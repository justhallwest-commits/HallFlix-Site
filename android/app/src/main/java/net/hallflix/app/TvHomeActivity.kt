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
 * (Continue watching, My List, new in each library, genres…). Rows, order and hidden sections come from /api/home, so
 * the Studio's Home layout applies; sizes, the big picture, the menu and the tiles follow Studio → Fire TV app.
 */
class TvHomeActivity : TvScreen() {
    private lateinit var heroImage: FocalImageView
    private lateinit var heroLogo: ImageView
    private lateinit var heroTitle: TextView
    private lateinit var heroMeta: TextView
    private lateinit var heroText: TextView
    private lateinit var heroButtons: LinearLayout
    private lateinit var playBtn: TextView
    private lateinit var rows: RecyclerView
    private lateinit var status: TextView
    private lateinit var nav: LinearLayout
    private var homeTab: TextView? = null

    private val heroOn get() = TvLook.flag("hero", "show", true)
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

    // ── Library tile videos: one small player shared by all tiles; only the focused tile plays, muted and looping ──
    private var tilePlayer: androidx.media3.exoplayer.ExoPlayer? = null
    private var tileTexture: android.view.TextureView? = null
    private val tileDelay = Debounce(700)

    private fun playTile(frame: FrameLayout, url: String) {
        tileDelay.run {
            if (!frame.isFocused || isFinishing) return@run
            stopTile()
            val p = tilePlayer ?: androidx.media3.exoplayer.ExoPlayer.Builder(this).build().also { pl ->
                pl.volume = 0f
                pl.repeatMode = androidx.media3.common.Player.REPEAT_MODE_ONE
                pl.addListener(object : androidx.media3.common.Player.Listener {
                    override fun onRenderedFirstFrame() { tileTexture?.animate()?.alpha(1f)?.setDuration(300)?.start() }
                    override fun onVideoSizeChanged(size: androidx.media3.common.VideoSize) { tileTexture?.let { crop(it, size.width, size.height) } }
                })
                tilePlayer = pl
            }
            val tv = android.view.TextureView(this).apply { alpha = 0f }
            frame.addView(tv, 2, FrameLayout.LayoutParams(-1, -1)) // above the picture, under the shade, logo and name
            tileTexture = tv
            p.setVideoTextureView(tv)
            p.setMediaItem(androidx.media3.common.MediaItem.fromUri(TvSession.abs(url) ?: return@run))
            p.prepare()
            p.playWhenReady = true
        }
    }

    /** Fill the tile without stretching (the middle of the video, like a picture's centre crop). */
    private fun crop(v: android.view.TextureView, vw: Int, vh: Int) {
        if (vw <= 0 || vh <= 0 || v.width <= 0 || v.height <= 0) return
        val scale = maxOf(v.width / vw.toFloat(), v.height / vh.toFloat())
        val m = android.graphics.Matrix()
        m.setScale(vw * scale / v.width, vh * scale / v.height, v.width / 2f, v.height / 2f)
        v.setTransform(m)
    }

    private fun stopTile() {
        tileDelay.cancel()
        tilePlayer?.let { it.stop(); it.clearVideoSurface() }
        tileTexture?.let { (it.parent as? ViewGroup)?.removeView(it) }
        tileTexture = null
    }

    override fun onPause() { stopTile(); super.onPause() }

    override fun onDestroy() {
        stopTile()
        tilePlayer?.release()
        tilePlayer = null
        TvNav.open -= this
        rotate.removeCallbacksAndMessages(null)
        follow.cancel()
        super.onDestroy()
    }

    override fun onResume() {
        super.onResume()
        // Back from the player: Continue Watching and My List may have changed.
        if (refreshOnReturn) { refreshOnReturn = false; load(quiet = true) }
    }

