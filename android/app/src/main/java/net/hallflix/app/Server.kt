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

    /** The home address (through Tailscale), tried before the saved one. The Studio can change it; "" means off. */
    const val DEFAULT_DIRECT = "http://100.117.23.98:8780"

    fun direct(ctx: Context): String = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("direct", DEFAULT_DIRECT) ?: ""

    fun saveDirect(ctx: Context, url: String) {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString("direct", url).apply()
    }

    /** Is HallFlix answering at this address right now? Quick: gives up after a second and a half. Blocks. */
    fun hello(server: String): Boolean = try {
        val c = URL("$server/api/hello").openConnection() as HttpURLConnection
        c.connectTimeout = 1_500
        c.readTimeout = 1_500
        c.setRequestProperty("Accept", "application/json")
        val ok = c.responseCode == 200 && JSONObject(c.inputStream.bufferedReader().use { it.readText() }).optBoolean("hallflix")
        c.disconnect()
        ok
    } catch (e: Exception) { false }

    /**
     * Keep the sign-in the same on both addresses, so switching between home and away never asks again.
     * onlyIfMissing: copy a sign-in across but never take one away (used before the first page loads).
     */
    fun shareSignIn(from: String, to: String, onlyIfMissing: Boolean = false) {
        if (from.isEmpty() || to.isEmpty() || from == to) return
        val have = token(from)
        val cm = CookieManager.getInstance()
        if (have != null) { if (token(to) != have) cm.setCookie(to, "hf_token=$have; Path=/; Max-Age=34560000; HttpOnly") }
        else if (!onlyIfMissing && token(to) != null) cm.setCookie(to, "hf_token=; Path=/; Max-Age=0")
        cm.flush()
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
    /**
     * What this device can play, remembered: working it out reads every decoder, which takes a moment on a Fire TV
     * stick, so the answer is kept (and refreshed in the background each time the app starts). Mobile data is always
     * checked fresh.
     */
    @Volatile private var known: JSONObject? = null
    private var refreshed = false

    fun caps(ctx: Context): JSONObject {
        val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val key = "caps:" + android.os.Build.FINGERPRINT
        val have = known ?: prefs.getString(key, null)?.let { try { JSONObject(it) } catch (e: Exception) { null } }
        if (have != null) {
            known = have
            if (!refreshed) { refreshed = true; Thread { try { val f = detect(ctx); known = f; prefs.edit().putString(key, f.toString()).apply() } catch (_: Exception) { } }.start() }
            return JSONObject(have.toString()).apply { if (onMobileData(ctx)) put("network", "cellular") }
        }
        val fresh = detect(ctx)
        known = fresh; refreshed = true
        prefs.edit().putString(key, fresh.toString()).apply()
        return JSONObject(fresh.toString()).apply { if (onMobileData(ctx)) put("network", "cellular") }
    }

    private fun detect(ctx: Context): JSONObject {
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
