// Lyrics: from the NAS first (a .lrc or .txt beside the song, or the song's own tags), then from lyrics services:
// LRCLIB (free, time-synced) built in, any JSON lyrics API added in the Studio, and services that plugins declare.
// What a service finds is kept, so each song is looked up once; songs with nothing are tried again after a week.
// Anyone can search for other lyrics, paste their own, or nudge the timing, and an admin can have found lyrics
// saved next to the songs as .lrc files.
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cfg } from './config.js';
import { q, q1, getSetting, setSetting } from './db.js';
import { HttpError, readJson } from './http.js';
import { listPlugins } from './plugins.js';

const exec = promisify(execFile);
const UA = `HallFlix/${cfg.version} (https://github.com/justhallwest-commits/HallFlix-Site)`;
const RETRY_MISSING_DAYS = 7;

// ---------- LRC ----------
const stamp = (m, s) => +m * 60 + parseFloat(String(s).replace(':', '.'));
/**
 * Lines from LRC text, in time order. Enhanced LRC (<mm:ss.xx> before each word) gives each line its words too,
 * so the player can light up word by word. An [offset:±ms] tag shifts everything.
 */
export function parseLrc(text) {
  const out = [];
  const src = String(text || '').replace(/\r/g, '');
  const off = /^\[offset:\s*([+-]?\d+)\s*\]/im.exec(src);
  const shift = off ? -(+off[1]) / 1000 : 0; // LRC: a positive offset means the lyrics come earlier
  for (const line of src.split('\n')) {
    const stamps = [...line.matchAll(/\[(\d+):(\d+(?:[.:]\d+)?)\]/g)];
    if (!stamps.length) continue;
    const body = line.replace(/\[[^\]]*\]/g, '');
    let words = null;
    if (/<\d+:\d+(?:[.:]\d+)?>/.test(body)) {
      words = [];
      const re = /<(\d+):(\d+(?:[.:]\d+)?)>([^<]*)/g;
      let m;
      while ((m = re.exec(body))) if (m[3] !== '') words.push({ t: Math.max(0, stamp(m[1], m[2]) + shift), text: m[3] });
      if (!words.length) words = null;
    }
    const plain = body.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
    for (const m of stamps) out.push({ t: Math.max(0, Math.round((stamp(m[1], m[2]) + shift) * 1000) / 1000), text: plain, ...(words && stamps.length === 1 ? { words } : {}) });
  }
  return out.sort((a, b) => a.t - b.t);
}
const looksTimed = (text) => (String(text).match(/^\s*\[\d+:\d+(?:[.:]\d+)?\]/gm) || []).length >= 3;

/** Either { synced } or { plain } from whatever text a file or service gave. */
function shape(text) {
  const t = String(text || '').trim();
  if (!t) return null;
  if (looksTimed(t)) { const synced = parseLrc(t); if (synced.length >= 3) return { synced }; }
  return { plain: t.replace(/^\[[a-z]+:[^\]]*\]\s*$/gim, '').trim().slice(0, 40000) };
}

// ---------- from the NAS ----------
async function fromFiles(item) {
  const stem = item.path.slice(0, -path.extname(item.path).length);
  for (const ext of ['.lrc', '.LRC']) {
    try { const s = shape(await fs.promises.readFile(stem + ext, 'utf8')); if (s) return { ...s, source: 'A .lrc file on the NAS' }; } catch { /* next */ }
  }
  try { const s = shape(await fs.promises.readFile(`${stem}.txt`, 'utf8')); if (s) return { ...s, source: 'A .txt file on the NAS' }; } catch { /* next */ }
  try {
    const { stdout } = await exec(cfg.ffprobe, ['-v', 'error', '-show_entries', 'format_tags:stream_tags', '-of', 'json', item.path], { timeout: 30e3, maxBuffer: 4e6 });
    const j = JSON.parse(stdout);
    const tags = Object.assign({}, ...(j.streams || []).map((s) => s.tags || {}), j.format?.tags || {});
    const key = Object.keys(tags).find((k) => /^(lyrics|unsyncedlyrics|uslt|syncedlyrics)(-|$)/i.test(k));
    const s = key && shape(tags[key]);
    if (s) return { ...s, source: "The song's own tags" };
  } catch { /* none */ }
  return null;
}