    private fun build() {
        val root = FrameLayout(this).apply { setBackgroundColor(TvLook.bg) }
        val w = resources.displayMetrics.widthPixels
        val h = resources.displayMetrics.heightPixels
        val clear = TvLook.bg and 0x00FFFFFF

        // The app's background picture (Studio → Fire TV app → Background), dimmed.
        TvLook.background?.let { url ->
            val bgImg = ImageView(this).apply { scaleType = ImageView.ScaleType.CENTER_CROP }
            loadImage(bgImg, url)
            root.addView(bgImg, FrameLayout.LayoutParams(-1, -1))
            root.addView(View(this).apply { setBackgroundColor(TvLook.bg); alpha = TvLook.num("background", "dim", 70) / 100f }, FrameLayout.LayoutParams(-1, -1))
        }

        // The big picture: the right-hand part of the screen, fading into the background on the left and at the bottom.
        val heroW = (w * TvLook.num("hero", "width", 72) / 100f).toInt()
        val rowsTop = (h * TvLook.num("hero", "height", 56) / 100f).toInt()
        val heroH = (rowsTop * 1.32f).toInt().coerceAtMost(h)
        heroImage = FocalImageView(this).apply { fy = TvLook.num("hero", "focusY", 25) / 100f; brightness(TvLook.num("hero", "brightness", 100)) }
        if (heroOn) {
            root.addView(heroImage, FrameLayout.LayoutParams(heroW, heroH, Gravity.END or Gravity.TOP))
            root.addView(View(this).apply {
                background = GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT, intArrayOf(TvLook.bg, clear or 0xCC000000.toInt(), clear))
            }, FrameLayout.LayoutParams((heroW * 0.6f).toInt(), heroH, Gravity.END or Gravity.TOP).apply { marginEnd = (heroW * 0.4f).toInt() })
            if (heroW < w) root.addView(View(this).apply { setBackgroundColor(TvLook.bg) }, FrameLayout.LayoutParams(w - heroW, heroH, Gravity.START or Gravity.TOP))
            root.addView(View(this).apply {
                background = GradientDrawable(GradientDrawable.Orientation.BOTTOM_TOP, intArrayOf(TvLook.bg, clear))
            }, FrameLayout.LayoutParams(-1, (heroH * 0.45f).toInt(), Gravity.TOP).apply { topMargin = (heroH * 0.55f).toInt() })
            root.addView(View(this).apply { setBackgroundColor(TvLook.bg) }, FrameLayout.LayoutParams(-1, (h - heroH).coerceAtLeast(0), Gravity.BOTTOM))
        }

        // The top menu (Studio → Fire TV app → Menu).
        nav = row().apply { setPadding(dp(40), dp(18), dp(40), 0) }
        val logo = ImageView(this).apply { adjustViewBounds = true; scaleType = ImageView.ScaleType.FIT_START }
        if (TvLook.logo != null) loadImage(logo, TvLook.logo) else logo.setImageResource(R.drawable.logo)
        nav.addView(logo, LinearLayout.LayoutParams(-2, dp(TvLook.num("nav", "logoHeight", 30))).apply { marginEnd = dp(26) })
        val centre = TvLook.str("nav", "align", "left") == "center"
        if (centre) nav.addView(View(this), LinearLayout.LayoutParams(0, 1, 1f))
        fun tab(text: String, action: () -> Unit) = label(15f, TvLook.muted, bold = true).apply {
            this.text = text
            setPadding(dp(12), dp(7), dp(12), dp(7))
            isFocusable = true; isClickable = true
            background = focusRing(dp(16).toFloat())
            zoomOnFocus(1.06f) { has -> setTextColor(if (has || this === homeTab) TvLook.text else TvLook.muted) }
            setOnClickListener { action() }
        }
        homeTab = tab("Home") { focusTop() }.apply { setTextColor(TvLook.text) }
        nav.addView(homeTab)
        if (TvLook.flag("nav", "libraries", true)) for (lib in TvLook.libraries.objects()) nav.addView(tab(lib.optString("name")) { TvNav.openLibrary(this, lib) })
        if (TvLook.flag("nav", "search", true)) nav.addView(tab("Search") { TvNav.search(this) })
        if (TvLook.flag("nav", "myList", true)) nav.addView(tab("My List") { TvNav.myList(this) })
        if (TvLook.flag("nav", "upNext", true)) nav.addView(tab("Up next") { TvNav.upNext(this) })
        nav.addView(View(this), LinearLayout.LayoutParams(0, 1, 1f))
        nav.addView(tab(TvLook.profileName.ifEmpty { "Profile" }) { profileMenu() })
        val navOn = TvLook.flag("nav", "show", true)
        if (navOn) root.addView(nav, FrameLayout.LayoutParams(-1, -2, Gravity.TOP))

