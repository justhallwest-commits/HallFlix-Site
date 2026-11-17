// Playback: choosing the fastest way to play a file on a given device, building the
// queue (pre-rolls, then the feature), and handing out streams and subtitles.
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { cfg } from './config.js';
import { currentLook } from './look.js';
import { q, q1, getSetting } from './db.js';
import { HttpError, readJson, sendFile, json } from './http.js';
import { run } from './probe.js';
import { card, img } from './catalog.js';
import * as prerolls from './prerolls.js';
import * as subtitles from './subtitles.js';

const DEFAULT_CAPS = { containers: ['mp4'], video: ['h264'], video10: [], audio: ['aac', 'mp3'], hlsHevc: false, audioSwitch: false, maxHeight: 0 };
const HLS_AUDIO_COPY = ['aac', 'mp3', 'ac3', 'eac3'];

export function defaultAudio(audios) {
  const i = audios.findIndex((a) => a.default);
  return i >= 0 ? i : 0;
}

/**
 * Three paths, fastest first:
 *   direct – the device plays the file itself; the server only reads it off the disk
 *   remux  – the video is copied untouched into a streaming wrapper (audio converted only if needed)
 *   transcode – the video is re-encoded to H.264
 */
export function decide(media, caps = {}, opt = {}) {
  const c = { ...DEFAULT_CAPS, ...caps };
  const streams = media.streams || [];
  const v = streams.find((s) => s.type === 'video');
  const audios = streams.filter((s) => s.type === 'audio');
  const def = defaultAudio(audios);
  const ai = Number.isInteger(opt.audio) && audios[opt.audio] ? opt.audio : def;
  const a = audios[ai];
  if (!v) throw new HttpError(415, 'This file has no video');
  const limit = opt.quality && opt.quality !== 'auto' ? +opt.quality : c.maxHeight || 0;
  const tooTall = limit > 0 && v.height > limit * 1.12;
  const depthOk = (v.bitDepth || 8) <= 8 || (c.video10 || []).includes(v.codec);
  const vOk = c.video.includes(v.codec) && depthOk && !tooTall;
  const aOk = !a || c.audio.includes(a.codec);
  const audioSel = { audioIndex: ai, audio: a ? 'aac' : 'none' };
  if (vOk && aOk && c.containers.includes(media.container) && (ai === def || c.audioSwitch)) {
    return { mode: 'direct', audioIndex: ai, reason: 'plays as-is' };
  }
  if (vOk && (v.codec === 'h264' || (v.codec === 'hevc' && c.hlsHevc))) {
    const copyAudio = a && aOk && HLS_AUDIO_COPY.includes(a.codec);
    return { mode: 'remux', video: 'copy', ...audioSel, audio: !a ? 'none' : copyAudio ? 'copy' : 'aac', seg: v.codec === 'hevc' ? 'fmp4' : 'ts',
      reason: !c.containers.includes(media.container) ? `repackaged from ${media.container}` : !aOk ? `audio converted from ${a.codec}` : 'audio track selected' };
  }
  const height = Math.min(v.height || 1080, limit || 1080);
  return { mode: 'transcode', video: 'h264', ...audioSel, seg: 'ts', height, srcHeight: v.height, hdr: !!v.hdr,
    reason: tooTall ? `resized to ${height}p` : !c.video.includes(v.codec) ? `video converted from ${v.codec}` : `${v.bitDepth}-bit video converted` };
}

export { pickPrerolls } from './prerolls.js';

const LANG = { eng: 'English', en: 'English', spa: 'Spanish', es: 'Spanish', fre: 'French', fra: 'French', fr: 'French', ger: 'German', deu: 'German', de: 'German',
  ita: 'Italian', it: 'Italian', jpn: 'Japanese', ja: 'Japanese', kor: 'Korean', ko: 'Korean', por: 'Portuguese', pt: 'Portuguese', chi: 'Chinese', zho: 'Chinese', zh: 'Chinese',
  rus: 'Russian', ru: 'Russian', hin: 'Hindi', hi: 'Hindi', ara: 'Arabic', ar: 'Arabic', und: 'Unknown' };
