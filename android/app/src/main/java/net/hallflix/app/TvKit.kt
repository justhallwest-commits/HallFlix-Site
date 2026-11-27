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

/** The Studio's look, as far as the native screens use it: colours, the focus ring, the logo, and the libraries. */
object TvLook {
    var bg = 0xFF0A0814.toInt()
    var surface = 0xFF16122B.toInt()
    var text = 0xFFF4F2FF.toInt()
    var muted = 0xFFA8A3C7.toInt()
    var accent = 0xFF35D0D0.toInt()
    var accent2 = 0xFFB344D6.toInt()
    var focus = Color.WHITE
    var logo: String? = null
    var libraries = JSONArray()
    var profileName = ""
    var loaded = false

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
        val look = boot.optJSONObject("look") ?: JSONObject()
        val tv = look.optJSONObject("devices")?.optJSONObject("tv")
        val base = look.optJSONObject("colors")
        val over = tv?.optJSONObject("colors")
        fun pick(key: String, d: Int) = color(over, key, color(base, key, d))
        bg = pick("bg", bg); surface = pick("surface", surface); text = pick("text", text)
        muted = pick("muted", muted); accent = pick("accent", accent); accent2 = pick("accent2", accent2)
        val focusKind = tv?.optJSONObject("tv")?.optString("focus")?.ifEmpty { null } ?: look.optJSONObject("tv")?.optString("focus")
        focus = if (focusKind == "accent") accent else Color.WHITE
        logo = look.optJSONObject("logo")?.optString("image")?.ifEmpty { null }
        libraries = boot.optJSONArray("libraries") ?: JSONArray()
        profileName = boot.optJSONObject("profile")?.optString("name").orEmpty()
        loaded = true
    }
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

fun Context.label(size: Float, color: Int = TvLook.text, bold: Boolean = false, lines: Int = 1): TextView = TextView(this).apply {
    textSize = size
    setTextColor(color)
    if (bold) typeface = Typeface.create("sans-serif-medium", Typeface.BOLD)
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
    addState(intArrayOf(android.R.attr.state_focused), rounded(Color.TRANSPARENT, radius, dp(3), TvLook.focus))
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
class CardHolder(val root: FrameLayout, val image: ImageView, val name: TextView, val caption: TextView?, val bar: View, val barTrack: View) : RecyclerView.ViewHolder(root)

fun Activity.cardSize(shape: Shape): Pair<Int, Int> = when (shape) {
    Shape.POSTER -> dp(122) to dp(183)
    Shape.WIDE -> dp(224) to dp(126)
    Shape.SQUARE -> dp(150) to dp(150)
}

fun Activity.makeCard(shape: Shape, withCaption: Boolean): CardHolder {
    val (w, h) = cardSize(shape)
    val r = dp(8).toFloat()
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
    val img = ImageView(this).apply { scaleType = ImageView.ScaleType.CENTER_CROP }
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
    val p = progressOf(it)
    h.barTrack.visibility = if (p >= 0) View.VISIBLE else View.GONE
    h.bar.visibility = if (p >= 0) View.VISIBLE else View.GONE
    if (p >= 0) {
        val w = cardSize(shape).first
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
) : RecyclerView.Adapter<CardHolder>() {
    override fun getItemCount() = items.size
    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int) = act.makeCard(shape, captions)
    override fun onBindViewHolder(h: CardHolder, position: Int) {
        val item = items[position]
        act.bindCard(h, item, shape)
        h.root.zoomOnFocus { has -> if (has) onFocus(item) }
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