        // What the big picture is about.
        val info = column().apply { setPadding(dp(48), 0, 0, 0) }
        heroLogo = ImageView(this).apply { adjustViewBounds = true; scaleType = ImageView.ScaleType.FIT_START }
        info.addView(heroLogo, LinearLayout.LayoutParams(dp(300), dp(84)).apply { bottomMargin = dp(10) })
        heroTitle = label(34f, bold = true, lines = 2)
        info.addView(heroTitle, LinearLayout.LayoutParams((w * 0.45).toInt(), -2).apply { bottomMargin = dp(8) })
        heroMeta = label(14f, TvLook.muted, bold = true)
        info.addView(heroMeta, LinearLayout.LayoutParams(-2, -2).apply { bottomMargin = dp(10) })
        heroText = label(15f, TvLook.text, lines = 3).apply { setLineSpacing(0f, 1.15f); alpha = 0.92f }
        if (TvLook.flag("hero", "overview", true)) info.addView(heroText, LinearLayout.LayoutParams((w * 0.42).toInt(), -2).apply { bottomMargin = dp(16) })
        heroButtons = row()
        playBtn = tvButton("Play", primary = true) { shown?.let { playItem(it) } }
        heroButtons.addView(playBtn, LinearLayout.LayoutParams(-2, -2).apply { marginEnd = dp(12) })
        heroButtons.addView(tvButton("More info") { shown?.let { TvNav.openItem(this, it) } })
        info.addView(heroButtons)
        // Where the title, details and buttons sit over the big picture: near the top, in the middle, or just above the rows.
        if (heroOn) {
            val area = FrameLayout(this)
            val top = if (navOn) dp(78) else dp(40)
            area.addView(info, when (TvLook.str("hero", "text", "top")) {
                "middle" -> FrameLayout.LayoutParams(-1, -2, Gravity.CENTER_VERTICAL).apply { topMargin = top / 2 }
                "bottom" -> FrameLayout.LayoutParams(-1, -2, Gravity.BOTTOM).apply { bottomMargin = dp(14) }
                else -> FrameLayout.LayoutParams(-1, -2, Gravity.TOP).apply { topMargin = top }
            })
            root.addView(area, FrameLayout.LayoutParams(-1, rowsTop, Gravity.TOP))
            // Never let the rows sit over the title and buttons: if the text is taller than the space, the rows start lower.
            area.clipChildren = false
            if (TvLook.str("hero", "text", "top") != "bottom") info.addOnLayoutChangeListener { v, _, _, _, _, _, _, _, _ ->
                val need = area.top + v.bottom + dp(10)
                val lp = rows.layoutParams as? FrameLayout.LayoutParams ?: return@addOnLayoutChangeListener
                if (lp.topMargin < need) { lp.topMargin = need; rows.layoutParams = lp }
            }
        }

