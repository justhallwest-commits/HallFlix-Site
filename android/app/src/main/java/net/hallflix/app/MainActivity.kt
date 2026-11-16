package net.hallflix.app

import android.annotation.SuppressLint
import android.app.Activity
import android.app.UiModeManager
import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.graphics.Bitmap
import android.net.Uri
import android.os.Bundle
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
        }
        web.isFocusable = true
        web.isFocusableInTouchMode = true
        web.setBackgroundColor(0xFF0A0814.toInt())
        web.addJavascriptInterface(Bridge(), "HallFlixNative")
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val url = request.url.toString()
                if (url.startsWith(server)) return false
                // Trailers and other outside links open in another app, if there is one.
                try { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) } catch (e: Exception) { /* nothing can open it */ }
                return true
            }
            override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) { loadFailed = false }
            override fun onPageFinished(view: WebView, url: String) {
                if (loadFailed) return
                web.visibility = View.VISIBLE
                splash.visibility = View.GONE
                panel.visibility = View.GONE
                web.requestFocus()
                CookieManager.getInstance().flush()
            }
            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (!request.isForMainFrame) return
                loadFailed = true
                showPanel("Can't reach HallFlix", "Check that the NAS is on and that this device is on the same network, or change the server address.", retry = true)
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
        web.loadUrl("$server/")
    }

    private fun showPanel(title: String, text: String, retry: Boolean) {
        web.visibility = View.INVISIBLE
        splash.visibility = View.GONE
        panel.visibility = View.VISIBLE
        findViewById<TextView>(R.id.panel_title).text = title
        findViewById<TextView>(R.id.panel_text).text = text
        val field = findViewById<EditText>(R.id.server)
        if (field.text.isEmpty()) field.setText(server.ifEmpty { "http://192.168.1.83:8780" })
        val retryButton = findViewById<Button>(R.id.retry)
        retryButton.visibility = if (retry) View.VISIBLE else View.GONE
        (if (retry) retryButton else findViewById<Button>(R.id.connect)).requestFocus()
    }

    override fun onResume() {
        super.onResume()
        if (playerOpen) {
            playerOpen = false
            // Tell the web app playback ended so Continue Watching and progress bars refresh.
            web.evaluateJavascript("window.dispatchEvent(new Event('hallflix-native-closed'))", null)
        }
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean {
        if (keyCode == KeyEvent.KEYCODE_BACK && panel.visibility != View.VISIBLE && web.canGoBack()) { web.goBack(); return true }
        return super.onKeyDown(keyCode, event)
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
                    .putExtra("start", if (o.isNull("start") || !o.has("start")) -1.0 else o.getDouble("start")))
            }
        }

        @JavascriptInterface
        fun changeServer() {
            runOnUiThread { showPanel("Change server", "Enter the address of your HallFlix server.", retry = false) }
        }

        @JavascriptInterface
        fun isTv(): Boolean = this@MainActivity.isTv()

        @JavascriptInterface
        fun version(): String = BuildConfigVersion.name(this@MainActivity)
    }
}

object BuildConfigVersion {
    fun name(ctx: Context): String = try { ctx.packageManager.getPackageInfo(ctx.packageName, 0).versionName ?: "1" } catch (e: Exception) { "1" }
}
