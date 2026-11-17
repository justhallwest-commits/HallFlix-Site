// Subtitles from subtitle services, for titles that have none in your language (or the wrong ones).
// OpenSubtitles.com and SubDL are built in (each needs a free key). Any JSON subtitle API can be added in the Studio,
// and plugins can declare services too. Anyone watching can search and pick; what's picked becomes a track for
// everyone, kept in HallFlix's data folder or, if the Studio allows it, saved next to the video as an .srt file.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { cfg } from './config.js';
import { q, q1, getSetting, setSetting } from './db.js';
import { HttpError, readJson } from './http.js';
import { listPlugins, unzip } from './plugins.js';
import * as tmdb from './tmdb.js';
import { dig, fill, cleanHeaders, getJson, getBytes, hideSecrets, keepSecret, ServiceError } from './services.js';

export const LANGS = [['en', 'English'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'], ['it', 'Italian'], ['pt', 'Portuguese'], ['pt-br', 'Portuguese (Brazil)'],
  ['nl', 'Dutch'], ['sv', 'Swedish'], ['no', 'Norwegian'], ['da', 'Danish'], ['fi', 'Finnish'], ['pl', 'Polish'], ['cs', 'Czech'], ['hu', 'Hungarian'], ['ro', 'Romanian'],
  ['el', 'Greek'], ['ru', 'Russian'], ['uk', 'Ukrainian'], ['tr', 'Turkish'], ['ar', 'Arabic'], ['he', 'Hebrew'], ['fa', 'Persian'], ['hi', 'Hindi'],
  ['ja', 'Japanese'], ['ko', 'Korean'], ['zh-cn', 'Chinese (simplified)'], ['zh-tw', 'Chinese (traditional)'], ['vi', 'Vietnamese'], ['th', 'Thai'], ['id', 'Indonesian'], ['ms', 'Malay']];
const LANG_NAME = Object.fromEntries(LANGS);
// Three-letter codes (from video files) to the two-letter ones services use.
const TO2 = { eng: 'en', spa: 'es', fre: 'fr', fra: 'fr', ger: 'de', deu: 'de', ita: 'it', por: 'pt', dut: 'nl', nld: 'nl', swe: 'sv', nor: 'no', nob: 'no', dan: 'da', fin: 'fi',
  pol: 'pl', cze: 'cs', ces: 'cs', hun: 'hu', rum: 'ro', ron: 'ro', gre: 'el', ell: 'el', rus: 'ru', ukr: 'uk', tur: 'tr', ara: 'ar', heb: 'he', per: 'fa', fas: 'fa', hin: 'hi',
  jpn: 'ja', kor: 'ko', chi: 'zh', zho: 'zh', vie: 'vi', tha: 'th', ind: 'id', may: 'ms', msa: 'ms' };
export const lang2 = (l) => { const s = String(l || '').toLowerCase().replace('_', '-'); return TO2[s] || s; };
export const langName = (l) => LANG_NAME[lang2(l)] || LANG_NAME[lang2(l).split('-')[0]] || (l ? String(l).toUpperCase() : 'Unknown');
const sameLang = (a, b) => { const x = lang2(a), y = lang2(b); return !!x && !!y && (x === y || x.split('-')[0] === y.split('-')[0]); };
// SubDL's own language codes.
const SUBDL = { 'pt-br': 'BR_PT', 'zh-cn': 'ZH', 'zh-tw': 'ZH_BG' };
const subdlCode = (l) => SUBDL[l] || l.toUpperCase();
const fromSubdl = (s) => { const v = String(s || '').toLowerCase(); return Object.keys(SUBDL).find((k) => SUBDL[k].toLowerCase() === v) || ({ english: 'en', spanish: 'es', french: 'fr', german: 'de' }[v]) || v; };

const TEXT_EXT = /\.(srt|vtt|ass|ssa)$/i;

// ---------- services ----------
const BUILTIN = [
  { id: 'opensubtitles', name: 'OpenSubtitles', kind: 'builtin', needsKey: true, login: true, keyUrl: 'https://www.opensubtitles.com/consumers',
    description: 'The largest subtitle library. Make a free API consumer on opensubtitles.com for a key; adding your account name and password raises the daily download limit.' },
  { id: 'subdl', name: 'SubDL', kind: 'builtin', needsKey: true, keyUrl: 'https://subdl.com/panel/api',
    description: 'A large, fast-growing library that often has releases OpenSubtitles doesn’t. Free key from your SubDL account.' },
];

export async function providers() {
  const saved = await getSetting('subtitles', {});
  const list = Array.isArray(saved.providers) ? saved.providers : [];
  const fromPlugins = [];
  for (const pl of await listPlugins()) {
    if (!pl.enabled || pl.broken) continue;
    for (const x of pl.subtitles || []) fromPlugins.push({ ...x, id: `plugin:${pl.id}:${x.key}`, kind: 'plugin', plugin: pl.name });
  }
  const known = new Map([...BUILTIN, ...fromPlugins].map((p) => [p.id, p]));
  const out = [], seen = new Set();
  for (const s of list) {
    if (!s || seen.has(s.id)) continue;
    if (known.has(s.id)) out.push({ ...known.get(s.id), enabled: s.enabled !== false, apiKey: s.apiKey || '', username: s.username || '', password: s.password || '' });
    else if (String(s.id).startsWith('custom:') && s.url) out.push({ ...s, kind: 'custom', enabled: s.enabled !== false });
    else continue;
    seen.add(s.id);
  }
  for (const p of known.values()) if (!seen.has(p.id)) out.push({ ...p, enabled: true, apiKey: '', username: '', password: '' });
  return out;
}
const ready = (p) => p.enabled && (!p.needsKey || p.apiKey);

export async function settings() {
  const s = await getSetting('subtitles', {});
  const languages = (Array.isArray(s.languages) && s.languages.length ? s.languages : ['en']).map(lang2).filter((l) => LANG_NAME[l]).slice(0, 6);
  return { languages: languages.length ? languages : ['en'], autoFetch: !!s.autoFetch, saveBeside: !!s.saveBeside, hi: ['prefer', 'avoid'].includes(s.hi) ? s.hi : 'either' };
}

export async function clientSettings() {
  const s = await settings();
  return { search: (await providers()).some(ready), languages: s.languages, autoFetch: s.autoFetch };
}

/** What a search needs to know about the video: ids, season and episode, the file name for matching releases. */
async function videoFor(id) {
  const v = await q1(`select i.id, i.kind, i.title, i.year, i.tmdb_id, i.path, i.size, i.season_no, i.episode_no, i.streams,
      s.title as show_title, s.year as show_year, s.tmdb_id as show_tmdb
    from items i left join items s on s.id = i.show_id where i.id=$1`, [id]);
  if (!v?.path || !['movie', 'episode'].includes(v.kind)) throw new HttpError(404, 'Subtitles are for movies and episodes');
  const ep = v.kind === 'episode';
  return { ...v, ep, type: ep ? 'tv' : 'movie', name: ep ? v.show_title : v.title, yr: ep ? v.show_year : v.year, tmdb: ep ? v.show_tmdb : v.tmdb_id, file: path.basename(v.path) };
}
async function imdbFor(v) {
  if (v.imdb !== undefined) return v.imdb;
  v.imdb = (await q1(`select imdb_id from ratings r join items i on i.id = r.item_id where i.tmdb_id=$1 and i.kind=$2 limit 1`, [v.tmdb, v.ep ? 'show' : 'movie']).catch(() => null))?.imdb_id || null;
  if (!v.imdb && v.tmdb) { try { v.imdb = (await tmdb.call(`/${v.type}/${v.tmdb}/external_ids`))?.imdb_id || null; } catch { /* no TMDb */ } }
  return v.imdb;
}

// Words in a release name ("The.Long.Signal.2021.1080p.BluRay.x264-GRP") for telling which subtitles fit this file.
const words = (s) => new Set(String(s || '').toLowerCase().replace(/\.(mkv|mp4|avi|m4v|srt|ass|vtt|zip)$/i, '').split(/[^a-z0-9]+/).filter((w) => w.length > 1 && !/^(the|and|of|a|en|eng)$/.test(w)));
const TAGS = /^(2160p|1080p|720p|480p|bluray|bdrip|brrip|webrip|web|webdl|dl|hdtv|dvdrip|remux|x264|x265|h264|h265|hevc|hdr|dv|amzn|nf|dsnp|hmax|atvp|proper|repack|extended)$/;
function fits(release, file) {
  const a = words(release), b = words(file);
  const group = [...b].pop();
  let tags = 0;
  for (const w of a) if (b.has(w) && TAGS.test(w)) tags++;
  return tags >= 2 || (group && a.has(group) && !TAGS.test(group) && tags >= 1);
}

const tokens = new Map(); // a search result's token -> what to download, so the browser never sends an address to fetch
const remember = (x) => { const t = crypto.randomBytes(9).toString('base64url'); tokens.set(t, { ...x, at: Date.now() }); if (tokens.size > 3000) for (const [k, v] of tokens) if (Date.now() - v.at > 3600e3) tokens.delete(k); return t; };

const osLogin = new Map(); // OpenSubtitles sign-in tokens, kept for a while
async function osHeaders(p, needAuth) {
  const h = { 'Api-Key': p.apiKey };
  if (needAuth && p.username && p.password) {
    const key = `${p.username}:${p.apiKey}`;
    let got = osLogin.get(key);
    if (!got || Date.now() - got.at > 12 * 3600e3) {
      const d = await getJson(`${cfg.opensubsBase.replace(/\/$/, '')}/login`, { method: 'POST', headers: h, body: { username: p.username, password: p.password } });
      if (!d?.token) throw new ServiceError('OpenSubtitles did not accept the account name and password');
      got = { token: d.token, at: Date.now() };
      osLogin.set(key, got);
    }
    h.Authorization = `Bearer ${got.token}`;
  }
  return h;
}

async function search(p, v, langs, term) {
  if (p.id === 'opensubtitles') {
    const qs = new URLSearchParams({ languages: langs.join(','), order_by: 'download_count' });
    if (term) { qs.set('query', term); if (v.ep) { qs.set('season_number', v.season_no); qs.set('episode_number', v.episode_no); } }
    else if (v.ep && v.tmdb) { qs.set('parent_tmdb_id', v.tmdb); qs.set('season_number', v.season_no); qs.set('episode_number', v.episode_no); }
    else if (v.tmdb) qs.set('tmdb_id', v.tmdb);
    else { qs.set('query', v.name); if (v.yr) qs.set('year', v.yr); if (v.ep) { qs.set('season_number', v.season_no); qs.set('episode_number', v.episode_no); } }
    const d = await getJson(`${cfg.opensubsBase.replace(/\/$/, '')}/subtitles?${qs}`, { headers: await osHeaders(p, false) });
    return (d?.data || []).flatMap((x) => {
      const a = x.attributes || {}, f = (a.files || [])[0];
      if (!f?.file_id) return [];
      return [{ provider: p.name, lang: lang2(a.language), release: a.release || f.file_name || '', hi: !!a.hearing_impaired, downloads: a.download_count || 0,
        ai: !!(a.ai_translated || a.machine_translated), ref: { p: p.id, fileId: f.file_id } }];
    });
  }
  if (p.id === 'subdl') {
    const qs = new URLSearchParams({ api_key: p.apiKey, languages: langs.map(subdlCode).join(','), subs_per_page: '30', type: v.type });
    if (!term && v.tmdb) qs.set('tmdb_id', v.tmdb); else qs.set('film_name', term || v.name);
    if (!term && !v.tmdb && v.yr) qs.set('year', v.yr);
    if (v.ep) { qs.set('season_number', v.season_no); qs.set('episode_number', v.episode_no); }
    const d = await getJson(`${cfg.subdlBase.replace(/\/$/, '')}/subtitles?${qs}`);
    if (d && d.status === false) { if (/key/i.test(d.error || '')) throw new ServiceError(d.error); return []; }
    return (d?.subtitles || []).filter((x) => x.url && (!v.ep || x.full_season || x.episode == null || +x.episode === +v.episode_no)).map((x) => ({
      provider: p.name, lang: fromSubdl(x.lang || x.language), release: x.release_name || x.name || '', hi: !!x.hi, downloads: 0, ai: false, ref: { p: p.id, url: x.url } }));
  }
  if (!p.url) return [];
  const need = (k) => p.url.includes(`{${k}}`);
  if (need('imdb')) await imdbFor(v);
  if ((need('imdb') && !v.imdb) || (need('tmdb') && !v.tmdb)) return [];
  const vals = { tmdb: v.tmdb || '', imdb: v.imdb || '', type: v.type, kind: v.ep ? 'episode' : 'movie', title: v.name, year: v.yr || '', season: v.season_no ?? '', episode: v.episode_no ?? '',
    lang: langs.join(','), query: term || v.name, file: v.file, key: p.apiKey || '' };
  const d = await getJson(fill(p.url, vals), { headers: cleanHeaders(p.headers) });
  const list = dig(d, p.list || '');
  return (Array.isArray(list) ? list : []).slice(0, 40).flatMap((x) => {
    const url = String(dig(x, p.download || 'url') || '');
    if (!/^https?:\/\//i.test(url)) return [];
    return [{ provider: p.name, lang: lang2(dig(x, p.language || 'language') || langs[0]), release: String(dig(x, p.release || 'release') || ''), hi: !!dig(x, p.hi || 'hi'),
      downloads: +dig(x, p.downloads || 'downloads') || 0, ai: false, ref: { p: p.id, url } }];
  });
}

/** Search every ready service; best matches first (your languages in order, a release that fits the file, most downloaded). */
async function searchAll(v, { langs, term, only } = {}) {
  const s = await settings();
  const want = (langs?.length ? langs : s.languages).map(lang2).filter((l) => LANG_NAME[l]);
  const results = [], errors = [];
  await Promise.all((await providers()).filter((p) => ready(p) && (!only || p.id === only)).map(async (p) => {
    try { results.push(...await search(p, v, want, term)); } catch (e) { errors.push(`${p.name}: ${e.message}`); }
  }));
  const rank = (x) => { const i = want.findIndex((l) => sameLang(l, x.lang)); return i < 0 ? 99 : i; };
  for (const x of results) x.fits = fits(x.release, v.file);
  const hiScore = (x) => (s.hi === 'prefer' ? (x.hi ? 0 : 1) : s.hi === 'avoid' ? (x.hi ? 1 : 0) : 0);
  results.sort((a, b) => rank(a) - rank(b) || (b.fits ? 1 : 0) - (a.fits ? 1 : 0) || hiScore(a) - hiScore(b) || (a.ai ? 1 : 0) - (b.ai ? 1 : 0) || b.downloads - a.downloads);
  return { results: results.filter((x) => rank(x) < 99).slice(0, 60), errors, languages: want };
}

// ---------- downloading ----------
/** Subtitle text from bytes in whatever encoding they came in. */
export function decode(buf) {
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.subarray(3).toString('utf8');
  if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf.subarray(2));
  if (buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder('utf-16be').decode(buf.subarray(2));
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { return new TextDecoder('windows-1252').decode(buf); }
}
/** From a zip (or a single file), the subtitle that fits this video best. */
export function pickFile(buf, v) {
  if (buf.readUInt32LE?.(0) !== 0x04034b50) return { name: 'subtitle.srt', data: buf };
  const files = unzip(buf).filter((f) => TEXT_EXT.test(f.name) && !f.name.startsWith('__MACOSX/'));
  if (!files.length) throw new ServiceError('The download had no subtitle file in it');
  if (v?.ep) {
    const se = new RegExp(`s0*${v.season_no}[ ._-]*e0*${v.episode_no}(?!\\d)|\\b${v.season_no}x0*${v.episode_no}(?!\\d)`, 'i');
    const hit = files.filter((f) => se.test(path.basename(f.name)));
    if (hit.length) return hit.sort((a, b) => (/\.srt$/i.test(b.name) ? 1 : 0) - (/\.srt$/i.test(a.name) ? 1 : 0))[0];
    if (files.length > 1) throw new ServiceError('That download is a whole season and none of its files is marked with this episode');
  }
  return files.sort((a, b) => (/\.srt$/i.test(b.name) ? 1 : 0) - (/\.srt$/i.test(a.name) ? 1 : 0) || b.data.length - a.data.length)[0];
}

async function fetchFile(ref, v) {
  const p = (await providers()).find((x) => x.id === ref.p);
  if (!p || !ready(p)) throw new HttpError(400, 'That subtitle service is switched off');
  if (p.id === 'opensubtitles') {
    const d = await getJson(`${cfg.opensubsBase.replace(/\/$/, '')}/download`, { method: 'POST', headers: await osHeaders(p, true), body: { file_id: ref.fileId } });
    if (!d?.link) throw new ServiceError(d?.message || 'OpenSubtitles did not give a download (the daily limit may be used up)');
    return { ...pickFile(await getBytes(d.link), v), provider: p.name };
  }
  if (p.id === 'subdl') return { ...pickFile(await getBytes(cfg.subdlFiles.replace(/\/$/, '') + (ref.url.startsWith('/') ? ref.url : `/${ref.url}`)), v), provider: p.name };
  return { ...pickFile(await getBytes(ref.url, { headers: cleanHeaders(p.headers) }), v), provider: p.name };
}

/** Keep a chosen subtitle: next to the video if allowed, otherwise in HallFlix's data folder. Returns the new track. */
async function keep(v, got, { lang, hi, release }) {
  const text = decode(got.data).replace(/\r\n?/g, '\n');
  if (!/-->|Dialogue:/.test(text)) throw new ServiceError('That file does not look like subtitles');
  const ext = (path.extname(got.name).toLowerCase().match(TEXT_EXT) ? path.extname(got.name).toLowerCase() : '.srt');
  const l = lang2(lang) || 'und';
  const s = await settings();
  if (s.saveBeside) {
    const stem = v.path.slice(0, -path.extname(v.path).length);
    for (let n = 1; n < 20; n++) {
      const file = `${stem}.${l}${hi ? '.sdh' : ''}${n > 1 ? `.${n}` : ''}${ext}`;
      try { await fs.promises.writeFile(file, text, { flag: 'wx' }); return { beside: true, file: path.basename(file) }; }
      catch (e) { if (e.code !== 'EEXIST') break; } // read-only media folder: keep it in HallFlix instead
    }
  }
  const dir = path.join(cfg.dataDir, 'subtitles', String(v.id));
  await fs.promises.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${Date.now().toString(36)}-${l}${ext}`);
  await fs.promises.writeFile(file, text);
  const label = `${langName(l)}${hi ? ' (SDH)' : ''} · ${got.provider}`;
  const row = await q1('insert into subtitles (item_id, lang, label, provider, file, hi) values ($1,$2,$3,$4,$5,$6) returning id', [v.id, l, label, got.provider, file, !!hi]);
  void release;
  return { id: `d${row.id}`, label, lang: l, url: `/api/subs/${v.id}/d${row.id}` };
}

/** The tracks downloaded for a video (playback lists them with the file's own). */
export async function downloaded(itemId) {
  return (await q('select id, lang, label from subtitles where item_id=$1 order by id', [itemId])).map((r) => ({ id: `d${r.id}`, label: r.label, lang: r.lang, url: `/api/subs/${itemId}/d${r.id}`, removable: true }));
}
export async function downloadedFile(itemId, n) { return (await q1('select file from subtitles where item_id=$1 and id=$2', [itemId, n]))?.file || null; }

/** Does the video already have subtitles in this language (in the file, beside it, or downloaded)? */
async function hasLang(v, l) {
  if ((v.streams || []).some((s) => s.type === 'sub' && s.text && sameLang(s.lang, l))) return true;
  const base = path.basename(v.path, path.extname(v.path));
  let entries = [];
  try { entries = await fs.promises.readdir(path.dirname(v.path)); } catch { /* unreadable */ }
  if (entries.some((e) => e.startsWith(base + '.') && TEXT_EXT.test(e) && e.slice(base.length + 1).split('.').some((part) => sameLang(part, l)))) return true;
  return (await downloaded(v.id)).some((t) => sameLang(t.lang, l));
}

const autoTried = new Map();
export function routes(r) {
  r.get('/api/subtitles/:id/search', async ({ params, query }) => {
    const v = await videoFor(params.id);
    const langs = String(query.lang || '').split(',').map((x) => x.trim()).filter(Boolean);
    const out = await searchAll(v, { langs, term: String(query.q || '').trim().slice(0, 120) || null });
    return { ...out, results: out.results.map(({ ref, ...x }) => ({ ...x, langName: langName(x.lang), token: remember({ ref, item: v.id, lang: x.lang, hi: x.hi, release: x.release }) })) };
  });
  r.post('/api/subtitles/:id/download', async ({ params, req }) => {
    const v = await videoFor(params.id);
    const t = tokens.get(String((await readJson(req)).token || ''));
    if (!t || t.item !== v.id) throw new HttpError(400, 'Search again: that result has expired');
    try { return { track: await keep(v, await fetchFile(t.ref, v), t) }; }
    catch (e) { if (e instanceof ServiceError) throw new HttpError(502, e.message); throw e; }
  });
  // The player asks this when a video has nothing in the first language you picked, if the Studio turned it on.
  r.post('/api/subtitles/:id/auto', async ({ params }) => {
    const s = await settings();
    if (!s.autoFetch) return { track: null };
    const v = await videoFor(params.id);
    const l = s.languages[0];
    if (await hasLang(v, l)) return { track: null, have: true };
    if (Date.now() - (autoTried.get(v.id) || 0) < 6 * 3600e3) return { track: null };
    autoTried.set(v.id, Date.now());
    const { results } = await searchAll(v, { langs: [l] });
    for (const x of results.filter((y) => !y.ai).slice(0, 3)) {
      try { return { track: await keep(v, await fetchFile(x.ref, v), x) }; } catch (e) { console.log('[subtitles] auto', v.title, e.message); }
    }
    return { track: null };
  });
  r.delete('/api/subtitles/:id/:track', async ({ params, profile }) => {
    if (!profile.is_admin) throw new HttpError(403, 'Only an admin can remove subtitles');
    const m = /^d(\d+)$/.exec(params.track);
    const row = m && await q1('delete from subtitles where item_id=$1 and id=$2 returning file', [params.id, m[1]]);
    if (!row) throw new HttpError(404, 'Not found');
    fs.promises.rm(row.file, { force: true }).catch(() => {});
    return { ok: true };
  });

  // ----- Studio
  const admin = { admin: true };
  r.get('/api/studio/subtitles', async () => {
    const counts = await q1('select count(*)::int as downloaded, count(distinct item_id)::int as titles from subtitles');
    return { ...(await settings()), providers: (await providers()).map(hideSecrets), langs: LANGS, counts };
  }, admin);
  r.put('/api/studio/subtitles', async ({ req }) => {
    const b = await readJson(req);
    const before = new Map((await providers()).map((p) => [p.id, p]));
    const list = (Array.isArray(b.providers) ? b.providers : []).slice(0, 30).map((p) => {
      const id = String(p.id || '');
      const apiKey = keepSecret(p, before.get(id), 'apiKey');
      if (id.startsWith('custom:')) {
        const url = String(p.url || '').trim();
        if (!/^https?:\/\//i.test(url)) throw new HttpError(400, `“${p.name || 'A custom service'}” needs a web address starting with http:// or https://`);
        return { id, name: String(p.name || 'My subtitle service').slice(0, 60), enabled: p.enabled !== false, url, apiKey, headers: cleanHeaders(p.headers),
          ...Object.fromEntries(['list', 'language', 'release', 'download', 'hi', 'downloads'].map((k) => [k, String(p[k] ?? '').slice(0, 100)])) };
      }
      return { id, enabled: p.enabled !== false, apiKey, username: String(p.username || '').trim().slice(0, 100), password: keepSecret(p, before.get(id), 'password') };
    });
    const languages = (Array.isArray(b.languages) ? b.languages : []).map(lang2).filter((l) => LANG_NAME[l]).slice(0, 6);
    await setSetting('subtitles', { providers: list, languages: languages.length ? languages : ['en'], autoFetch: !!b.autoFetch, saveBeside: !!b.saveBeside, hi: ['prefer', 'avoid'].includes(b.hi) ? b.hi : 'either' });
    osLogin.clear();
    return { ok: true, ...(await settings()), providers: (await providers()).map(hideSecrets) };
  }, admin);
  // Search with each service for one video, to check keys and new services.
  r.post('/api/studio/subtitles/test', async ({ req }) => {
    const b = await readJson(req);
    let v;
    if (b.itemId) v = await videoFor(b.itemId);
    else {
      const any = await q1(`select id from items where kind in ('movie','episode') and path is not null order by (tmdb_id is null), added_at desc limit 1`);
      if (!any) throw new HttpError(400, 'Add a movie or show library first');
      v = await videoFor(any.id);
    }
    const out = [];
    for (const p of await providers()) {
      if (b.only && p.id !== b.only) continue;
      const started = Date.now();
      if (!ready(p)) { out.push({ id: p.id, name: p.name, enabled: p.enabled, found: 0, error: p.enabled ? 'No key yet' : 'Switched off' }); continue; }
      try {
        const got = await search(p, v, (await settings()).languages, null);
        out.push({ id: p.id, name: p.name, enabled: p.enabled, ms: Date.now() - started, found: got.length, sample: got.slice(0, 3).map((x) => `${langName(x.lang)} · ${x.release}`) });
      } catch (e) { out.push({ id: p.id, name: p.name, enabled: p.enabled, ms: Date.now() - started, found: 0, error: e.message }); }
    }
    return { title: v.ep ? `${v.name} S${v.season_no}E${v.episode_no}` : v.name, results: out };
  }, admin);
}
