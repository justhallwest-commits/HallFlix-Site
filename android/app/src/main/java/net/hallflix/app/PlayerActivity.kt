package net.hallflix.app

import android.app.Activity
import android.net.Uri
import android.os.Bundle
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
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.ui.PlayerView
import org.json.JSONArray
import org.json.JSONObject
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
    private val remoteIo = Executors.newSingleThreadExecutor()
    private val deviceId = java.util.UUID.randomUUID().toString().take(12)
    private val deviceName = if (android.os.Build.MODEL.startsWith("AFT")) "Fire TV" else android.os.Build.MODEL

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_player)
        server = intent.getStringExtra("server") ?: return finish()
        token = intent.getStringExtra("token")
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
        view.setControllerVisibilityListener(PlayerView.ControllerVisibilityListener { v -> findViewById<View>(R.id.title).visibility = v })

        exo.addListener(object : Player.Listener {
            override fun onMediaItemTransition(item: MediaItem?, reason: Int) { onEntryChanged() }
            override fun onPlaybackStateChanged(state: Int) {
                if (state == Player.STATE_READY) retries = 0
                if (state == Player.STATE_ENDED) onQueueEnded()
            }
            override fun onPlayerError(error: PlaybackException) { recover(error) }
        })
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
                val queue = Server.call(server, token, "POST", "/api/play", body).getJSONArray("queue")
                val list = (0 until queue.length()).map { i ->
                    val q = queue.getJSONObject(i)
                    resolve(q, if (q.optString("kind") == "main") q.optDouble("resumeAt", 0.0) else 0.0)
                }
                ui.post {
                    if (isFinishing) return@post
                    stopSessions()
                    entries = list
                    resumeAt = list.lastOrNull()?.json?.optDouble("resumeAt", 0.0) ?: 0.0
                    resumed = false
                    list.firstOrNull()?.let { interludeMode(it.interlude) } // before playback starts, so the controls never flash up
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
                MediaItem.SubtitleConfiguration.Builder(Uri.parse(server + s.getString("url") + (token?.let { "?t=$it" } ?: "")))
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
        view.useController = !on
        view.controllerAutoShow = !on
        if (on) view.hideController()
        view.setShowBuffering(if (on) PlayerView.SHOW_BUFFERING_NEVER else PlayerView.SHOW_BUFFERING_ALWAYS)
        findViewById<View>(R.id.title).visibility = if (on) View.GONE else findViewById<View>(R.id.title).visibility
    }

    private fun onEntryChanged() {
        val e = current() ?: return
        interludeMode(e.interlude)
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
        var left = 8
        val show = next.optJSONObject("show")
        val label = if (show != null) "S${show.optInt("season")} E${show.optInt("episode")} · ${next.optString("title")}" else next.optString("title")
        val tickDown = object : Runnable {
            override fun run() {
                if (left <= 0) { nextUp = null; start(next.getLong("id"), null, prerolls = false); return }
                showMessage("Up next in $left", label, "Play now") { ui.removeCallbacks(this); nextUp = null; start(next.getLong("id"), null, prerolls = false) }
                left--
                ui.postDelayed(this, 1000)
            }
        }
        nextUp = tickDown
        tickDown.run()
    }

    private fun report(ended: Boolean = false) {
        if (!::exo.isInitialized) return
        val e = current() ?: return
        if (!e.main || exo.playbackState == Player.STATE_IDLE) return
        val dur = if (e.duration > 0) e.duration else e.offset + exo.duration.coerceAtLeast(0) / 1000.0
        val pos = if (ended) dur else position(e)
        val body = JSONObject().put("itemId", e.itemId).put("position", pos).put("duration", dur).put("ended", ended)
        io.execute { try { Server.call(server, token, "POST", "/api/progress", body) } catch (_: Exception) { } }
    }

    private val tick = object : Runnable {
        override fun run() {
            if (exo.isPlaying) report()
            for (sid in entries.mapNotNull { it.sid }) io.execute { try { Server.call(server, token, "POST", "/api/play/ping/$sid") } catch (_: Exception) { } }
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
                val body = JSONObject().put("device", deviceId).put("name", deviceName).put("itemId", e.itemId).put("title", e.json.optString("title"))
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
        if (!isFinishing) { report(); exo.pause() }
    }

    override fun finish() {
        if (!finished) {
            finished = true
            nextUp?.let { ui.removeCallbacks(it) }
            report()
            try { remoteIo.execute { try { Server.call(server, token, "POST", "/api/remote/state", JSONObject().put("device", deviceId).put("closed", true)) } catch (_: Exception) { } } } catch (_: Exception) { }
            if (::exo.isInitialized) stopSessions()
        }
        super.finish()
    }

    override fun onDestroy() {
        ui.removeCallbacksAndMessages(null)
        if (::exo.isInitialized) exo.release()
        io.shutdown()
        remoteIo.shutdown()
        super.onDestroy()
    }
}
