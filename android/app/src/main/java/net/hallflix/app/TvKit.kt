package net.hallflix.app

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.Outline
import android.graphics.Rect
import android.graphics.Typeface
import android.graphics.drawable.ColorDrawable
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.StateListDrawable
import android.os.Handler
import android.os.Looper
import android.text.TextUtils
import android.util.AttributeSet
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.ViewOutlineProvider
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.bumptech.glide.Glide
import com.bumptech.glide.load.resource.drawable.DrawableTransitionOptions
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.Executors

// ── The native TV screens (home, library, title page) ──
// They draw the most-used TV pages natively for speed; everything else stays in the web app (MainActivity).
// The web app opens them (HallFlixNative.nativeHome) and they hand rarer pages back with TvNav.toWeb().

/** Who is signed in and where: set by MainActivity when the web app hands over. */
object TvSession {
    var server = ""
    var token: String? = null
    var device = ""
    var deviceName = "Fire TV"
    val ready get() = server.isNotEmpty()

    /** Server paths ("/img/t/w342/…") → full addresses. */
    fun abs(url: String?): String? = when {
        url.isNullOrEmpty() -> null
        url.startsWith("http://") || url.startsWith("https://") -> url
        else -> server + url
    }
}

/**
 * The Studio's look, as the native screens use it: the TV look's colours, logo and background, each library's look
 * (tile picture, logo, brightness, page background), and the Fire TV app's own settings (theme.tvApp, edited in
 * Studio → Fire TV app).
 */
object TvLook {
    var bg = 0xFF0A0814.toInt()
    var surface = 0xFF16122B.toInt()
    var text = 0xFFF4F2FF.toInt()
    var muted = 0xFFA8A3C7.toInt()
    var accent = 0xFF35D0D0.toInt()
    var accent2 = 0xFFB344D6.toInt()
    var focus = Color.WHITE
    var showFocus = true
    var logo: String? = null
    var background: String? = null
    var libraries = JSONArray()
    var profileName = ""
    var loaded = false
    /** theme.tvApp, with HallFlix's defaults already filled in by the server. */
    var app = JSONObject()
    /** The look's fonts (theme.fonts): headings and buttons use the display font, everything else the body font. */
    var displayFont = "Outfit"
    var bodyFont = "Inter"
    /** theme.screensaver: "off", "tv" (TVs only) or "all". The native screens are always on a TV. */
    var screensaver = "tv"
    /** Uploaded videos → their TV-safe copies (see ident.js on the server). */
    var tvCopies = JSONObject()

    /** A TV-safe copy of an uploaded video when the server has made one. */
    fun tvVideo(url: String?): String? = url?.let { tvCopies.optString(it).ifEmpty { it } }
    private var libLooks = JSONObject()
    /** Look and feel → library tiles → logo placement (the whole app), which the TV follows unless told otherwise. */
    private var siteTileLogo = JSONObject()

    private fun color(o: JSONObject?, key: String, fallback: Int): Int {
        val s = o?.optString(key)?.trim().orEmpty()
        if (s.isEmpty()) return fallback
        return try {
            // "#abc" → "#aabbcc"; Color.parseColor handles #rrggbb and #aarrggbb.
            val full = if (Regex("^#[0-9a-fA-F]{3}$").matches(s)) "#" + s.drop(1).map { "$it$it" }.joinToString("") else s
            Color.parseColor(full)
        } catch (e: Exception) { fallback }
    }

    fun apply(boot: JSONObject) {
        // /api/boot's look is { theme, libraries, devices: { tv: { theme } } }: the TV's own look when there is one.
        val look = boot.optJSONObject("look") ?: JSONObject()
        val theme = look.optJSONObject("devices")?.optJSONObject("tv")?.optJSONObject("theme") ?: look.optJSONObject("theme") ?: JSONObject()
        val c = theme.optJSONObject("colors")
        bg = color(c, "bg", bg); surface = color(c, "surface", surface); text = color(c, "text", text)
        muted = color(c, "muted", muted); accent = color(c, "accent", accent); accent2 = color(c, "accent2", accent2)
        app = theme.optJSONObject("tvApp") ?: JSONObject()
        theme.optJSONObject("fonts")?.let { f -> displayFont = f.optString("display").ifEmpty { displayFont }; bodyFont = f.optString("body").ifEmpty { bodyFont } }
        screensaver = theme.optString("screensaver").ifEmpty { "tv" }
        tvCopies = boot.optJSONObject("tvIdents") ?: JSONObject()
        val ring = str("cards", "focus", "theme")
        val themeRing = theme.optJSONObject("tv")?.optString("focus") ?: "white"
        showFocus = ring != "none"
        focus = when (if (ring == "theme") themeRing else ring) { "accent" -> accent; else -> Color.WHITE }
        logo = usable(theme.optJSONObject("logo")?.optString("image"))
        background = if (str("background", "use", "color") == "image") usable(theme.optJSONObject("background")?.optString("image"))?.let { fit(it, 1280) } else null
        libLooks = look.optJSONObject("libraries") ?: JSONObject()
        siteTileLogo = theme.optJSONObject("tileLogo") ?: JSONObject()
        libraries = boot.optJSONArray("libraries") ?: JSONArray()
        profileName = boot.optJSONObject("profile")?.optString("name").orEmpty()
        loaded = true
    }

