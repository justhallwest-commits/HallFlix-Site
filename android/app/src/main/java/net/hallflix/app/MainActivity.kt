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
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
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
    companion object {
        /** JavaScript a native TV screen left for the web app to run when it comes back (usually a page to go to). */
        var pendingJs: String? = null
        /** True while the native TV screens are showing on top of the web app. */
        var nativeOpen = false
    }

    private lateinit var web: WebView
    private lateinit var panel: ScrollView
    private lateinit var splash: ImageView
    /** The address the page is using right now: the home address when it answers, otherwise the away one. */
    private var server = ""
    /** The address typed in, if any; kept even while the home address is in use. Empty: the built-in addresses. */
    private var saved = ""
    /** True while using the home (Tailscale) address. */
    private var home = false
    private var probe = 0
    private var loadFailed = false
    private var playerOpen = false
    private val ui = Handler(Looper.getMainLooper())
    /** If the server hasn't drawn anything after this long, stop waiting and say so instead of showing the logo forever. */
    private val slow = Runnable {
        if (web.visibility == View.VISIBLE) return@Runnable
        web.stopLoading()
        if (home && mode() == "auto") { fallBack(); return@Runnable }
        loadFailed = true
        showPanel("HallFlix is taking too long", "Couldn't reach $server. ${AWAY_HINT}", retry = true)
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        playFromTvHome(intent)
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
        // Video in the page (the welcome ident, banner clips) needs a WebChromeClient: without one, many Fire TVs and
        // older Android WebViews play the sound with a blank picture. The default poster is a clear pixel, so no grey
        // play button shows before the first frame.
        web.webChromeClient = object : WebChromeClient() {
            override fun getDefaultVideoPoster(): Bitmap = Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888)
        }
        web.webViewClient = object : WebViewClient() {
            // The Downloads page and downloaded files, served from inside the app (works offline).
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? = LocalFiles.intercept(this@MainActivity, request)
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                // Anything on the HallFlix server stays in the app, even after an http → https redirect.
                if (Server.sameSite(server, request.url) || request.url.host == LocalFiles.HOST) return false
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
                if (!home && landed != null && landed != server && Server.sameSite(server, Uri.parse(url))) {
                    server = landed
                    saved = landed
                    Server.save(this@MainActivity, landed)
                }
                Server.shareSignIn(server, otherAddress())
                reveal()
                CookieManager.getInstance().flush()
                // Online again: send where films were stopped offline, and carry on getting downloads ready.
                if (Server.sameSite(server, Uri.parse(url))) {
                    val token = Server.token(server)
                    DownloadStore.sync(this@MainActivity, server, token)
                    DownloadStore.resume(this@MainActivity, server, token)
                    watchDownloads()
                }
            }
            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (!request.isForMainFrame) return
                // The home address stopped answering (Tailscale turned off, left home): carry on with the away address.
                if (home && mode() == "auto") { fallBack(); return }
                loadFailed = true
                showPanel("Can't reach HallFlix", "Check that HallFlix is running, or change the server address. $AWAY_HINT", retry = true)
            }
        }

        findViewById<Button>(R.id.connect).setOnClickListener { connect() }
        findViewById<Button>(R.id.retry).setOnClickListener { load() }
        findViewById<Button>(R.id.offline).setOnClickListener { openDownloads() }
        DownloadStore.changed = { if (!isDestroyed) web.evaluateJavascript("window.dispatchEvent(new Event('hallflix-downloads'))", null) }
        findViewById<EditText>(R.id.server).setOnEditorActionListener { _, id, _ -> if (id == EditorInfo.IME_ACTION_GO) { connect(); true } else false }

        // A new install needs no address typed in: it tries the home (Tailscale) address, then https://new.hallflix.net.
        saved = Server.url(this)
        server = saved
        load()
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
        saved = url
        Server.save(this, url)
        // Typed in by hand: use exactly that address from now on (the sign-in screen can go back to Automatic).
        setMode(if (url == Server.direct(this)) "home" else "away")
        load()
    }

    /**
     * Try the home address first (a second and a half at most). If HallFlix answers there, use it: video comes straight
     * from the server instead of round the internet. If not, use the away address (see away()).
     */
    private fun load() {
        panel.visibility = View.GONE
        splash.visibility = View.VISIBLE
        ui.removeCallbacks(slow)
        val direct = Server.direct(this)
        val ticket = ++probe
        // Chosen on the sign-in screen: always home, always away, or (normally) whichever answers.
        when (mode()) {
            "home" -> if (direct.isNotEmpty()) { open(direct, true); return }
            "away" -> { open(away(), false); return }
        }
        if (direct.isEmpty()) { open(away(), false); return }
        Thread {
            val answers = Server.hello(direct)
            runOnUiThread {
                if (ticket != probe || isDestroyed) return@runOnUiThread
                if (answers) open(direct, true) else open(away(), false)
            }
        }.start()
    }

    private fun open(url: String, atHome: Boolean) {
        home = atHome
        server = url
        Server.shareSignIn(otherAddress(), url, onlyIfMissing = true) // signed in on the other address? Then here too.
        ui.removeCallbacks(slow)
        ui.postDelayed(slow, LOAD_TIMEOUT_MS)
        web.loadUrl("$server/")
    }

    /** The home address stopped answering part-way: switch to the away address without showing an error. */
    private fun fallBack() {
        loadFailed = false
        web.visibility = View.INVISIBLE
        panel.visibility = View.GONE
        splash.visibility = View.VISIBLE
        open(away(), false)
    }

    /**
     * Where to go when the home address doesn't answer: the address typed in, unless that is the home address itself
     * (or nothing was typed), then https://new.hallflix.net.
     */
    private fun away(): String = if (saved.isEmpty() || saved == Server.direct(this)) DEFAULT_SERVER else saved

    /** "auto" (home address when it answers, else away), "home" or "away"; chosen on the sign-in screen. */
    private fun mode(): String = getSharedPreferences("hallflix", MODE_PRIVATE).getString("mode", "auto") ?: "auto"
    private fun setMode(m: String) { getSharedPreferences("hallflix", MODE_PRIVATE).edit().putString("mode", m).apply() }

    private fun otherAddress(): String = if (home) away() else Server.direct(this)

    private fun reveal() {
        ui.removeCallbacks(slow)
        if (web.visibility == View.VISIBLE) return
        web.visibility = View.VISIBLE
        splash.visibility = View.GONE
        panel.visibility = View.GONE
        web.requestFocus()
    }

    private fun hasDownloads() = DownloadStore.state(this).optJSONArray("items")?.length()?.let { it > 0 } == true

    /** The Downloads page: built into the app, so it opens with or without a connection. */
    private fun openDownloads() {
        ui.removeCallbacks(slow)
        panel.visibility = View.GONE
        loadFailed = false
        web.loadUrl(LocalFiles.PAGE)
        watchDownloads()
    }

    /** While anything is downloading, check on it every couple of seconds (the Downloads page shows the progress). */
    private val downloadTick = object : Runnable {
        override fun run() { if (DownloadStore.refresh(this@MainActivity)) ui.postDelayed(this, 2000) }
    }
    private fun watchDownloads() { ui.removeCallbacks(downloadTick); ui.post(downloadTick) }

    private fun showPanel(title: String, text: String, retry: Boolean) {
        ui.removeCallbacks(slow)
        web.visibility = View.INVISIBLE
        splash.visibility = View.GONE
        panel.visibility = View.VISIBLE
        findViewById<TextView>(R.id.panel_title).text = title
        findViewById<TextView>(R.id.panel_text).text = text
        val field = findViewById<EditText>(R.id.server)
        if (field.text.isEmpty()) field.setText(saved.ifEmpty { Server.direct(this).ifEmpty { DEFAULT_SERVER } })
        val retryButton = findViewById<Button>(R.id.retry)
        retryButton.visibility = if (retry) View.VISIBLE else View.GONE
        findViewById<Button>(R.id.offline).visibility = if (retry && hasDownloads()) View.VISIBLE else View.GONE
        (if (retry) retryButton else findViewById<Button>(R.id.connect)).requestFocus()
    }

    override fun onDestroy() {
        ui.removeCallbacks(slow)
        // The music lives in this page, so it ends with it.
        if (isFinishing) { MusicService.stopAll(); MusicService.commands = null }
        super.onDestroy()
    }

    override fun onPause() {
        super.onPause()
        Server.shareSignIn(server, otherAddress()) // a sign-in or sign-out on one address applies to the other
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        playFromTvHome(intent)
    }

    /** hallflix://play/<id>, from the TV's own home screen: play it now, or as soon as HallFlix has signed in. */
    private fun playFromTvHome(i: Intent?) {
        val id = i?.data?.takeIf { it.scheme == "hallflix" && it.host == "play" }?.lastPathSegment?.toLongOrNull() ?: return
        i?.data = null
        if (TvSession.ready) { playerOpen = true; TvNav.play(this, id, null) } // afterwards the web app opens the native Home again
        else TvNav.pendingPlay = id
    }

    override fun onResume() {
        super.onResume()
        // Back from the native TV screens (they close when they hand a page to the web app).
        nativeOpen = false
        pendingJs?.let { js -> pendingJs = null; web.evaluateJavascript(js, null) }
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

        /**
         * The web app reached its home page on a TV: show the native TV screens instead (faster on Fire TV sticks).
         * Returns false when they're switched off, or not a TV, so the web app draws its own home page.
         */
        @JavascriptInterface
        fun nativeHome(json: String): Boolean {
            if (!isTv() || !nativeTvOn()) return false
            if (nativeOpen) return true
            nativeOpen = true
            val o = try { JSONObject(json) } catch (e: Exception) { JSONObject() }
            val token = Server.token(server)
            runOnUiThread {
                TvSession.server = server
                TvSession.token = token
                TvSession.device = o.optString("device")
                TvSession.deviceName = o.optString("name").ifEmpty { "Fire TV" }
                // The look and libraries first (quick), then the home screen.
                Thread {
                    try { TvLook.apply(Server.call(server, token, "GET", "/api/boot")) } catch (e: Exception) { /* default colours */ }
                    runOnUiThread { if (!isDestroyed) startActivity(Intent(this@MainActivity, TvHomeActivity::class.java)) }
                }.start()
            }
            return true
        }

        /** The native TV screens on or off (on by default on TVs). */
        @JavascriptInterface
        fun setNativeTv(on: Boolean) { getSharedPreferences("hallflix", MODE_PRIVATE).edit().putBoolean("nativeTv", on).apply() }

        @JavascriptInterface
        fun nativeTvOn(): Boolean = isTv() && getSharedPreferences("hallflix", MODE_PRIVATE).getBoolean("nativeTv", true)

        /** The home address from Studio → Settings → Apps ("" turns it off). Used from the next start. */
        @JavascriptInterface
        fun setDirect(url: String) { Server.saveDirect(this@MainActivity, Server.normalise(url)) }

        /** For the sign-in screen's Server choice: what's chosen, what's in use, and the two addresses. */
        @JavascriptInterface
        fun serverInfo(): String = JSONObject()
            .put("mode", mode()).put("current", server).put("home", home)
            .put("direct", Server.direct(this@MainActivity)).put("away", away()).toString()

        /** "auto", "home" or "away": switch now and keep it. */
        @JavascriptInterface
        fun useServer(m: String) {
            if (m !in listOf("auto", "home", "away")) return
            runOnUiThread {
                setMode(m)
                Server.shareSignIn(server, otherAddress())
                load()
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

        /** Save a title to enjoy offline: { itemId, quality: "original" | "1080" | "720" | "480" }. */
        @JavascriptInterface
        fun download(json: String) {
            val o = JSONObject(json)
            DownloadStore.add(this@MainActivity, server, Server.token(server), o.getLong("itemId"), o.optString("quality", "original"))
            runOnUiThread { watchDownloads() }
        }

        /** What's downloaded or on its way, with progress, and the space used and left. */
        @JavascriptInterface
        fun downloads(): String { DownloadStore.refresh(this@MainActivity); return DownloadStore.state(this@MainActivity).toString() }

        @JavascriptInterface
        fun deleteDownload(id: Long) { DownloadStore.remove(this@MainActivity, id) }

        @JavascriptInterface
        fun setDownloadWifiOnly(on: Boolean) { DownloadStore.setWifiOnly(this@MainActivity, on) }

        @JavascriptInterface
        fun openDownloads() { runOnUiThread { this@MainActivity.openDownloads() } }

        /** From the Downloads page back to HallFlix online (or the "can't reach" panel if still offline). */
        @JavascriptInterface
        fun goOnline() { runOnUiThread { load() } }

        /** Play a downloaded film or episode in the app's player, with no connection needed. */
        @JavascriptInterface
        fun playOffline(id: Long) {
            runOnUiThread {
                playerOpen = true
                startActivity(Intent(this@MainActivity, PlayerActivity::class.java).putExtra("server", server).putExtra("offline", id))
            }
        }

        /** Where a downloaded book or comic was left (page, or chapter.fraction for EPUBs); sent to the server once online. */
        @JavascriptInterface
        fun saveReading(id: Long, position: Double, duration: Double, finished: Boolean) { DownloadStore.savePosition(this@MainActivity, id, position, duration, finished) }

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
private const val AWAY_HINT = "The home address (http://100.…) only works with the Tailscale app connected; without it, use https://new.hallflix.net."

object BuildConfigVersion {
    fun name(ctx: Context): String = try { ctx.packageManager.getPackageInfo(ctx.packageName, 0).versionName ?: "1" } catch (e: Exception) { "1" }
}
