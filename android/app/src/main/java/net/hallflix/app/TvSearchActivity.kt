package net.hallflix.app

import android.app.Activity
import android.content.Intent
import android.graphics.drawable.StateListDrawable
import android.net.Uri
import android.os.Bundle
import android.speech.RecognizerIntent
import android.text.Editable
import android.text.InputType
import android.text.TextWatcher
import android.view.Gravity
import android.view.KeyEvent
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.recyclerview.widget.GridLayoutManager
import androidx.recyclerview.widget.RecyclerView
import org.json.JSONObject

/**
 * Native search: results appear as you type (titles, people, genres, and plain-language searches like "funny 90s
 * movies under two hours", the same /api/search the website uses). Speaking works through the Fire TV keyboard's
 * microphone, and on Android TV / Google TV the Speak button (or the remote's search key) listens directly.
 */
class TvSearchActivity : Activity() {
    private lateinit var field: EditText
    private lateinit var grid: RecyclerView
    private lateinit var status: TextView
    private lateinit var adapter: CardAdapter
    private val items = mutableListOf<JSONObject>()
    private val typing = Debounce(350)
    private var asked = ""
    private var generation = 0

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (TvNav.lost(this)) return
        TvNav.open += this
        build()
        if (intent.getBooleanExtra("voice", false)) listen()
    }

    override fun onDestroy() { TvNav.open -= this; typing.cancel(); super.onDestroy() }

    private fun canListen(): Boolean = try {
        packageManager.queryIntentActivities(Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH), 0).isNotEmpty()
    } catch (e: Exception) { false }

    private fun build() {
        val root = FrameLayout(this).apply { setBackgroundColor(TvLook.bg) }
        val col = column()
        val head = row().apply { setPadding(dp(48), dp(28), dp(48), dp(14)) }
        val r = dp(10).toFloat()
        field = EditText(this).apply {
            hint = "Search titles, people, genres — or describe what you want"
            setHintTextColor(TvLook.muted)
            setTextColor(TvLook.text)
            textSize = 18f
            isSingleLine = true
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS
            imeOptions = EditorInfo.IME_ACTION_SEARCH or EditorInfo.IME_FLAG_NO_EXTRACT_UI
            setPadding(dp(18), dp(12), dp(18), dp(12))
            background = StateListDrawable().apply {
                addState(intArrayOf(android.R.attr.state_focused), rounded(0x33FFFFFF, r, dp(2), TvLook.focus))
                addState(intArrayOf(), rounded(0x1AFFFFFF, r))
            }
            addTextChangedListener(object : TextWatcher {
                override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
                override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}
                override fun afterTextChanged(s: Editable?) { typing.run { search(s?.toString().orEmpty()) } }
            })
            setOnEditorActionListener { _, action, _ ->
                if (action == EditorInfo.IME_ACTION_SEARCH || action == EditorInfo.IME_ACTION_DONE) {
                    typing.cancel(); search(text.toString())
                    hideKeyboard()
                    grid.post { grid.getChildAt(0)?.requestFocus() }
                    true
                } else false
            }
        }
        head.addView(field, LinearLayout.LayoutParams(0, -2, 1f))
        if (canListen()) head.addView(tvButton("Speak") { listen() }, LinearLayout.LayoutParams(-2, -2).apply { marginStart = dp(12) })
        col.addView(head)

        val usable = resources.displayMetrics.widthPixels - dp(82)
        val span = (usable / (cardSize(Shape.POSTER).first + dp(14))).coerceAtLeast(3)
        val w = usable / span - dp(14)
        adapter = CardAdapter(this, items, Shape.POSTER, captions = true, onFocus = {}, size = w to (w * 1.5f).toInt(), onPick = { TvNav.openItem(this, it) })
        grid = RecyclerView(this).apply {
            layoutManager = GridLayoutManager(this@TvSearchActivity, span)
            this.adapter = this@TvSearchActivity.adapter
            setPadding(dp(48), dp(8), dp(34), dp(48))
            clipToPadding = false
            clipChildren = false
            itemAnimator = null
            addItemDecoration(object : RecyclerView.ItemDecoration() {
                override fun getItemOffsets(out: android.graphics.Rect, view: android.view.View, parent: RecyclerView, state: RecyclerView.State) { out.bottom = dp(18) }
            })
        }
        col.addView(grid, LinearLayout.LayoutParams(-1, 0, 1f))
        root.addView(col, FrameLayout.LayoutParams(-1, -1))
        status = label(16f, TvLook.muted, lines = 4).apply {
            gravity = Gravity.CENTER; setPadding(dp(90), 0, dp(90), 0)
            text = if (canListen()) "Type, or press Speak and say what you’d like to watch." else "Type, or hold the microphone on the on-screen keyboard and say what you’d like to watch."
        }
        root.addView(status, FrameLayout.LayoutParams(-1, -2, Gravity.CENTER).apply { topMargin = dp(40) })
        setContentView(root)
        field.requestFocus()
    }

    private fun hideKeyboard() {
        (getSystemService(INPUT_METHOD_SERVICE) as? InputMethodManager)?.hideSoftInputFromWindow(field.windowToken, 0)
    }

    private fun search(term: String) {
        val t = term.trim()
        if (t == asked) return
        asked = t
        val mine = ++generation
        if (t.isEmpty()) { items.clear(); adapter.notifyDataSetChanged(); status.text = ""; return }
        status.text = "Searching…"
        TvApi.get(this, "/api/search?q=${Uri.encode(t)}", { d ->
            if (mine != generation) return@get
            items.clear()
            items += d.optJSONArray("items")?.objects().orEmpty()
            adapter.notifyDataSetChanged()
            status.text = when {
                items.isEmpty() -> "Nothing matches “$t”. You can also describe what you want, like “funny movies from the 90s under two hours”."
                else -> ""
            }
        }, { msg -> if (mine == generation) status.text = msg })
    }

    private fun listen() {
        try {
            startActivityForResult(Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
                .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                .putExtra(RecognizerIntent.EXTRA_PROMPT, "What would you like to watch?"), VOICE_REQ)
        } catch (e: Exception) {
            android.widget.Toast.makeText(this, "Hold the microphone on the on-screen keyboard to speak", android.widget.Toast.LENGTH_LONG).show()
            field.requestFocus()
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != VOICE_REQ || resultCode != RESULT_OK) return
        val heard = data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)?.firstOrNull() ?: return
        field.setText(heard)
        field.setSelection(heard.length)
        typing.cancel()
        search(heard)
        grid.postDelayed({ grid.getChildAt(0)?.requestFocus() }, 600)
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean {
        // The remote's search key (Android TV) starts listening.
        if (keyCode == KeyEvent.KEYCODE_SEARCH) { if (canListen()) listen() else field.requestFocus(); return true }
        // Down from the box goes to the results.
        if (keyCode == KeyEvent.KEYCODE_DPAD_DOWN && field.hasFocus() && items.isNotEmpty()) { hideKeyboard(); grid.getChildAt(0)?.requestFocus(); return true }
        return super.onKeyDown(keyCode, event)
    }

    companion object { private const val VOICE_REQ = 41 }
}