    fun num(section: String, key: String, def: Int): Int = app.optJSONObject(section)?.optInt(key, def) ?: def
    fun flag(section: String, key: String, def: Boolean): Boolean = app.optJSONObject(section)?.optBoolean(key, def) ?: def
    fun str(section: String, key: String, def: String): String = app.optJSONObject(section)?.optString(key)?.ifEmpty { null } ?: def

    /** A picture that can be shown: set, not "null", and not a video. */
    fun usable(u: String?): String? = u?.trim()?.takeIf { it.isNotEmpty() && it != "null" && !Regex("\\.(mp4|webm|m4v|mov)(\\?|$)", RegexOption.IGNORE_CASE).containsMatchIn(it) }

    /** A tile- or screen-sized copy of an uploaded picture (a full-size upload is heavy for a Fire TV stick). */
    fun fit(url: String, w: Int): String = if (url.startsWith("/img/t/") || url.startsWith("data:")) url else "/api/fit?w=$w&src=" + android.net.Uri.encode(url)

    fun libLook(id: Long): JSONObject = libLooks.optJSONObject(id.toString()) ?: JSONObject()

    /** A library tile's picture, the way the website picks it: the tile's own picture, the library page's background, then new artwork. */
    fun tilePicture(tile: JSONObject): String? {
        val lk = libLook(tile.optLong("id"))
        if (str("tiles", "art", "library") == "library") {
            usable(lk.optString("tileBackground"))?.let { return fit(it, 800) }
            if (lk.optString("tileUse") != "artwork") usable(lk.optString("background"))?.let { return fit(it, 800) }
        }
        return usable(tile.optString("backdrop"))
    }

    /** Where a library's logo or name sits on its tile, and how big: anchor (0–1 across, down), nudge (share of the tile), size, count. */
    class LogoSpot(val ax: Float, val ay: Float, val nx: Float, val ny: Float, val k: Float, val count: Boolean)

    private val PLACES = mapOf("tl" to (0f to 0f), "tc" to (0.5f to 0f), "tr" to (1f to 0f), "ml" to (0f to 0.5f), "mc" to (0.5f to 0.5f),
        "mr" to (1f to 0.5f), "bl" to (0f to 1f), "bc" to (0.5f to 1f), "br" to (1f to 1f))

    /**
     * The logo placement for a library's tile: its TV-only placement (Studio → Fire TV app) if it has one, then either the
     * TV-wide placement or the website's (the whole app's, then that library's), the same rules the website uses.
     */
    fun logoSpot(tile: JSONObject): LogoSpot {
        val lk = libLook(tile.optLong("id"))
        val c = JSONObject().put("place", "bl").put("size", 100).put("x", 0).put("y", 0).put("count", "yes")
        fun over(o: JSONObject?) { o?.keys()?.forEach { k -> c.put(k, o.get(k)) } }
        if (str("tiles", "logoFrom", "site") == "tv") over(app.optJSONObject("tiles")?.optJSONObject("logo"))
        else { over(siteTileLogo); over(lk.optJSONObject("tileLogo")) }
        over(lk.optJSONObject("tvTileLogo"))
        val fx = c.optDouble("fx", -1.0); val fy = c.optDouble("fy", -1.0)
        val free = c.optString("place") == "free" && fx >= 0 && fy >= 0
        val (ax, ay) = if (free) (fx.toFloat() / 100f).coerceIn(0f, 1f) to (fy.toFloat() / 100f).coerceIn(0f, 1f) else PLACES[c.optString("place")] ?: (0f to 1f)
        val nx = if (free) 0f else (c.optDouble("x", 0.0).toFloat().coerceIn(-45f, 45f)) / 100f
        val ny = if (free) 0f else (c.optDouble("y", 0.0).toFloat().coerceIn(-45f, 45f)) / 100f
        val k = (c.optDouble("size", 100.0).toFloat().coerceIn(30f, 300f)) / 100f
        return LogoSpot(ax, ay, nx, ny, k, c.optString("count") != "no")
    }

