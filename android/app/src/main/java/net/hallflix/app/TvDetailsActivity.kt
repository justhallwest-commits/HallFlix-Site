package net.hallflix.app

import android.app.Activity
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.StateListDrawable
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.HorizontalScrollView
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.recyclerview.widget.RecyclerView
import org.json.JSONObject

/**
 * A movie's or show's page: big backdrop, logo, details, Play / Resume, From the beginning, My List, seasons and
 * episodes, and More like this. "More" opens the web app's page for the rest (cast, ratings, trailer, extras).
 */
class TvDetailsActivity : Activity() {
    private var itemId = 0L
    private var focusEp = 0L
    private var data: JSONObject? = null
    private var refreshOnReturn = false
    private var season = 0

    private lateinit var backdrop: ImageView
    private lateinit var body: LinearLayout
    private lateinit var scroll: ScrollView
    private lateinit var status: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (TvNav.lost(this)) return
        TvNav.open += this
        itemId = intent.getLongExtra("id", 0)
        focusEp = intent.getLongExtra("focus", 0)
        build()
        load(first = true)
    }

    override fun onDestroy() { TvNav.open -= this; super.onDestroy() }

    override fun onResume() {
        super.onResume()
        // Back from the player: the Resume button and the episodes' progress bars move on.
        if (refreshOnReturn) { refreshOnReturn = false; load(first = false) }
    }

    private fun build() {
        val root = FrameLayout(this).apply { setBackgroundColor(TvLook.bg) }
        val w = resources.displayMetrics.widthPixels
        val h = resources.displayMetrics.heightPixels
        backdrop = ImageView(this).apply { scaleType = ImageView.ScaleType.CENTER_CROP }
        root.addView(backdrop, FrameLayout.LayoutParams((w * 0.75).toInt(), (h * 0.8).toInt(), Gravity.END or Gravity.TOP))
        root.addView(View(this).apply {
            background = GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT, intArrayOf(TvLook.bg, (TvLook.bg and 0x00FFFFFF) or 0xB3000000.toInt(), TvLook.bg and 0x00FFFFFF))
        }, FrameLayout.LayoutParams((w * 0.75).toInt(), (h * 0.8).toInt(), Gravity.END or Gravity.TOP))
        root.addView(View(this).apply {
            background = GradientDrawable(GradientDrawable.Orientation.BOTTOM_TOP, intArrayOf(TvLook.bg, TvLook.bg and 0x00FFFFFF))
        }, FrameLayout.LayoutParams(-1, (h * 0.4).toInt(), Gravity.TOP).apply { topMargin = (h * 0.4).toInt() })
        root.addView(View(this).apply { setBackgroundColor(TvLook.bg) }, FrameLayout.LayoutParams(-1, (h * 0.2).toInt(), Gravity.BOTTOM))

        scroll = ScrollView(this).apply { isVerticalScrollBarEnabled = false; isFillViewport = true; isSmoothScrollingEnabled = true }
        body = column().apply { setPadding(0, dp(56), 0, dp(48)); clipChildren = false }
        scroll.addView(body)
        root.addView(scroll, FrameLayout.LayoutParams(-1, -1))
        status = label(16f, TvLook.muted, lines = 3).apply { gravity = Gravity.CENTER }
        root.addView(status, FrameLayout.LayoutParams(-1, -2, Gravity.CENTER))
        setContentView(root)
    }

    private fun load(first: Boolean) {
        if (first) status.text = "Loading…"
        TvApi.get(this, "/api/items/$itemId", { d ->
            status.text = ""
            val kind = d.optString("kind")
            if (kind != "movie" && kind != "show") { TvNav.toWeb(this, "location.hash = '#/title/$itemId'"); return@get }
            data = d
            draw(d, first)
        }, { msg -> if (first) status.text = msg })
    }

    private fun draw(d: JSONObject, first: Boolean) {
        val keepY = scroll.scrollY
        val w = resources.displayMetrics.widthPixels
        body.removeAllViews()
        loadImage(backdrop, d.optString("backdrop").ifEmpty { d.optString("poster") }.takeIf { it.isNotEmpty() && it != "null" })
        val side = dp(56)

        val logo = d.optString("logo").takeIf { it.isNotEmpty() && it != "null" }
        if (logo != null) {
            val iv = ImageView(this).apply { adjustViewBounds = true; scaleType = ImageView.ScaleType.FIT_START }
            loadImage(iv, logo)
            body.addView(iv, LinearLayout.LayoutParams(dp(340), dp(100)).apply { marginStart = side; bottomMargin = dp(14) })
        } else {
            body.addView(label(38f, bold = true, lines = 2).apply { text = d.optString("title") }, LinearLayout.LayoutParams((w * 0.5).toInt(), -2).apply { marginStart = side; bottomMargin = dp(10) })
        }
        val extra = mutableListOf<String>()
        d.optJSONObject("media")?.let { m -> m.optString("quality").takeIf { it.isNotEmpty() && it != "null" }?.let { extra += it }; if (m.optBoolean("hdr")) extra += "HDR" }
        if (d.optString("kind") == "show") d.optJSONArray("seasons")?.length()?.takeIf { it > 0 }?.let { extra += if (it == 1) "1 season" else "$it seasons" }
        body.addView(label(15f, TvLook.muted, bold = true).apply { text = (listOf(metaLine(d)) + extra).filter { it.isNotEmpty() }.joinToString("  ·  ") },
            LinearLayout.LayoutParams(-2, -2).apply { marginStart = side; bottomMargin = dp(8) })
        val genres = d.optJSONArray("genres")?.let { g -> (0 until g.length()).map { g.optString(it) } }.orEmpty()
        if (genres.isNotEmpty()) body.addView(label(14f, TvLook.muted).apply { text = genres.take(4).joinToString(" • ") },
            LinearLayout.LayoutParams(-2, -2).apply { marginStart = side; bottomMargin = dp(12) })
        d.optString("tagline").takeIf { it.isNotEmpty() && it != "null" }?.let { t ->
            body.addView(label(16f, TvLook.text, bold = true, lines = 2).apply { text = t; alpha = 0.9f }, LinearLayout.LayoutParams((w * 0.48).toInt(), -2).apply { marginStart = side; bottomMargin = dp(6) })
        }
        body.addView(label(16f, TvLook.text, lines = 4).apply { text = d.optString("overview").takeIf { it != "null" }.orEmpty(); setLineSpacing(0f, 1.18f); alpha = 0.92f },
            LinearLayout.LayoutParams((w * 0.48).toInt(), -2).apply { marginStart = side; bottomMargin = dp(20) })

        // Buttons.
        val buttons = row().apply { clipChildren = false }
        val playId = d.optLong("playId")
        val isShow = d.optString("kind") == "show"
        val prog = if (isShow) d.optJSONObject("playProgress") else d.optJSONObject("progress")
        val started = prog != null && !prog.optBoolean("watched") && prog.optDouble("position", 0.0) > 30
        val epLabel = d.optString("playLabel").takeIf { isShow && it.isNotEmpty() }
        val playText = when {
            started && epLabel != null -> "Resume $epLabel"
            started -> "Resume"
            epLabel != null -> "Play $epLabel"
            else -> "Play"
        }
        val play = tvButton(playText, primary = true) { refreshOnReturn = true; TvNav.play(this, playId, null) }
        if (playId > 0) buttons.addView(play, LinearLayout.LayoutParams(-2, -2).apply { marginEnd = dp(12) })
        if (started) buttons.addView(tvButton("From the beginning") { refreshOnReturn = true; TvNav.play(this, playId, 0.0) }, LinearLayout.LayoutParams(-2, -2).apply { marginEnd = dp(12) })
        var inList = d.optBoolean("inList")
        lateinit var listBtn: TextView
        listBtn = tvButton(if (inList) "✓  My List" else "+  My List") {
            inList = !inList
            listBtn.text = if (inList) "✓  My List" else "+  My List"
            TvApi.post(this, "/api/mylist", JSONObject().put("itemId", d.optLong("id")).put("on", inList),
                fail = { m -> inList = !inList; listBtn.text = if (inList) "✓  My List" else "+  My List"; Toast.makeText(this, m, Toast.LENGTH_SHORT).show() })
        }
        buttons.addView(listBtn, LinearLayout.LayoutParams(-2, -2).apply { marginEnd = dp(12) })
        buttons.addView(tvButton("More") { TvNav.toWeb(this, "location.hash = '#/title/${d.optLong("id")}'") })
        if (started && prog != null) {
            val left = (prog.optDouble("duration", 0.0) - prog.optDouble("position", 0.0)).coerceAtLeast(0.0)
            if (left > 60) buttons.addView(label(14f, TvLook.muted).apply { text = "${runtimeText(left)} left" }, LinearLayout.LayoutParams(-2, -2).apply { marginStart = dp(8) })
        }
        body.addView(buttons, LinearLayout.LayoutParams(-2, -2).apply { marginStart = side; bottomMargin = dp(30) })

        // Seasons and episodes.
        val seasons = d.optJSONArray("seasons")?.objects().orEmpty()
        var epRow: RowRecycler? = null
        if (isShow && seasons.isNotEmpty()) {
            if (first) {
                // Open on the season of the episode asked for, or of the one Play would play.
                val want = if (focusEp > 0) focusEp else playId
                season = seasons.indexOfFirst { s -> s.optJSONArray("episodes")?.objects()?.any { it.optLong("id") == want } == true }.coerceAtLeast(0)
            }
            val chips = row().apply { setPadding(side, dp(6), side, dp(6)); clipChildren = false }
            val chipScroll = HorizontalScrollView(this).apply { isHorizontalScrollBarEnabled = false; clipChildren = false; addView(chips) }
            val rv = RowRecycler(this).apply {
                layoutManager = LeadLayoutManager(this@TvDetailsActivity, RecyclerView.HORIZONTAL, side)
                setPadding(side, dp(10), side, dp(10)); clipToPadding = false; clipChildren = false; itemAnimator = null
            }
            epRow = rv
            fun showSeason(i: Int) {
                season = i
                val eps = seasons[i].optJSONArray("episodes")?.objects().orEmpty()
                rv.adapter = EpisodeAdapter(eps)
                for (c in 0 until chips.childCount) (chips.getChildAt(c) as TextView).isSelected = c == i
            }
            seasons.forEachIndexed { i, s ->
                val t = label(15f, bold = true).apply {
                    text = s.optString("title").ifEmpty { "Season ${s.optInt("number")}" }
                    setPadding(dp(16), dp(8), dp(16), dp(8))
                    isFocusable = true; isClickable = true
                    val r = dp(18).toFloat()
                    background = StateListDrawable().apply {
                        addState(intArrayOf(android.R.attr.state_focused), rounded(android.graphics.Color.WHITE, r))
                        addState(intArrayOf(android.R.attr.state_selected), rounded(0x40FFFFFF, r))
                        addState(intArrayOf(), rounded(0x14FFFFFF, r))
                    }
                    zoomOnFocus(1.05f) { has -> setTextColor(if (has) 0xFF0A0814.toInt() else TvLook.text) }
                    setOnClickListener { showSeason(i) }
                }
                chips.addView(t, LinearLayout.LayoutParams(-2, -2).apply { marginEnd = dp(10) })
            }
            if (seasons.size > 1) body.addView(chipScroll, LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(4) })
            else body.addView(label(18f, bold = true).apply { text = "Episodes" }, LinearLayout.LayoutParams(-2, -2).apply { marginStart = side })
            body.addView(rv, LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(22) })
            showSeason(season.coerceIn(0, seasons.size - 1))
            if (first && focusEp > 0) {
                val eps = seasons[season].optJSONArray("episodes")?.objects().orEmpty()
                val at = eps.indexOfFirst { it.optLong("id") == focusEp }
                if (at > 0) rv.scrollToPosition(at)
            }
        }

        // More like this.
        val similar = d.optJSONArray("similar")?.objects().orEmpty()
        if (similar.isNotEmpty()) {
            body.addView(label(18f, bold = true).apply { text = "More like this" }, LinearLayout.LayoutParams(-2, -2).apply { marginStart = side; bottomMargin = dp(4) })
            val rv = RowRecycler(this).apply {
                layoutManager = LeadLayoutManager(this@TvDetailsActivity, RecyclerView.HORIZONTAL, side)
                setPadding(side, dp(10), side, dp(10)); clipToPadding = false; clipChildren = false; itemAnimator = null
                adapter = CardAdapter(this@TvDetailsActivity, similar, Shape.POSTER, captions = false, onFocus = {}, onPick = { TvNav.openItem(this@TvDetailsActivity, it) })
            }
            body.addView(rv, LinearLayout.LayoutParams(-1, -2))
        }

        if (first) {
            if (focusEp > 0 && epRow != null) epRow.post { epRow.findViewHolderForAdapterPosition(
                seasons[season].optJSONArray("episodes")?.objects().orEmpty().indexOfFirst { it.optLong("id") == focusEp }.coerceAtLeast(0))?.itemView?.requestFocus() ?: play.requestFocus() }
            else body.post { (if (playId > 0) play else listBtn).requestFocus() }
        } else scroll.post { scroll.scrollTo(0, keepY); if (playId > 0) play.requestFocus() }
    }

    /** An episode: still, number and name, length, progress; OK plays it (from where it was left). */
    private inner class EpisodeAdapter(val eps: List<JSONObject>) : RecyclerView.Adapter<EpHolder>() {
        override fun getItemCount() = eps.size
        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): EpHolder {
            val card = makeCard(Shape.WIDE, withCaption = false)
            val col = column().apply { layoutParams = RecyclerView.LayoutParams(-2, -2).apply { marginEnd = dp(16) }; clipChildren = false }
            (card.root.layoutParams as ViewGroup.MarginLayoutParams).marginEnd = 0
            col.addView(card.root)
            val t = label(14f, bold = true).apply { setPadding(0, dp(8), 0, dp(2)) }
            val m = label(12f, TvLook.muted)
            col.addView(t, LinearLayout.LayoutParams(cardSize(Shape.WIDE).first, -2))
            col.addView(m, LinearLayout.LayoutParams(cardSize(Shape.WIDE).first, -2))
            return EpHolder(col, card, t, m)
        }
        override fun onBindViewHolder(h: EpHolder, position: Int) {
            val e = eps[position]
            bindCard(h.card, e, Shape.WIDE)
            h.card.name.text = "${e.optInt("number")}"
            h.title.text = "${e.optInt("number")}. ${e.optString("title")}"
            val bits = mutableListOf<String>()
            if (e.optDouble("runtime", 0.0) > 0) bits += runtimeText(e.optDouble("runtime"))
            if (e.optJSONObject("progress")?.optBoolean("watched") == true) bits += "✓ Watched"
            h.meta.text = bits.joinToString("  ·  ")
            h.card.root.zoomOnFocus {}
            h.card.root.setOnClickListener { refreshOnReturn = true; TvNav.play(this@TvDetailsActivity, e.optLong("id"), null) }
        }
    }
    private class EpHolder(root: LinearLayout, val card: CardHolder, val title: TextView, val meta: TextView) : RecyclerView.ViewHolder(root)
}
