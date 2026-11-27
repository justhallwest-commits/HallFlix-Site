package net.hallflix.app

import android.content.Context
import android.webkit.MimeTypeMap
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import java.io.File
import java.io.FileInputStream
import java.io.InputStream

/**
 * The Downloads page and its files, served to the WebView from inside the app so they work with no connection:
 *   https://appassets.androidplatform.net/assets/…  the page itself (app/src/main/assets)
 *   https://appassets.androidplatform.net/files/…   downloaded songs, pictures, subtitles, books and comics, with byte
 *                                                     ranges so music can seek
 * (appassets.androidplatform.net is the address Android reserves for this; nothing leaves the phone.)
 */
object LocalFiles {
    const val HOST = "appassets.androidplatform.net"
    const val PAGE = "https://$HOST/assets/offline/index.html"

    fun intercept(ctx: Context, req: WebResourceRequest): WebResourceResponse? {
        val u = req.url
        if (u.host != HOST) return null
        val path = u.path ?: return notFound()
        if (path.contains("..")) return notFound()
        return try {
            when {
                path.startsWith("/assets/") -> {
                    val name = path.removePrefix("/assets/")
                    WebResourceResponse(mime(name), "utf-8", ctx.assets.open(name)).apply { responseHeaders = mapOf("Cache-Control" to "no-store") }
                }
                path.startsWith("/files/") -> file(File(DownloadStore.dir(ctx), path.removePrefix("/files/")), req.requestHeaders?.entries?.firstOrNull { it.key.equals("Range", true) }?.value)
                path.startsWith("/epub/") -> epub(ctx, path.removePrefix("/epub/"))
                else -> notFound()
            }
        } catch (e: Exception) { notFound() }
    }

    private fun file(f: File, range: String?): WebResourceResponse {
        if (!f.isFile) return notFound()
        val len = f.length()
        val m = range?.let { Regex("""bytes=(\d*)-(\d*)""").find(it) }
        if (m == null) return WebResourceResponse(mime(f.name), null, 200, "OK", mapOf("Accept-Ranges" to "bytes", "Content-Length" to len.toString()), FileInputStream(f))
        val (a, b) = m.destructured
        val start = if (a.isEmpty()) (len - (b.toLongOrNull() ?: 0)).coerceAtLeast(0) else a.toLong()
        val end = if (a.isEmpty() || b.isEmpty()) len - 1 else minOf(b.toLong(), len - 1)
        if (start >= len || end < start) return WebResourceResponse(mime(f.name), null, 416, "Range Not Satisfiable", mapOf("Content-Range" to "bytes */$len"), null)
        val input = FileInputStream(f).apply { skipFully(this, start) }
        return WebResourceResponse(mime(f.name), null, 206, "Partial Content",
            mapOf("Accept-Ranges" to "bytes", "Content-Range" to "bytes $start-$end/$len", "Content-Length" to (end - start + 1).toString()),
            Limited(input, end - start + 1))
    }

    /** A file inside a downloaded EPUB (/epub/<id>/<path in the book>). Scripts in books never run. */
    private fun epub(ctx: Context, rest: String): WebResourceResponse {
        val id = rest.substringBefore('/').toLongOrNull() ?: return notFound()
        val name = java.net.URLDecoder.decode(rest.substringAfter('/'), "UTF-8")
        val book = DownloadStore.dir(ctx).listFiles()?.firstOrNull { it.name.startsWith("$id-") && it.name.endsWith(".epub") } ?: return notFound()
        val zip = java.util.zip.ZipFile(book)
        val entry = zip.getEntry(name) ?: run { zip.close(); return notFound() }
        val bytes = zip.getInputStream(entry).use { it.readBytes() }
        zip.close()
        return WebResourceResponse(mime(name), null, 200, "OK",
            mapOf("Content-Security-Policy" to "script-src 'none'; object-src 'none'", "X-Content-Type-Options" to "nosniff"), bytes.inputStream())
    }

    private fun skipFully(s: InputStream, n: Long) { var left = n; while (left > 0) { val k = s.skip(left); if (k <= 0) break; left -= k } }

    private fun mime(name: String): String {
        val ext = name.substringAfterLast('.', "").lowercase()
        return when (ext) {
            "html" -> "text/html"; "js" -> "text/javascript"; "css" -> "text/css"; "vtt" -> "text/vtt"; "json" -> "application/json"
            "m4a" -> "audio/mp4"; "flac" -> "audio/flac"; "opus", "ogg" -> "audio/ogg"; "mp3" -> "audio/mpeg"
            "epub" -> "application/epub+zip"; "cbz" -> "application/zip"; "pdf" -> "application/pdf"
            "xhtml", "xht" -> "application/xhtml+xml"; "htm" -> "text/html"; "svg" -> "image/svg+xml"; "otf" -> "font/otf"; "ttf" -> "font/ttf"; "woff" -> "font/woff"; "woff2" -> "font/woff2"
            else -> MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext) ?: "application/octet-stream"
        }
    }

    private fun notFound() = WebResourceResponse("text/plain", "utf-8", 404, "Not Found", emptyMap(), null)

    /** Reads at most `left` bytes, for a byte range. */
    private class Limited(private val s: InputStream, private var left: Long) : InputStream() {
        override fun read(): Int = if (left <= 0) -1 else s.read().also { if (it >= 0) left-- }
        override fun read(b: ByteArray, off: Int, len: Int): Int {
            if (left <= 0) return -1
            val n = s.read(b, off, minOf(len.toLong(), left).toInt())
            if (n > 0) left -= n
            return n
        }
        override fun close() = s.close()
    }
}
