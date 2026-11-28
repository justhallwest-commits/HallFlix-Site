package net.hallflix.app

import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.widget.TextView
import androidx.core.content.FileProvider
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

/**
 * "Update available": every few hours the app asks the server for the newest build (/api/app/latest, from the
 * version.json published with each APK). When there's a newer one signed with the same key as this app, it offers to
 * download it and opens Android's installer, so updating no longer means uninstalling and using Downloader. If the new
 * build is signed with a different key (the one-time switch from the temporary key), it says a reinstall is needed.
 */
object Updates {
    private const val EVERY = 6 * 3600_000L
    private var checking = false
    private var offered = 0
    /** A downloaded update waiting for "Install unknown apps" to be allowed. */
    private var pending: File? = null

    private fun installed(act: Activity): Int = try {
        @Suppress("DEPRECATION") act.packageManager.getPackageInfo(act.packageName, 0).versionCode
    } catch (e: Exception) { 0 }

    /** This app's signing certificate, as the SHA-256 hex version.json uses. */
    private fun signer(act: Activity): String = try {
        @Suppress("DEPRECATION")
        val sig = act.packageManager.getPackageInfo(act.packageName, PackageManager.GET_SIGNATURES).signatures!![0].toByteArray()
        MessageDigest.getInstance("SHA-256").digest(sig).joinToString("") { "%02x".format(it) }
    } catch (e: Exception) { "" }

    /** Called when a screen opens: checks at most every few hours, and offers each new build once per app run. */
    fun check(act: Activity, force: Boolean = false, at: String? = null) {
        // Back from "Install unknown apps" with an update downloaded: install it now.
        pending?.let { f -> if (canInstall(act)) { pending = null; install(act, f) }; return }
        val server = at?.ifEmpty { null } ?: TvSession.server.ifEmpty { Server.url(act) }
        if (server.isEmpty() || checking) return
        val prefs = act.getSharedPreferences("hallflix", Activity.MODE_PRIVATE)
        if (!force && System.currentTimeMillis() - prefs.getLong("updateChecked", 0) < EVERY && offered == 0) return
        checking = true
        Thread {
            val latest = try { Server.call(server, null, "GET", "/api/app/latest") } catch (e: Exception) { null }
            act.runOnUiThread {
                checking = false
                prefs.edit().putLong("updateChecked", System.currentTimeMillis()).apply()
                if (latest == null || act.isFinishing) return@runOnUiThread
                val code = latest.optInt("versionCode")
                if (code <= installed(act) || code == offered || code == prefs.getInt("updateSkipped", 0)) return@runOnUiThread
                offered = code
                offer(act, latest)
            }
        }.start()
    }

    private fun offer(act: Activity, latest: JSONObject) {
        val name = latest.optString("versionName").ifEmpty { "a new version" }
        val theirs = latest.optString("signer")
        val mine = signer(act)
        val prefs = act.getSharedPreferences("hallflix", Activity.MODE_PRIVATE)
        if (theirs.isNotEmpty() && mine.isNotEmpty() && theirs != mine) {
            // Signed with another key: Android won't install it over this app. Say so once, plainly.
            AlertDialog.Builder(act, android.R.style.Theme_Material_Dialog_Alert)
                .setTitle("HallFlix $name is ready")
                .setMessage("This update is signed with HallFlix's permanent key, so it can't install over the version you have. " +
                    "This happens once: uninstall HallFlix, then install it again from your server's /get/android link in Downloader. " +
                    "After that, updates install right here.")
                .setPositiveButton("OK", null)
                .setNegativeButton("Don’t remind me") { _, _ -> prefs.edit().putInt("updateSkipped", latest.optInt("versionCode")).apply() }
                .show()
            return
        }
        AlertDialog.Builder(act, android.R.style.Theme_Material_Dialog_Alert)
            .setTitle("Update available")
            .setMessage("HallFlix $name is ready. It downloads here and installs over this version, keeping your sign-in and downloads.")
            .setPositiveButton("Update now") { _, _ -> download(act, latest.optString("apk"), latest.optInt("versionCode")) }
            .setNegativeButton("Later", null)
            .setNeutralButton("Skip this version") { _, _ -> prefs.edit().putInt("updateSkipped", latest.optInt("versionCode")).apply() }
            .show()
    }

