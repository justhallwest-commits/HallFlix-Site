package net.hallflix.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.MediaMetadata
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.webkit.CookieManager
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

/**
 * Keeps HallFlix music playing with the screen off or another app open, the way music apps do: a media notification
 * and lock-screen controls (previous, play/pause, next, seek), with the song, artist and cover.
 *
 * The music itself plays in the web app. It tells this service what is playing (MainActivity's bridge →
 * [update]); the buttons send commands back to the web app through [commands]. Android only lets an app keep
 * playing in the background while it shows a notification like this one, so the service runs while there is music
 * and stops when the music is stopped.
 */
class MusicService : Service() {
    companion object {
        /** Runs a command in the web app's music player: "resume()", "pause()", "next()", "prev()", "seek(12.5)", "stop()". */
        @Volatile var commands: ((String) -> Unit)? = null
        @Volatile private var running: MusicService? = null
        @Volatile private var pending: JSONObject? = null
        private const val CHANNEL = "music"
        private const val NOTE = 7

        /** What the web app's music player is doing: { state: playing|paused|stopped, title, artist, album, art, position, duration }. */
        fun update(ctx: Context, state: JSONObject) {
            Handler(Looper.getMainLooper()).post {
                val s = running
                if (s != null) { s.apply(state); return@post }
                if (state.optString("state") != "playing") return@post
                pending = state
                val i = Intent(ctx, MusicService::class.java)
                try { if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(i) else ctx.startService(i) } catch (_: Exception) { }
            }
        }

        val isPlaying get() = running?.playing == true
        fun stopAll() { running?.end() }
    }