const langName = (l) => LANG[String(l || '').toLowerCase()] || (l ? l.toUpperCase() : 'Unknown');

async function sidecarSubs(file) {
  const dir = path.dirname(file), base = path.basename(file, path.extname(file));
  let entries = [];
  try { entries = await fs.promises.readdir(dir); } catch { /* unreadable */ }
  return entries.filter((e) => e.startsWith(base + '.') && /\.(srt|vtt|ass|ssa)$/i.test(e)).sort().map((e) => {
    const mid = e.slice(base.length + 1).replace(/\.(srt|vtt|ass|ssa)$/i, '');
    const lang = mid.split('.').find((p) => LANG[p.toLowerCase()]) || null;
    return { file: path.join(dir, e), lang, forced: /forced/i.test(mid), sdh: /(^|\.)(sdh|hi|cc)(\.|$)/i.test(mid) };
  });
}

async function tracks(item) {
  const st = item.streams || [];
  const audio = st.filter((s) => s.type === 'audio').map((a, i) => ({
    index: i, label: [a.title || langName(a.lang), a.channels > 2 ? `${a.channels === 6 ? '5.1' : a.channels === 8 ? '7.1' : a.channels + 'ch'}` : ''].filter(Boolean).join(' · '),
    lang: a.lang, default: a.default }));
  const subs = st.filter((s) => s.type === 'sub').map((s, i) => ({ s, i })).filter((x) => x.s.text).map(({ s, i }) => ({
    id: `e${i}`, label: s.title || langName(s.lang) + (s.forced ? ' (forced)' : ''), lang: s.lang, url: `/api/subs/${item.id}/e${i}` }));
  (await sidecarSubs(item.path)).forEach((x, i) => subs.push({ id: `x${i}`, label: langName(x.lang) + (x.sdh ? ' (SDH)' : '') + (x.forced ? ' (forced)' : ''), lang: x.lang, url: `/api/subs/${item.id}/x${i}` }));
  subs.push(...await subtitles.downloaded(item.id)); // found with a subtitle service
  return { audio, subs };
}

async function entryFor(item, caps, opt, kind) {
  const d = decide({ container: item.container, streams: item.streams }, caps, opt);
  const t = await tracks(item);
  return {
    kind, itemId: item.id, title: item.title, duration: item.runtime_s || 0, container: item.container,
    mode: d.mode, reason: d.reason, audioIndex: d.audioIndex,
    url: d.mode === 'direct' ? `/api/file/${item.id}` : null,
    audio: t.audio, subs: kind === 'main' ? t.subs : [],
  };
}

async function transcoder(pathname, init) {
  let res;
  try { res = await fetch(cfg.transcoderUrl + pathname, init); }
  catch { throw new HttpError(503, 'The transcoder is not running'); }
  return res;
}