    private fun download(act: Activity, url: String, code: Int) {
        if (url.isEmpty()) return
        val msg = TextView(act).apply { setPadding(act.dp(24), act.dp(16), act.dp(24), act.dp(8)); textSize = 16f; text = "Downloading… 0%" }
        val dialog = AlertDialog.Builder(act, android.R.style.Theme_Material_Dialog_Alert).setTitle("Updating HallFlix").setView(msg).setCancelable(false).show()
        Thread {
            try {
                val dir = File(act.getExternalFilesDir(null) ?: act.filesDir, "updates").apply { mkdirs(); listFiles()?.forEach { it.delete() } }
                val file = File(dir, "hallflix-$code.apk")
                // Follow GitHub's redirects by hand (Android won't follow one that changes host and protocol).
                var at = URL(url); var c: HttpURLConnection
                var hops = 0
                while (true) {
                    c = at.openConnection() as HttpURLConnection
                    c.instanceFollowRedirects = false
                    c.connectTimeout = 15_000; c.readTimeout = 30_000
                    val rc = c.responseCode
                    if (rc in 300..399 && hops++ < 6) { at = URL(at, c.getHeaderField("Location")); c.disconnect(); continue }
                    if (rc != 200) throw Exception("The download answered $rc")
                    break
                }
                val total = c.contentLengthLong
                var got = 0L
                var shown = -1
                c.inputStream.use { input -> file.outputStream().use { out ->
                    val buf = ByteArray(64 * 1024)
                    while (true) {
                        val n = input.read(buf); if (n < 0) break
                        out.write(buf, 0, n); got += n
                        val pct = if (total > 0) (got * 100 / total).toInt() else -1
                        if (pct != shown) { shown = pct; act.runOnUiThread { msg.text = if (pct >= 0) "Downloading… $pct%" else "Downloading… ${got / 1_000_000} MB" } }
                    }
                } }
                act.runOnUiThread {
                    dialog.dismiss()
                    if (canInstall(act)) install(act, file) else askToAllow(act, file)
                }
            } catch (e: Exception) {
                act.runOnUiThread { dialog.dismiss(); android.widget.Toast.makeText(act, "The update couldn’t be downloaded. Try again later.", android.widget.Toast.LENGTH_LONG).show() }
            }
        }.start()
    }

    private fun canInstall(act: Activity): Boolean = Build.VERSION.SDK_INT < 26 || act.packageManager.canRequestPackageInstalls()

    /** Android 8+ asks once whether HallFlix may install apps. On a Fire TV that setting lives in Developer options. */
    private fun askToAllow(act: Activity, file: File) {
        pending = file
        val settings = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${act.packageName}"))
        val fire = act.packageManager.hasSystemFeature("amazon.hardware.fire_tv") || Build.MODEL.startsWith("AFT")
        AlertDialog.Builder(act, android.R.style.Theme_Material_Dialog_Alert)
            .setTitle("Allow HallFlix to install its updates")
            .setMessage(if (fire) "On the next screen (or in Settings → My Fire TV → Developer options → Install unknown apps), turn HallFlix on, then come back. The update installs straight away."
                else "On the next screen, allow HallFlix to install apps, then come back. The update installs straight away.")
            .setPositiveButton("Open settings") { _, _ ->
                try { act.startActivity(settings) } catch (e: Exception) {
                    try { act.startActivity(Intent(Settings.ACTION_SECURITY_SETTINGS)) } catch (_: Exception) { }
                }
            }
            .setNegativeButton("Not now") { _, _ -> pending = null }
            .show()
    }

    private fun install(act: Activity, file: File) {
        val uri = if (Build.VERSION.SDK_INT >= 24) FileProvider.getUriForFile(act, "${act.packageName}.updates", file) else Uri.fromFile(file)
        val i = Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        try { act.startActivity(i) } catch (e: Exception) {
            android.widget.Toast.makeText(act, "Android couldn’t open the installer. Install from your server’s /get/android link instead.", android.widget.Toast.LENGTH_LONG).show()
        }
    }
}