    /** Which part of a library's tile picture shows (Look and feel → that library → "Which part of the picture shows"). */
    fun tileFocus(tile: JSONObject): Pair<Float, Float> = when (libLook(tile.optLong("id")).optString("tilePos")) {
        "center" -> 0.5f to 0.5f
        "top" -> 0.5f to 0f
        "bottom" -> 0.5f to 1f
        "left" -> 0f to 0.5f
        "right" -> 1f to 0.5f
        else -> 0.5f to 0.3f // centre, a little high, as on the website
    }

    /** A library's own logo (Studio → Look and feel → that library), shown on its tile instead of its name. */
    fun tileLogo(tile: JSONObject): String? = usable(libLook(tile.optLong("id")).optString("logo"))

    /** How bright a library's tile is: the library's own setting, else the Fire TV app's. 100 is as it is. */
    fun tileBrightness(tile: JSONObject): Int {
        val own = libLook(tile.optLong("id")).optInt("tileBrightness", 0)
        return if (own in 20..160) own else num("tiles", "brightness", 100)
    }

    private fun isVideo(u: String?) = !u.isNullOrBlank() && Regex("\\.(mp4|webm|m4v|mov)(\\?|$)", RegexOption.IGNORE_CASE).containsMatchIn(u)

    /** A library tile's video (the website's rules: its tile video, a video tile picture, or a video page background). */
    fun tileVideo(tile: JSONObject): String? {
        if (!flag("tiles", "videos", true)) return null
        val lk = libLook(tile.optLong("id"))
        val v = when {
            isVideo(lk.optString("tileVideo")) -> lk.optString("tileVideo")
            isVideo(lk.optString("tileBackground")) -> lk.optString("tileBackground")
            lk.optString("tileUse") != "artwork" && lk.optString("tileBackground").isBlank() && isVideo(lk.optString("background")) -> lk.optString("background")
            else -> null
        }
        return tvVideo(v)
    }

    /** The background behind a library's page, if it has one and the Fire TV app shows them. */
    fun libraryBackground(id: Long): String? = if (flag("library", "background", true)) usable(libLook(id).optString("background"))?.let { fit(it, 1280) } else null
}

/** A picture that fills its frame like a centre crop, but shows the chosen part (fx, fy: 0 = left/top, 1 = right/bottom). */
class FocalImageView(ctx: Context) : ImageView(ctx) {
    var fx = 0.5f
        set(v) { field = v; refit() }
    var fy = 0.5f
        set(v) { field = v; refit() }
    init { scaleType = ScaleType.MATRIX }
    override fun setFrame(l: Int, t: Int, r: Int, b: Int): Boolean { val changed = super.setFrame(l, t, r, b); refit(); return changed }
    override fun setImageDrawable(d: android.graphics.drawable.Drawable?) { super.setImageDrawable(d); refit() }
    private fun refit() {
        val d = drawable ?: return
        val vw = (width - paddingLeft - paddingRight).toFloat(); val vh = (height - paddingTop - paddingBottom).toFloat()
        val dw = d.intrinsicWidth.toFloat(); val dh = d.intrinsicHeight.toFloat()
        if (vw <= 0 || vh <= 0 || dw <= 0 || dh <= 0) return
        val s = maxOf(vw / dw, vh / dh)
        imageMatrix = android.graphics.Matrix().apply { setScale(s, s); postTranslate((vw - dw * s) * fx, (vh - dh * s) * fy) }
    }
}

/** Darker (below 100) or brighter (above) artwork, for the brightness settings. */
fun ImageView.brightness(percent: Int) {
    if (percent == 100) { clearColorFilter(); return }
    val f = percent / 100f
    colorFilter = android.graphics.ColorMatrixColorFilter(android.graphics.ColorMatrix(floatArrayOf(
        f, 0f, 0f, 0f, 0f, 0f, f, 0f, 0f, 0f, 0f, 0f, f, 0f, 0f, 0f, 0f, 0f, 1f, 0f)))
}

/** Server calls off the main thread; answers come back on it, and never to a closed screen. */
object TvApi {
    private val pool = Executors.newFixedThreadPool(3)

    fun get(act: Activity, path: String, ok: (JSONObject) -> Unit, fail: (String) -> Unit = {}) = run(act, "GET", path, null, ok, fail)
    fun post(act: Activity, path: String, body: JSONObject, ok: (JSONObject) -> Unit = {}, fail: (String) -> Unit = {}) = run(act, "POST", path, body, ok, fail)

