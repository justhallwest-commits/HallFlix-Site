package net.hallflix.app

import android.app.Activity
import android.graphics.Color
import android.graphics.drawable.StateListDrawable
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.TextView
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import com.bumptech.glide.Glide
import org.json.JSONObject

/**
 * The welcome ident after signing in, played by the app's own video player (hardware decoding, so it shows on Fire TV
 * sticks that can't play it in a web page). The sign-in logo shows until the first frame. Only Back or the Skip button
 * end it early. "Keep the sign-in music playing" carries on the song and fades it out with the ident.
 */
class IdentActivity : Activity() {
    private var player: ExoPlayer? = null
    private var music: ExoPlayer? = null
    private val ui = Handler(Looper.getMainLooper())
    private var finished = false
    private var fallback = ""

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        val o = try { JSONObject(intent.getStringExtra("ident") ?: "{}") } catch (e: Exception) { JSONObject() }
        val url = o.optString("url")
        fallback = o.optString("fallback")
        if (url.isEmpty()) { done(); return }

        val root = FrameLayout(this).apply { setBackgroundColor(Color.BLACK) }
        val logo = ImageView(this).apply { adjustViewBounds = true; scaleType = ImageView.ScaleType.FIT_CENTER }
        o.optString("logo").takeIf { it.isNotEmpty() }?.let { Glide.with(this).load(it).into(logo) }
        root.addView(logo, FrameLayout.LayoutParams(dp(260), dp(160), Gravity.CENTER))
        logo.animate().alpha(0.55f).setDuration(900).withEndAction { logo.animate().alpha(1f).setDuration(900).start() }.start()

        val view = PlayerView(this).apply {
            useController = false
            resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT
            setShutterBackgroundColor(Color.TRANSPARENT)
            alpha = 0f
        }
        root.addView(view, FrameLayout.LayoutParams(-1, -1))

        val skip = TextView(this).apply {
            text = "Skip"
            textSize = 16f
            setTextColor(Color.WHITE)
            setPadding(dp(22), dp(10), dp(22), dp(10))
            isFocusable = true; isClickable = true
            val r = dp(20).toFloat()
            background = StateListDrawable().apply {
                addState(intArrayOf(android.R.attr.state_focused), rounded(0xFFFFFFFF.toInt(), r))
                addState(intArrayOf(), rounded(0x66000000, r, dp(1), 0x88FFFFFF.toInt()))
            }
            setOnFocusChangeListener { _, has -> setTextColor(if (has) Color.BLACK else Color.WHITE) }
            setOnClickListener { done() }
        }
        root.addView(skip, FrameLayout.LayoutParams(-2, -2, Gravity.BOTTOM or Gravity.END).apply { setMargins(0, 0, dp(40), dp(36)) })
        setContentView(root)
        skip.requestFocus()

        val p = ExoPlayer.Builder(this).build()
        player = p
        view.player = p
        p.volume = if (o.optBoolean("sound", true)) 1f else 0f
        p.addListener(object : Player.Listener {
            override fun onRenderedFirstFrame() { view.animate().alpha(1f).setDuration(250).start(); logo.animate().cancel(); logo.visibility = View.GONE }
            override fun onPlaybackStateChanged(state: Int) { if (state == Player.STATE_ENDED) done() }
            override fun onPlayerError(error: PlaybackException) {
                // The TV-safe copy didn't play: try the original once, then give up quietly.
                if (fallback.isNotEmpty()) { val f = fallback; fallback = ""; p.setMediaItem(MediaItem.fromUri(f)); p.prepare(); p.play() } else done()
            }
        })
        p.setMediaItem(MediaItem.fromUri(url))
        p.prepare()
        p.playWhenReady = true

        // The sign-in music, carried on underneath (when the ident itself is silent).
        o.optJSONObject("music")?.let { m ->
            val mp = ExoPlayer.Builder(this).build()
            music = mp
            mp.setMediaItem(MediaItem.fromUri(m.optString("url")))
            mp.volume = m.optDouble("volume", 0.5).toFloat().coerceIn(0f, 1f)
            mp.prepare()
            mp.seekTo((m.optDouble("time", 0.0) * 1000).toLong())
            mp.playWhenReady = true
        }
        ui.postDelayed({ done() }, 35_000) // never longer than that
    }

    private fun done() {
        if (finished) return
        finished = true
        ui.removeCallbacksAndMessages(null)
        val m = music
        if (m != null) {
            // The music bows out with the ident.
            // (on its own handler, so closing this screen doesn't cut the fade short)
            music = null
            val fade = Handler(Looper.getMainLooper())
            val from = m.volume
            val start = System.currentTimeMillis()
            val step = object : Runnable { override fun run() {
                val k = ((System.currentTimeMillis() - start) / 700f).coerceAtMost(1f)
                m.volume = from * (1 - k)
                if (k < 1f) fade.postDelayed(this, 40) else m.release()
            } }
            step.run()
        }
        player?.release(); player = null
        finish()
        overridePendingTransition(android.R.anim.fade_in, android.R.anim.fade_out)
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean {
        // Only Back (and Skip) end it: pressing other buttons while waiting no longer skips it by accident.
        if (keyCode == KeyEvent.KEYCODE_BACK) { done(); return true }
        if (keyCode == KeyEvent.KEYCODE_DPAD_CENTER || keyCode == KeyEvent.KEYCODE_ENTER) return super.onKeyDown(keyCode, event)
        return true
    }

    override fun onPause() { super.onPause(); if (!isFinishing) done() }
    override fun onDestroy() { ui.removeCallbacksAndMessages(null); player?.release(); music?.release(); super.onDestroy() }
}
