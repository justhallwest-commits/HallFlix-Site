package net.hallflix.app

import android.app.Activity
import android.net.Uri
import android.os.Bundle
import android.view.Gravity
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.recyclerview.widget.GridLayoutManager
import androidx.recyclerview.widget.RecyclerView
import org.json.JSONObject

/** A movies or shows library as a grid of posters, with sorting and a watched filter. Loads 60 at a time. */
class TvLibraryActivity : Activity() {
    private var libId = 0L
    private lateinit var grid: RecyclerView
    private lateinit var count: TextView
    private lateinit var status: TextView
    private lateinit var sortBtn: TextView
    private lateinit var showBtn: TextView
    private lateinit var adapter: CardAdapter
    private val items = mutableListOf<JSONObject>()
    private var total = 0
    private var loading = false
    private var generation = 0
    private var refreshOnReturn = false

    private val sorts = listOf("title" to "A–Z", "added" to "Recently added", "released" to "Newest", "score" to "Top rated")
    private val filters = listOf("" to "Everything", "unwatched" to "Not watched", "inprogress" to "In progress", "watched" to "Watched")
    private var sort = 0
    private var filter = 0

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (TvNav.lost(this)) return
        TvNav.open += this
        libId = intent.getLongExtra("id", 0)
        val prefs = getSharedPreferences("hallflix", MODE_PRIVATE)
        sort = prefs.getInt("tvSort$libId", 0).coerceIn(0, sorts.size - 1)
        build(intent.getStringExtra("name").orEmpty())
        load(reset = true)
    }

    override fun onDestroy() { TvNav.open -= this; super.onDestroy() }

    override fun onResume() {
        super.onResume()
        if (refreshOnReturn) { refreshOnReturn = false; adapter.notifyDataSetChanged() }
    }

    private fun build(name: String) {
        val root = FrameLayout(this).apply { setBackgroundColor(TvLook.bg) }
        val col = column()
        val head = row().apply { setPadding(dp(48), dp(26), dp(48), dp(12)) }
        head.addView(label(28f, bold = true).apply { text = name }, LinearLayout.LayoutParams(-2, -2).apply { marginEnd = dp(16) })
        count = label(14f, TvLook.muted)
        head.addView(count, LinearLayout.LayoutParams(0, -2, 1f))
        sortBtn = tvButton("Sort: ${sorts[sort].second}") {
            sort = (sort + 1) % sorts.size
            getSharedPreferences("hallflix", MODE_PRIVATE).edit().putInt("tvSort$libId", sort).apply()
            sortBtn.text = "Sort: ${sorts[sort].second}"
            load(reset = true)
        }
        head.addView(sortBtn, LinearLayout.LayoutParams(-2, -2).apply { marginEnd = dp(10) })
        showBtn = tvButton("Show: ${filters[filter].second}") {
            filter = (filter + 1) % filters.size
            showBtn.text = "Show: ${filters[filter].second}"
            load(reset = true)
        }
        head.addView(showBtn)
        col.addView(head)

        val cardW = cardSize(Shape.POSTER).first + dp(14)
        val span = ((resources.displayMetrics.widthPixels - dp(96)) / cardW).coerceAtLeast(3)
        adapter = CardAdapter(this, items, Shape.POSTER, captions = false, onFocus = {}, onPick = { TvNav.openItem(this, it); refreshOnReturn = true }, onNearEnd = { load(reset = false) })
        grid = RecyclerView(this).apply {
            layoutManager = GridLayoutManager(this@TvLibraryActivity, span)
            this.adapter = this@TvLibraryActivity.adapter
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
        status = label(16f, TvLook.muted, lines = 3).apply { gravity = Gravity.CENTER }
        root.addView(status, FrameLayout.LayoutParams(-1, -2, Gravity.CENTER))
        setContentView(root)
    }

    private fun load(reset: Boolean) {
        if (reset) { generation++; items.clear(); total = 0; adapter.notifyDataSetChanged(); loading = false; status.text = "Loading…" }
        else if (loading || items.size >= total) return
        loading = true
        val mine = generation
        val q = StringBuilder("/api/library/$libId?limit=60&offset=${items.size}&sort=${sorts[sort].first}")
        filters[filter].first.takeIf { it.isNotEmpty() }?.let { q.append("&status=").append(Uri.encode(it)) }
        TvApi.get(this, q.toString(), { d ->
            if (mine != generation) return@get
            loading = false
            total = d.optInt("total")
            val got = d.optJSONArray("items")?.objects().orEmpty()
            val from = items.size
            items += got
            adapter.notifyItemRangeInserted(from, got.size)
            count.text = if (total == 1) "1 title" else "$total titles"
            status.text = if (items.isEmpty()) "Nothing here with these choices." else ""
            if (reset && items.isNotEmpty()) grid.post { grid.getChildAt(0)?.requestFocus() }
            if (reset && items.isEmpty()) showBtn.requestFocus()
        }, { msg -> if (mine == generation) { loading = false; status.text = msg } })
    }
}