    private fun run(act: Activity, method: String, path: String, body: JSONObject?, ok: (JSONObject) -> Unit, fail: (String) -> Unit) {
        pool.execute {
            try {
                val r = Server.call(TvSession.server, TvSession.token, method, path, body)
                act.runOnUiThread { if (!act.isFinishing && !act.isDestroyed) ok(r) }
            } catch (e: Exception) {
                val msg = if (e is Server.ServerError) e.message ?: "Something went wrong" else "Couldn't reach HallFlix"
                act.runOnUiThread { if (!act.isFinishing && !act.isDestroyed) fail(msg) }
            }
        }
    }
}

/** Moving between the native screens, the player and the web app. */
object TvNav {
    /** A title picked on the TV's own home screen before HallFlix had started: played once Home opens. */
    var pendingPlay = 0L

    /** Native screens that are open, so going to the web app can close them all. */
    val open = mutableSetOf<Activity>()

    /** A title page: movies and shows are native; books, comics and music go to the web app's own page. */
    fun openItem(act: Activity, item: JSONObject) {
        val kind = item.optString("kind")
        when (kind) {
            "movie", "show" -> act.startActivity(Intent(act, TvDetailsActivity::class.java).putExtra("id", item.optLong("id")))
            "episode" -> act.startActivity(Intent(act, TvDetailsActivity::class.java)
                .putExtra("id", item.optJSONObject("show")?.optLong("id") ?: item.optLong("id")).putExtra("focus", item.optLong("id")))
            "book", "comic" -> toWeb(act, "location.hash = '#/read/${item.optLong("id")}'")
            else -> toWeb(act, "location.hash = '#/title/${item.optLong("id")}'")
        }
    }

    /** A library: movies and shows are native; music, books and comics use the web app's richer pages. */
    fun openLibrary(act: Activity, lib: JSONObject) {
        val kind = lib.optString("kind")
        if (kind == "movies" || kind == "shows") {
            act.startActivity(Intent(act, TvLibraryActivity::class.java).putExtra("id", lib.optLong("id")).putExtra("name", lib.optString("name")))
        } else toWeb(act, "location.hash = '#/library/${lib.optLong("id")}'")
    }

    fun search(act: Activity, voice: Boolean = false) = act.startActivity(Intent(act, TvSearchActivity::class.java).putExtra("voice", voice))
    fun myList(act: Activity) = act.startActivity(Intent(act, TvGridActivity::class.java)
        .putExtra("path", "/api/mylist").putExtra("title", "My List").putExtra("empty", "Add titles with “+ My List” on their page and they’ll wait for you here."))
    fun upNext(act: Activity) = act.startActivity(Intent(act, TvGridActivity::class.java)
        .putExtra("path", "/api/upnext").putExtra("title", "Up next").putExtra("play", true)
        .putExtra("empty", "When you finish an episode, the next one waits here. Press OK on it to play."))

    /** Play in the app's own player. start: seconds, 0 from the beginning, null to carry on where it was left. */
    fun play(act: Activity, itemId: Long, start: Double?) {
        if (itemId <= 0) return
        act.startActivity(Intent(act, PlayerActivity::class.java)
            .putExtra("server", TvSession.server)
            .putExtra("token", TvSession.token)
            .putExtra("itemId", itemId)
            .putExtra("device", TvSession.device)
            .putExtra("deviceName", TvSession.deviceName)
            .putExtra("tv", true)
            .putExtra("start", start ?: -1.0))
    }

    /** Close the native screens and run a bit of JavaScript in the web app (usually a page to go to). */
    fun toWeb(act: Activity, js: String) {
        MainActivity.pendingJs = js
        act.startActivity(Intent(act, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP))
        for (a in open.toList()) if (a !== act) a.finish()
        act.finish()
    }

    /** After the app was closed in the background and reopened on a native screen: start again from the web app. */
    fun lost(act: Activity): Boolean {
        if (TvSession.ready) return false
        act.startActivity(Intent(act, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP))
        act.finish()
        return true
    }
}

// ── Small view helpers ──

fun Context.dp(n: Number): Int = (n.toFloat() * resources.displayMetrics.density + 0.5f).toInt()