    private lateinit var session: MediaSession
    private val io = Executors.newSingleThreadExecutor()
    private var state = JSONObject()
    private var playing = false
    private var art: Bitmap? = null
    private var artUrl = ""
    private var foreground = false
    private var wake: PowerManager.WakeLock? = null
    private var wifi: WifiManager.WifiLock? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        running = this
        if (Build.VERSION.SDK_INT >= 26) {
            (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).createNotificationChannel(
                NotificationChannel(CHANNEL, "Music", NotificationManager.IMPORTANCE_LOW).apply { description = "What is playing, with controls"; setShowBadge(false) })
        }
        session = MediaSession(this, "HallFlix").apply {
            setCallback(object : MediaSession.Callback() {
                override fun onPlay() { send("resume()") }
                override fun onPause() { send("pause()") }
                override fun onSkipToNext() { send("next()") }
                override fun onSkipToPrevious() { send("prev()") }
                override fun onSeekTo(pos: Long) { send("seek(${pos / 1000.0})") }
                override fun onStop() { send("stop()") }
            })
            setSessionActivity(openApp())
            isActive = true
        }
        val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
        wake = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "HallFlix:music").apply { setReferenceCounted(false) }
        @Suppress("DEPRECATION")
        wifi = (applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager)?.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "HallFlix:music")?.apply { setReferenceCounted(false) }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // Android requires the notification straight away after starting a service like this one.
        if (!foreground) goForeground()
        pending?.let { pending = null; apply(it) }
        when (intent?.action) {
            "hf.prev" -> send("prev()")
            "hf.toggle" -> send(if (playing) "pause()" else "resume()")
            "hf.next" -> send("next()")
            "hf.stop" -> { send("stop()"); end() }
        }
        return START_NOT_STICKY
    }

    /** Swiping HallFlix away from recent apps closes the web app, and its music with it. */
    override fun onTaskRemoved(rootIntent: Intent?) { end() }

    override fun onDestroy() {
        running = null
        releaseLocks()
        try { session.isActive = false; session.release() } catch (_: Exception) { }
        io.shutdown()
        super.onDestroy()
    }

    private fun send(js: String) { commands?.invoke(js) }

    fun apply(s: JSONObject) {
        if (s.optString("state") == "stopped") { end(); return }
        state = s
        playing = s.optString("state") == "playing"
        if (playing) { wake?.acquire(6 * 60 * 60 * 1000L); try { wifi?.acquire() } catch (_: Exception) { } } else releaseLocks()
        val url = s.optString("art")
        if (url != artUrl) { artUrl = url; art = null; loadArt(url) }
        session.setMetadata(metadata())
        session.setPlaybackState(PlaybackState.Builder()
            .setActions(PlaybackState.ACTION_PLAY or PlaybackState.ACTION_PAUSE or PlaybackState.ACTION_PLAY_PAUSE or PlaybackState.ACTION_SKIP_TO_NEXT or
                PlaybackState.ACTION_SKIP_TO_PREVIOUS or PlaybackState.ACTION_SEEK_TO or PlaybackState.ACTION_STOP)
            .setState(if (playing) PlaybackState.STATE_PLAYING else PlaybackState.STATE_PAUSED, (s.optDouble("position", 0.0) * 1000).toLong(), if (playing) 1f else 0f)
            .build())
        if (foreground) (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).notify(NOTE, notification())
        else goForeground()
    }

    private fun metadata(): MediaMetadata = MediaMetadata.Builder()
        .putString(MediaMetadata.METADATA_KEY_TITLE, state.optString("title"))
        .putString(MediaMetadata.METADATA_KEY_ARTIST, state.optString("artist"))
        .putString(MediaMetadata.METADATA_KEY_ALBUM, state.optString("album"))
        .putLong(MediaMetadata.METADATA_KEY_DURATION, (state.optDouble("duration", 0.0) * 1000).toLong())
        .apply { art?.let { putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART, it) } }
        .build()

    private fun goForeground() {
        val n = notification()
        try {
            if (Build.VERSION.SDK_INT >= 29) startForeground(NOTE, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK) else startForeground(NOTE, n)
            foreground = true
        } catch (_: Exception) { stopSelf() }
    }

    fun end() {
        releaseLocks()
        try { session.isActive = false } catch (_: Exception) { }
        if (Build.VERSION.SDK_INT >= 24) stopForeground(STOP_FOREGROUND_REMOVE) else stopForeground(true)
        foreground = false
        stopSelf()
    }

    private fun releaseLocks() {
        try { if (wake?.isHeld == true) wake?.release() } catch (_: Exception) { }
        try { if (wifi?.isHeld == true) wifi?.release() } catch (_: Exception) { }
    }

    private fun openApp(): PendingIntent = PendingIntent.getActivity(this, 0,
        Intent(this, MainActivity::class.java).setAction(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)

    private fun button(action: String, code: Int): PendingIntent =
        PendingIntent.getService(this, code, Intent(this, MusicService::class.java).setAction(action), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)

    @Suppress("DEPRECATION")
    private fun notification(): Notification {
        val b = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, CHANNEL) else Notification.Builder(this)
        return b.setSmallIcon(R.drawable.ic_stat_music)
            .setContentTitle(state.optString("title").ifEmpty { "HallFlix" })
            .setContentText(listOf(state.optString("artist"), state.optString("album")).filter { it.isNotEmpty() }.joinToString(" · "))
            .setLargeIcon(art)
            .setContentIntent(openApp())
            .setDeleteIntent(button("hf.stop", 14))
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .setShowWhen(false)
            .setOngoing(playing)
            .addAction(Notification.Action.Builder(android.R.drawable.ic_media_previous, "Previous", button("hf.prev", 11)).build())
            .addAction(Notification.Action.Builder(if (playing) android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play, if (playing) "Pause" else "Play", button("hf.toggle", 12)).build())
            .addAction(Notification.Action.Builder(android.R.drawable.ic_media_next, "Next", button("hf.next", 13)).build())
            .setStyle(Notification.MediaStyle().setMediaSession(session.sessionToken).setShowActionsInCompactView(0, 1, 2))
            .build()
    }

    /** The cover, fetched with the web app's sign-in so private artwork loads too. */
    private fun loadArt(url: String) {
        if (url.isEmpty()) return
        io.execute {
            try {
                val c = URL(url).openConnection() as HttpURLConnection
                c.connectTimeout = 8000; c.readTimeout = 15000
                CookieManager.getInstance().getCookie(url)?.let { c.setRequestProperty("Cookie", it) }
                val bytes = c.inputStream.use { it.readBytes() }
                c.disconnect()
                val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
                var sample = 1
                while (bounds.outWidth / (sample * 2) >= 512) sample *= 2
                val bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample }) ?: return@execute
                Handler(Looper.getMainLooper()).post {
                    if (url != artUrl || running !== this) return@post
                    art = bmp
                    session.setMetadata(metadata())
                    if (foreground) (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).notify(NOTE, notification())
                }
            } catch (_: Exception) { }
        }
    }
}
