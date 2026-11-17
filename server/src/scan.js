// Library scanner: walks folders, probes files, and fills in details from TMDb.
import fs from 'node:fs';
import path from 'node:path';
import { q, q1 } from './db.js';
import { probe } from './probe.js';
import * as names from './names.js';
import * as tmdb from './tmdb.js';
import { scanBooks, scanComics, scanMusic } from './shelf.js';

export const status = { running: false, library: null, phase: '', done: 0, total: 0, errors: [], finishedAt: null };
const queue = [];

export function startScan(libraryId) {
  if (!queue.includes(libraryId) && status.libraryId !== libraryId) queue.push(libraryId);
  if (!status.running) drain();
}
export async function scanAll() {
  for (const l of await q('select id from libraries order by position, id')) startScan(l.id);
}
async function drain() {
  status.running = true;
  status.errors = [];
  while (queue.length) {
    const id = queue.shift();
    const lib = await q1('select * from libraries where id=$1', [id]);
    if (!lib) continue;
    Object.assign(status, { library: lib.name, libraryId: id, phase: 'Reading folders', done: 0, total: 0 });
    try {
      if (lib.kind === 'movies') await scanMovies(lib);
      else if (lib.kind === 'shows') await scanShows(lib);
      else if (lib.kind === 'books') await scanBooks(lib);
      else if (lib.kind === 'comics') await scanComics(lib);
      else if (lib.kind === 'music') await scanMusic(lib);
      else await scanClips(lib);
    } catch (e) {
      console.error('[scan]', e);
      status.errors.push(String(e.message || e));
    }
  }
  Object.assign(status, { running: false, libraryId: null, phase: '', finishedAt: new Date().toISOString() });
}
export const idle = () => new Promise((resolve) => { const t = setInterval(() => { if (!status.running) { clearInterval(t); resolve(); } }, 50); });

async function walk(dir, out = []) {
  let entries;
  try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { if (!names.skipDir(e.name)) await walk(full, out); }
    else if (names.isVideo(e.name) && !names.skipFile(e.name)) {
      try { const st = await fs.promises.stat(full); out.push({ path: full, size: st.size, mtime: Math.floor(st.mtimeMs) }); } catch { /* vanished */ }
    }
  }
  return out;
}

/** Paths an admin hid. A hidden folder hides everything inside it. */
export async function hiddenFor(lib) {
  const set = new Set((await q('select path from hidden where library_id=$1', [lib.id])).map((r) => r.path));
  return (p) => { if (!set.size) return false; for (let x = p; ; x = path.dirname(x)) { if (set.has(x)) return true; if (x === path.dirname(x) || x === lib.path) return false; } };
}

export async function pool(list, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, list.length) }, async () => {
    while (i < list.length) {
      const item = list[i++];
      try { await fn(item); } catch (e) { if (status.errors.length < 50) status.errors.push(`${path.basename(item.path || item.title || '')}: ${e.message}`); }
      status.done++;
    }
  }));
}

/** Artwork sitting beside the media: poster.jpg, fanart.jpg, logo.png, "<file>-poster.jpg"… */
async function localArt(dir, base) {
  const found = {};
  let entries;
  try { entries = await fs.promises.readdir(dir); } catch { return found; }
  const lower = new Map(entries.map((e) => [e.toLowerCase(), e]));
  const pick = (stems) => {
    for (const s of stems) for (const x of names.IMAGE_EXT) {
      const hit = lower.get(`${s}.${x}`.toLowerCase());
      if (hit) return `local:${path.join(dir, hit)}`;
    }
    return null;
  };
  const b = base ? [`${base}-poster`, `${base}-fanart`, `${base}-logo`] : [null, null, null];
  found.poster = pick([b[0], 'poster', 'folder', 'cover'].filter(Boolean));
  found.backdrop = pick([b[1], 'fanart', 'backdrop', 'background'].filter(Boolean));
  found.logo = pick([b[2], 'logo', 'clearlogo'].filter(Boolean));
  return found;
}

const media = (p) => [p.container, JSON.stringify(p.streams), p.bitrate || null, p.duration || null];

/** Apply TMDb (or other) fields to an item, leaving anything the admin locked by hand. */
async function applyMeta(id, meta, extra = {}) {
  const row = await q1('select locked, poster, backdrop, logo from items where id=$1', [id]);
  if (!row) return;
  const fields = { ...meta, ...extra };
  delete fields.seasons;
  for (const k of ['poster', 'backdrop', 'logo']) if (String(row[k] || '').startsWith('local:') || String(row[k] || '').startsWith('/uploads/')) delete fields[k];
  const sets = [], vals = [];
  for (const [k, v] of Object.entries(fields)) {
    if (row.locked?.[k] || v === undefined) continue;
    vals.push(k === 'people' ? JSON.stringify(v) : v);
    sets.push(`${k}=$${vals.length}${k === 'people' ? '::jsonb' : ''}`);
  }
  if (fields.title && !row.locked?.title) { vals.push(names.sortTitle(fields.title)); sets.push(`sort_title=$${vals.length}`); }
  if (!sets.length) return;
  vals.push(id);
  await q(`update items set ${sets.join(', ')} where id=$${vals.length}`, vals);
}