/** The look's fonts, bundled in the app (assets/fonts, converted from the website's own font files). */
object TvFonts {
    private val cache = HashMap<String, Typeface?>()
    private val files = mapOf("outfit" to "outfit", "inter" to "inter", "bebas neue" to "bebas", "audiowide" to "audiowide")
    fun get(ctx: Context, name: String, bold: Boolean): Typeface? {
        val n = name.trim().lowercase()
        if (n == "georgia") return Typeface.create(Typeface.SERIF, if (bold) Typeface.BOLD else Typeface.NORMAL)
        if (n == "system" || n.isEmpty()) return Typeface.create("sans-serif", if (bold) Typeface.BOLD else Typeface.NORMAL)
        val base = files[n] ?: return null
        // Outfit and Inter come in regular and bold; Bebas Neue and Audiowide have one weight.
        val file = if (base == "outfit" || base == "inter") "fonts/$base-${if (bold) "bold" else "regular"}.ttf" else "fonts/$base.ttf"
        return cache.getOrPut(file) { try { Typeface.createFromAsset(ctx.assets, file) } catch (e: Exception) { null } }
    }
}

fun Context.label(size: Float, color: Int = TvLook.text, bold: Boolean = false, lines: Int = 1): TextView = TextView(this).apply {
    textSize = size
    setTextColor(color)
    typeface = TvFonts.get(this@label, if (bold) TvLook.displayFont else TvLook.bodyFont, bold)
        ?: if (bold) Typeface.create("sans-serif-medium", Typeface.BOLD) else Typeface.DEFAULT
    maxLines = lines
    ellipsize = TextUtils.TruncateAt.END
    includeFontPadding = false
}

fun rounded(color: Int, radius: Float, stroke: Int = 0, strokeColor: Int = 0) = GradientDrawable().apply {
    setColor(color); cornerRadius = radius
    if (stroke > 0) setStroke(stroke, strokeColor)
}

/** A ring drawn only while the view has focus. */
fun Context.focusRing(radius: Float): StateListDrawable = StateListDrawable().apply {
    val w = TvLook.num("cards", "ring", 3)
    if (TvLook.showFocus && w > 0) addState(intArrayOf(android.R.attr.state_focused), rounded(Color.TRANSPARENT, radius, dp(w), TvLook.focus))
    addState(intArrayOf(), ColorDrawable(Color.TRANSPARENT))
}

/** Grows a little when focused; also tells `also` about focus changes. */
fun View.zoomOnFocus(scale: Float = 1.08f, also: (Boolean) -> Unit = {}) {
    setOnFocusChangeListener { v, has ->
        v.animate().scaleX(if (has) scale else 1f).scaleY(if (has) scale else 1f).setDuration(140).start()
        if (has) v.translationZ = 8f else v.translationZ = 0f
        also(has)
    }
}

fun View.clipRounded(radius: Float) {
    outlineProvider = object : ViewOutlineProvider() {
        override fun getOutline(view: View, outline: Outline) { outline.setRoundRect(0, 0, view.width, view.height, radius) }
    }
    clipToOutline = true
}

fun Activity.loadImage(into: ImageView, url: String?) {
    val full = TvSession.abs(url)
    if (full == null) { Glide.with(this).clear(into); into.setImageDrawable(null); return }
    Glide.with(this).load(full).transition(DrawableTransitionOptions.withCrossFade(180)).into(into)
}

/** A button in the HallFlix style: filled when it's the main one, quiet otherwise; white with dark text when focused. */
fun Activity.tvButton(text: String, primary: Boolean = false, onClick: () -> Unit): TextView = label(16f, bold = true).apply {
    this.text = text
    gravity = Gravity.CENTER
    setPadding(dp(22), dp(11), dp(22), dp(11))
    isFocusable = true
    isClickable = true
    val r = dp(8).toFloat()
    val idle = rounded(if (primary) TvLook.accent else 0x33FFFFFF, r)
    val on = rounded(Color.WHITE, r)
    background = StateListDrawable().apply { addState(intArrayOf(android.R.attr.state_focused), on); addState(intArrayOf(), idle) }
    val dark = if (primary) contrast(TvLook.accent) else TvLook.text
    setTextColor(dark)
    zoomOnFocus(1.05f) { has -> setTextColor(if (has) 0xFF0A0814.toInt() else dark) }
    setOnClickListener { onClick() }
}

/** Black or white text, whichever reads better on this colour. */
fun contrast(c: Int): Int {
    val l = (0.299 * Color.red(c) + 0.587 * Color.green(c) + 0.114 * Color.blue(c)) / 255
    return if (l > 0.6) 0xFF0A0814.toInt() else Color.WHITE
}