        // The rows: the focused row's top always sits at the same height.
        rows = RecyclerView(this).apply {
            layoutManager = LeadLayoutManager(this@TvHomeActivity, RecyclerView.VERTICAL, 0)
            itemAnimator = null
            clipToPadding = false
            setPadding(0, 0, 0, h)
            isFocusable = false
            descendantFocusability = ViewGroup.FOCUS_AFTER_DESCENDANTS
        }
        val top = if (heroOn) rowsTop else if (navOn) dp(78) else dp(32)
        root.addView(rows, FrameLayout.LayoutParams(-1, -1).apply { topMargin = top })

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
            spotlight = if (heroOn) data.optJSONArray("spotlight")?.objects().orEmpty() else emptyList()
            val list = mutableListOf<HomeRow>()
            val tiles = if (TvLook.flag("tiles", "show", true)) data.optJSONArray("libraries")?.objects().orEmpty() else emptyList()
            val tilesTitle = TvLook.str("tiles", "title", "Libraries")
            val tilesAt = data.optJSONObject("layout")?.optInt("tilesAt", -1) ?: -1
            val rowList = data.optJSONArray("rows")?.objects().orEmpty()
            rowList.forEachIndexed { i, r ->
                if (i == tilesAt && tiles.isNotEmpty()) list += HomeRow(tilesTitle, tiles, Shape.WIDE, tiles = true)
                val items = r.optJSONArray("items")?.objects().orEmpty()
                if (items.isEmpty()) return@forEachIndexed
                val shape = when (r.optString("shape")) { "wide" -> Shape.WIDE; "square" -> Shape.SQUARE; else -> Shape.POSTER }
                list += HomeRow(r.optString("title"), items, shape, cont = r.optString("id") == "continue")
            }
            if (tilesAt >= rowList.size && tiles.isNotEmpty()) list += HomeRow(tilesTitle, tiles, Shape.WIDE, tiles = true)
            if (list.isEmpty() && spotlight.isEmpty()) { status.text = "Your library is empty.\nAdd folders in the Studio on a computer."; return@get }
            // Continue watching on the TV's own home screen too (Android TV and Google TV).
            TvWatchNext.sync(this, rowList.firstOrNull { it.optString("id") == "continue" }?.optJSONArray("items")?.objects().orEmpty())
            // A title picked on the TV's home screen while HallFlix was starting: play it now.
            if (TvNav.pendingPlay > 0) { val id = TvNav.pendingPlay; TvNav.pendingPlay = 0; refreshOnReturn = true; TvNav.play(this, id, null) }
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
        // While the big picture's buttons have focus, it moves on to the next spotlight title (Studio: every N seconds).
        val every = TvLook.num("hero", "rotate", 12)
        if (every > 0) rotate.postDelayed({ if (heroButtons.hasFocus() && spotlight.size > 1) spot++; showSpot() }, every * 1000L)
    }

    private fun isTile(it: JSONObject) = it.has("count") && !it.has("year") && !it.has("progress")

    private fun show(it: JSONObject, wide: Boolean) {
        if (!heroOn || shown === it) return
        shown = it
        val pic = if (isTile(it)) TvLook.tilePicture(it) else it.optString("backdrop").ifEmpty { it.optString("poster") }.takeIf { s -> s.isNotEmpty() && s != "null" }
        loadImage(heroImage, pic)
        val logo = if (TvLook.flag("hero", "logos", true)) (it.optString("logo").takeIf { s -> s.isNotEmpty() && s != "null" } ?: if (isTile(it)) TvLook.tileLogo(it) else null) else null
        val name = it.optJSONObject("show")?.optString("title")?.ifEmpty { null } ?: it.optString("title").ifEmpty { it.optString("name") }
        if (logo != null) { heroLogo.visibility = View.VISIBLE; heroTitle.visibility = View.GONE; loadImage(heroLogo, logo) }
        else { heroLogo.visibility = View.GONE; heroTitle.visibility = View.VISIBLE; heroTitle.text = name }
        heroMeta.text = if (isTile(it)) "${it.optInt("count")} titles" + (if (it.optInt("fresh") > 0) "  ·  ${it.optInt("fresh")} new" else "")
        else metaLine(it)
        heroText.text = it.optString("overview").takeIf { s -> s != "null" }.orEmpty()
        playBtn.text = if (progressOf(it) >= 0) "Resume" else "Play"
        if (!wide) heroButtons.alpha = 0f
    }

    private fun focusTop() {
        rows.scrollToPosition(0)
        if (spotlight.isNotEmpty()) { heroButtons.alpha = 1f; showSpot(); playBtn.requestFocus() }
        else rows.post { rows.getChildAt(0)?.let { firstCard(it)?.requestFocus() } }
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
        val opts = arrayOf("Search", "My List", "Up next", "Switch profile", "My HallFlix", "Use the web version of the TV screens", "Change server")
        AlertDialog.Builder(this, android.R.style.Theme_Material_Dialog_Alert)
            .setTitle(TvLook.profileName.ifEmpty { "HallFlix" })
            .setItems(opts) { _, which ->
                when (which) {
                    0 -> TvNav.search(this)
                    1 -> TvNav.myList(this)
                    2 -> TvNav.upNext(this)
                    3 -> TvNav.toWeb(this, "HallFlix.api('POST','/api/logout').then(function(){location.hash='#/';location.reload();})")
                    4 -> TvNav.toWeb(this, "location.hash = '#/me'")
                    5 -> {
                        getSharedPreferences("hallflix", MODE_PRIVATE).edit().putBoolean("nativeTv", false).apply()
                        TvNav.toWeb(this, "location.hash = '#/'; window.dispatchEvent(new Event('hallflix-native-closed'))")
                    }
                    6 -> TvNav.toWeb(this, "window.HallFlixNative && HallFlixNative.changeServer()")
                }
            }
            .show()
    }

    // ── Back ──

    override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean {
        if (keyCode == KeyEvent.KEYCODE_BACK) {
            // Down in the rows: back to the top first. At the top: press twice to close HallFlix.
            val atTop = heroButtons.hasFocus() || nav.hasFocus() || (spotlight.isEmpty() && rows.getChildAt(0)?.hasFocus() == true && rows.computeVerticalScrollOffset() == 0)
            if (!atTop) { focusTop(); return true }
            val now = SystemClock.uptimeMillis()
            if (now - backAt < 2500) { if (MusicService.isPlaying) moveTaskToBack(true) else finishAffinity(); return true }
            backAt = now
            Toast.makeText(this, "Press Back again to close HallFlix", Toast.LENGTH_SHORT).show()
            return true
        }
        // The remote's Menu button always opens the menu (the only way to it when the top menu is hidden).
        if (keyCode == KeyEvent.KEYCODE_MENU) { profileMenu(); return true }
        // The remote's search key (Android TV) opens search, listening straight away.
        if (keyCode == KeyEvent.KEYCODE_SEARCH) { TvNav.search(this, voice = true); return true }
        return super.onKeyDown(keyCode, event)
    }

    // ── Rows ──

    private class HomeRow(val title: String, val items: List<JSONObject>, val shape: Shape, val cont: Boolean = false, val tiles: Boolean = false)
    private class RowHolder(val root: LinearLayout, val title: TextView, val list: RowRecycler) : RecyclerView.ViewHolder(root)

    private fun captionsFor(r: HomeRow): Boolean = when (TvLook.str("rows", "captions", "auto")) {
        "always" -> true
        "never" -> false
        else -> r.cont || r.shape == Shape.WIDE
    }

    private inner class RowsAdapter(val list: List<HomeRow>) : RecyclerView.Adapter<RowHolder>() {
        private val pool = RecyclerView.RecycledViewPool()
        override fun getItemCount() = list.size
        override fun getItemViewType(position: Int) = list[position].let { r -> if (r.tiles) 99 else r.shape.ordinal * 2 + if (captionsFor(r)) 1 else 0 }
        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): RowHolder {
            val col = column().apply { layoutParams = RecyclerView.LayoutParams(-1, -2); setPadding(0, 0, 0, dp(TvLook.num("rows", "gap", 18))) }
            val t = label(TvLook.num("rows", "titleSize", 17).toFloat(), bold = true).apply { setPadding(dp(48), 0, 0, dp(10)) }
            col.addView(t)
            val rv = RowRecycler(this@TvHomeActivity).apply {
                layoutManager = LeadLayoutManager(this@TvHomeActivity, RecyclerView.HORIZONTAL, dp(48))
                setPadding(dp(48), dp(8), dp(48), dp(10))
                clipToPadding = false
                clipChildren = false
                itemAnimator = null
                if (viewType != 99) setRecycledViewPool(pool)
                setHasFixedSize(true)
            }
            col.addView(rv, LinearLayout.LayoutParams(-1, -2))
            col.clipChildren = false
            return RowHolder(col, t, rv)
        }
        override fun onBindViewHolder(h: RowHolder, position: Int) {
            val r = list[position]
            h.title.text = r.title
            h.title.visibility = if (r.title.isBlank()) View.GONE else View.VISIBLE
            val focus = { it: JSONObject ->
                heroButtons.alpha = 0f
                if (TvLook.flag("hero", "follow", true)) follow.run { show(it, wide = false) }
            }
            h.list.adapter = if (r.tiles) TileAdapter(r.items, focus) else CardAdapter(this@TvHomeActivity, r.items, r.shape, captions = captionsFor(r),
                onFocus = focus,
                onPick = { it ->
                    if (r.cont) { refreshOnReturn = true; TvNav.play(this@TvHomeActivity, it.optLong("id"), null) } // Continue watching carries straight on
                    else TvNav.openItem(this@TvHomeActivity, it)
                })
        }
    }

    /**
     * Library tiles: each library's own picture (and which part of it shows), brightness, and its logo or name placed where
     * the Studio says (dragged into place, or a corner and nudges, and a size), with the title count under it.
     */
    private inner class TileAdapter(val tiles: List<JSONObject>, val onFocus: (JSONObject) -> Unit) : RecyclerView.Adapter<TileHolder>() {
        private val size = dp(TvLook.num("tiles", "width", 224)) to dp(TvLook.num("tiles", "height", 126))
        override fun getItemCount() = tiles.size
        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): TileHolder {
            val card = makeCard(Shape.WIDE, withCaption = false, size = size)
            val shade = View(this@TvHomeActivity)
            card.root.addView(shade, 2, FrameLayout.LayoutParams(-1, -1))
            val block = column()
            val logo = ImageView(this@TvHomeActivity).apply { adjustViewBounds = true; scaleType = ImageView.ScaleType.FIT_CENTER }
            val name = label(18f, bold = true, lines = 2)
            val count = label(11f, 0xDDFFFFFF.toInt(), bold = true)
            block.addView(logo, LinearLayout.LayoutParams(-2, -2))
            block.addView(name, LinearLayout.LayoutParams(-2, -2))
            block.addView(count, LinearLayout.LayoutParams(-2, -2).apply { topMargin = dp(3) })
            card.root.addView(block, FrameLayout.LayoutParams(-2, -2, Gravity.TOP or Gravity.START))
            card.name.visibility = View.GONE
            // Place the block whenever it's laid out: its anchor point meets the same point on the tile (so it never runs
            // off an edge), then nudged. The placement for the library shown is kept in the block's tag.
            block.addOnLayoutChangeListener { v, _, _, _, _, _, _, _, _ ->
                val spot = v.tag as? TvLook.LogoSpot ?: return@addOnLayoutChangeListener
                val (w, ht) = size
                val edgeX = w * 0.06f; val edgeY = ht * 0.09f
                v.translationX = edgeX + spot.ax * (w - 2 * edgeX) + spot.nx * w - spot.ax * v.width
                v.translationY = edgeY + spot.ay * (ht - 2 * edgeY) + spot.ny * ht - spot.ay * v.height
            }
            return TileHolder(card, logo, block, name, count, shade)
        }
        override fun onBindViewHolder(h: TileHolder, position: Int) {
            val t = tiles[position]
            val c = h.card
            val (w, ht) = size
            val spot = TvLook.logoSpot(t)
            val (fx, fy) = TvLook.tileFocus(t)
            c.image.fx = fx; c.image.fy = fy
            loadImage(c.image, TvLook.tilePicture(t))
            c.image.brightness(TvLook.tileBrightness(t))
            // Darker toward the logo, so it reads on any picture (Studio → Fire TV app → Library tiles → Darken behind).
            val alpha = (TvLook.num("tiles", "shade", 45) * 2.55f).toInt().coerceIn(0, 255)
            val a = alpha shl 24
            val mid = (alpha / 3) shl 24
            h.shade.background = GradientDrawable(when {
                spot.ay > 0.66f -> GradientDrawable.Orientation.BOTTOM_TOP
                spot.ay < 0.34f -> GradientDrawable.Orientation.TOP_BOTTOM
                spot.ax < 0.34f -> GradientDrawable.Orientation.LEFT_RIGHT
                spot.ax > 0.66f -> GradientDrawable.Orientation.RIGHT_LEFT
                else -> GradientDrawable.Orientation.BOTTOM_TOP
            }, intArrayOf(a, mid, 0))
            // The logo or name, and the count, aligned toward the side they sit on.
            val logo = TvLook.tileLogo(t)
            val align = if (spot.ax < 0.34f) Gravity.START else if (spot.ax > 0.66f) Gravity.END else Gravity.CENTER_HORIZONTAL
            h.block.gravity = align
            if (logo != null) {
                h.logo.visibility = View.VISIBLE
                h.logo.maxHeight = (ht * 0.30f * spot.k).toInt()
                h.logo.maxWidth = (w * minOf(0.94f, 0.58f * maxOf(1f, spot.k))).toInt()
                loadImage(h.logo, logo)
            } else { h.logo.visibility = View.GONE; h.logo.setImageDrawable(null) }
            val showName = logo == null && TvLook.flag("tiles", "names", true)
            h.name.visibility = if (showName) View.VISIBLE else View.GONE
            h.name.text = t.optString("name")
            h.name.textSize = 18f * spot.k
            h.name.gravity = align
            h.name.maxWidth = (w * 0.9f).toInt()
            val counts = TvLook.flag("tiles", "counts", true) && spot.count
            h.count.visibility = if (counts) View.VISIBLE else View.GONE
            h.count.text = "${t.optInt("count")} titles" + if (t.optInt("fresh") > 0) " · ${t.optInt("fresh")} new" else ""
            h.block.tag = spot
            h.block.requestLayout()
            c.bar.visibility = View.GONE; c.barTrack.visibility = View.GONE
            c.root.contentDescription = t.optString("name")
            val video = TvLook.tileVideo(t)
            c.root.zoomOnFocus(cardScale()) { has ->
                if (has) { onFocus(t); if (video != null) playTile(c.root, video) }
                else if (tileTexture?.parent === c.root) stopTile()
            }
            c.root.setOnClickListener { TvNav.openLibrary(this@TvHomeActivity, t) }
        }
    }
    private class TileHolder(val card: CardHolder, val logo: ImageView, val block: LinearLayout, val name: TextView, val count: TextView, val shade: View) : RecyclerView.ViewHolder(card.root)
}