// ---------- services ----------
const BUILTIN = [{ id: 'lrclib', name: 'LRCLIB', kind: 'builtin', description: 'A free, community-made database of time-synced lyrics.', search: true }];
const dig = (obj, p) => (!p ? obj : String(p).split('.').reduce((a, k) => (a == null ? a : a[/^\d+$/.test(k) ? +k : k]), obj));
const fill = (tpl, t) => String(tpl).replace(/\{(artist|title|album|duration|query)\}/g, (_, k) => encodeURIComponent(k === 'duration' ? String(Math.round(t.duration || 0)) : t[k] || ''));
const cleanHeaders = (h) => Object.fromEntries(Object.entries(h && typeof h === 'object' ? h : {}).filter(([k, v]) => /^[\w-]{1,60}$/.test(k) && typeof v === 'string' && v.length < 2000));

async function getJson(url, headers = {}, ms = 7000) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json, text/plain;q=0.8, */*;q=0.5', ...headers }, signal: AbortSignal.timeout(ms) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`The service answered ${res.status}`);
  const type = res.headers.get('content-type') || '';
  const body = await res.text();
  if (/json/.test(type) || /^\s*[[{]/.test(body)) { try { return JSON.parse(body); } catch { /* text after all */ } }
  return { __text: body };
}

/** One provider's answer for a song: { synced } or { plain }, or null. */
async function ask(p, t) {
  if (p.id === 'lrclib') {
    const base = cfg.lrclibBase.replace(/\/$/, '');
    const pick = (x) => (x?.instrumental ? { plain: '♪ Instrumental ♪', instrumental: true } : shape(x?.syncedLyrics) || shape(x?.plainLyrics));
    const qs = new URLSearchParams({ track_name: t.title, artist_name: t.artist });
    if (t.album) qs.set('album_name', t.album);
    if (t.duration) qs.set('duration', String(Math.round(t.duration)));
    const exact = await getJson(`${base}/api/get?${qs}`);
    const got = pick(exact);
    if (got) return got;
    // No exact match: search by title and artist and take the closest length.
    const list = await getJson(`${base}/api/search?${new URLSearchParams({ track_name: t.title, artist_name: t.artist })}`);
    const near = (Array.isArray(list) ? list : []).filter((x) => !t.duration || !x.duration || Math.abs(x.duration - t.duration) <= 4)
      .sort((a, b) => (b.syncedLyrics ? 1 : 0) - (a.syncedLyrics ? 1 : 0) || Math.abs((a.duration || 0) - (t.duration || 0)) - Math.abs((b.duration || 0) - (t.duration || 0)));
    return near.length ? pick(near[0]) : null;
  }
  if (!p.url) return null;
  const data = await getJson(fill(p.url, t), cleanHeaders(p.headers));
  if (!data) return null;
  if (data.__text != null) return shape(data.__text);
  const root = p.result ? dig(data, p.result) : data;
  if (root == null) return null;
  return shape(p.synced ? dig(root, p.synced) : null) || shape(p.plain ? dig(root, p.plain) : null) || (typeof root === 'string' ? shape(root) : null);
}