/** "2024 · PG-13 · 1h 52m · ★ 7.8" (or "S1 E3 · Pilot" for an episode). */
fun metaLine(it: JSONObject): String {
    val parts = mutableListOf<String>()
    val show = it.optJSONObject("show")
    if (show != null) parts += "S${show.optInt("season")} E${show.optInt("episode")}"
    if (it.optInt("year") > 0) parts += it.optInt("year").toString()
    it.optString("rating").takeIf { r -> r.isNotEmpty() && r != "null" }?.let { r -> parts += r }
    val rt = it.optDouble("runtime", 0.0)
    if (rt > 0) parts += runtimeText(rt)
    val sc = it.optDouble("score", 0.0)
    if (sc > 0) parts += "★ ${"%.1f".format(sc)}"
    return parts.joinToString("  ·  ")
}

fun runtimeText(seconds: Double): String {
    val m = (seconds / 60).toInt()
    return if (m >= 60) "${m / 60}h ${m % 60}m" else "${m}m"
}

/** 0–1 of the way through, or -1 when not started (or finished). */
fun progressOf(it: JSONObject?): Float {
    val p = it?.optJSONObject("progress") ?: return -1f
    if (p.optBoolean("watched")) return -1f
    val d = p.optDouble("duration", 0.0)
    val pos = p.optDouble("position", 0.0)
    return if (d > 0 && pos > 0) (pos / d).toFloat().coerceIn(0.02f, 1f) else -1f
}

fun JSONArray.objects(): List<JSONObject> = (0 until length()).mapNotNull { optJSONObject(it) }

// ── Rows and cards ──

enum class Shape { POSTER, WIDE, SQUARE }

/** Keeps the focused item at a fixed place (lead px from the start), the way TV apps scroll. */
class LeadLayoutManager(ctx: Context, orientation: Int, private val lead: Int) : LinearLayoutManager(ctx, orientation, false) {
    override fun requestChildRectangleOnScreen(parent: RecyclerView, child: View, rect: Rect, immediate: Boolean, focusedChildVisible: Boolean): Boolean {
        val d = if (orientation == HORIZONTAL) getDecoratedLeft(child) - lead else getDecoratedTop(child) - lead
        if (d == 0) return false
        val dx = if (orientation == HORIZONTAL) d else 0
        val dy = if (orientation == VERTICAL) d else 0
        if (immediate) parent.scrollBy(dx, dy) else parent.smoothScrollBy(dx, dy)
        return true
    }
}

/** A sideways row that keeps Left and Right inside itself (pressing Right on the last card stays there). */
class RowRecycler @JvmOverloads constructor(ctx: Context, attrs: AttributeSet? = null) : RecyclerView(ctx, attrs) {
    override fun focusSearch(focused: View, direction: Int): View? {
        val found = super.focusSearch(focused, direction)
        if (direction == View.FOCUS_LEFT || direction == View.FOCUS_RIGHT) {
            if (found == null || !isInside(found)) return focused
        }
        return found
    }
    private fun isInside(v: View): Boolean {
        var p = v.parent
        while (p != null) { if (p === this) return true; p = p.parent }
        return false
    }
}

/** One card: artwork, a fallback title, an optional caption and a progress bar. */
class CardHolder(val root: FrameLayout, val image: FocalImageView, val name: TextView, val caption: TextView?, val bar: View, val barTrack: View) : RecyclerView.ViewHolder(root)

/** Card sizes from Studio → Fire TV app → Rows (posters 2:3, wide cards 16:9, music squares). */
fun Activity.cardSize(shape: Shape): Pair<Int, Int> {
    val pw = TvLook.num("rows", "posterWidth", 122)
    val ww = TvLook.num("rows", "wideWidth", 224)
    return when (shape) {
        Shape.POSTER -> dp(pw) to dp(pw * 1.5f)
        Shape.WIDE -> dp(ww) to dp(ww * 0.5625f)
        Shape.SQUARE -> dp(pw * 1.23f) to dp(pw * 1.23f)
    }
}

/** How much a card grows when focused (Studio → Fire TV app → Cards). */
fun cardScale(): Float = TvLook.num("cards", "scale", 108) / 100f
fun Context.cardRadius(): Float = dp(TvLook.num("cards", "radius", 8)).toFloat()

