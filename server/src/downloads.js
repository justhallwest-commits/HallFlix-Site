// Downloads for the HallFlix Android app: what can be saved to watch, listen or read offline, in which sizes, and the
// files themselves. A film or episode can be saved as its original file, or as a smaller copy (1080p, 720p or 480p) the
// transcoder makes once and keeps for two days. Songs, books and comics are saved as their original files.
// Turned on and off per profile in Studio → Profiles → Menu access ("Downloads"); hidden titles can't be saved.
import path from 'node:path';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { q, q1 } from './db.js';
import { HttpError, readJson, json } from './http.js';
import { SEL, FROM, card, trackCard, img } from './catalog.js';
import { transcoder, tracks, defaultAudio } from './playback.js';

export const QUALITIES = [1080, 720, 480];
const VIDEO = new Set(['movie', 'episode', 'clip']);
const SAVE = new Set([...VIDEO, 'track', 'book', 'comic']);
// Average bitrates of the transcoder's download copies (CRF 23 under its caps), for the size estimates.
const KBPS = { 1080: 4600, 720: 2300, 480: 1150 };

async function itemFor(pid, id) {
  const it = await q1(`select ${SEL}, al.title as album_title, al.poster as album_poster ${FROM} left join items al on al.id = i.parent_id and i.kind = 'track' where i.id = $2`, [pid, +id]);
  if (!it || !SAVE.has(it.kind) || !it.path) throw new HttpError(404, 'This can’t be downloaded');
  return it;
}

const video = (it) => (it.streams || []).find((s) => s.type === 'video');
const copyKey = (it, height, audioIndex) => crypto.createHash('sha1').update(`${it.path}|${it.size}|${height}|${audioIndex}`).digest('hex').slice(0, 24);

/** The sizes a title can be saved in: the original, and smaller copies below the original's height. */
export function options(it) {
  const out = [{ quality: 'original', label: 'Original', size: +it.size || 0, detail: [String(it.container || path.extname(it.path).slice(1)).toUpperCase(), video(it) ? `${video(it).height}p` : ''].filter(Boolean).join(' · ') }];
  const v = video(it);
  if (!VIDEO.has(it.kind) || !v) return out;
  const secs = +it.runtime_s || 0;
  for (const h of QUALITIES) {
    if (v.height && h >= v.height * 0.95) continue;
    out.push({ quality: h, label: `${h}p`, size: secs ? Math.round(secs * ((KBPS[h] + (h > 500 ? 160 : 128)) * 1000 / 8)) : 0, estimate: true, detail: 'Smaller copy, made by your server first' });
  }
  return out;
}

