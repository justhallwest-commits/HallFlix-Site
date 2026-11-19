// Import a CSV exported by the Jellyfin Bulk Metadata plugin (justhallwest-commits/jellyfin-bulk-metadata).
// Its rows carry Jellyfin's own ids, so each row is matched to a HallFlix title instead:
//   1. by file or folder path (the last two parts, so different mount points like /media vs /data still match),
//   2. by TMDb id (movies and shows),
//   3. by show name + season + episode number (seasons and episodes),
//   4. by title + year (+ type), when that is unique.
import { q } from './db.js';

/** Jellyfin's column names → HallFlix fields. Columns not listed (OriginalTitle, CriticRating, LockedFields…) are skipped. */
const COLS = {
  name: 'title', forcedsortname: 'sort_title', overview: 'overview', tagline: 'tagline', genres: 'genres', tags: 'tags', studios: 'studios',
  officialrating: 'rating', communityrating: 'score', productionyear: 'year', premieredate: 'premiered', 'providerids.tmdb': 'tmdb_id', authors: 'author',
};
/** Jellyfin item types → HallFlix kinds. */
const TYPES = {
  movie: ['movie'], series: ['show'], season: ['season'], episode: ['episode'], book: ['book'], audiobook: ['book'],
  musicalbum: ['album'], musicartist: ['artist'], audio: ['track'], video: ['movie', 'clip'], boxset: [],
};
const MARKERS = ['productionyear', 'officialrating', 'forcedsortname', 'providerids.tmdb', 'communityrating', 'productionlocations'];

/** A Jellyfin Bulk Metadata export: Jellyfin's column names, not HallFlix's. */
export function isJellyfin(head) {
  return head.includes('name') && head.includes('id') && MARKERS.some((m) => head.includes(m));
}

const norm = (s) => String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').trim();
const parts = (p) => String(p ?? '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase().split('/').filter(Boolean);
const tail = (p, n) => { const x = parts(p); return x.length >= n ? x.slice(-n).join('/') : null; };
/** The plugin guards spreadsheet formulas with a leading apostrophe ('=…); take it off again. */
const unguard = (v) => (/^'[=+@-]/.test(v) ? v.slice(1) : v);

/** Turn one Jellyfin cell into the text HallFlix's own CSV would have for that field. */
function value(field, raw) {
  const v = unguard(String(raw ?? '').trim());
  if (field === 'premiered') return v.slice(0, 10);
  if (field === 'author') return v.split('|').map((x) => x.trim()).filter(Boolean).join(', ');
  if (field === 'score' && v && Number(v) > 10) return String(Math.round(Number(v)) / 10); // a 0–100 score
  return v;
}

/**
 * Match every Jellyfin row to a HallFlix title. Returns rows as { id, values: {field: text} } plus a report.
 * `values` uses HallFlix field names and HallFlix CSV text, so the regular import planner can take it from there.
 */
export async function match(rows) {
  const head = rows[0].map((h) => h.trim().toLowerCase());
  const at = (k) => head.indexOf(k);
  const cols = head.map((h, i) => ({ field: COLS[h], i })).filter((c) => c.field);
  const all = await q(`select i.id, i.kind, i.path, i.tmdb_id, i.title, i.year, i.show_id, i.parent_id, i.season_no, i.episode_no from items i`);

  // Indexes
  const add = (map, key, it) => { if (!key) return; const l = map.get(key); if (l) l.push(it); else map.set(key, [it]); };
  const path2 = new Map(), path1 = new Map(), tmdb = new Map(), title = new Map(), shows = new Map(), eps = new Map();
  for (const it of all) {
    add(path2, tail(it.path, 2), it); add(path1, tail(it.path, 1), it);
    if (it.tmdb_id && (it.kind === 'movie' || it.kind === 'show')) add(tmdb, `${it.kind}:${it.tmdb_id}`, it);
    add(title, `${it.kind}:${norm(it.title)}`, it);
    if (it.kind === 'show') add(shows, norm(it.title), it);
    if (it.kind === 'episode' || it.kind === 'season') add(eps, `${it.kind}:${it.show_id}:${it.season_no ?? ''}:${it.kind === 'episode' ? it.episode_no ?? '' : ''}`, it);
  }
  const one = (list, kinds) => { const l = (list || []).filter((x) => !kinds?.length || kinds.includes(x.kind)); return l.length === 1 ? l[0] : null; };

  const out = new Map(), by = { path: 0, tmdb: 0, episode: 0, title: 0 }, missed = [];
  const iType = at('type'), iPath = at('path'), iName = at('name'), iSeries = at('seriesname'), iSeason = at('season'), iEp = at('episode'), iYear = at('productionyear'), iTmdb = at('providerids.tmdb');
  for (const r of rows.slice(1)) {
    const get = (i) => (i >= 0 ? unguard(String(r[i] ?? '').trim()) : '');
    const type = get(iType).toLowerCase().replace(/\s+/g, '');
    const kinds = TYPES[type] ?? [];
    if (type && !kinds.length) continue; // collections and other things HallFlix doesn't have
    let it = null, how = '';
    // 1. Path
    const p = get(iPath);
    if (p) { it = one(path2.get(tail(p, 2)), kinds) || (parts(p).length && /\.[a-z0-9]{2,4}$/.test(p) ? one(path1.get(tail(p, 1)), kinds) : null); if (it) how = 'path'; }
    // 2. TMDb
    if (!it && get(iTmdb)) { for (const k of kinds.filter((x) => x === 'movie' || x === 'show')) { it = one(tmdb.get(`${k}:${parseInt(get(iTmdb), 10)}`)); if (it) break; } if (it) how = 'tmdb'; }
    // 3. Show + season + episode
    if (!it && (kinds.includes('episode') || kinds.includes('season')) && get(iSeries)) {
      const show = one(shows.get(norm(get(iSeries))));
      const sn = get(iSeason) === '' ? '' : parseInt(get(iSeason), 10), en = get(iEp) === '' ? '' : parseInt(get(iEp), 10);
      if (show) it = one(eps.get(kinds.includes('episode') ? `episode:${show.id}:${sn}:${en}` : `season:${show.id}:${sn}:`));
      if (it) how = 'episode';
    }
    // 4. Title + year
    if (!it && get(iName)) {
      const cands = kinds.flatMap((k) => title.get(`${k}:${norm(get(iName))}`) || []);
      const y = parseInt(get(iYear), 10);
      it = one(Number.isFinite(y) ? cands.filter((x) => x.year === y) : cands) || (Number.isFinite(y) ? null : one(cands));
      if (it) how = 'title';
    }
    if (!it) { if (missed.length < 200) missed.push({ name: get(iName) || '(no name)', type: get(iType), series: get(iSeries), season: get(iSeason), episode: get(iEp), path: p }); else missed.push(null); continue; }
    by[how]++;
    out.set(it.id, { id: it.id, values: Object.fromEntries(cols.map((c) => [c.field, value(c.field, r[c.i])])) });
  }
  return { rows: [...out.values()], matched: by, unmatched: missed.length, missed: missed.filter(Boolean).slice(0, 200), total: rows.length - 1 };
}