fun Activity.makeCard(shape: Shape, withCaption: Boolean, size: Pair<Int, Int>? = null): CardHolder {
    val (w, h) = size ?: cardSize(shape)
    val r = cardRadius()
    val frame = FrameLayout(this).apply {
        layoutParams = ViewGroup.MarginLayoutParams(w, h).apply { marginEnd = dp(14) }
        isFocusable = true
        isClickable = true
        background = rounded(TvLook.surface, r)
        foreground = focusRing(r)
        clipRounded(r)
    }
    val name = label(15f, bold = true, lines = 3).apply {
        gravity = Gravity.CENTER
        setPadding(dp(10), dp(10), dp(10), dp(10))
    }
    frame.addView(name, FrameLayout.LayoutParams(-1, -1))
    val img = FocalImageView(this)
    frame.addView(img, FrameLayout.LayoutParams(-1, -1))
    var caption: TextView? = null
    if (withCaption) {
        val shade = View(this).apply {
            background = GradientDrawable(GradientDrawable.Orientation.BOTTOM_TOP, intArrayOf(0xE6000000.toInt(), 0x00000000))
        }
        frame.addView(shade, FrameLayout.LayoutParams(-1, h / 2, Gravity.BOTTOM))
        caption = label(13f, bold = true, lines = 1).apply { setPadding(dp(10), 0, dp(10), dp(12)) }
        frame.addView(caption, FrameLayout.LayoutParams(-1, -2, Gravity.BOTTOM))
    }
    val track = View(this).apply { setBackgroundColor(0x55FFFFFF) }
    frame.addView(track, FrameLayout.LayoutParams(-1, dp(4), Gravity.BOTTOM))
    val bar = View(this).apply { setBackgroundColor(TvLook.accent) }
    frame.addView(bar, FrameLayout.LayoutParams(0, dp(4), Gravity.BOTTOM))
    return CardHolder(frame, img, name, caption, bar, track)
}

fun Activity.bindCard(h: CardHolder, it: JSONObject, shape: Shape) {
    val title = it.optJSONObject("show")?.optString("title")?.ifEmpty { null } ?: it.optString("title").ifEmpty { it.optString("name") }
    h.name.text = title
    val art = when (shape) {
        Shape.WIDE -> it.optString("thumb").ifEmpty { it.optString("backdrop") }.ifEmpty { it.optString("still") }.ifEmpty { it.optString("poster") }
        else -> it.optString("poster").ifEmpty { it.optString("backdrop") }
    }.takeIf { s -> s.isNotEmpty() && s != "null" }
    loadImage(h.image, art)
    h.caption?.text = if (it.optJSONObject("show") != null) "$title · ${metaLine(it).substringBefore("  ·  ")}" else title
    val p = if (TvLook.flag("rows", "progress", true)) progressOf(it) else -1f
    h.barTrack.visibility = if (p >= 0) View.VISIBLE else View.GONE
    h.bar.visibility = if (p >= 0) View.VISIBLE else View.GONE
    if (p >= 0) {
        val w = h.root.layoutParams?.width?.takeIf { x -> x > 0 } ?: cardSize(shape).first
        h.bar.layoutParams = (h.bar.layoutParams as FrameLayout.LayoutParams).apply { width = (w * p).toInt() }
    }
    h.root.contentDescription = title
}

/** A row of cards. onFocus is told which item has focus (for the home screen's big picture). */
class CardAdapter(
    private val act: Activity,
    var items: List<JSONObject>,
    private val shape: Shape,
    private val captions: Boolean,
    private val onFocus: (JSONObject) -> Unit,
    private val onPick: (JSONObject) -> Unit,
    private val onNearEnd: (() -> Unit)? = null,
    private val size: Pair<Int, Int>? = null,
) : RecyclerView.Adapter<CardHolder>() {
    override fun getItemCount() = items.size
    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int) = act.makeCard(shape, captions, size)
    override fun onBindViewHolder(h: CardHolder, position: Int) {
        val item = items[position]
        act.bindCard(h, item, shape)
        h.root.zoomOnFocus(cardScale()) { has -> if (has) onFocus(item) }
        h.root.setOnClickListener { onPick(item) }
        if (onNearEnd != null && position >= items.size - 12) onNearEnd.invoke()
    }
}

/** Runs the newest request after a short pause (for the big picture following focus without flicker). */
class Debounce(private val ms: Long) {
    private val h = Handler(Looper.getMainLooper())
    private var r: Runnable? = null
    fun run(block: () -> Unit) { r?.let { h.removeCallbacks(it) }; r = Runnable(block).also { h.postDelayed(it, ms) } }
    fun cancel() { r?.let { h.removeCallbacks(it) } }
}

fun Activity.row(): LinearLayout = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
fun Activity.column(): LinearLayout = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }


/**
 * The base of every native TV screen: after five minutes with no button pressed, a screensaver drifts slowly across
 * backdrops (the Studio's screensaver pictures, title backdrops, or both, from /api/screensaver) with the time and the
 * logo. Any button wakes it without doing anything else. Look and feel → Screensaver "Off" turns it off.
 */
abstract class TvScreen : Activity() {
    private val idle = Handler(Looper.getMainLooper())
    private var saver: FrameLayout? = null
    private val wake = Runnable { startSaver() }

