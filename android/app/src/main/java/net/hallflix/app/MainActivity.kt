package net.hallflix.app

import android.annotation.SuppressLint
import android.app.Activity
import android.app.UiModeManager
import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.graphics.Bitmap
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.speech.RecognizerIntent
import android.view.KeyEvent
import android.view.View
import android.view.inputmethod.EditorInfo
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.ImageView
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import org.json.JSONObject

/**
 * The HallFlix screens come from the server (the same web app, so every Studio change shows up without an update).
 * Video is handed to PlayerActivity, which plays it natively with ExoPlayer.
 */
class MainActivity : Activity() {
    private lateinit var web: WebView
    private lateinit var panel: ScrollView
    private lateinit var splash: ImageView
    private var server = ""
    private var loadFailed = false
    private var playerOpen = false
    private val ui = Handler(Looper.getMainLooper())
    /** If the server hasn't drawn anything after this long, stop waiting and say so instead of showing the logo forever. */
    private val slow = Runnable {
        if (web.visibility == View.VISIBLE) return@Runnable
        web.stopLoading()
        loadFailed = true
        showPanel("HallFlix is taking too long", "Couldn't reach $server. ${AWAY_HINT}", retry = true)
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        web = findViewById(R.id.web)
        panel = findViewById(R.id.panel)
        splash = findViewById(R.id.splash)

        CookieManager.getInstance().setAcceptCookie(true)
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            loadWithOverviewMode = true
            useWideViewPort = true
            // "Android TV" tells the web app to use its remote-friendly layout.
            userAgentString = "$userAgentString HallFlixApp/${BuildConfigVersion.name(this@MainActivity)}${if (isTv()) " Android TV" else ""}"
            // TVs: the page decides text sizes, whatever the system's font size setting.
            textZoom = 100
        }
        web.apply {
            // No system focus outline around the whole page: HallFlix draws its own focus ring on each item.
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) defaultFocusHighlightEnabled = false
            // No setLayerType here: a permanent hardware layer copies the whole page into an extra
            // texture every frame (slow on a Fire TV Stick) and can leave <video> blank.
            isVerticalScrollBarEnabled = false
            isHorizontalScrollBarEnabled = false
        }
        web.isFocusable = true
        web.isFocusableInTouchMode = true
        web.setBackgroundColor(0xFF0A0814.toInt())
        web.addJavascriptInterface(Bridge(), "HallFlixNative")
        // The music notification's buttons run in the web app's music player.
        MusicService.commands = { js -> runOnUiThread { if (!isDestroyed) web.evaluateJavascript("window.HallFlix && HallFlix.music && HallFlix.music.$js", null) } }
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                // Anything on the HallFlix server stays in the app, even after an http → https redirect.
                if (Server.sameSite(server, request.url)) return false
                // Trailers and other outside links open in another app, if there is one.
                try { startActivity(Intent(Intent.ACTION_VIEW, request.url)) } catch (e: Exception) { /* nothing can open it */ }
                return true
            }
            override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) { loadFailed = false }
            // Show the page as soon as it starts drawing (Android 6+), not only once every picture and video has loaded.
            override fun onPageCommitVisible(view: WebView, url: String) { if (!loadFailed) reveal() }
            override fun onPageFinished(view: WebView, url: String) {
                if (loadFailed) return
                // If the server sent us somewhere else on the same site (usually http → https), remember that address.
                val landed = Server.origin(url)
                if (landed != null && landed != server && Server.sameSite(server, Uri.parse(url))) {
                    server = landed
                    Server.save(this@MainActivity, landed)
                }
                reveal()
                CookieManager.getInstance().flush()
            }
            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (!request.isForMainFrame) return
                loadFailed = true
                showPanel("Can't reach HallFlix", "Check that HallFlix is running, or change the server address. $AWAY_HINT", retry = true)
            }
        }

        findViewById<Button>(R.id.connect).setOnClickListener { connect() }
        findViewById<Button>(R.id.retry).setOnClickListener { load() }
        findViewById<EditText>(R.id.server).setOnEditorActionListener { _, id, _ -> if (id == EditorInfo.IME_ACTION_GO) { connect(); true } else false }

        server = Server.url(this)
        if (server.isEmpty()) showPanel("Welcome to HallFlix", "Enter the address of your HallFlix server. It is shown in the Studio and in the install guide.", retry = false)
        else load()
    }

    private fun isTv(): Boolean {
        val ui = getSystemService(Context.UI_MODE_SERVICE) as UiModeManager
        return ui.currentModeType == Configuration.UI_MODE_TYPE_TELEVISION ||
            packageManager.hasSystemFeature("android.software.leanback") ||
            packageManager.hasSystemFeature("amazon.hardware.fire_tv")
    }

    private fun connect() {
        val url = Server.normalise(findViewById<EditText>(R.id.server).text.toString())
        if (url.isEmpty()) return
        server = url
        Server.save(this, url)
        load()
    }

    private fun load() {
        panel.visibility = View.GONE
        splash.visibility = View.VISIBLE
        ui.removeCallbacks(slow)
        ui.postDelayed(slow, LOAD_TIMEOUT_MS)
        web.loadUrl("$server/")
    }

    private fun reveal() {
        ui.removeCallbacks(slow)
        if (web.visibility == View.VISIBLE) return
        web.visibility = View.VISIBLE
        splash.visibility = View.GONE
        panel.visibility = View.GONE
        web.requestFocus()
    }

    private fun showPanel(title: String, text: String, retry: Boolean) {
        ui.removeCallbacks(slow)
        web.visibility = View.INVISIBLE
        splash.visibility = View.GONE
        panel.visibility = View.VISIBLE
        findViewById<TextView>(R.id.panel_title).text = title
        findViewById<TextView>(R.id.panel_text).text = text
        val field = findViewById<EditText>(R.id.server)
        if (field.text.isEmpty()) field.setText(server.ifEmpty { DEFAULT_SERVER })
        val retryButton = findViewById<Button>(R.id.retry)
        retryButton.visibility = if (retry) View.VISIBLE else View.GONE
        (if (retry) retryButton else findViewById<Button>(R.id.connect)).requestFocus()
    }

    override fun onDestroy() {
        ui.removeCallbacks(slow)
        // The music lives in this page, so it ends with it.
        if (isFinishing) { MusicService.stopAll(); MusicService.commands = null }
        super.onDestroy()
    }

    override fun onResume() {
        super.onResume()
        if (web.visibility == View.VISIBLE) web.requestFocus() // focus comes back to the page after the player or another app
        if (playerOpen) {
            playerOpen = false
            // Tell the web app playback ended so Continue Watching and progress bars refresh.
            web.evaluateJavascript("window.dispatchEvent(new Event('hallflix-native-closed'))", null)
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != VOICE || resultCode != RESULT_OK) return
        val heard = data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)?.firstOrNull() ?: return
        web.evaluateJavascript("window.dispatchEvent(new CustomEvent('hallflix-voice',{detail:${JSONObject.quote(heard)}}))", null)
    }

    private var backAt = 0L
    /**
     * Back goes to the page first: it closes whatever is open, goes to the previous page, then to the sidebar.
     * Only when the page has nothing left to go back to does Back close the app, after a second press.
     */
    private fun back() {
        if (panel.visibility == View.VISIBLE || web.visibility != View.VISIBLE) { finish(); return }
        web.evaluateJavascript("window.hallflixBack ? hallflixBack() : null") { r ->
            when (r) {
                "true" -> Unit
                "false" -> confirmExit()
                else -> if (web.canGoBack()) web.goBack() else confirmExit()
            }
        }
    }
    private fun confirmExit() {
        val now = SystemClock.uptimeMillis()
        // With music playing, HallFlix goes to the background (the music carries on) instead of closing.
        if (now - backAt < 2500) { if (MusicService.isPlaying) moveTaskToBack(true) else finish(); return }
        backAt = now
        Toast.makeText(this, "Press Back again to close HallFlix", Toast.LENGTH_SHORT).show()
    }

    /** The remote's media and menu keys go to the page: Play/Pause plays the focused title, ⏪ ⏩ jump along a row, Menu opens the sidebar. */
    private fun pageKey(name: String) {
        web.evaluateJavascript("window.dispatchEvent(new CustomEvent('hallflix-key',{detail:'$name'}))", null)
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (web.visibility == View.VISIBLE && panel.visibility != View.VISIBLE) {
            val name = when (event.keyCode) {
                KeyEvent.KEYCODE_BACK -> "back"
                KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE, KeyEvent.KEYCODE_MEDIA_PLAY -> "play"
                KeyEvent.KEYCODE_MEDIA_FAST_FORWARD -> "ff"
                KeyEvent.KEYCODE_MEDIA_REWIND -> "rew"
                KeyEvent.KEYCODE_MENU -> "menu"
                else -> null
            }
            if (name != null) {
                if (event.action == KeyEvent.ACTION_UP && event.repeatCount == 0) { if (name == "back") back() else pageKey(name) }
                return true
            }
        }
        return super.dispatchKeyEvent(event)
    }

    /** What the web app can ask of the app. Calls arrive on a background thread. */
    inner class Bridge {
        @JavascriptInterface
        fun play(json: String) {
            val o = JSONObject(json)
            runOnUiThread {
                playerOpen = true
                startActivity(Intent(this@MainActivity, PlayerActivity::class.java)
                    .putExtra("server", server)
                    .putExtra("token", Server.token(server))
                    .putExtra("itemId", o.getLong("itemId"))
                    .putExtra("device", o.optString("device"))
                    .putExtra("deviceName", o.optString("name"))
                    .putExtra("tv", o.optBoolean("tv"))
                    .putExtra("start", if (o.isNull("start") || !o.has("start")) -1.0 else o.getDouble("start")))
            }
        }

        @JavascriptInterface
        fun changeServer() {
            runOnUiThread { showPanel("Change server", "Enter the address of your HallFlix server.", retry = false) }
        }

        /** Listen for a spoken search. The words come back to the page as a "hallflix-voice" event. */
        @JavascriptInterface
        fun voice() {
            runOnUiThread {
                try {
                    startActivityForResult(Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
                        .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                        .putExtra(RecognizerIntent.EXTRA_PROMPT, "Search HallFlix"), VOICE)
                } catch (e: Exception) {
                    web.evaluateJavascript("window.HallFlix && HallFlix.toast('Voice search is not available on this device')", null)
                }
            }
        }

        /** The music player's state, for the notification and lock-screen controls (see MusicService). */
        @JavascriptInterface
        fun music(json: String) {
            try { MusicService.update(this@MainActivity, JSONObject(json)) } catch (_: Exception) { }
        }

        @JavascriptInterface
        fun isTv(): Boolean = this@MainActivity.isTv()

        @JavascriptInterface
        fun version(): String = BuildConfigVersion.name(this@MainActivity)
    }
}

private const val VOICE = 41
private const val LOAD_TIMEOUT_MS = 20_000L
/** Works at home and away. A home-network address (192.168.…) only works on the home Wi-Fi. */
private const val DEFAULT_SERVER = "https://new.hallflix.net"
private const val AWAY_HINT = "Away from home? An address like 192.168.… only works on your home Wi-Fi, so use https://new.hallflix.net instead."

object BuildConfigVersion {
    fun name(ctx: Context): String = try { ctx.packageManager.getPackageInfo(ctx.packageName, 0).versionName ?: "1" } catch (e: Exception) { "1" }
}
