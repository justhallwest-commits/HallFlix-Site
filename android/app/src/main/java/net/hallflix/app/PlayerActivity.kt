package net.hallflix.app

import android.app.Activity
import android.app.PendingIntent
import android.app.PictureInPictureParams
import android.app.RemoteAction
import android.app.UiModeManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.graphics.drawable.Icon
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.util.Rational
import android.os.Handler
import android.os.Looper
import android.view.KeyEvent
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.ForwardingPlayer
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.VideoSize
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.ui.PlayerView
import org.json.JSONArray
import org.json.JSONObject
import java.lang.ref.WeakReference
import java.util.concurrent.Executors

/**
 * Plays what the server queues: any pre-rolls, then the title. Files the device can play are streamed as-is;
 * the rest come through the server's converter as HLS. Progress goes back to the server every 10 seconds.
 */
@OptIn(UnstableApi::class)
class PlayerActivity : Activity() {
    /** One queue entry, ready to play. `offset` is where a converted stream starts in the film, in seconds. */
    private class Entry(val json: JSONObject, var uri: String, var hls: Boolean, var offset: Double, var sid: String?) {
        val main get() = json.optString("kind") == "main"
        /** The HallFlix ident before a feature: shown as a clean interlude, not as a video with player controls. */
        val interlude get() = json.optString("kind") == "ident"
        /** How loud to play it: pre-rolls and the ident come turned down to the movie's level when "even volume" is on. */
        val gain get() = json.optDouble("gain", 1.0).toFloat().coerceIn(0f, 1f)
        val itemId get() = json.getLong("itemId")
        val duration get() = json.optDouble("duration", 0.0)
    }

    private val io = Executors.newSingleThreadExecutor()
    private val ui = Handler(Looper.getMainLooper())
    private lateinit var exo: ExoPlayer
    private lateinit var view: PlayerView
    private lateinit var server: String
    private var token: String? = null
    private var entries = listOf<Entry>()
    private var caps = JSONObject()
    private var resumeAt = 0.0
    private var resumed = false
    private var retries = 0
    private var finished = false
    private var nextUp: Runnable? = null
    /** The credits (Studio mark) have been handled for this title: the countdown started, or skipped. */
    private var creditsDone = false
    /** Episodes that started on their own, one after another, since anyone last pressed a button. */
    private var autoPlays = 0
    private var lastInput = android.os.SystemClock.uptimeMillis()
    /** The next title's play answer, asked for during the credits so it starts at once: item id → answer. */
    private var prefetched: Pair<Long, JSONObject>? = null
    private var prefetchedAt = 0L
    private val remoteIo = Executors.newSingleThreadExecutor()
    // The same id and name the web app uses on this device, so the phone remote (and Play on TV) sees one screen.
    private var deviceId = java.util.UUID.randomUUID().toString().take(12)
    private var deviceName = if (android.os.Build.MODEL.startsWith("AFT")) "Fire TV" else android.os.Build.MODEL
    private var gestures: PlayerGestures? = null
    /** Playing a download (no server needed): its id. Progress is kept on the phone and sent once online. */
    private var offlineId = 0L
    private var inPip = false
    /** Phones and tablets: touch gestures and picture-in-picture. Never on Fire TV or Android TV. */
    private val tv by lazy {
        (getSystemService(Context.UI_MODE_SERVICE) as UiModeManager).currentModeType == Configuration.UI_MODE_TYPE_TELEVISION ||
            packageManager.hasSystemFeature("android.software.leanback") || packageManager.hasSystemFeature("amazon.hardware.fire_tv")
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_player)
        server = intent.getStringExtra("server") ?: return finish()
        token = intent.getStringExtra("token")
        intent.getStringExtra("device")?.takeIf { it.isNotEmpty() }?.let { deviceId = it }
        intent.getStringExtra("deviceName")?.takeIf { it.isNotEmpty() }?.let { deviceName = it }
        // Starting something new while an earlier film plays in the small window: that one stops.
        open?.get()?.takeIf { it !== this && !it.isFinishing }?.finish()
        open = WeakReference(this)
        caps = Server.caps(this)