/** Candidates for "search for other lyrics": several results per provider that can search. */
async function searchOne(p, query, t) {
  if (p.id === 'lrclib') {
    const list = await getJson(`${cfg.lrclibBase.replace(/\/$/, '')}/api/search?${new URLSearchParams({ q: query })}`);
    return (Array.isArray(list) ? list : []).slice(0, 12).map((x) => ({
      provider: 'LRCLIB', title: x.trackName || x.name, artist: x.artistName, album: x.albumName, duration: x.duration,
      synced: x.syncedLyrics || null, plain: x.plainLyrics || null, instrumental: !!x.instrumental,
    })).filter((x) => x.synced || x.plain || x.instrumental);
  }
  if (!p.searchUrl) { const one = await ask(p, { ...t, title: query }); return one ? [{ provider: p.name, title: query, artist: t.artist, ...(one.synced ? { synced: toLrc(one.synced) } : { plain: one.plain }) }] : []; }
  const data = await getJson(fill(p.searchUrl, { ...t, query }), cleanHeaders(p.headers));
  const list = dig(data, p.searchList || '');
  return (Array.isArray(list) ? list : []).slice(0, 12).map((x) => ({
    provider: p.name, title: dig(x, p.searchTitle || 'title'), artist: dig(x, p.searchArtist || 'artist'), album: dig(x, p.searchAlbum || 'album'),
    synced: p.synced ? dig(x, p.synced) || null : null, plain: p.plain ? dig(x, p.plain) || null : null,
  })).filter((x) => x.synced || x.plain);
}

const toLrc = (lines) => lines.map((l) => { const m = Math.floor(l.t / 60), s = (l.t - m * 60).toFixed(2).padStart(5, '0'); return `[${String(m).padStart(2, '0')}:${s}]${l.text}`; }).join('\n');

/** Every provider, in the order the Studio set, with plugin services added at the end the first time they appear. */
export async function providers() {
  const saved = await getSetting('lyrics', {});
  const list = Array.isArray(saved.providers) ? saved.providers : [];
  const fromPlugins = [];
  for (const pl of await listPlugins()) {
    if (!pl.enabled || pl.broken) continue;
    for (const l of pl.lyrics || []) fromPlugins.push({ ...l, id: `plugin:${pl.id}:${l.key}`, kind: 'plugin', plugin: pl.name });
  }
  const known = new Map([...BUILTIN, ...fromPlugins].map((p) => [p.id, p]));
  const out = [];
  const seen = new Set();
  for (const s of list) {
    if (!s || seen.has(s.id)) continue;
    if (known.has(s.id)) out.push({ ...known.get(s.id), enabled: s.enabled !== false });
    else if (String(s.id).startsWith('custom:') && s.url) out.push({ ...s, kind: 'custom', enabled: s.enabled !== false });
    else continue;
    seen.add(s.id);
  }
  for (const p of known.values()) if (!seen.has(p.id)) out.push({ ...p, enabled: true });
  return out;
}

async function settings() {
  const s = await getSetting('lyrics', {});
  return { autoFetch: s.autoFetch !== false, saveLrc: !!s.saveLrc };
}

async function trackInfo(id) {
  const t = await q1(`select i.id, i.title, i.author, i.path, i.runtime_s, al.title as album, al.author as album_artist
    from items i left join items al on al.id = i.parent_id where i.id=$1 and i.kind='track'`, [id]);
  if (!t?.path) throw new HttpError(404, 'Not found');
  return { ...t, artist: t.author || t.album_artist || '', duration: t.runtime_s || 0 };
}

const fetching = new Map();
/** Ask the enabled services in order until one has lyrics. */
async function lookUp(t) {
  const errors = [];
  for (const p of (await providers()).filter((x) => x.enabled)) {
    try {
      const got = await ask(p, t);
      if (got) return { ...got, source: p.name };
    } catch (e) { errors.push(`${p.name}: ${e.message}`); }
  }
  if (errors.length) console.log('[lyrics]', t.title, errors.join('; '));
  return null;
}