export function routes(r) {
  // What can be saved, in which sizes, and everything the app needs to show and play it offline.
  r.get('/api/downloads/:id', async ({ profile, params }) => {
    const it = await itemFor(profile.id, params.id);
    const base = it.kind === 'track' ? trackCard(it) : card(it);
    const info = { ...base, poster: img(it.kind === 'episode' ? it.show_poster : it.kind === 'track' ? it.album_poster : it.poster, 'w500'),
      backdrop: img(it.backdrop || it.show_backdrop, 'w1280'), options: options(it), ext: path.extname(it.path).slice(1).toLowerCase(),
      artist: it.kind === 'track' ? it.show_title || undefined : undefined };
    if (VIDEO.has(it.kind)) {
      info.subs = (await tracks(it)).subs.map((s) => ({ id: s.id, label: s.label, lang: s.lang, url: s.url }));
      info.marks = it.marks || {};
      if (it.kind === 'episode') {
        const next = await q1(`select id from items where show_id=$1 and kind='episode' and (season_no, episode_no) > ($2, $3) and season_no > 0 order by season_no, episode_no limit 1`, [it.show_id, it.season_no, it.episode_no]);
        info.nextId = next?.id || null;
      }
    }
    return info;
  });

  // The episodes of a season (or a whole show) or the songs of an album or playlist, to save together.
  r.get("/api/downloads/:id/children", async ({ params }) => {
    const parent = await q1('select id, kind from items where id=$1', [+params.id]);
    if (!parent) throw new HttpError(404, 'Not found');
    const rows = parent.kind === 'season' ? await q(`select i.id from items i where i.parent_id=$1 and i.kind='episode' order by i.episode_no`, [parent.id])
      : parent.kind === 'show' ? await q(`select i.id from items i where i.show_id=$1 and i.kind='episode' and i.season_no > 0 order by i.season_no, i.episode_no`, [parent.id])
      : parent.kind === 'album' ? await q(`select i.id from items i where i.parent_id=$1 and i.kind='track' order by i.season_no nulls first, i.episode_no nulls last, i.title`, [parent.id])
      : parent.kind === 'series' ? await q(`select i.id from items i where i.parent_id=$1 and i.kind='comic' order by (i.extra->>'number')::numeric nulls last, i.title`, [parent.id])
      : null;
    if (!rows) throw new HttpError(400, 'Nothing to save together here');
    return { ids: rows.map((x) => +x.id) };
  });

  // Get a file ready: the original straight away, or a smaller copy once the transcoder has made it (poll until ready).
  r.post('/api/downloads/:id/prepare', async ({ profile, params, req }) => {
    const it = await itemFor(profile.id, params.id);
    const b = await readJson(req);
    const ext = path.extname(it.path).slice(1).toLowerCase();
    if (!b.quality || b.quality === 'original') return { ready: true, state: 'ready', url: `/api/file/${it.id}`, size: +it.size || 0, ext };
    const h = +b.quality;
    if (!QUALITIES.includes(h) || !VIDEO.has(it.kind)) throw new HttpError(400, 'That size isn’t available for this');
    const v = video(it);
    if (!v) throw new HttpError(415, 'This file has no video');
    const audios = (it.streams || []).filter((s) => s.type === 'audio');
    const ai = audios.length ? defaultAudio(audios) : 0;
    const res = await transcoder('/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: copyKey(it, h, ai), input: it.path, height: h, srcHeight: v.height, audioIndex: ai, audio: audios.length ? 'aac' : 'none', hdr: !!v.hdr, duration: +it.runtime_s || 0 }) });
    const s = await res.json().catch(() => ({}));
    if (!res.ok) throw new HttpError(res.status, s.error || 'The transcoder could not make the copy');
    return { ready: s.state === 'ready', state: s.state, progress: s.progress || 0, waiting: s.waiting, error: s.error, size: s.size, url: `/api/downloads/${it.id}/file?quality=${h}`, ext: 'mp4' };
  });

  // A smaller copy, with byte ranges so an interrupted download carries on where it stopped.
  r.get('/api/downloads/:id/file', async ({ profile, params, req, res, query }) => {
    const it = await itemFor(profile.id, params.id);
    const h = +(query?.quality ?? new URL(req.url, 'http://x').searchParams.get('quality'));
    if (!QUALITIES.includes(h)) throw new HttpError(400, 'Which size?');
    const audios = (it.streams || []).filter((s) => s.type === 'audio');
    const up = await transcoder(`/jobs/${copyKey(it, h, audios.length ? defaultAudio(audios) : 0)}/file`, { headers: req.headers.range ? { Range: req.headers.range } : {} });
    if (!up.ok && up.status !== 206) {
      const err = await up.json().catch(() => ({}));
      return json(res, up.status === 404 ? 410 : up.status, { error: err.error || 'The copy is no longer on the server; download it again' });
    }
    const headers = { 'Cache-Control': 'no-store', 'Content-Disposition': `attachment; filename="${it.id}-${h}p.mp4"` };
    for (const k of ['content-type', 'content-length', 'content-range', 'accept-ranges']) if (up.headers.get(k)) headers[k] = up.headers.get(k);
    res.writeHead(up.status, headers);
    if (req.method === 'HEAD' || !up.body) return res.end();
    Readable.fromWeb(up.body).on('error', () => res.destroy()).pipe(res);
  });
}