        val http = DefaultHttpDataSource.Factory().setAllowCrossProtocolRedirects(true).setUserAgent("HallFlixApp")
        token?.let { http.setDefaultRequestProperties(mapOf("Authorization" to "Bearer $it")) }
        exo = ExoPlayer.Builder(this)
            .setRenderersFactory(DefaultRenderersFactory(this).setEnableDecoderFallback(true))
            .setMediaSourceFactory(DefaultMediaSourceFactory(http))
            .setSeekBackIncrementMs(10_000).setSeekForwardIncrementMs(30_000)
            .build()
        view = findViewById(R.id.player)
        view.player = Seeker(exo)
        view.setControllerVisibilityListener(PlayerView.ControllerVisibilityListener { v -> findViewById<View>(R.id.title).visibility = if (inPip) View.GONE else v })
        if (!tv && packageManager.hasSystemFeature(PackageManager.FEATURE_TOUCHSCREEN)) {
            gestures = PlayerGestures(this, view, findViewById(R.id.hud),
                enabled = { !inPip && current()?.interlude != true && findViewById<View>(R.id.message).visibility != View.VISIBLE },
                skip = { ms -> view.player?.let { p -> p.seekTo((p.currentPosition + ms).coerceAtLeast(0)) } },
                toggle = { if (exo.isPlaying) exo.pause() else exo.play() }).also { it.attach() }
        }
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(pipReceiver, IntentFilter(PIP_ACTION), Context.RECEIVER_NOT_EXPORTED)
        else registerReceiver(pipReceiver, IntentFilter(PIP_ACTION))