export function routes(r) {
  // What to play, in order: any pre-rolls, then the title itself.
  r.post('/api/play', async ({ profile, req }) => {
    const body = await readJson(req);
    const item = await q1(
      `select i.*, s.title as show_title, s.genres as show_genres, s.studios as show_studios, s.rating as show_rating, s.backdrop as show_backdrop, s.logo as show_logo
       from items i left join items s on s.id = i.show_id where i.id=$1`, [body.itemId]);
    if (!item || !item.path || !['movie', 'episode', 'clip'].includes(item.kind)) throw new HttpError(404, 'Nothing to play');
    const prog = await q1('select position_s, watched from progress where profile_id=$1 and item_id=$2', [profile.id, item.id]);
    // Movie night: the full programme from the top, whatever was watched before.
    const resumeAt = body.cinema ? 0 : body.start != null ? +body.start : prog && !prog.watched && prog.position_s > 20 ? prog.position_s : 0;
    const queue = [];
    if (item.kind !== 'clip' && body.prerolls !== false) {
      for (const clip of await prerolls.forPlay(profile, item, resumeAt)) {
        try { queue.push(await entryFor(clip, body.caps, {}, 'preroll')); } catch { /* unplayable clip: skip it */ }
      }
    }
    // The HallFlix ident (a logo card) plays last before the feature. An uploaded video reaches every app;
    // without one, the web app draws its own animation.
    const ident = (await currentLook()).theme.ident;
    if (item.kind !== 'clip' && body.prerolls !== false && resumeAt < 60 && ident?.enabled && /^\/uploads\/[\w.-]+\.(mp4|webm)$/.test(ident.video || '')) {
      queue.push({ kind: 'ident', itemId: 0, title: '', duration: 0, container: 'mp4', mode: 'direct', url: ident.video, audio: [], subs: [] });
    }
    const main = await entryFor(item, body.caps, { audio: body.audio, quality: body.quality }, 'main');
    main.resumeAt = resumeAt;
    main.marks = item.marks || {};
    main.showId = item.show_id || null;
    const v = (item.streams || []).find((x) => x.type === 'video'), au = (item.streams || []).filter((x) => x.type === 'audio')[main.audioIndex || 0];
    main.file = { container: item.container, size: item.size, bitrate: item.bitrate, video: v ? `${String(v.codec).toUpperCase()} ${v.width}×${v.height}${v.hdr ? ' HDR' : ''}` : null, audio: au ? `${String(au.codec).toUpperCase()}${au.channels ? ` ${au.channels === 6 ? '5.1' : au.channels === 8 ? '7.1' : au.channels === 2 ? 'stereo' : au.channels + 'ch'}` : ''}` : null };
    main.subtitle = item.kind === 'episode' ? `${item.show_title} · S${item.season_no} E${item.episode_no}` : item.year ? String(item.year) : '';
    main.backdrop = img(item.backdrop || item.show_backdrop, 'w1280');
    main.logo = img(item.kind === 'episode' ? item.show_logo : item.logo, 'w500');
    if (item.kind === 'episode') {
      const next = await q1(
        `select i.*, s.title as show_title, s.poster as show_poster, s.backdrop as show_backdrop, s.logo as show_logo
         from items i join items s on s.id = i.show_id
         where i.show_id=$1 and i.kind='episode' and (i.season_no, i.episode_no) > ($2, $3) and i.season_no > 0
         order by i.season_no, i.episode_no limit 1`, [item.show_id, item.season_no, item.episode_no]);
      if (next) main.next = card(next);
    }
    queue.push(main);
    return { queue };
  });

  // Start (or restart at a new time) a streamed session for a title that cannot be played as-is.
  r.post('/api/play/session', async ({ req }) => {
    const body = await readJson(req);
    const item = await q1('select id, path, container, streams from items where id=$1', [body.itemId]);
    if (!item?.path) throw new HttpError(404, 'Nothing to play');
    const d = decide(item, body.caps, { audio: body.audio, quality: body.quality });
    if (d.mode === 'direct') return { direct: true, url: `/api/file/${item.id}` };
    if (body.replace) transcoder(`/sessions/${encodeURIComponent(body.replace)}`, { method: 'DELETE' }).catch(() => {});
    const res = await transcoder('/sessions', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: item.path, start: +body.start || 0, video: d.video, audio: d.audio, audioIndex: d.audioIndex,
        height: d.height, srcHeight: d.srcHeight, seg: d.seg, hdr: d.hdr }) });
    const out = await res.json();
    if (!res.ok) throw new HttpError(res.status, out.error || 'Could not start playback');
    return { sid: out.id, url: `/hls/${out.id}/index.m3u8`, start: out.start, mode: d.mode, hw: out.hw };
  });
  r.post('/api/play/ping/:sid', async ({ params }) => { await transcoder(`/sessions/${params.sid}/ping`, { method: 'POST' }).catch(() => {}); return { ok: true }; });
  r.delete('/api/play/session/:sid', async ({ params }) => { await transcoder(`/sessions/${params.sid}`, { method: 'DELETE' }).catch(() => {}); return { ok: true }; });

  // Stream files: session ids are long random strings, so the playlist and segments need no cookie
  // (native players do not send one for every segment).
  r.get('/hls/:sid/:file', async ({ req, res, params }) => {
    if (!/^[a-f0-9]{24}$/.test(params.sid) || !/^[\w.]+$/.test(params.file)) throw new HttpError(404, 'Not found');
    const up = await transcoder(`/s/${params.sid}/${params.file}`, { headers: req.headers.range ? { Range: req.headers.range } : {} });
    if (!up.ok && up.status !== 206) {
      const err = await up.json().catch(() => ({}));
      return json(res, up.status, { error: err.error || 'Stream ended' });
    }
    const headers = { 'Cache-Control': 'no-store' };
    for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges']) if (up.headers.get(h)) headers[h] = up.headers.get(h);
    res.writeHead(up.status, headers);
    if (req.method === 'HEAD' || !up.body) return res.end();
    Readable.fromWeb(up.body).on('error', () => res.destroy()).pipe(res);
  }, { auth: false });

  // The original file, with byte ranges, for devices that can play it untouched.
  r.get('/api/file/:id', async ({ req, res, params }) => {
    const item = await q1('select path from items where id=$1', [params.id]);
    if (!item?.path) throw new HttpError(404, 'Not found');
    await sendFile(req, res, item.path, { cache: 'private, max-age=3600' });
  });

  // Text subtitles as WebVTT, converted once and kept.
  r.get('/api/subs/:id/:track', async ({ req, res, params }) => {
    const item = await q1('select id, path, mtime, streams from items where id=$1', [params.id]);
    const m = /^([exd])(\d+)$/.exec(params.track);
    if (!item?.path || !m) throw new HttpError(404, 'Not found');
    const dir = path.join(cfg.dataDir, 'cache', 'subs');
    // Files beside the video are named in the cache by file name, since saving a new one shifts the numbers.
    const side = m[1] === 'x' ? (await sidecarSubs(item.path))[+m[2]] : null;
    if (m[1] === 'x' && !side) throw new HttpError(404, 'Not found');
    const tag = side ? Buffer.from(path.basename(side.file)).toString('base64url').slice(-40) : params.track;
    const out = path.join(dir, `${item.id}-${item.mtime}-${tag}.vtt`);
    if (!fs.existsSync(out)) {
      await fs.promises.mkdir(dir, { recursive: true });
      const tmp = `${out}.${process.pid}.tmp.vtt`;
      if (m[1] === 'e') {
        const subs = (item.streams || []).filter((s) => s.type === 'sub');
        const s = subs[+m[2]];
        if (!s?.text) throw new HttpError(404, 'Not found');
        await run(cfg.ffmpeg, ['-v', 'error', '-nostdin', '-y', '-i', item.path, '-map', `0:${s.index}`, '-f', 'webvtt', tmp], { timeout: 180e3 });
      } else if (m[1] === 'd') {
        const file = await subtitles.downloadedFile(item.id, +m[2]);
        if (!file) throw new HttpError(404, 'Not found');
        await run(cfg.ffmpeg, ['-v', 'error', '-nostdin', '-y', '-i', file, '-f', 'webvtt', tmp], { timeout: 60e3 });
      } else {
        await run(cfg.ffmpeg, ['-v', 'error', '-nostdin', '-y', '-i', side.file, '-f', 'webvtt', tmp], { timeout: 60e3 });
      }
      await fs.promises.rename(tmp, out);
    }
    await sendFile(req, res, out, { cache: 'private, max-age=86400' });
  });
}