async function store(t, got, { chosen = false } = {}) {
  await q(`insert into lyrics (item_id, source, synced, plain, missing, chosen, fetched_at) values ($1,$2,$3::jsonb,$4,$5,$6,now())
           on conflict (item_id) do update set source=excluded.source, synced=excluded.synced, plain=excluded.plain, missing=excluded.missing, chosen=excluded.chosen, fetched_at=now()`,
    [t.id, got?.source || null, got?.synced ? JSON.stringify(got.synced) : null, got?.plain || null, !got, chosen]);
  // Keep a copy beside the song, if the Studio asked for that and HallFlix may write there.
  if (got && (await settings()).saveLrc && !got.instrumental) {
    const stem = t.path.slice(0, -path.extname(t.path).length);
    const body = got.synced ? `[ti:${t.title}]\n[ar:${t.artist}]\n${t.album ? `[al:${t.album}]\n` : ''}[by:HallFlix · ${got.source || 'lyrics'}]\n${toLrc(got.synced)}\n` : `${got.plain}\n`;
    fs.promises.writeFile(stem + (got.synced ? '.lrc' : '.txt'), body, { flag: chosen ? 'w' : 'wx' }).catch(() => {});
  }
}

const answer = (row, extra = {}) => ({
  ...(row.synced ? { synced: row.synced } : row.plain ? { plain: row.plain } : {}),
  source: row.source || null, offset: row.offset_s || 0, chosen: !!row.chosen, words: !!row.synced?.some?.((l) => l.words), ...extra,
});

/** Lyrics for one song, from wherever they can be found. */
export async function lyricsFor(id, { fetchOnline = true } = {}) {
  const t = await trackInfo(id);
  const row = await q1('select * from lyrics where item_id=$1', [t.id]);
  if (row?.chosen) return answer(row);
  const local = await fromFiles(t);
  if (local) return answer({ ...local, synced: local.synced, plain: local.plain, offset_s: row?.offset_s || 0 }, { local: true });
  if (row && !row.missing) return answer(row);
  if (row?.missing && Date.now() - new Date(row.fetched_at) < RETRY_MISSING_DAYS * 86400e3) return { offset: row.offset_s || 0, missing: true };
  if (!fetchOnline || !(await settings()).autoFetch) return { offset: row?.offset_s || 0 };
  if (!fetching.has(t.id)) fetching.set(t.id, lookUp(t).then(async (got) => { await store(t, got); return got; }).finally(() => fetching.delete(t.id)));
  const got = await fetching.get(t.id);
  return got ? answer({ ...got, offset_s: row?.offset_s || 0 }) : { offset: row?.offset_s || 0, missing: true };
}

