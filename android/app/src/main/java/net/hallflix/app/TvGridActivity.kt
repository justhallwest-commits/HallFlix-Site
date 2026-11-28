package net.hallflix.app

import android.app.Activity
import android.os.Bundle
import android.view.Gravity
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.recyclerview.widget.GridLayoutManager
import androidx.recyclerview.widget.RecyclerView
import org.json.JSONObject

/**
 * A simple native grid of titles from one endpoint: My List (/api/mylist) and Up next (/api/upnext, the next episode of
 * each show being watched; OK plays it straight away). Refreshes when coming back from the player or a title page.
 */
class TvGridActivity : TvScreen() {
    private lateinit var grid: RecyclerView
    private lateinit var status: TextView
    private lateinit var count: TextView
    private val items = mutableListOf<JSONObject>()
    private lateinit var adapter: CardAdapter
    private var path = ""
    private var playDirectly = false
    private var refreshOnReturn = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (TvNav.lost(this)) return
        TvNav.open += this
        path = intent.getStringExtra("path").orEmpty()
        playDirectly = intent.getBooleanExtra("play", false)
        build(intent.getStringExtra("title").orEmpty(), intent.getStringExtra("empty").orEmpty())
        load()
    }

    override fun onDestroy() { TvNav.open -= this; super.onDestroy() }

    override fun onResume() {
        super.onResume()
        if (refreshOnReturn) { refreshOnReturn = false; load() }
    }

    private var emptyText = ""

    private fun build(title: String, empty: String) {
        emptyText = empty
        val root = FrameLayout(this).apply { setBackgroundColor(TvLook.bg) }
        TvLook.background?.let { url ->
            val bg = android.widget.ImageView(this).apply { scaleType = android.widget.ImageView.ScaleType.CENTER_CROP }
            loadImage(bg, url)
            root.addView(bg, FrameLayout.LayoutParams(-1, -1))
            root.addView(android.view.View(this).apply { setBackgroundColor(TvLook.bg); alpha = TvLook.num("background", "dim", 70) / 100f }, FrameLayout.LayoutParams(-1, -1))
        }
        val col = column()
        val head = row().apply { setPadding(dp(48), dp(26), dp(48), dp(12)) }
        head.addView(label(28f, bold = true).apply { text = title }, LinearLayout.LayoutParams(-2, -2).apply { marginEnd = dp(16) })
        count = label(14f, TvLook.muted)
        head.addView(count)
        col.addView(head)
        val shape = if (playDirectly) Shape.WIDE else Shape.POSTER
        val usable = resources.displayMetrics.widthPixels - dp(82)
        val span = (usable / (cardSize(shape).first + dp(14))).coerceAtLeast(2)
        val w = usable / span - dp(14)
        val size = if (shape == Shape.WIDE) w to (w * 0.5625f).toInt() else w to (w * 1.5f).toInt()
        adapter = CardAdapter(this, items, shape, captions = playDirectly || TvLook.flag("library", "names", false), onFocus = {}, size = size, onPick = { it ->
            refreshOnReturn = true
            if (playDirectly) TvNav.play(this, it.optLong("id"), null) else TvNav.openItem(this, it)
        })
        grid = RecyclerView(this).apply {
            layoutManager = GridLayoutManager(this@TvGridActivity, span)
            this.adapter = this@TvGridActivity.adapter
            setPadding(dp(48), dp(12), dp(34), dp(48))
            clipToPadding = false
            clipChildren = false
            itemAnimator = null
            addItemDecoration(object : RecyclerView.ItemDecoration() {
                override fun getItemOffsets(out: android.graphics.Rect, view: android.view.View, parent: RecyclerView, state: RecyclerView.State) { out.bottom = dp(18) }
            })
        }
        col.addView(grid, LinearLayout.LayoutParams(-1, 0, 1f))
        root.addView(col, FrameLayout.LayoutParams(-1, -1))
        status = label(17f, TvLook.muted, lines = 4).apply { gravity = Gravity.CENTER; setPadding(dp(80), 0, dp(80), 0) }
        root.addView(status, FrameLayout.LayoutParams(-1, -2, Gravity.CENTER))
        setContentView(root)
    }

    private fun load() {
        if (items.isEmpty()) status.text = "Loading…"
        TvApi.get(this, path, { d ->
            val had = grid.hasFocus()
            items.clear()
            items += d.optJSONArray("items")?.objects().orEmpty()
            adapter.notifyDataSetChanged()
            count.text = when (items.size) { 0 -> ""; 1 -> "1 title"; else -> "${items.size} titles" }
            status.text = if (items.isEmpty()) emptyText else ""
            if (items.isNotEmpty() && !had) grid.post { grid.getChildAt(0)?.requestFocus() }
        }, { msg -> status.text = msg })
    }
}