async function scanMovies(lib) {
  const isHidden = await hiddenFor(lib);
  const all = await walk(lib.path);
  const files = all.filter((f) => !isHidden(f.path));
  const existing = new Map((await q(`select id, path, size, mtime, matched from items where library_id=$1 and kind='movie'`, [lib.id])).map((r) => [r.path, r]));
  const present = new Set(files.map((f) => f.path));
  const gone = [...existing.values()].filter((r) => !present.has(r.path)).map((r) => r.id);
  if (gone.length && (all.length || !(await rootMissing(lib.path)))) await q('delete from items where id = any($1)', [gone]);
  const hasKey = !!(await tmdb.tmdbKey());
  const todo = files.filter((f) => { const e = existing.get(f.path); return !e || e.size !== f.size || e.mtime !== f.mtime || (hasKey && !e.matched); });
  Object.assign(status, { phase: 'Adding movies', total: todo.length, done: 0 });
  await pool(todo, 4, async (f) => {
    const e = existing.get(f.path);
    let id = e?.id;
    const parsed = names.parseMovie(f.path, lib.path);
    if (!e || e.size !== f.size || e.mtime !== f.mtime) {
      const p = await probe(f.path);
      const art = await localArt(path.dirname(f.path), path.dirname(f.path) === lib.path ? path.basename(f.path, path.extname(f.path)) : null);
      const row = await q1(
        `insert into items (library_id, kind, title, sort_title, year, path, size, mtime, container, streams, bitrate, runtime_s, poster, backdrop, logo)
         values ($1,'movie',$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14)
         on conflict (path) do update set size=excluded.size, mtime=excluded.mtime, container=excluded.container,
           streams=excluded.streams, bitrate=excluded.bitrate, runtime_s=excluded.runtime_s
         returning id, matched`,
        [lib.id, parsed.title, names.sortTitle(parsed.title), parsed.year, f.path, f.size, f.mtime, ...media(p), art.poster, art.backdrop, art.logo]);
      id = row.id;
      if (row.matched) return;
    }
    if (hasKey) {
      const meta = await tmdb.matchMovie(parsed);
      if (meta) await applyMeta(id, meta, { matched: true });
    }
  });
}

// A library folder that is missing or unreadable (NAS volume not mounted) must not wipe the library.
export async function rootMissing(dir) {
  try { await fs.promises.readdir(dir); return false; } catch { return true; }
}

async function scanShows(lib) {
  if (await rootMissing(lib.path)) throw new Error(`Folder not found: ${lib.path}`);
  const dirs = (await fs.promises.readdir(lib.path, { withFileTypes: true })).filter((d) => d.isDirectory() && !names.skipDir(d.name));
  const hasKey = !!(await tmdb.tmdbKey());
  const existingShows = new Map((await q(`select id, path, matched, tmdb_id from items where library_id=$1 and kind='show'`, [lib.id])).map((r) => [r.path, r]));
  const seenShows = new Set();
  const isHidden = await hiddenFor(lib);
  Object.assign(status, { phase: 'Adding shows', total: dirs.length, done: 0 });
  for (const d of dirs) {
    const showPath = path.join(lib.path, d.name);
    if (isHidden(showPath)) { status.done++; continue; }
    try { await scanShow(lib, showPath, d.name, existingShows.get(showPath), hasKey, seenShows, isHidden); }
    catch (e) { if (status.errors.length < 50) status.errors.push(`${d.name}: ${e.message}`); }
    status.done++;
  }
  const goneShows = [...existingShows.values()].filter((s) => !seenShows.has(s.path)).map((s) => s.id);
  if (goneShows.length) await q('delete from items where id = any($1)', [goneShows]);
}

