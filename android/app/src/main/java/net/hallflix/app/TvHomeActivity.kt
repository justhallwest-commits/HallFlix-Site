package net.hallflix.app

import android.app.Activity
import android.app.AlertDialog
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.os.SystemClock
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.recyclerview.widget.RecyclerView
import org.json.JSONObject

/**
 * The native TV home screen: a big picture of the focused title, the top menu, library tiles, and the Studio's home rows
 * (Continue watching, My List, new in each library, genres…). Rows, order and hidden sections come from /api/home,
 * so the Studio's Home layout applies here too.
 */
class TvHomeActivity : Activity() {
    private lateinit var heroImage: ImageView
    private lateinit var heroLogo: ImageView
    private lateinit var heroTitle: TextView
    private lateinit var heroMeta: TextView
    private lateinit var heroText: TextView
    private lateinit var heroButtons: LinearLayout
    private lateinit var playBtn: TextView
    private lateinit var rows: RecyclerView
    private lateinit var status: TextView
    private lateinit var nav: LinearLayout

    private var spotlight = listOf<JSONObject>()
    private var spot = 0
    private var shown: JSONObject? = null
    private val follow = Debounce(220)
    private val rotate = android.os.Handler(android.os.Looper.getMainLooper())
    private var refreshOnReturn = false
    private var backAt = 0L

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (TvNav.lost(this)) return
        TvNav.open += this
        build()
        load()
    }

    override fun onDestroy() {
        TvNav.open -= this
        rotate.removeCallbacksAndMessages(null)
        follow.cancel()
        super.onDestroy()
    }

    override fun onResume() {
        super.onResume()
        // Back from the player or a title page: Continue Watching and My List may have changed.
        if (refreshOnReturn) { refreshOnReturn = false; load(quiet = true) }
    }


    private fun build() {
        val root = FrameLayout(this).apply { setBackgroundColor(TvLook.bg) }
        val w = resources.displayMetrics.widthPixels
        val h = resources.displayMetrics.heightPixels

        // The big picture: right-hand two thirds, fading into the background on the left and at the bottom.
        heroImage = ImageView(this).apply { scaleType = ImageView.ScaleType.CENTER_CROP }
        root.addView(heroImage, FrameLayout.LayoutParams((w * 0.72).toInt(), (h * 0.74).toInt(), Gravity.END or Gravity.TOP))
        root.addView(View(this).apply {
            background = GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT, intArrayOf(TvLook.bg, TvLook.bg and 0x00FFFFFF or 0xCC000000.toInt(), TvLook.bg and 0x00FFFFFF))
        }, FrameLayout.LayoutParams((w * 0.72).toInt(), (h * 0.74).toInt(), Gravity.END or Gravity.TOP).apply { })
        root.addView(View(this).apply {
            background = GradientDrawable(GradientDrawable.Orientation.BOTTOM_TOP, intArrayOf(TvLook.bg, TvLook.bg and 0x00FFFFFF))
        }, FrameLayout.LayoutParams(-1, (h * 0.34).toInt(), Gravity.TOP).apply { topMargin = (h * 0.42).toInt() })
        root.addView(View(this).apply { setBackgroundColor(TvLook.bg) }, FrameLayout.LayoutParams(-1, (h * 0.26).toInt(), Gravity.BOTTOM))

        // The top menu.
        nav = row().apply { setPadding(dp(40), dp(18), dp(40), 0) }
        val logo = ImageView(this).apply { adjustViewBounds = true; scaleType = ImageView.ScaleType.FIT_START }
        if (TvLook.logo != null) loadImage(logo, TvLook.logo) else logo.setImageResource(R.drawable.logo)
        nav.addView(logo, LinearLayout.LayoutParams(-2, dp(30)).apply { marginEnd = dp(26) })
        fun tab(text: String, action: () -> Unit) = label(15f, TvLook.muted, bold = true).apply {
            this.text = text
            setPadding(dp(12), dp(7), dp(12), dp(7))
            isFocusable = true; isClickable = true
            background = focusRing(dp(16).toFloat()).apply { }
            zoomOnFocus(1.06f) { has -> setTextColor(if (has) TvLook.text else TvLook.muted) }
            setOnClickListener { action() }
        }
        nav.addView(tab("Home") { focusHero() }.apply { setTextColor(TvLook.text) })
        for (lib in TvLook.libraries.objects()) nav.addView(tab(lib.optString("name")) { TvNav.openLibrary(this, lib) })
        nav.addView(tab("Search") { TvNav.toWeb(this, "location.hash = '#/search/'") })
        nav.addView(tab("My List") { TvNav.toWeb(this, "location.hash = '#/list'") })
        nav.addView(View(this), LinearLayout.LayoutParams(0, 1, 1f))
        nav.addView(tab(TvLook.profileName.ifEmpty { "Profile" }) { profileMenu() })
        root.addView(nav, FrameLayout.LayoutParams(-1, -2, Gravity.TOP))

        // What the big picture is about.
        val info = column().apply { setPadding(dp(48), 0, 0, 0) }
        heroLogo = ImageView(this).apply { adjustViewBounds = true; scaleType = ImageView.ScaleType.FIT_START }
        info.addView(heroLogo, LinearLayout.LayoutParams(dp(300), dp(84)).apply { bottomMargin = dp(10) })
        heroTitle = label(34f, bold = true, lines = 2)
        info.addView(heroTitle, LinearLayout.LayoutParams((w * 0.45).toInt(), -2).apply { bottomMargin = dp(8) })
        heroMeta = label(14f, TvLook.muted, bold = true)
        info.addView(heroMeta, LinearLayout.LayoutParams(-2, -2).apply { bottomMargin = dp(10) })
        heroText = label(15f, TvLook.text, lines = 3).apply { setLineSpacing(0f, 1.15f); alpha = 0.92f }
        info.addView(heroText, LinearLayout.LayoutParams((w * 0.42).toInt(), -2).apply { bottomMargin = dp(16) })
        heroButtons = row()
        playBtn = tvButton("▶  Play", primary = true) { shown?.let { playItem(it) } }
        heroButtons.addView(playBtn, LinearLayout.LayoutParams(-2, -2).apply { marginEnd = dp(12) })
        heroButtons.addView(tvButton("More info") { shown?.let { TvNav.openItem(this, it) } })
        info.addView(heroButtons)
        root.addView(info, FrameLayout.LayoutParams(-1, -2, Gravity.TOP).apply { topMargin = dp(78) })

        // The rows: the focused row's top always sits at the same height.
        rows = RecyclerView(this).apply {
            layoutManager = LeadLayoutManager(this@TvHomeActivity, RecyclerView.VERTICAL, 0)
            itemAnimator = null
            clipToPadding = false
            setPadding(0, 0, 0, h)
            isFocusable = false
            descendantFocusability = ViewGroup.FOCUS_AFTER_DESCENDANTS
        }
        root.addView(rows, FrameLayout.LayoutParams(-1, -1).apply { topMargin = (h * 0.56).toInt() })

        status = label(16f, TvLook.muted, lines = 3).apply { gravity = Gravity.CENTER }
        root.addView(status, FrameLayout.LayoutParams(-1, -2, Gravity.CENTER))
        // Back on the big picture's buttons (from the rows or the menu): it shows the spotlight again.
        root.viewTreeObserver.addOnGlobalFocusChangeListener { _, now ->
            if (now != null && now.parent === heroButtons && heroButtons.alpha < 1f) { heroButtons.alpha = 1f; shown = null; showSpot() }
        }
        setContentView(root)
    }

    private fun load(quiet: Boolean = false) {
        if (!quiet) status.text = "Loading…"
        TvApi.get(this, "/api/home?lite=1", { data ->
            status.text = ""
            spotlight = data.optJSONArray("spotlight")?.objects().orEmpty()
            val list = mutableListOf<HomeRow>()
            val tiles = data.optJSONArray("libraries")?.objects().orEmpty()
            val tilesAt = data.optJSONObject("layout")?.optInt("tilesAt", -1) ?: -1
            val rowList = data.optJSONArray("rows")?.objects().orEmpty()
            rowList.forEachIndexed { i, r ->
                if (i == tilesAt && tiles.isNotEmpty()) list += HomeRow("Libraries", tiles, Shape.WIDE, tiles = true)
                val items = r.optJSONArray("items")?.objects().orEmpty()
                if (items.isEmpty()) return@forEachIndexed
                val shape = when (r.optString("shape")) { "wide" -> Shape.WIDE; "square" -> Shape.SQUARE; else -> Shape.POSTER }
                list += HomeRow(r.optString("title"), items, shape, cont = r.optString("id") == "continue")
            }
            if (tilesAt >= rowList.size && tiles.isNotEmpty()) list += HomeRow("Libraries", tiles, Shape.WIDE, tiles = true)
            if (list.isEmpty() && spotlight.isEmpty()) { status.text = "Your library is empty.\nAdd folders in the Studio on a computer."; return@get }
            val inRows = rows.hasFocus()
            rows.adapter = RowsAdapter(list)
            if (!quiet) { spot = 0; showSpot() }
            rows.post {
                when {
                    !quiet && spotlight.isNotEmpty() -> playBtn.requestFocus()
                    !quiet || inRows -> rows.getChildAt(0)?.let { firstCard(it)?.requestFocus() }
                }
            }
        }, { msg ->
            if (!quiet) {
                status.text = "$msg\nPress OK to try again."
                status.isFocusable = true
                status.setOnClickListener { status.isFocusable = false; load() }
                status.requestFocus()
            }
        })
    }

    private fun firstCard(row: View): View? = (row as? ViewGroup)?.let { g -> (0 until g.childCount).map { g.getChildAt(it) }.filterIsInstance<RecyclerView>().firstOrNull()?.getChildAt(0) }

    // ── The big picture ──

    private fun showSpot() {
        rotate.removeCallbacksAndMessages(null)
        if (spotlight.isEmpty()) { heroButtons.visibility = View.GONE; return }
        heroButtons.visibility = View.VISIBLE
        show(spotlight[spot % spotlight.size], wide = true)
        // While the big picture's buttons have focus, it moves on to the next spotlight title every 12 seconds.
        rotate.postDelayed({ if (heroButtons.hasFocus() && spotlight.size > 1) { spot++; showSpot() } else showSpot() }, 12_000)
    }

    private fun show(it: JSONObject, wide: Boolean) {
        if (shown === it) return
        shown = it
        loadImage(heroImage, it.optString("backdrop").ifEmpty { it.optString("poster") }.takeIf { s -> s.isNotEmpty() && s != "null" })
        val logo = it.optString("logo").takeIf { s -> s.isNotEmpty() && s != "null" }
        val name = it.optJSONObject("show")?.optString("title")?.ifEmpty { null } ?: it.optString("title").ifEmpty { it.optString("name") }
        if (logo != null) { heroLogo.visibility = View.VISIBLE; heroTitle.visibility = View.GONE; loadImage(heroLogo, logo) }
        else { heroLogo.visibility = View.GONE; heroTitle.visibility = View.VISIBLE; heroTitle.text = name }
        heroMeta.text = if (it.has("count") && it.has("kind") && !it.has("year") && it.optString("kind") in listOf("movies", "shows", "music", "books", "comics"))
            "${it.optInt("count")} titles" + (if (it.optInt("fresh") > 0) "  ·  ${it.optInt("fresh")} new" else "")
        else metaLine(it)
        heroText.text = it.optString("overview").takeIf { s -> s != "null" }.orEmpty()
        playBtn.text = if (progressOf(it) >= 0) "▶  Resume" else "▶  Play"
        if (!wide) heroButtons.alpha = 0f
    }

    private fun focusHero() {
        rows.scrollToPosition(0)
        heroButtons.alpha = 1f
        if (spotlight.isNotEmpty()) { showSpot(); playBtn.requestFocus() }
    }

    private fun playItem(it: JSONObject) {
        refreshOnReturn = true
        when (it.optString("kind")) {
            "movie", "episode" -> TvNav.play(this, it.optLong("id"), null)
            "show" -> TvApi.get(this, "/api/items/${it.optLong("id")}", { d -> TvNav.play(this, d.optLong("playId"), null) }, { m -> Toast.makeText(this, m, Toast.LENGTH_SHORT).show() })
            else -> TvNav.openItem(this, it)
        }
    }

    private fun profileMenu() {
        val opts = arrayOf("Switch profile", "My HallFlix", "Use the web version of the TV screens", "Change server")
        AlertDialog.Builder(this, android.R.style.Theme_Material_Dialog_Alert)
            .setTitle(TvLook.profileName.ifEmpty { "HallFlix" })
            .setItems(opts) { _, which ->
                when (which) {
                    0 -> TvNav.toWeb(this, "HallFlix.api('POST','/api/logout').then(function(){location.hash='#/';location.reload();})")
                    1 -> TvNav.toWeb(this, "location.hash = '#/me'")
                    2 -> {
                        getSharedPreferences("hallflix", MODE_PRIVATE).edit().putBoolean("nativeTv", false).apply()
                        TvNav.toWeb(this, "location.hash = '#/'; window.dispatchEvent(new Event('hallflix-native-closed'))")
                    }
                    3 -> TvNav.toWeb(this, "window.HallFlixNative && HallFlixNative.changeServer()")
                }
            }
            .show()
    }

    // ── Back ──

    override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean {
        if (keyCode == KeyEvent.KEYCODE_BACK) {
            // In the rows or the menu: back to the big picture first. There: press twice to close HallFlix.
            if (!heroButtons.hasFocus() && spotlight.isNotEmpty()) { focusHero(); return true }
            val now = SystemClock.uptimeMillis()
            if (now - backAt < 2500) { if (MusicService.isPlaying) moveTaskToBack(true) else finishAffinity(); return true }
            backAt = now
            Toast.makeText(this, "Press Back again to close HallFlix", Toast.LENGTH_SHORT).show()
            return true
        }
        if (keyCode == KeyEvent.KEYCODE_MENU) { profileMenu(); return true }
        return super.onKeyDown(keyCode, event)
    }

    // ── Rows ──

    private class HomeRow(val title: String, val items: List<JSONObject>, val shape: Shape, val cont: Boolean = false, val tiles: Boolean = false)
    private class RowHolder(val root: LinearLayout, val title: TextView, val list: RowRecycler) : RecyclerView.ViewHolder(root)

    private inner class RowsAdapter(val list: List<HomeRow>) : RecyclerView.Adapter<RowHolder>() {
        private val pool = RecyclerView.RecycledViewPool()
        override fun getItemCount() = list.size
        override fun getItemViewType(position: Int) = list[position].shape.ordinal * 2 + if (list[position].tiles || list[position].cont) 1 else 0
        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): RowHolder {
            val col = column().apply { layoutParams = RecyclerView.LayoutParams(-1, -2); setPadding(0, 0, 0, dp(18)) }
            val t = label(17f, bold = true).apply { setPadding(dp(48), 0, 0, dp(10)) }
            col.addView(t)
            val rv = RowRecycler(this@TvHomeActivity).apply {
                layoutManager = LeadLayoutManager(this@TvHomeActivity, RecyclerView.HORIZONTAL, dp(48))
                setPadding(dp(48), dp(8), dp(48), dp(10))
                clipToPadding = false
                clipChildren = false
                itemAnimator = null
                setRecycledViewPool(pool)
                setHasFixedSize(true)
            }
            col.addView(rv, LinearLayout.LayoutParams(-1, -2))
            col.clipChildren = false
            return RowHolder(col, t, rv)
        }
        override fun onBindViewHolder(h: RowHolder, position: Int) {
            val r = list[position]
            h.title.text = r.title
            h.list.adapter = CardAdapter(this@TvHomeActivity, r.items, r.shape, captions = r.tiles || r.cont,
                onFocus = { it -> heroButtons.alpha = 0f; follow.run { show(it, wide = false) } },
                onPick = { it ->
                    when {
                        r.tiles -> TvNav.openLibrary(this@TvHomeActivity, it)
                        r.cont -> { refreshOnReturn = true; TvNav.play(this@TvHomeActivity, it.optLong("id"), null) } // Continue watching carries straight on
                        else -> TvNav.openItem(this@TvHomeActivity, it)
                    }
                })
        }
    }
}
