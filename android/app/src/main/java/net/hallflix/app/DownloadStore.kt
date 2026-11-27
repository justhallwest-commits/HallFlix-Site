package net.hallflix.app

import android.app.DownloadManager
import android.content.Context
import android.net.Uri
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.os.StatFs
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

/**
 * Downloads saved in the app: films, episodes, songs, books and comics, with their pictures and subtitles, to enjoy
 * offline. Files are fetched by Android's download manager (it resumes after a dropped connection, shows progress in
 * the notifications and can wait for Wi-Fi); a smaller copy of a film is first made by the server, which this polls.
 *
 * The list lives in downloads.json in the app's private storage; the files in the app's own folder on the phone
 * (removed with the app). Where you stopped in a film watched offline is kept and sent to the server once online.
 *
 * Entry: { id, kind, title, quality, state: preparing|downloading|paused|done|failed, progress (0..1, preparing),
 *          dm (download manager id), file, size, bytes, error, meta (from /api/downloads/:id), poster, subs: [{label,lang,file}],
 *          position, duration, watched, unsynced, added }
 */
object DownloadStore {
    private const val PREFS = "hallflix"
    private val io = Executors.newSingleThreadExecutor()
    private val ui = Handler(Looper.getMainLooper())
    private val lock = Any()
    private var list: MutableList<JSONObject>? = null
    /** Called (on the main thread) whenever the list changes, so the Downloads page can redraw. */
    @Volatile var changed: (() -> Unit)? = null

    fun dir(ctx: Context): File = File(ctx.getExternalFilesDir(null) ?: ctx.filesDir, "downloads").apply { mkdirs() }
    private fun indexFile(ctx: Context) = File(ctx.filesDir, "downloads.json")

    private fun entries(ctx: Context): MutableList<JSONObject> = synchronized(lock) {
        list ?: try {
            val a = JSONArray(indexFile(ctx).readText())
            (0 until a.length()).map { a.getJSONObject(it) }.toMutableList()
        } catch (e: Exception) { mutableListOf() }.also { list = it }
    }

    private fun save(ctx: Context) = synchronized(lock) {
        val a = JSONArray(); entries(ctx).forEach { a.put(it) }
        val tmp = File(ctx.filesDir, "downloads.json.tmp")
        tmp.writeText(a.toString()); tmp.renameTo(indexFile(ctx))
    }

    private fun notifyChanged() { ui.post { changed?.invoke() } }

    fun find(ctx: Context, id: Long): JSONObject? = synchronized(lock) { entries(ctx).firstOrNull { it.optLong("id") == id } }

