package net.hallflix.app

import android.app.Activity
import android.content.Context
import android.media.AudioManager
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.GestureDetector
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.widget.FrameLayout
import android.widget.TextView
import androidx.media3.ui.PlayerView
import kotlin.math.abs
import kotlin.math.roundToInt

/**
 * Touch gestures on the phone player, like the big streaming apps:
 * - double-tap the left or right side to skip back or forward 10 seconds (tap again quickly to keep going);
 *   double-tap the middle to pause or play;
 * - swipe up or down on the left half for screen brightness, on the right half for volume;
 * - a single tap shows or hides the controls as before.
 * A small label shows what changed. Swipes that start at the very top or bottom are left to the system.
 */
class PlayerGestures(
    private val activity: Activity,
    private val view: PlayerView,
    private val hud: TextView,
    private val enabled: () -> Boolean,
    private val skip: (Long) -> Unit,
    private val toggle: () -> Unit,
) {
    private val audio = activity.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    private val ui = Handler(Looper.getMainLooper())
    private var mode = NONE
    private var level = 0f
    private var skipTotal = 0
    private var skipSide = 0
    private val hideHud = Runnable { hud.animate().alpha(0f).setDuration(200).withEndAction { hud.visibility = View.GONE }.start() }
    private val resetSkip = Runnable { skipTotal = 0; skipSide = 0 }

    private val detector = GestureDetector(activity, object : GestureDetector.SimpleOnGestureListener() {
        override fun onDown(e: MotionEvent): Boolean { mode = NONE; return true }

        override fun onSingleTapConfirmed(e: MotionEvent): Boolean {
            if (view.isControllerFullyVisible) view.hideController() else view.showController()
            return true
        }

        override fun onDoubleTap(e: MotionEvent): Boolean {
            val side = sideOf(e.x)
            if (side == 0) toggle() else skipOn(side)
            return true
        }

        override fun onScroll(e1: MotionEvent?, e2: MotionEvent, distanceX: Float, distanceY: Float): Boolean {
            val start = e1 ?: return false
            if (mode == NONE) {
                val h = view.height.toFloat()
                mode = when {
                    start.y < h * 0.08f || start.y > h * 0.92f -> IGNORED
                    abs(e2.y - start.y) < abs(e2.x - start.x) * 1.2f -> IGNORED
                    start.x < view.width / 2f -> { level = brightness(); BRIGHTNESS }
                    else -> { level = audio.getStreamVolume(AudioManager.STREAM_MUSIC).toFloat() / maxVolume(); VOLUME }
                }
            }
            val step = distanceY / (view.height * 0.7f) // finger moving up gives a positive distance
            when (mode) {
                BRIGHTNESS -> {
                    level = (level + step).coerceIn(0.01f, 1f)
                    val lp = activity.window.attributes
                    lp.screenBrightness = level
                    activity.window.attributes = lp
                    show("☀  ${(level * 100).roundToInt()}%", Gravity.CENTER)
                }
                VOLUME -> {
                    level = (level + step).coerceIn(0f, 1f)
                    audio.setStreamVolume(AudioManager.STREAM_MUSIC, (level * maxVolume()).roundToInt(), 0)
                    show(if (level <= 0.001f) "🔇  Muted" else "🔊  ${(level * 100).roundToInt()}%", Gravity.CENTER)
                }
            }
            return mode == BRIGHTNESS || mode == VOLUME
        }
    })

    private var continuing = false

    /** Takes over taps on the player while [enabled]; otherwise the player handles them as usual. */
    fun attach() {
        view.setOnTouchListener { _, ev ->
            if (!enabled()) return@setOnTouchListener false
            // Soon after a double-tap skip, each single tap on the same side skips another 10 seconds (as in Jellyfin).
            if (ev.actionMasked == MotionEvent.ACTION_DOWN) continuing = skipSide != 0 && sideOf(ev.x) == skipSide
            if (continuing) { if (ev.actionMasked == MotionEvent.ACTION_DOWN) skipOn(skipSide); return@setOnTouchListener true }
            detector.onTouchEvent(ev)
            if ((ev.actionMasked == MotionEvent.ACTION_UP || ev.actionMasked == MotionEvent.ACTION_CANCEL) && (mode == BRIGHTNESS || mode == VOLUME)) {
                ui.removeCallbacks(hideHud); ui.postDelayed(hideHud, 600)
            }
            true
        }
    }

    fun hide() { ui.removeCallbacks(hideHud); hud.visibility = View.GONE }

    private fun sideOf(x: Float): Int { val w = view.width.toFloat(); return when { x < w * 0.4f -> -1; x > w * 0.6f -> 1; else -> 0 } }

    private fun skipOn(side: Int) {
        if (side != skipSide) skipTotal = 0
        skipSide = side
        skipTotal += 10
        skip(side * 10_000L)
        show(if (side < 0) "⏪  $skipTotal s" else "$skipTotal s  ⏩", if (side < 0) Gravity.START or Gravity.CENTER_VERTICAL else Gravity.END or Gravity.CENTER_VERTICAL)
        ui.postDelayed(hideHud, 700)
        ui.removeCallbacks(resetSkip); ui.postDelayed(resetSkip, 900)
    }

    private fun maxVolume() = audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC).coerceAtLeast(1)

    private fun brightness(): Float {
        val own = activity.window.attributes.screenBrightness
        if (own >= 0) return own
        return try { Settings.System.getInt(activity.contentResolver, Settings.System.SCREEN_BRIGHTNESS) / 255f } catch (e: Exception) { 0.5f }
    }

    private fun show(text: String, gravity: Int) {
        hud.text = text
        val lp = hud.layoutParams as FrameLayout.LayoutParams
        if (lp.gravity != gravity) { lp.gravity = gravity; hud.layoutParams = lp }
        ui.removeCallbacks(hideHud)
        hud.animate().cancel()
        hud.alpha = 1f
        hud.visibility = View.VISIBLE
    }

    private companion object {
        const val NONE = 0
        const val BRIGHTNESS = 1
        const val VOLUME = 2
        const val IGNORED = 3
    }
}