export function routes(r) {
  r.get('/api/lyrics/:id', async ({ params }) => lyricsFor(params.id));

  // Search every service that can search, for "these aren't right" and songs with nothing found.
  r.get('/api/lyrics/:id/search', async ({ params, query }) => {
    const t = await trackInfo(params.id);
    const term = String(query.q || `${t.artist} ${t.title}`).trim().slice(0, 200);
    const results = [];
    const errors = [];
    for (const p of (await providers()).filter((x) => x.enabled && (x.search || x.searchUrl))) {
      try { results.push(...await searchOne(p, term, t)); } catch (e) { errors.push(`${p.name}: ${e.message}`); }
    }
    // Closest length first, then time-synced before plain.
    results.sort((a, b) => (t.duration && a.duration && b.duration ? Math.abs(a.duration - t.duration) - Math.abs(b.duration - t.duration) : 0) || (b.synced ? 1 : 0) - (a.synced ? 1 : 0));
    return { query: term, duration: t.duration, results: results.slice(0, 24), errors };
  });

  // Use these lyrics for this song: a search result, or text someone pasted (LRC or plain).
  r.post('/api/lyrics/:id', async ({ params, req }) => {
    const t = await trackInfo(params.id);
    const b = await readJson(req);
    const text = String(b.synced || b.lrc || b.plain || '').slice(0, 200000);
    if (b.instrumental) { await store(t, { plain: '♪ Instrumental ♪', instrumental: true, source: String(b.source || 'Chosen by hand').slice(0, 80) }, { chosen: true }); return lyricsFor(t.id); }
    const got = shape(text);
    if (!got) throw new HttpError(400, 'Paste some lyrics first');
    await store(t, { ...got, source: String(b.source || 'Added by hand').slice(0, 80) }, { chosen: true });
    return lyricsFor(t.id);
  });
  // Lyrics a little early or late: shift them for this song (seconds; positive shows them later).
  r.put('/api/lyrics/:id/offset', async ({ params, req }) => {
    const t = await trackInfo(params.id);
    const offset = Math.max(-30, Math.min(30, Math.round((+(await readJson(req)).offset || 0) * 10) / 10));
    await q(`insert into lyrics (item_id, offset_s, missing, fetched_at) values ($1,$2,true, now() - interval '30 days')
             on conflict (item_id) do update set offset_s=excluded.offset_s`, [t.id, offset]);
    return { offset };
  });
  // Forget what was found or chosen, so the next play looks again.
  r.delete('/api/lyrics/:id', async ({ params }) => {
    const t = await trackInfo(params.id);
    await q('delete from lyrics where item_id=$1', [t.id]);
    return lyricsFor(t.id);
  });

  // ----- Studio
  const admin = { admin: true };
  r.get('/api/studio/lyrics', async () => {
    const counts = await q1(`select count(*) filter (where not missing and (synced is not null or plain is not null))::int as found,
      count(*) filter (where synced is not null)::int as synced, count(*) filter (where missing)::int as missing, count(*) filter (where chosen)::int as chosen from lyrics`);
    return { ...(await settings()), providers: await providers(), counts };
  }, admin);
  r.put('/api/studio/lyrics', async ({ req }) => {
    const b = await readJson(req);
    const list = (Array.isArray(b.providers) ? b.providers : []).slice(0, 30).map((p) => {
      const id = String(p.id || '');
      if (id.startsWith('custom:')) {
        const url = String(p.url || '').trim();
        if (!/^https?:\/\//i.test(url)) throw new HttpError(400, `“${p.name || 'A custom service'}” needs a web address starting with http:// or https://`);
        return { id, name: String(p.name || 'My lyrics service').slice(0, 60), enabled: p.enabled !== false, url, searchUrl: /^https?:\/\//i.test(p.searchUrl || '') ? String(p.searchUrl) : '',
          result: String(p.result || '').slice(0, 100), synced: String(p.synced || '').slice(0, 100), plain: String(p.plain || '').slice(0, 100),
          searchList: String(p.searchList || '').slice(0, 100), headers: cleanHeaders(p.headers) };
      }
      return { id, enabled: p.enabled !== false };
    });
    await setSetting('lyrics', { providers: list, autoFetch: b.autoFetch !== false, saveLrc: !!b.saveLrc });
    return { ok: true, providers: await providers() };
  }, admin);
  // Try every enabled service with one song, to check a new one is set up right.
  r.post('/api/studio/lyrics/test', async ({ req }) => {
    const b = await readJson(req);
    const t = { title: String(b.title || '').trim(), artist: String(b.artist || '').trim(), album: String(b.album || '').trim(), duration: +b.duration || 0 };
    if (!t.title || !t.artist) throw new HttpError(400, 'Give a song title and an artist');
    const out = [];
    for (const p of await providers()) {
      if (b.only && p.id !== b.only) continue;
      const started = Date.now();
      try {
        const got = await ask(p, t);
        out.push({ id: p.id, name: p.name, enabled: p.enabled, ms: Date.now() - started, found: !!got, synced: !!got?.synced, lines: got?.synced?.length || 0, preview: (got?.synced || []).slice(0, 4).map((l) => l.text).join(' / ') || String(got?.plain || '').slice(0, 160) });
      } catch (e) { out.push({ id: p.id, name: p.name, enabled: p.enabled, ms: Date.now() - started, found: false, error: e.message }); }
    }
    return { results: out };
  }, admin);
  r.delete('/api/studio/lyrics/cache', async ({ query }) => {
    if (query.missing === '1') await q('delete from lyrics where missing and offset_s = 0'); else await q('delete from lyrics where not chosen');
    return { ok: true };
  }, admin);
}