        exo.addListener(object : Player.Listener {
            override fun onMediaItemTransition(item: MediaItem?, reason: Int) { onEntryChanged() }
            override fun onPlaybackStateChanged(state: Int) {
                if (state == Player.STATE_READY) retries = 0
                if (state == Player.STATE_ENDED) onQueueEnded()
            }
            override fun onPlayerError(error: PlaybackException) { recover(error) }
            override fun onIsPlayingChanged(isPlaying: Boolean) { updatePip() }
            override fun onVideoSizeChanged(videoSize: VideoSize) { updatePip() }
        })
        offlineId = intent.getLongExtra("offline", 0L)
        if (offlineId > 0) { startOffline(offlineId); ui.postDelayed(tick, 10_000); ui.postDelayed(introWatch, 1000); return }
        start(intent.getLongExtra("itemId", 0), intent.getDoubleExtra("start", -1.0).takeIf { it >= 0 }, prerolls = true)
        ui.postDelayed(tick, 10_000)
        ui.postDelayed(introWatch, 1000)
        ui.postDelayed(remote, 2000)
    }

    private fun current(): Entry? = entries.getOrNull(exo.currentMediaItemIndex)
    private fun position(e: Entry) = e.offset + exo.currentPosition.coerceAtLeast(0) / 1000.0

    /** Ask the server what to play, get every entry a playable address, and start. */
    private fun start(itemId: Long, startAt: Double?, prerolls: Boolean) {
        hideMessage()
        io.execute {
            try {
                val body = JSONObject().put("itemId", itemId).put("caps", caps).put("prerolls", prerolls)
                if (startAt != null) body.put("start", startAt)
                // Used only while fresh: a server stream not asked for within a minute may have been tidied away.
                val ready = prefetched?.takeIf { it.first == itemId && startAt == null && android.os.SystemClock.uptimeMillis() - prefetchedAt < 60_000 }?.second
                prefetched = null
                val queue = (ready ?: Server.call(server, token, "POST", "/api/play", body)).getJSONArray("queue")
                val list = (0 until queue.length()).map { i ->
                    val q = queue.getJSONObject(i)
                    resolve(q, if (q.optString("kind") == "main") q.optDouble("resumeAt", 0.0) else 0.0)
                }
                ui.post {
                    if (isFinishing) return@post
                    stopSessions()
                    creditsDone = false
                    entries = list
                    resumeAt = list.lastOrNull()?.json?.optDouble("resumeAt", 0.0) ?: 0.0
                    resumed = false
                    list.firstOrNull()?.let { interludeMode(it.interlude); exo.volume = it.gain } // before playback starts, so the controls never flash up
                    exo.setMediaItems(list.mapIndexed { i, e -> mediaItem(e, i) })
                    exo.prepare()
                    exo.playWhenReady = true
                    onEntryChanged()
                }
            } catch (e: Exception) {
                ui.post { showMessage("Can't play this right now", e.message ?: "Something went wrong.", "Go back") { finish() } }
            }
        }
    }

    /** A downloaded film or episode, from the phone: its file, its subtitles, and where it was stopped. */
    private fun startOffline(id: Long) {
        hideMessage()
        val d = DownloadStore.find(this, id)
        val file = d?.let { DownloadStore.file(this, it) }
        if (d == null || file == null) { showMessage("Not downloaded", "This download isn't on the phone any more.", "Go back") { finish() }; return }
        val meta = d.optJSONObject("meta") ?: JSONObject()
        val json = JSONObject(meta.toString()).put("kind", "main").put("itemId", id).put("duration", meta.optDouble("runtime", 0.0))
        json.put("subtitle", meta.optJSONObject("show")?.let { s -> "${s.optString("title")} · S${s.optInt("season")} E${s.optInt("episode")}" } ?: meta.optString("year").takeIf { it != "null" } ?: "")
        // The next episode plays on if it's downloaded too.
        meta.optLong("nextId").takeIf { it > 0 }?.let { n -> DownloadStore.find(this, n)?.takeIf { DownloadStore.file(this, it) != null }?.let { json.put("next", JSONObject().put("id", n).put("title", it.optString("title")).apply { it.optJSONObject("meta")?.optJSONObject("show")?.let { s -> put("show", s) } }) } }
        val subs = JSONArray()
        d.optJSONArray("subs")?.let { a -> for (i in 0 until a.length()) a.getJSONObject(i).let { s -> subs.put(JSONObject().put("id", "x$i").put("label", s.optString("label")).put("lang", s.optString("lang")).put("file", s.optString("file"))) } }
        json.put("subs", subs)
        val e = Entry(json, Uri.fromFile(file).toString(), false, 0.0, null)
        entries = listOf(e)
        resumeAt = if (d.optBoolean("watched") && d.optDouble("position", 0.0) == 0.0) 0.0 else d.optDouble("position", 0.0)
        resumed = false
        exo.setMediaItems(listOf(mediaItem(e, 0)))
        exo.prepare()
        exo.playWhenReady = true
        onEntryChanged()
    }

    /** Runs on the io thread. Direct files play from /api/file; everything else starts a converted stream at `at`. */
    private fun resolve(q: JSONObject, at: Double): Entry {
        if (q.optString("mode") == "direct") return Entry(q, server + q.optString("url", "/api/file/${q.getLong("itemId")}"), false, 0.0, null)
        val s = Server.call(server, token, "POST", "/api/play/session", JSONObject().put("itemId", q.getLong("itemId")).put("start", at).put("caps", caps))
        if (s.optBoolean("direct")) return Entry(q, server + s.getString("url"), false, 0.0, null)
        return Entry(q, server + s.getString("url"), true, s.optDouble("start", at), s.getString("sid"))
    }

    private fun mediaItem(e: Entry, index: Int): MediaItem {
        val b = MediaItem.Builder().setUri(Uri.parse(e.uri)).setTag(index)
        if (e.hls) b.setMimeType(MimeTypes.APPLICATION_M3U8)
        // Embedded subtitles in files are found by the player itself; add the server's subtitle tracks where they line up.
        val subs = e.json.optJSONArray("subs") ?: JSONArray()
        val configs = (0 until subs.length()).map { subs.getJSONObject(it) }
            .filter { s -> if (e.hls) e.offset < 1 else s.optString("id").startsWith("x") }
            .map { s ->
                val where = if (s.has("file")) Uri.fromFile(java.io.File(DownloadStore.dir(this), s.getString("file"))) else Uri.parse(server + s.getString("url") + (token?.let { "?t=$it" } ?: ""))
                MediaItem.SubtitleConfiguration.Builder(where)
                    .setMimeType(MimeTypes.TEXT_VTT).setLanguage(s.optString("lang").ifEmpty { null }).setLabel(s.optString("label")).build()
            }
        if (configs.isNotEmpty()) b.setSubtitleConfigurations(configs)
        return b.build()
    }

    /**
     * The ident plays like a channel ident on TV: full screen, no seek bar, no buffering spinner, no title. OK, Right or
     * fast-forward skip it; Back leaves as usual. Everything else plays with the normal controls.
     */
    private fun interludeMode(on: Boolean) {
        view.useController = !on && !inPip
        view.controllerAutoShow = !on
        if (on) view.hideController()
        view.setShowBuffering(if (on) PlayerView.SHOW_BUFFERING_NEVER else PlayerView.SHOW_BUFFERING_ALWAYS)
        findViewById<View>(R.id.title).visibility = if (on) View.GONE else findViewById<View>(R.id.title).visibility
    }

    private fun onEntryChanged() {
        val e = current() ?: return
        updatePip()
        interludeMode(e.interlude)
        exo.volume = e.gain
        val title = findViewById<TextView>(R.id.title)
        findViewById<View>(R.id.badge).visibility = if (e.main || e.json.optString("kind") == "ident") View.GONE else View.VISIBLE
        title.text = if (e.main) listOf(e.json.optString("title"), e.json.optString("subtitle")).filter { it.isNotEmpty() }.joinToString("  ·  ") else ""
        // A file that plays as-is resumes by seeking; a converted stream already starts at the resume point.
        if (e.main && !resumed) {
            resumed = true
            if (!e.hls && resumeAt > 1) exo.seekTo(exo.currentMediaItemIndex, (resumeAt * 1000).toLong())
        }
    }

    /** Seeking inside a converted stream that has not been made yet restarts the stream at that point. */
    private inner class Seeker(p: Player) : ForwardingPlayer(p) {
        override fun seekTo(positionMs: Long) = seekTo(currentMediaItemIndex, positionMs)
        override fun seekTo(mediaItemIndex: Int, positionMs: Long) {
            val e = entries.getOrNull(mediaItemIndex)
            if (e == null || !e.hls || !e.main) return super.seekTo(mediaItemIndex, positionMs)
            val made = exo.duration.takeIf { it != C.TIME_UNSET } ?: 0L
            if (positionMs in 0..(made - 15_000).coerceAtLeast(0)) return super.seekTo(mediaItemIndex, positionMs)
            restartAt(mediaItemIndex, e, e.offset + positionMs / 1000.0)
        }
        override fun seekForward() = seekTo(currentPosition + seekForwardIncrement)
        override fun seekBack() = seekTo((currentPosition - seekBackIncrement).coerceAtLeast(0))
    }

    private fun restartAt(index: Int, e: Entry, at: Double) {
        val old = e.sid
        io.execute {
            try {
                val s = Server.call(server, token, "POST", "/api/play/session",
                    JSONObject().put("itemId", e.itemId).put("start", at).put("caps", caps).put("replace", old ?: JSONObject.NULL))
                ui.post {
                    if (isFinishing) return@post
                    if (s.optBoolean("direct")) { e.uri = server + s.getString("url"); e.hls = false; e.offset = 0.0; e.sid = null }
                    else { e.uri = server + s.getString("url"); e.hls = true; e.offset = s.optDouble("start", at); e.sid = s.getString("sid") }
                    exo.addMediaItem(index, mediaItem(e, index))
                    exo.removeMediaItem(index + 1)
                    exo.seekTo(index, if (e.hls) 0 else (at * 1000).toLong())
                    exo.prepare()
                    exo.playWhenReady = true
                }
            } catch (err: Exception) { ui.post { recover(null) } }
        }
    }

    /** A dropped stream (expired session, network blip) restarts where the viewer was, up to three times. */
    private fun recover(error: PlaybackException?) {
        val e = current() ?: return
        if (offlineId > 0) { showMessage("Can't play this download", error?.message ?: "The file could not be played.", "Go back") { finish() }; return }
        retries++
        if (retries > 3 || (!e.hls && error?.errorCode == PlaybackException.ERROR_CODE_DECODING_FAILED && !e.main)) {
            if (!e.main && exo.hasNextMediaItem()) { exo.seekToNextMediaItem(); exo.prepare(); return } // skip a broken pre-roll
            showMessage("Playback stopped", error?.message ?: "The stream could not continue.", "Go back") { finish() }
            return
        }
        if (!e.main) { exo.prepare(); return }
        val at = position(e)
        if (!e.hls) {
            // The device could not play the file after all: ask the server to convert it instead.
            io.execute {
                try {
                    val s = Server.call(server, token, "POST", "/api/play/session",
                        JSONObject().put("itemId", e.itemId).put("start", at).put("caps", JSONObject(caps.toString()).put("containers", JSONArray())))
                    ui.post {
                        e.uri = server + s.getString("url"); e.hls = !s.optBoolean("direct"); e.offset = s.optDouble("start", 0.0); e.sid = s.optString("sid").ifEmpty { null }
                        val i = exo.currentMediaItemIndex
                        exo.addMediaItem(i, mediaItem(e, i)); exo.removeMediaItem(i + 1); exo.seekTo(i, 0); exo.prepare(); exo.playWhenReady = true
                    }
                } catch (err: Exception) { ui.post { showMessage("Can't play this right now", err.message ?: "", "Go back") { finish() } } }
            }
        } else restartAt(exo.currentMediaItemIndex, e, at)
    }

    private fun onQueueEnded() {
        val e = entries.lastOrNull() ?: return finish()
        report(ended = true)
        val next = e.json.optJSONObject("next") ?: return finish()
        if (nextUp != null) return // already counting down from the credits
        countdown(next, 8)
    }

    /**
     * "Up next in 8…" then the next episode plays. From the credits mark it starts early (left keeps watching the credits).
     * After three episodes in a row with nobody pressing anything for 90 minutes, it asks "Still watching?" instead.
     */
    private fun countdown(next: JSONObject, seconds: Int, fromCredits: Boolean = false) {
        nextUp?.let { ui.removeCallbacks(it) }
        prefetch(next.optLong("id"))
        var left = seconds
        val show = next.optJSONObject("show")
        val label = if (show != null) "S${show.optInt("season")} E${show.optInt("episode")} · ${next.optString("title")}" else next.optString("title")
        val tickDown = object : Runnable {
            override fun run() {
                if (left <= 0) {
                    nextUp = null
                    val idle = android.os.SystemClock.uptimeMillis() - lastInput
                    if (autoPlays >= 3 && idle > 90 * 60_000L) { stillWatching(next); return }
                    autoPlays++
                    playNext(next.getLong("id"))
                    return
                }
                showMessage(if (fromCredits) "Up next in $left  ·  ← to keep watching" else "Up next in $left", label, "Play now") {
                    ui.removeCallbacks(this); nextUp = null; autoPlays = 0; playNext(next.getLong("id"))
                }
                left--
                ui.postDelayed(this, 1000)
            }
        }
        nextUp = tickDown
        tickDown.run()
    }

    /** Nobody has touched the remote for a long while: ask before playing on, and stop if there's no answer. */
    private fun stillWatching(next: JSONObject) {
        exo.pause()
        val giveUp = Runnable { finish() }
        showMessage("Are you still watching?", "Nothing has been pressed for a while, so HallFlix paused.", "Keep watching") {
            ui.removeCallbacks(giveUp); autoPlays = 0; lastInput = android.os.SystemClock.uptimeMillis(); playNext(next.getLong("id"))
        }
        ui.postDelayed(giveUp, 60_000)
    }

    /** Ask for the next title's stream now, during the credits, so it starts the moment it's needed. */
    private fun prefetch(id: Long) {
        if (id <= 0 || offlineId > 0 || (prefetched?.first == id && android.os.SystemClock.uptimeMillis() - prefetchedAt < 60_000)) return
        io.execute {
            try {
                val r = Server.call(server, token, "POST", "/api/play", JSONObject().put("itemId", id).put("caps", caps).put("prerolls", false))
                ui.post { if (!isFinishing) { prefetched = id to r; prefetchedAt = android.os.SystemClock.uptimeMillis() } }
            } catch (_: Exception) { /* it's asked for again when it plays */ }
        }
    }

    private fun playNext(id: Long) { if (offlineId > 0) { offlineId = id; startOffline(id) } else start(id, null, prerolls = false) }

    private fun report(ended: Boolean = false) {
        if (!::exo.isInitialized) return
        val e = current() ?: return
        if (!e.main || exo.playbackState == Player.STATE_IDLE) return
        val dur = if (e.duration > 0) e.duration else e.offset + exo.duration.coerceAtLeast(0) / 1000.0
        val pos = if (ended) dur else position(e)
        if (offlineId > 0) { DownloadStore.savePosition(this, e.itemId, pos, dur, ended); return }
        val body = JSONObject().put("itemId", e.itemId).put("position", pos).put("duration", dur).put("ended", ended)
        io.execute { try { Server.call(server, token, "POST", "/api/progress", body) } catch (_: Exception) { } }
    }

    private val tick = object : Runnable {
        override fun run() {
            if (exo.isPlaying) report()
            if (offlineId == 0L) for (sid in entries.mapNotNull { it.sid }) io.execute { try { Server.call(server, token, "POST", "/api/play/ping/$sid") } catch (_: Exception) { } }
            ui.postDelayed(this, 10_000)
        }
    }

    /** While the intro the Studio marked is playing, offer to skip it. */
    private var introShown = false
    private val introWatch = object : Runnable {
        override fun run() {
            val e = current()
            val m = if (e != null && e.main) e.json.optJSONObject("marks") else null
            val end = m?.optDouble("introEnd", 0.0) ?: 0.0
            val inIntro = e != null && end > 0 && nextUp == null && position(e) >= (m?.optDouble("introStart", 0.0) ?: 0.0) && position(e) < end - 1
            if (inIntro && !introShown) {
                introShown = true
                showMessage("Intro", "Skip ahead to the episode", "Skip intro") { view.player?.seekTo(((end - e!!.offset) * 1000).toLong().coerceAtLeast(0)); hideMessage(); introShown = false }
            } else if (!inIntro && introShown) { introShown = false; if (nextUp == null) hideMessage() }
            // The credits mark: the next episode is offered straight away; a film offers to skip the credits.
            val credits = m?.optDouble("credits", 0.0) ?: 0.0
            if (e != null && e.main && credits > 0 && !creditsDone && nextUp == null && exo.isPlaying && position(e) >= credits) {
                creditsDone = true
                val next = e.json.optJSONObject("next")
                if (next != null) countdown(next, 12, fromCredits = true)
                else showMessage("Credits", "That's the end of ${e.json.optString("title").ifEmpty { "the film" }}", "Skip credits") { finish() }
            }
            ui.postDelayed(this, 1000)
        }
    }

    /** The phone remote: say what is playing every two seconds and do what the phone asked. */
    private val remote = object : Runnable {
        override fun run() {
            val e = current()
            if (e != null && e.main && exo.playbackState != Player.STATE_IDLE && !finished) {
                val dur = if (e.duration > 0) e.duration else e.offset + exo.duration.coerceAtLeast(0) / 1000.0
                val next = e.json.optJSONObject("next")
                val body = JSONObject().put("device", deviceId).put("name", deviceName).put("tv", tv).put("itemId", e.itemId).put("title", e.json.optString("title"))
                    .put("subtitle", e.json.optString("subtitle")).put("position", position(e)).put("duration", dur).put("paused", !exo.isPlaying)
                    .put("art", e.json.optString("backdrop")).put("hasNext", next != null)
                remoteIo.execute {
                    try {
                        val cmds = Server.call(server, token, "POST", "/api/remote/state", body).optJSONArray("commands") ?: JSONArray()
                        if (cmds.length() > 0) ui.post { for (i in 0 until cmds.length()) command(cmds.getJSONObject(i), e, next) }
                    } catch (_: Exception) { }
                }
            }
            ui.postDelayed(this, 2000)
        }
    }

    private fun command(c: JSONObject, e: Entry, next: JSONObject?) {
        if (finished || current() !== e) return
        val p = view.player ?: return
        val v = c.optDouble("value", 0.0)
        when (c.optString("cmd")) {
            "toggle" -> if (exo.isPlaying) exo.pause() else exo.play()
            "play" -> exo.play()
            "pause" -> exo.pause()
            "seek" -> p.seekTo(((v - e.offset) * 1000).toLong().coerceAtLeast(0))
            "skip" -> p.seekTo((exo.currentPosition + (v * 1000).toLong()).coerceAtLeast(0))
            "next" -> if (next != null) { report(); start(next.getLong("id"), null, prerolls = false) }
            "stop" -> finish()
            // Play on TV from a phone while something is already playing here: the new title replaces it.
            "start" -> c.optLong("itemId").takeIf { it > 0 }?.let { id -> report(); stopSessions(); start(id, v.takeIf { it > 0 }, prerolls = true) }
        }
    }

    // ---------- Picture-in-picture (phones and tablets, Android 8 and up) ----------

    private fun pipAllowed() = Build.VERSION.SDK_INT >= 26 && !tv && packageManager.hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE)
    /** Leaving the app while a film plays (Home, or switching apps) shrinks it to a small window that keeps playing. */
    private fun pipWanted() = pipAllowed() && ::exo.isInitialized && exo.isPlaying && current()?.main == true && !finished

    private fun pipParams(): PictureInPictureParams? {
        if (Build.VERSION.SDK_INT < 26) return null
        val vs = exo.videoSize
        val ratio = if (vs.width > 0 && vs.height > 0) Rational((vs.width * vs.pixelWidthHeightRatio).toInt().coerceAtLeast(1), vs.height) else Rational(16, 9)
        val clamped = when { ratio.toFloat() > 2.39f -> Rational(239, 100); ratio.toFloat() < 0.42f -> Rational(100, 239); else -> ratio }
        val playing = exo.isPlaying
        fun action(cmd: String, icon: Int, label: String, code: Int) = RemoteAction(Icon.createWithResource(this, icon), label, label,
            PendingIntent.getBroadcast(this, code, Intent(PIP_ACTION).setPackage(packageName).putExtra("cmd", cmd), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
        val b = PictureInPictureParams.Builder().setAspectRatio(clamped).setActions(listOf(
            action("back", android.R.drawable.ic_media_rew, "Back 10 seconds", 1),
            if (playing) action("toggle", android.R.drawable.ic_media_pause, "Pause", 2) else action("toggle", android.R.drawable.ic_media_play, "Play", 2),
            action("forward", android.R.drawable.ic_media_ff, "Forward 10 seconds", 3)))
        // Android 12+: swiping Home shrinks the film smoothly, without waiting for the app to ask.
        if (Build.VERSION.SDK_INT >= 31) b.setAutoEnterEnabled(pipWanted()).setSeamlessResizeEnabled(true)
        return b.build()
    }

    private fun updatePip() {
        if (Build.VERSION.SDK_INT < 26 || !pipAllowed() || !::exo.isInitialized) return
        try { pipParams()?.let { setPictureInPictureParams(it) } } catch (_: Exception) { }
    }

    override fun onUserLeaveHint() {
        super.onUserLeaveHint()
        if (Build.VERSION.SDK_INT in 26..30 && pipWanted()) try { pipParams()?.let { enterPictureInPictureMode(it) } } catch (_: Exception) { }
    }

    override fun onPictureInPictureModeChanged(isInPictureInPictureMode: Boolean, newConfig: Configuration) {
        super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig)
        inPip = isInPictureInPictureMode
        val interlude = current()?.interlude == true
        view.useController = !inPip && !interlude
        if (inPip) {
            view.hideController()
            gestures?.hide()
            findViewById<View>(R.id.title).visibility = View.GONE
            findViewById<View>(R.id.badge).visibility = View.GONE
        } else onEntryChanged()
    }

    /** The small window's buttons. */
    private val pipReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            val p = view.player ?: return
            when (intent.getStringExtra("cmd")) {
                "toggle" -> if (exo.isPlaying) exo.pause() else exo.play()
                "back" -> p.seekTo((p.currentPosition - 10_000).coerceAtLeast(0))
                "forward" -> p.seekTo(p.currentPosition + 10_000)
            }
        }
    }

    private fun stopSessions() {
        for (sid in entries.mapNotNull { it.sid }) io.execute { try { Server.call(server, token, "DELETE", "/api/play/session/$sid") } catch (_: Exception) { } }
    }

    private fun showMessage(small: String, text: String, button: String, action: () -> Unit) {
        val box = findViewById<LinearLayout>(R.id.message)
        findViewById<TextView>(R.id.message_small).text = small
        findViewById<TextView>(R.id.message_text).text = text
        val b = findViewById<Button>(R.id.message_button)
        b.text = button
        b.setOnClickListener { action() }
        val wasHidden = box.visibility != View.VISIBLE
        box.visibility = View.VISIBLE
        if (wasHidden) b.requestFocus()
    }

    private fun hideMessage() { findViewById<View>(R.id.message).visibility = View.GONE }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (event.action == KeyEvent.ACTION_DOWN) { lastInput = android.os.SystemClock.uptimeMillis(); autoPlays = 0 }
        // Counting down over the credits: Left (or Play/Pause) keeps watching them.
        if (nextUp != null && event.action == KeyEvent.ACTION_UP && event.keyCode in listOf(KeyEvent.KEYCODE_DPAD_LEFT, KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE)
            && exo.playbackState != Player.STATE_ENDED) {
            nextUp?.let { ui.removeCallbacks(it) }; nextUp = null; hideMessage(); return true
        }
        val msg = findViewById<View>(R.id.message).visibility == View.VISIBLE
        if (event.keyCode == KeyEvent.KEYCODE_BACK) return super.dispatchKeyEvent(event)
        if (msg) return super.dispatchKeyEvent(event)
        if (current()?.interlude == true) {
            val skip = event.keyCode in listOf(KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER, KeyEvent.KEYCODE_DPAD_RIGHT, KeyEvent.KEYCODE_MEDIA_FAST_FORWARD, KeyEvent.KEYCODE_MEDIA_NEXT)
            if (skip && event.action == KeyEvent.ACTION_UP && exo.hasNextMediaItem()) { exo.seekToNextMediaItem(); exo.playWhenReady = true }
            return true // no controls appear during the ident
        }
        return view.dispatchKeyEvent(event) || super.dispatchKeyEvent(event)
    }

    override fun onStop() {
        super.onStop()
        // The small window was closed: stop, as if Back had been pressed.
        if (inPip) { finish(); return }
        if (!isFinishing) { report(); exo.pause() }
    }

    override fun finish() {
        if (!finished) {
            finished = true
            nextUp?.let { ui.removeCallbacks(it) }
            report()
            if (offlineId == 0L) try { remoteIo.execute { try { Server.call(server, token, "POST", "/api/remote/state", JSONObject().put("device", deviceId).put("closed", true)) } catch (_: Exception) { } } } catch (_: Exception) { }
            if (::exo.isInitialized) stopSessions()
        }
        super.finish()
    }

    override fun onDestroy() {
        try { unregisterReceiver(pipReceiver) } catch (_: Exception) { }
        if (open?.get() === this) open = null
        ui.removeCallbacksAndMessages(null)
        if (::exo.isInitialized) exo.release()
        io.shutdown()
        remoteIo.shutdown()
        super.onDestroy()
    }
}

private const val PIP_ACTION = "net.hallflix.app.PIP"
/** The player on screen (or in the small window), so starting another film can close it. */
private var open: WeakReference<PlayerActivity>? = null