    fun wifiOnly(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean("downloadWifiOnly", true)
    fun setWifiOnly(ctx: Context, on: Boolean) { ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean("downloadWifiOnly", on).apply() }

    /** Save a title: ask the server what it is, get the file ready (a smaller copy is made first), then download it all. */
    fun add(ctx: Context, server: String, token: String?, itemId: Long, quality: String) {
        val app = ctx.applicationContext
        synchronized(lock) {
            val have = find(app, itemId)
            if (have != null && have.optString("state") != "failed") return
            if (have != null) remove(app, itemId, keepEntry = false)
            entries(app).add(JSONObject().put("id", itemId).put("quality", quality).put("state", "preparing").put("title", "").put("added", System.currentTimeMillis()))
            save(app)
        }
        notifyChanged()
        io.execute { prepare(app, server, token, itemId) }
    }

    /** Carry on with downloads that were still being got ready (or a comic still being saved page by page) when the app closed. */
    fun resume(ctx: Context, server: String, token: String?) {
        val app = ctx.applicationContext
        val waiting = synchronized(lock) { entries(app).filter { it.optString("state") == "preparing" || (it.optBoolean("bundle") && it.optString("state") in setOf("downloading", "paused")) }.map { it.optLong("id") } }
        for (id in waiting) io.execute { prepare(app, server, token, id) }
    }

    private fun update(ctx: Context, id: Long, change: (JSONObject) -> Unit) {
        synchronized(lock) { find(ctx, id)?.let(change); save(ctx) }
        notifyChanged()
    }

    private fun prepare(ctx: Context, server: String, token: String?, id: Long) {
        try {
            val meta = Server.call(server, token, "GET", "/api/downloads/$id")
            val e0 = find(ctx, id) ?: return
            update(ctx, id) { it.put("meta", meta).put("kind", meta.optString("kind")).put("title", meta.optString("title")) }
            val dir = dir(ctx)
            // The picture, and the subtitles for a film or episode (small, so fetched here).
            meta.optString("poster").takeIf { it.isNotEmpty() }?.let { p ->
                fetch(absolute(server, p), token, File(dir, "$id-poster.jpg"))?.let { f -> update(ctx, id) { it.put("poster", f.name) } }
            }
            val subs = JSONArray()
            meta.optJSONArray("subs")?.let { a ->
                for (i in 0 until a.length()) {
                    val s = a.getJSONObject(i)
                    fetch(absolute(server, s.getString("url")), token, File(dir, "$id-sub$i.vtt"))?.let { f -> subs.put(JSONObject().put("label", s.optString("label")).put("lang", s.optString("lang")).put("file", f.name)) }
                }
            }
            update(ctx, id) { it.put("subs", subs) }
            // Books and comics: what the reader needs (pages, or an EPUB's chapters and contents).
            val kind = meta.optString("kind")
            if (kind == "book" || kind == "comic") {
                val read = Server.call(server, token, "GET", "/api/read/$id")
                update(ctx, id) { it.put("read", JSONObject().put("mode", read.optString("mode")).put("pages", read.optInt("pages")).put("rtl", read.optBoolean("rtl"))
                    .put("spine", read.optJSONArray("spine") ?: JSONArray()).put("toc", read.optJSONArray("toc") ?: JSONArray())
                    .put("series", read.optJSONObject("series")).put("number", read.opt("number"))) }
                // Comics and PDFs are saved page by page, as pictures sized for a phone (any comic format works this way).
                if (read.optString("mode") == "pages") { savePages(ctx, server, token, id, read.optInt("pages")); return }
            }
            // The file: a smaller copy is made by the server first; ask every few seconds until it is ready.
            val quality = e0.optString("quality", "original")
            var p: JSONObject
            while (true) {
                if (find(ctx, id) == null) return // removed meanwhile
                p = Server.call(server, token, "POST", "/api/downloads/$id/prepare", JSONObject().put("quality", if (quality == "original") "original" else quality.toInt()))
                if (p.optBoolean("ready")) break
                if (p.optString("state") == "failed") throw Exception(p.optString("error").ifEmpty { "The server could not make the smaller copy" })
                update(ctx, id) { it.put("progress", p.optDouble("progress", 0.0)).put("waiting", p.optInt("waiting", 0)) }
                Thread.sleep(4000)
            }
            val name = "$id-${if (quality == "original") "original" else quality + "p"}.${p.optString("ext", "mp4")}"
            val req = DownloadManager.Request(Uri.parse(absolute(server, p.getString("url"))))
                .setTitle(meta.optString("title"))
                .setDescription("HallFlix download")
                .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                .setDestinationUri(Uri.fromFile(File(dir, name)))
                .setAllowedOverMetered(!wifiOnly(ctx))
                .setAllowedOverRoaming(false)
            token?.let { req.addRequestHeader("Authorization", "Bearer $it") }
            val dm = (ctx.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager).enqueue(req)
            update(ctx, id) { it.put("dm", dm).put("file", name).put("size", p.optLong("size", 0)).put("state", "downloading").remove("progress") }
        } catch (e: Exception) {
            update(ctx, id) { it.put("state", "failed").put("error", e.message ?: "The download could not start") }
        }
    }

    /** A comic or PDF, page by page into the app's folder; carries on from where it stopped. Honours Wi-Fi only. */
    private fun savePages(ctx: Context, server: String, token: String?, id: Long, pages: Int) {
        if (pages <= 0) throw Exception("This has no pages to save")
        val dir = dir(ctx)
        update(ctx, id) { it.put("bundle", true).put("state", "downloading").put("pages", pages).put("file", "$id-p1.jpg").remove("progress") }
        var bytes = 0L
        for (n in 1..pages) {
            val f = File(dir, "$id-p$n.jpg")
            if (find(ctx, id) == null) return // removed meanwhile
            while (wifiOnly(ctx) && Server.onMobileData(ctx)) {
                update(ctx, id) { it.put("state", "paused").put("why", "Waiting for Wi-Fi") }
                Thread.sleep(15_000)
                if (find(ctx, id) == null) return
            }
            if (!f.exists() || f.length() == 0L) {
                val tmp = File(dir, "$id-p$n.part")
                fetch(absolute(server, "/api/read/$id/page/$n?w=1600"), token, tmp) ?: throw Exception("Page $n could not be saved")
                tmp.renameTo(f)
            }
            bytes += f.length()
            if (n == pages || n % 3 == 0) update(ctx, id) { it.put("state", "downloading").remove("why"); it.put("bytes", bytes).put("size", bytes * pages / n).put("progress", n.toDouble() / pages) }
        }
        update(ctx, id) { it.put("state", "done").put("size", bytes).put("bytes", bytes).remove("progress") }
    }

    private fun absolute(server: String, url: String) = if (url.startsWith("http")) url else server + url

    private fun fetch(url: String, token: String?, to: File): File? = try {
        val c = URL(url).openConnection() as HttpURLConnection
        c.connectTimeout = 10_000; c.readTimeout = 30_000
        token?.let { c.setRequestProperty("Authorization", "Bearer $it") }
        if (c.responseCode in 200..299) { c.inputStream.use { input -> to.outputStream().use { input.copyTo(it) } }; to } else null
    } catch (e: Exception) { null }

    /** Check on files the download manager is fetching. Returns true while anything is still on its way. */
    fun refresh(ctx: Context): Boolean {
        val dm = ctx.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
        var busy = false
        var dirty = false
        synchronized(lock) {
            for (e in entries(ctx)) {
                val s = e.optString("state")
                if (s == "preparing") { busy = true; continue }
                if (e.optBoolean("bundle")) { if (s != "done" && s != "failed") busy = true; continue } // saved page by page, not by the download manager
                if (s != "downloading" && s != "paused") continue
                busy = true
                val c = dm.query(DownloadManager.Query().setFilterById(e.optLong("dm"))) ?: continue
                c.use {
                    if (!it.moveToFirst()) { e.put("state", "failed").put("error", "The download was cancelled"); dirty = true; return@use }
                    val status = it.getInt(it.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS))
                    val got = it.getLong(it.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR))
                    val total = it.getLong(it.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES))
                    val reason = it.getInt(it.getColumnIndexOrThrow(DownloadManager.COLUMN_REASON))
                    val next = when (status) {
                        DownloadManager.STATUS_SUCCESSFUL -> "done"
                        DownloadManager.STATUS_FAILED -> "failed"
                        DownloadManager.STATUS_PAUSED -> "paused"
                        else -> "downloading"
                    }
                    if (got != e.optLong("bytes") || next != s) dirty = true
                    e.put("bytes", got)
                    if (total > 0) e.put("size", total)
                    e.put("state", next)
                    if (next == "paused") e.put("why", when (reason) {
                        DownloadManager.PAUSED_QUEUED_FOR_WIFI -> "Waiting for Wi-Fi"
                        DownloadManager.PAUSED_WAITING_FOR_NETWORK -> "Waiting for a connection"
                        DownloadManager.PAUSED_WAITING_TO_RETRY -> "Trying again soon"
                        else -> "Paused"
                    }) else e.remove("why")
                    if (next == "failed") e.put("error", if (reason == DownloadManager.ERROR_INSUFFICIENT_SPACE) "Not enough space on the phone" else "The download failed (error $reason)")
                }
            }
            if (dirty) save(ctx)
        }
        if (dirty) notifyChanged()
        return busy
    }

    /** Delete a download and its files. */
    fun remove(ctx: Context, id: Long, keepEntry: Boolean = false) {
        val e = find(ctx, id) ?: return
        try { if (e.has("dm")) (ctx.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager).remove(e.optLong("dm")) } catch (_: Exception) { }
        dir(ctx).listFiles()?.filter { it.name.startsWith("$id-") }?.forEach { it.delete() }
        if (!keepEntry) synchronized(lock) { entries(ctx).removeAll { it.optLong("id") == id }; save(ctx) }
        notifyChanged()
    }

    /** Where a download's file is, once it's complete. */
    fun file(ctx: Context, e: JSONObject): File? = e.optString("file").takeIf { it.isNotEmpty() && e.optString("state") == "done" }?.let { File(dir(ctx), it) }?.takeIf { it.exists() }

    /** Where you stopped, watched offline: kept, and sent to the server next time HallFlix is online. */
    fun savePosition(ctx: Context, id: Long, position: Double, duration: Double, ended: Boolean) {
        synchronized(lock) {
            val e = find(ctx, id) ?: return
            e.put("position", if (ended) 0.0 else position).put("duration", duration).put("unsynced", true)
            if (ended) e.put("watched", true)
            save(ctx)
        }
    }

    /** Send offline progress to the server (call when online). */
    fun sync(ctx: Context, server: String, token: String?) {
        if (token == null) return
        val app = ctx.applicationContext
        io.execute {
            val todo = synchronized(lock) { entries(app).filter { it.optBoolean("unsynced") }.map { JSONObject(it.toString()) } }
            for (e in todo) {
                try {
                    val ended = e.optBoolean("watched") && e.optDouble("position", 0.0) == 0.0
                    val dur = e.optDouble("duration", 0.0)
                    Server.call(server, token, "POST", "/api/progress", JSONObject().put("itemId", e.optLong("id")).put("position", if (ended) dur else e.optDouble("position", 0.0)).put("duration", dur).put("ended", ended))
                    synchronized(lock) { find(app, e.optLong("id"))?.remove("unsynced"); save(app) }
                } catch (_: Exception) { return@execute } // still offline: try again next time
            }
        }
    }

    /** Everything, for the Downloads page: entries plus where their files are and how much space is left. */
    fun state(ctx: Context): JSONObject {
        val a = JSONArray()
        val dir = dir(ctx)
        synchronized(lock) {
            for (e in entries(ctx)) {
                val o = JSONObject(e.toString())
                o.optString("file").takeIf { it.isNotEmpty() }?.let { o.put("url", "$ASSET_FILES$it").put("path", Uri.fromFile(File(dir, it)).toString()) }
                o.optString("poster").takeIf { it.isNotEmpty() }?.let { o.put("posterUrl", "$ASSET_FILES$it").put("posterPath", Uri.fromFile(File(dir, it)).toString()) }
                o.optJSONArray("subs")?.let { s -> for (i in 0 until s.length()) s.getJSONObject(i).let { x -> x.put("url", ASSET_FILES + x.optString("file")) } }
                // Books and comics, for the reader on the Downloads page.
                if (o.optBoolean("bundle")) o.put("pagesBase", "$ASSET_FILES${o.optLong("id")}-p")
                if (o.optString("file").endsWith(".epub")) o.put("epubBase", "https://${LocalFiles.HOST}/epub/${o.optLong("id")}/")
                a.put(o)
            }
        }
        val used = dir.listFiles()?.sumOf { it.length() } ?: 0L
        val free = try { StatFs(dir.path).availableBytes } catch (e: Exception) { 0L }
        return JSONObject().put("items", a).put("used", used).put("free", free).put("wifiOnly", wifiOnly(ctx))
            .put("external", Environment.getExternalStorageState() == Environment.MEDIA_MOUNTED)
    }

    /** The Downloads page's address for a downloaded file (served by MainActivity's asset loader, see LocalFiles). */
    const val ASSET_FILES = "https://appassets.androidplatform.net/files/"
}
