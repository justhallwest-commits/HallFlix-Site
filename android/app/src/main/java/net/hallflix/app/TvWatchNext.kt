package net.hallflix.app

import android.content.Context
import android.net.Uri
import android.os.Build
import androidx.tvprovider.media.tv.TvContractCompat
import androidx.tvprovider.media.tv.WatchNextProgram
import org.json.JSONObject

/**
 * HallFlix's Continue Watching on the TV's own home screen: the "Continue watching" / "Play next" row of Android TV and
 * Google TV. Picking a title there opens HallFlix and plays it (hallflix://play/<id>).
 *
 * Fire TV shows this row only for apps from the Amazon Appstore, so on Fire TV nothing is written.
 */
object TvWatchNext {
    fun supported(ctx: Context): Boolean = Build.VERSION.SDK_INT >= 26 &&
        ctx.packageManager.hasSystemFeature("android.software.leanback") &&
        !ctx.packageManager.hasSystemFeature("amazon.hardware.fire_tv") &&
        !Build.MODEL.startsWith("AFT")

    /** Replace HallFlix's entries with these (newest first). Runs in the background and never fails loudly. */
    fun sync(ctx: Context, items: List<JSONObject>) {
        if (!supported(ctx) || !TvSession.ready) return
        val app = ctx.applicationContext
        Thread {
            try {
                val cr = app.contentResolver
                // Remove the entries written last time (the provider only lists this app's own).
                cr.query(TvContractCompat.WatchNextPrograms.CONTENT_URI, arrayOf(TvContractCompat.WatchNextPrograms._ID), null, null, null)?.use { c ->
                    while (c.moveToNext()) cr.delete(TvContractCompat.buildWatchNextProgramUri(c.getLong(0)), null, null)
                }
                val now = System.currentTimeMillis()
                items.take(12).forEachIndexed { i, it ->
                    val id = it.optLong("id")
                    if (id <= 0) return@forEachIndexed
                    val show = it.optJSONObject("show")
                    val p = it.optJSONObject("progress")
                    val pos = ((p?.optDouble("position", 0.0) ?: 0.0) * 1000).toLong()
                    val dur = ((p?.optDouble("duration", 0.0) ?: it.optDouble("runtime", 0.0)) * 1000).toLong()
                    val art = TvSession.abs(it.optString("thumb").ifEmpty { it.optString("backdrop") }.ifEmpty { it.optString("poster") }.takeIf { s -> s.isNotEmpty() && s != "null" })
                    val b = WatchNextProgram.Builder()
                        .setType(if (show != null) TvContractCompat.WatchNextPrograms.TYPE_TV_EPISODE else TvContractCompat.WatchNextPrograms.TYPE_MOVIE)
                        .setWatchNextType(if (pos > 0) TvContractCompat.WatchNextPrograms.WATCH_NEXT_TYPE_CONTINUE else TvContractCompat.WatchNextPrograms.WATCH_NEXT_TYPE_NEXT)
                        .setLastEngagementTimeUtcMillis(now - i * 60_000L) // keeps HallFlix's order
                        .setTitle(show?.optString("title")?.ifEmpty { null } ?: it.optString("title"))
                        .setIntentUri(Uri.parse("hallflix://play/$id"))
                        .setInternalProviderId(id.toString())
                    if (show != null) b.setEpisodeTitle(it.optString("title")).setSeasonNumber(show.optInt("season")).setEpisodeNumber(show.optInt("episode"))
                    if (art != null) b.setPosterArtUri(Uri.parse(art)).setPosterArtAspectRatio(TvContractCompat.PreviewPrograms.ASPECT_RATIO_16_9)
                    if (pos > 0) b.setLastPlaybackPositionMillis(pos.toInt())
                    if (dur > 0) b.setDurationMillis(dur.toInt())
                    cr.insert(TvContractCompat.WatchNextPrograms.CONTENT_URI, b.build().toContentValues())
                }
            } catch (e: Exception) { /* a TV without the home-screen provider: nothing to do */ }
        }.start()
    }
}
