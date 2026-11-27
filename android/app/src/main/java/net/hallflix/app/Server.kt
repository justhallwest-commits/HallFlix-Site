package net.hallflix.app

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.media.MediaCodecInfo
import android.net.Uri
import android.media.MediaCodecList
import android.webkit.CookieManager
import androidx.media3.exoplayer.audio.AudioCapabilities
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/** Where the HallFlix server is, and small JSON calls to it. Calls block: run them off the main thread. */
object Server {
    private const val PREFS = "hallflix"

    fun url(ctx: Context): String = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("server", "") ?: ""

    fun save(ctx: Context, url: String) {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString("server", url).apply()
    }

    /**
     * "192.168.1.83:8780" → "http://192.168.1.83:8780"; "new.hallflix.net" → "https://new.hallflix.net".
     * A bare name gets https; an IP address, a port or a local name gets http. Trailing slashes removed.
     */
    fun normalise(raw: String): String {
        var s = raw.trim().trimEnd('/')
        if (s.isEmpty()) return s
        if (!s.startsWith("http://", true) && !s.startsWith("https://", true)) {
            val host = s.substringBefore('/')
            val local = host.contains(':') || host.matches(Regex("""\d{1,3}(\.\d{1,3}){3}""")) ||
                !host.contains('.') || host.endsWith(".local", true) || host.endsWith(".lan", true)
            s = (if (local) "http://" else "https://") + s
        }
        return s
    }

    /** "https://new.hallflix.net/#/home" → "https://new.hallflix.net". */
    fun origin(url: String): String? {
        val u = Uri.parse(url)
        val scheme = u.scheme?.lowercase() ?: return null
        if (scheme != "http" && scheme != "https") return null
        val host = u.host ?: return null
        return "$scheme://$host" + (if (u.port != -1) ":${u.port}" else "")
    }

    /** Is this link part of the HallFlix server? Same host on http or https (or a subdomain of it) counts. */
    fun sameSite(server: String, link: Uri): Boolean {
        val scheme = link.scheme?.lowercase()
        if (scheme != "http" && scheme != "https") return false
        val home = Uri.parse(server).host?.lowercase() ?: return false
        val host = link.host?.lowercase() ?: return false
        return host == home || host.endsWith(".$home")
    }

    /** The sign-in token the web app stored as a cookie, so the native player acts as the same profile. */
    fun token(server: String): String? {
        val cookies = CookieManager.getInstance().getCookie(server) ?: return null
        return cookies.split(';').map { it.trim() }.firstOrNull { it.startsWith("hf_token=") }?.removePrefix("hf_token=")?.takeIf { it.isNotEmpty() }
    }

    fun call(server: String, token: String?, method: String, path: String, body: JSONObject? = null): JSONObject {
        val c = URL(server + path).openConnection() as HttpURLConnection
        c.requestMethod = method
        c.connectTimeout = 10_000
        c.readTimeout = 30_000
        c.setRequestProperty("Accept", "application/json")
        if (token != null) c.setRequestProperty("Authorization", "Bearer $token")
        if (body != null) {
            c.doOutput = true
            c.setRequestProperty("Content-Type", "application/json")
            c.outputStream.use { it.write(body.toString().toByteArray()) }
        }
        val code = c.responseCode
        val text = (if (code < 400) c.inputStream else c.errorStream)?.bufferedReader()?.use { it.readText() } ?: ""
        c.disconnect()
        val json = try { if (text.isBlank()) JSONObject() else JSONObject(text) } catch (e: Exception) { JSONObject() }
        if (code >= 400) throw ServerError(json.optString("error").ifEmpty { "The server answered $code" })
        return json
    }

    class ServerError(message: String) : Exception(message)

    /** What this device can play without help, in the server's own words (see decide() in playback.js). */
    fun caps(ctx: Context): JSONObject {
        val decoders = MediaCodecList(MediaCodecList.REGULAR_CODECS).codecInfos.filter { !it.isEncoder }
        fun has(mime: String) = decoders.any { ci -> ci.supportedTypes.any { it.equals(mime, ignoreCase = true) } }
        fun hevc10(): Boolean = decoders.any { ci ->
            ci.supportedTypes.any { it.equals("video/hevc", true) } && try {
                ci.getCapabilitiesForType("video/hevc").profileLevels.any { it.profile == MediaCodecInfo.CodecProfileLevel.HEVCProfileMain10 }
            } catch (e: Exception) { false }
        }
        val pass = AudioCapabilities.getCapabilities(ctx)
        val video = JSONArray().put("h264")
        if (has("video/hevc")) video.put("hevc")
        if (has("video/x-vnd.on2.vp9")) video.put("vp9")
        if (has("video/av01")) video.put("av1")
        if (has("video/mpeg2")) video.put("mpeg2video")
        if (has("video/mp4v-es")) video.put("mpeg4")
        val audio = JSONArray().put("aac").put("mp3").put("opus").put("vorbis").put("flac")
        if (has("audio/ac3") || pass.supportsEncoding(androidx.media3.common.C.ENCODING_AC3)) audio.put("ac3")
        if (has("audio/eac3") || pass.supportsEncoding(androidx.media3.common.C.ENCODING_E_AC3)) audio.put("eac3")
        if (has("audio/vnd.dts") || pass.supportsEncoding(androidx.media3.common.C.ENCODING_DTS)) audio.put("dts")
        return JSONObject()
            .put("containers", JSONArray(listOf("mp4", "mov", "mkv", "webm", "ts", "avi")))
            .put("video", video)
            .put("video10", if (hevc10()) JSONArray().put("hevc") else JSONArray())
            .put("audio", audio)
            .put("hlsHevc", has("video/hevc"))
            .put("audioSwitch", true)
            .put("maxHeight", 0)
            .apply { if (onMobileData(ctx)) put("network", "cellular") }
    }

    /** On mobile data (not Wi-Fi or Ethernet): the server then holds films to the Studio's "Quality on mobile data". */
    @Suppress("DEPRECATION")
    fun onMobileData(ctx: Context): Boolean = try {
        val cm = ctx.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        if (android.os.Build.VERSION.SDK_INT >= 23) {
            val nc = cm.getNetworkCapabilities(cm.activeNetwork)
            nc != null && nc.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) && !nc.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) && !nc.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)
        } else cm.activeNetworkInfo?.type == ConnectivityManager.TYPE_MOBILE
    } catch (e: Exception) { false }
}