async function scanShow(lib, showPath, dirName, existing, hasKey, seenShows, isHidden = () => false) {
  const files = (await walk(showPath)).filter((f) => !isHidden(f.path)).map((f) => ({ ...f, ep: names.parseEpisode(f.path) })).filter((f) => f.ep);
  if (!files.length) return;
  seenShows.add(showPath);
  const parsed = names.parseTitleYear(dirName);
  let show = existing;
  if (!show) {
    const art = await localArt(showPath, null);
    show = await q1(
      `insert into items (library_id, kind, title, sort_title, year, path, poster, backdrop, logo)
       values ($1,'show',$2,$3,$4,$5,$6,$7,$8) on conflict (path) do update set title=items.title returning id, matched, tmdb_id`,
      [lib.id, parsed.title, names.sortTitle(parsed.title), parsed.year, showPath, art.poster, art.backdrop, art.logo]);
  }
  let seasonsMeta = null;
  if (hasKey && !show.matched) {
    const meta = await tmdb.matchShow(parsed);
    if (meta) { await applyMeta(show.id, meta, { matched: true }); show.tmdb_id = meta.tmdb_id; show.matched = true; seasonsMeta = meta.seasons; }
  }
  const eps = new Map((await q(`select id, path, size, mtime, matched, parent_id from items where show_id=$1 and kind='episode'`, [show.id])).map((r) => [r.path, r]));
  const present = new Set(files.map((f) => f.path));
  const gone = [...eps.values()].filter((r) => !present.has(r.path)).map((r) => r.id);
  if (gone.length) await q('delete from items where id = any($1)', [gone]);
  const seasons = new Map((await q(`select id, season_no from items where parent_id=$1 and kind='season'`, [show.id])).map((r) => [r.season_no, r.id]));
  const tmdbSeasons = new Map();
  let added = false;
  for (const f of files.sort((a, b) => a.ep.season - b.ep.season || a.ep.episode - b.ep.episode)) {
    const e = eps.get(f.path);
    if (e && e.size === f.size && e.mtime === f.mtime && (e.matched || !show.tmdb_id)) continue;
    let seasonId = seasons.get(f.ep.season);
    if (!seasonId) {
      const sm = seasonsMeta?.find((s) => s.season === f.ep.season);
      const title = sm?.title || (f.ep.season === 0 ? 'Specials' : `Season ${f.ep.season}`);
      seasonId = (await q1(
        `insert into items (library_id, kind, parent_id, show_id, title, season_no, overview, poster) values ($1,'season',$2,$2,$3,$4,$5,$6) returning id`,
        [lib.id, show.id, title, f.ep.season, sm?.overview || null, sm?.poster || null])).id;
      seasons.set(f.ep.season, seasonId);
    }
    let id = e?.id;
    if (!e || e.size !== f.size || e.mtime !== f.mtime) {
      const p = await probe(f.path);
      const title = f.ep.title || `Episode ${f.ep.episode}`;
      id = (await q1(
        `insert into items (library_id, kind, parent_id, show_id, title, season_no, episode_no, path, size, mtime, container, streams, bitrate, runtime_s)
         values ($1,'episode',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13)
         on conflict (path) do update set size=excluded.size, mtime=excluded.mtime, container=excluded.container,
           streams=excluded.streams, bitrate=excluded.bitrate, runtime_s=excluded.runtime_s, parent_id=excluded.parent_id,
           season_no=excluded.season_no, episode_no=excluded.episode_no
         returning id`,
        [lib.id, seasonId, show.id, title, f.ep.season, f.ep.episode, f.path, f.size, f.mtime, ...media(p)])).id;
      if (!e) added = true;
    }
    if (show.tmdb_id) {
      if (!tmdbSeasons.has(f.ep.season)) tmdbSeasons.set(f.ep.season, await tmdb.seasonEpisodes(show.tmdb_id, f.ep.season).catch(() => null));
      const em = tmdbSeasons.get(f.ep.season)?.find((x) => x.episode === f.ep.episode);
      if (em) await applyMeta(id, { title: em.title, overview: em.overview, backdrop: em.still, premiered: em.premiered, score: em.score }, { matched: true });
    }
  }
  if (added) await q('update items set added_at=now() where id=$1', [show.id]);
  await q(`delete from items s where s.parent_id=$1 and s.kind='season' and not exists (select 1 from items e where e.parent_id=s.id)`, [show.id]);
}

/** Pre-roll clips: every video in the folder; sub-folder names become tags ("halloween/bump.mp4" → tag "halloween"). */
async function scanClips(lib) {
  const files = await walk(lib.path);
  const existing = new Map((await q(`select id, path, size, mtime from items where library_id=$1 and kind='clip'`, [lib.id])).map((r) => [r.path, r]));
  const present = new Set(files.map((f) => f.path));
  const gone = [...existing.values()].filter((r) => !present.has(r.path)).map((r) => r.id);
  if (gone.length && (files.length || !(await rootMissing(lib.path)))) await q('delete from items where id = any($1)', [gone]);
  const todo = files.filter((f) => { const e = existing.get(f.path); return !e || e.size !== f.size || e.mtime !== f.mtime; });
  Object.assign(status, { phase: 'Adding pre-roll clips', total: todo.length, done: 0 });
  await pool(todo, 4, async (f) => {
    const p = await probe(f.path);
    const rel = path.relative(lib.path, path.dirname(f.path));
    const tags = rel ? rel.split(path.sep).map((t) => t.toLowerCase()) : [];
    const title = names.clipTitle(f.path);
    await q(
      `insert into items (library_id, kind, title, sort_title, path, size, mtime, container, streams, bitrate, runtime_s, tags)
       values ($1,'clip',$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11)
       on conflict (path) do update set size=excluded.size, mtime=excluded.mtime, container=excluded.container,
         streams=excluded.streams, bitrate=excluded.bitrate, runtime_s=excluded.runtime_s, tags=excluded.tags`,
      [lib.id, title, names.sortTitle(title), f.path, f.size, f.mtime, ...media(p), tags]);
  });
}