    private fun arm() { idle.removeCallbacks(wake); if (TvLook.screensaver != "off") idle.postDelayed(wake, 5 * 60_000L) }

    override fun onResume() { super.onResume(); arm(); Updates.check(this) }
    override fun onPause() { idle.removeCallbacks(wake); stopSaver(); super.onPause() }

    override fun dispatchKeyEvent(event: android.view.KeyEvent): Boolean {
        if (saver != null) { if (event.action == android.view.KeyEvent.ACTION_UP) { stopSaver(); arm() }; return true }
        arm()
        return super.dispatchKeyEvent(event)
    }

    private fun stopSaver() {
        val s = saver ?: return
        saver = null
        s.animate().alpha(0f).setDuration(250).withEndAction { (s.parent as? ViewGroup)?.removeView(s); s.tag?.let { (it as? Runnable)?.let { r -> idle.removeCallbacks(r) } } }.start()
    }

    private fun startSaver() {
        if (saver != null || isFinishing) return
        Thread {
            val list = try { Server.list(TvSession.server, TvSession.token, "/api/screensaver").objects().filter { TvLook.usable(it.optString("image")) != null } } catch (e: Exception) { emptyList() }
            runOnUiThread { if (list.size >= 2 && !isFinishing && saver == null && hasWindowFocus()) showSaver(list) else arm() }
        }.start()
    }

    private fun picture(u: String): String = when {
        u.startsWith("/img/t/original/") -> u.replace("/img/t/original/", "/img/t/w1280/") // a TV-sized copy of TMDB art
        else -> TvLook.fit(u, 1280)
    }

    private fun showSaver(list: List<JSONObject>) {
        val w = resources.displayMetrics.widthPixels.toFloat()
        val root = FrameLayout(this).apply { setBackgroundColor(Color.BLACK); alpha = 0f; isClickable = true }
        val layers = List(2) { ImageView(this).apply { scaleType = ImageView.ScaleType.CENTER_CROP; alpha = 0f } }
        for (l in layers) root.addView(l, FrameLayout.LayoutParams(-1, -1))
        root.addView(View(this).apply {
            background = GradientDrawable(GradientDrawable.Orientation.BOTTOM_TOP, intArrayOf(0xCC000000.toInt(), 0x00000000, 0x00000000))
        }, FrameLayout.LayoutParams(-1, -1))
        val info = column().apply { setPadding(dp(48), 0, dp(48), dp(40)) }
        val logo = ImageView(this).apply { adjustViewBounds = true; scaleType = ImageView.ScaleType.FIT_START }
        if (TvLook.logo != null) loadImage(logo, TvLook.logo) else logo.setImageResource(R.drawable.logo)
        info.addView(logo, LinearLayout.LayoutParams(-2, dp(28)).apply { bottomMargin = dp(10) })
        val title = label(22f, Color.WHITE, bold = true)
        val sub = label(14f, 0xCCFFFFFF.toInt())
        info.addView(title); info.addView(sub)
        root.addView(info, FrameLayout.LayoutParams(-1, -2, Gravity.BOTTOM or Gravity.START))
        val clock = label(28f, Color.WHITE, bold = true).apply { setPadding(0, dp(32), dp(48), 0) }
        root.addView(clock, FrameLayout.LayoutParams(-2, -2, Gravity.TOP or Gravity.END))
        (window.decorView as ViewGroup).addView(root, ViewGroup.LayoutParams(-1, -1))
        saver = root
        root.animate().alpha(1f).setDuration(600).start()
        var i = -1
        var layer = 0
        val fmt = android.text.format.DateFormat.getTimeFormat(this)
        val next = object : Runnable {
            override fun run() {
                if (saver !== root) return
                i = (i + 1) % list.size; layer = 1 - layer
                val it = list[i]
                val v = layers[layer]
                loadImage(v, picture(it.optString("image")))
                // A slow drift and zoom over the twelve seconds each picture shows.
                val dir = if (i % 2 == 0) 1 else -1
                v.scaleX = 1.04f; v.scaleY = 1.04f; v.translationX = -dir * w * 0.02f
                v.animate().alpha(1f).setDuration(1200).start()
                v.animate().scaleX(1.14f).scaleY(1.14f).translationX(dir * w * 0.02f).setDuration(13_000).setInterpolator(android.view.animation.LinearInterpolator()).start()
                layers[1 - layer].animate().alpha(0f).setDuration(1200).start()
                title.text = it.optString("title")
                sub.text = it.optString("sub")
                clock.text = fmt.format(java.util.Date())
                idle.postDelayed(this, 12_000)
            }
        }
        root.tag = next
        next.run()
    }
}
