// Bulk metadata editor: find titles across every library, change many at once with a preview, undo any batch,
// tidy genres/tags/studios, and round-trip through a spreadsheet. Locked fields keep hand edits through rescans.
import path from 'node:path';
import { q, q1 } from './db.js';
import { HttpError, readJson, readBody } from './http.js';
import * as names from './names.js';
import * as guard from './guard.js';
import * as jf from './jfimport.js';

const admin = { admin: true };

// The fields the editor can change. `col` is the items column; `lock` is the name TMDb updates check.
export const FIELDS = {
  title: { label: 'Title', kind: 'text' },
  sort_title: { label: 'Sort title', kind: 'text' },
  overview: { label: 'Overview', kind: 'text' },
  tagline: { label: 'Tagline', kind: 'text' },
  genres: { label: 'Genres', kind: 'list' },
  tags: { label: 'Tags', kind: 'list' },
  studios: { label: 'Studios / networks / publishers', kind: 'list' },
  rating: { label: 'Parental rating', kind: 'text' },
  score: { label: 'Score (0–10)', kind: 'decimal' },
  year: { label: 'Year', kind: 'int' },
  premiered: { label: 'Release date', kind: 'date' },
  author: { label: 'Author / artist / writer', kind: 'text' },
  tmdb_id: { label: 'TMDb id', kind: 'int' },
};
export const KINDS = { movie: 'Movies', show: 'Shows', season: 'Seasons', episode: 'Episodes', book: 'Books', series: 'Comic series', comic: 'Comic issues', album: 'Albums', artist: 'Artists', track: 'Songs', clip: 'Pre-roll clips' };
const LISTS = Object.keys(FIELDS).filter((k) => FIELDS[k].kind === 'list');
const splitList = (v) => (Array.isArray(v) ? v : String(v ?? '').split('|')).map((x) => String(x).trim()).filter(Boolean);
const empty = (v) => v == null || v === '' || (Array.isArray(v) && !v.length);
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

function coerce(field, v) {
  const k = FIELDS[field].kind;
  if (k === 'list') return splitList(v);
  if (v == null || String(v).trim() === '') return null;
  if (k === 'int') { const n = parseInt(v, 10); if (!Number.isFinite(n)) throw new Error(`“${v}” is not a whole number`); return n; }
  if (k === 'decimal') { const n = parseFloat(v); if (!Number.isFinite(n) || n < 0 || n > 10) throw new Error(`“${v}” is not a score from 0 to 10`); return Math.round(n * 10) / 10; }
  if (k === 'date') { if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v).trim())) throw new Error(`“${v}” is not a date like 2024-05-31`); return String(v).trim(); }
  return String(v);
}

// ---------- tokens and text helpers ----------
const pad = (n, f) => (n == null ? '' : f ? String(n).padStart(f.length, '0') : String(n));
export function tokens(text, it, value) {
  return String(text ?? '').replace(/\{(\w+)(?::(0+))?\}/g, (all, k, f) => {
    switch (k.toLowerCase()) {
      case 'name': case 'title': return it.title || '';
      case 'year': return it.year ?? '';
      case 'seriesname': case 'show': return it.show_title || it.parent_title || '';
      case 'seasonnumber': return pad(it.season_no, f);
      case 'episodenumber': case 'number': return pad(it.episode_no ?? it.extra?.number, f);
      case 'library': return it.library_name || '';
      case 'type': return KINDS[it.kind] || it.kind;
      case 'author': return it.author || '';
      case 'filename': return it.path ? path.basename(it.path, path.extname(it.path)) : '';
      case 'folder': return it.path ? path.basename(path.dirname(it.path)) : '';
      case 'value': return Array.isArray(value) ? value.join(' | ') : value ?? '';
      default: return all;
    }
  });
}
const SMALL = new Set(['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'in', 'nor', 'of', 'on', 'or', 'the', 'to', 'vs', 'with']);
export function recase(s, mode) {
  s = String(s ?? '');
  if (mode === 'upper') return s.toUpperCase();
  if (mode === 'lower') return s.toLowerCase();
  if (mode === 'sentence') return s.toLowerCase().replace(/(^\s*\p{L}|[.!?]\s+\p{L})/gu, (m) => m.toUpperCase());
  return s.toLowerCase().split(/(\s+)/).map((w, i, a) => (i > 0 && i < a.length - 1 && SMALL.has(w) ? w : w.replace(/^(\p{L})/u, (m) => m.toUpperCase()))).join('');
}
function matcher(find, regex) {
  if (!find) throw new Error('Say what to find');
  if (regex) { try { return new RegExp(find, 'giu'); } catch (e) { throw new Error(`That pattern doesn't work: ${e.message}`); } }
  return new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu');
}

/** Run one edit on one item's current values. Returns the new value (or undefined for "no change"). Pure. */
export function runOp(op, it, cur) {
  const def = FIELDS[op.field];
  if (!def) throw new Error(`Unknown field ${op.field}`);
  const list = def.kind === 'list';
  const v = cur[op.field];
  switch (op.op) {
    case 'set': return list ? splitList(tokens(op.value, it, v)) : coerce(op.field, tokens(op.value, it, v));
    case 'clear': return list ? [] : null;
    case 'add': { if (!list) throw new Error('Add works on lists'); const add = splitList(tokens(op.value, it, v)); const lower = new Set(v.map((x) => x.toLowerCase())); return [...v, ...add.filter((x) => !lower.has(x.toLowerCase()))]; }
    case 'remove': {
      if (!list) throw new Error('Remove works on lists');
      if (op.regex) { const rx = matcher(op.value, true); return v.filter((x) => { rx.lastIndex = 0; return !rx.test(x); }); }
      const drop = new Set(splitList(op.value).map((x) => x.toLowerCase())); return v.filter((x) => !drop.has(x.trim().toLowerCase()));
    }
    case 'replace': {
      const rx = matcher(op.find, op.regex), rep = tokens(op.replace ?? '', it, v);
      if (list) return [...new Set(v.map((x) => x.replace(rx, rep).trim()).filter(Boolean))];
      if (v == null) return undefined;
      return coerce(op.field, String(v).replace(rx, rep));
    }
    case 'prepend': case 'append': {
      if (def.kind !== 'text') throw new Error('Adding text works on text fields');
      const t = tokens(op.value, it, v);
      return op.op === 'prepend' ? t + (v ?? '') : (v ?? '') + t;
    }
    case 'case': if (list) return v.map((x) => recase(x, op.mode)); if (def.kind !== 'text') throw new Error('Capitalization works on text'); return v == null ? undefined : recase(v, op.mode);
    case 'copy': {
      const src = FIELDS[op.from]; if (!src) throw new Error('Choose a field to copy from');
      const sv = cur[op.from];
      if (list) return src.kind === 'list' ? [...sv] : splitList(sv ?? '');
      return coerce(op.field, src.kind === 'list' ? sv.join(' | ') : sv);
    }
    case 'trim':
      if (list) { const seen = new Set(); return v.map((x) => x.replace(/\s+/g, ' ').trim()).filter((x) => x && !seen.has(x.toLowerCase()) && seen.add(x.toLowerCase())); }
      return typeof v === 'string' ? v.replace(/[ \t]+/g, ' ').replace(/\s*\n\s*\n\s*/g, '\n\n').trim() || null : undefined;
    case 'sort': if (!list) throw new Error('Sorting works on lists'); return [...v].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    default: throw new Error(`Unknown edit “${op.op}”`);
  }
}

// ---------- loading and planning ----------
async function load(ids) {
  return q(`select i.*, l.name as library_name, s.title as show_title, p.title as parent_title from items i join libraries l on l.id = i.library_id
    left join items s on s.id = i.show_id left join items p on p.id = i.parent_id where i.id = any($1::bigint[])`, [ids.map(Number)]);
}
const current = (it) => Object.fromEntries(Object.keys(FIELDS).map((k) => [k, LISTS.includes(k) ? it[k] || [] : it[k] ?? null]));

/** Work out every change a list of edits makes, without saving. */
export function plan(items, ops, { onlyEmpty = false, lock = true } = {}) {
  const out = [];
  for (const it of items) {
    const cur = current(it), start = current(it), changes = [], locks = { ...(it.locked || {}) };
    let error = null;
    for (const op of ops) {
      try {
        if (op.op === 'lock' || op.op === 'unlock') {
          for (const f of op.field === 'all' ? Object.keys(FIELDS) : [op.field]) {
            if (!FIELDS[f]) throw new Error(`Unknown field ${f}`);
            if (op.op === 'lock' && !locks[f]) { locks[f] = true; changes.push({ field: f, lock: true }); }
            if (op.op === 'unlock' && locks[f]) { delete locks[f]; changes.push({ field: f, lock: false }); }
          }
          continue;
        }
        if (onlyEmpty && !empty(cur[op.field]) && op.op !== 'clear') continue;
        const next = runOp(op, it, cur);
        if (next !== undefined) cur[op.field] = next;
      } catch (e) { error = e.message; break; }
    }
    if (!error) {
      for (const f of Object.keys(FIELDS)) {
        if (same(cur[f], start[f])) continue;
        changes.push({ field: f, before: start[f], after: cur[f] });
        if (lock && !locks[f]) { locks[f] = true; }
      }
      if (cur.title !== start.title && same(cur.sort_title, start.sort_title) && !(it.locked || {}).sort_title) changes.push({ field: 'sort_title', before: start.sort_title, after: names.sortTitle(cur.title || ''), auto: true });
    }
    if (changes.length || error) out.push({ id: it.id, title: it.title, kind: it.kind, library: it.library_name, show: it.show_title || it.parent_title || null, changes, error, lockAfter: locks });
  }
  return out;
}

/** Save planned changes. Returns the history entry. */
async function commit(planned, label, { lock = true, undoes = null } = {}) {
  planned = [...planned, ...(await cascadeTags(planned))];
  const record = [];
  for (const p of planned) {
    if (p.error || !p.changes.length) continue;
    const row = await q1('select locked, edits from items where id=$1', [p.id]);
    if (!row) continue;
    const locked = { ...(row.locked || {}) }, edits = { ...(row.edits || {}) };
    const sets = [], vals = [];
    for (const c of p.changes) {
      const wasLocked = !!locked[c.field];
      if ('lock' in c) {
        if (c.lock) { locked[c.field] = true; } else { delete locked[c.field]; delete edits[c.field]; }
        record.push({ id: p.id, field: c.field, lock: c.lock, wasLocked });
        continue;
      }
      vals.push(c.after); sets.push(`${c.field}=$${vals.length}`);
      const lockNow = c.lockTo ?? (lock || wasLocked);
      if (lockNow) { locked[c.field] = true; edits[c.field] = c.after; } else { delete locked[c.field]; delete edits[c.field]; }
      record.push({ id: p.id, field: c.field, before: c.before, after: c.after, wasLocked, auto: c.auto || undefined });
    }
    vals.push(JSON.stringify(locked), JSON.stringify(edits), p.id);
    await q(`update items set ${[...sets, `locked=$${vals.length - 2}::jsonb`, `edits=$${vals.length - 1}::jsonb`].join(', ')} where id=$${vals.length}`, vals);
  }
  if (!record.length) return null;
  const h = await q1('insert into meta_history (label, changes, undoes) values ($1,$2::jsonb,$3) returning id, label, created_at', [label, JSON.stringify(record), undoes]);
  await q('delete from meta_history where id not in (select id from meta_history order by id desc limit 50)');
  guard.changed();
  return { ...h, items: new Set(record.map((r) => r.id)).size, changes: record.length };
}

/**
 * A tag taken off a show comes off its seasons and episodes too. Episodes use their show's tags as well as their own,
 * and imports (Jellyfin's export) copy the show's tags onto every episode, so without this an old tag lives on in the
 * episodes and keeps matching (pre-rolls, parental controls). Tags added to a show aren't copied: episodes get them
 * from the show already. Returns extra planned changes, saved (and undone) with the edit itself.
 */
async function cascadeTags(planned) {
  const out = [];
  for (const p of planned) {
    if (p.error || p.kind !== 'show') continue;
    const c = p.changes.find((x) => x.field === 'tags' && 'after' in x);
    if (!c) continue;
    const after = new Set((c.after || []).map((t) => String(t).toLowerCase()));
    const removed = [...new Set((c.before || []).map((t) => String(t).toLowerCase()))].filter((t) => !after.has(t));
    if (!removed.length) continue;
    const kids = await q(`select id, title, kind, tags, locked from items where show_id = $1 and kind in ('season','episode')
      and exists (select 1 from unnest(tags) t where lower(t) = any($2::text[]))`, [p.id, removed]);
    for (const k of kids) {
      const next = k.tags.filter((t) => !removed.includes(String(t).toLowerCase()));
      out.push({ id: k.id, title: k.title, kind: k.kind, show: p.title, changes: [{ field: 'tags', before: k.tags, after: next, lockTo: !!(k.locked || {}).tags }], error: null, lockAfter: k.locked || {} });
    }
  }
  return out;
}

/** Set one field on some titles as a saved, undoable edit (used by tools outside the metadata editor). */
export async function setField(ids, field, value, label) {
  const items = await load(ids);
  return commit(plan(items, [{ op: 'set', field, value: Array.isArray(value) ? value.join('|') : value }]), label);
}

/** After a scan rewrites files' details, put locked hand edits back. */
export async function reapplyEdits(libraryId) {
  const rows = await q(`select id, edits from items where library_id=$1 and edits <> '{}'::jsonb`, [libraryId]);
  for (const r of rows) {
    const sets = [], vals = [];
    let extra = 'extra'; // several locked extra.* fields nest into one assignment (a column can only be set once)
    for (const [k, v] of Object.entries(r.edits)) {
      if (k.startsWith('extra.')) { vals.push(JSON.stringify(v)); extra = `jsonb_set(${extra}, '{${k.slice(6).replace(/[^\w]/g, '')}}', $${vals.length}::jsonb)`; continue; }
      if (!FIELDS[k] && !['poster', 'backdrop', 'logo'].includes(k)) continue;
      vals.push(v); sets.push(`${k}=$${vals.length}`);
    }
    if (extra !== 'extra') sets.push(`extra = ${extra}`);
    if (!sets.length) continue;
    vals.push(r.id);
    await q(`update items set ${sets.join(', ')} where id=$${vals.length}`, vals);
  }
  guard.changed();
}

// ---------- finding titles ----------
function where(f, args) {
  const w = ['true'];
  const arg = (v) => { args.push(v); return `$${args.length}`; };
  const kinds = splitList(f.kinds).filter((k) => KINDS[k]);
  // Pre-roll clips (bumpers, idents) stay out of the everything-everywhere list, but show up as soon as you pick
  // their type, their library, or search for them by name.
  if (kinds.length) w.push(`i.kind = any(${arg(kinds)})`);
  else if (!f.library && !f.q?.trim()) w.push(`i.kind not in ('clip')`);
  if (f.library) w.push(`i.library_id = ${arg(+f.library)}`);
  if (f.q?.trim()) { const like = `%${f.q.trim().replace(/[%_\\]/g, '\\$&')}%`; w.push(`(i.title ilike ${arg(like)} or i.sort_title ilike $${args.length} or i.path ilike $${args.length} or s.title ilike $${args.length} or p.title ilike $${args.length})`); }
  if (f.series?.trim()) w.push(`coalesce(s.title, p.title) ilike ${arg(`%${f.series.trim()}%`)}`);
  if (f.genre) w.push(`${arg(f.genre)} = any(i.genres)`);
  if (f.tag) w.push(`${arg(f.tag)} = any(i.tags)`);
  if (f.notTag) w.push(`not (${arg(f.notTag)} = any(i.tags))`);
  if (f.studio) w.push(`${arg(f.studio)} = any(i.studios)`);
  if (f.rating === '(none)') w.push(`coalesce(i.rating, '') = ''`); else if (f.rating) w.push(`i.rating = ${arg(f.rating)}`);
  if (f.yearFrom) w.push(`i.year >= ${arg(+f.yearFrom)}`);
  if (f.yearTo) w.push(`i.year <= ${arg(+f.yearTo)}`);
  if (f.contains?.trim() && FIELDS[f.containsField]) {
    const col = f.containsField;
    w.push(FIELDS[col].kind === 'list' ? `array_to_string(i.${col}, '|') ilike ${arg(`%${f.contains.trim()}%`)}` : `i.${col}::text ilike ${arg(`%${f.contains.trim()}%`)}`);
  }
  const MISSING = { overview: `coalesce(i.overview,'') = ''`, genres: `cardinality(i.genres) = 0`, tags: `cardinality(i.tags) = 0`, rating: `coalesce(i.rating,'') = ''`, year: 'i.year is null',
    tmdb: `i.tmdb_id is null and i.kind in ('movie','show')`, poster: 'i.poster is null', backdrop: 'i.backdrop is null', logo: 'i.logo is null', studios: 'cardinality(i.studios) = 0', author: `coalesce(i.author,'') = ''` };
  if (MISSING[f.missing]) w.push(MISSING[f.missing]);
  if (f.locked === 'any') w.push(`i.locked <> '{}'::jsonb`); else if (f.locked === 'none') w.push(`i.locked = '{}'::jsonb`);
  return w.join(' and ');
}
const FROMQ = 'from items i join libraries l on l.id = i.library_id left join items s on s.id = i.show_id left join items p on p.id = i.parent_id';
const SORTS = { title: 'i.sort_title, i.id', added: 'i.added_at desc, i.id', year: 'i.year desc nulls last, i.sort_title', series: 'coalesce(s.title, p.title, i.sort_title), i.season_no, i.episode_no, i.sort_title' };

// ---------- CSV ----------
// "show" is the show an episode or season belongs to (or the series/album a comic issue or song is in, or a show's own
// name), with its season and episode numbers: there to read and sort by, ignored when a file is imported.
const CSV_COLS = ['id', 'library', 'type', 'show', 'season', 'episode', 'path', ...Object.keys(FIELDS)];
const READONLY = new Set(['library', 'type', 'show', 'season', 'episode', 'path']);
const csvValue = (it, c) => (c === 'library' ? it.library_name : c === 'type' ? KINDS[it.kind]
  : c === 'show' ? it.show_title || it.parent_title || (it.kind === 'show' ? it.title : '')
    : c === 'season' ? it.season_no : c === 'episode' ? it.episode_no : it[c]);
const cell = (v) => { const s = Array.isArray(v) ? v.join(' | ') : v == null ? '' : String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export function parseCsv(text) {
  const rows = []; let row = [], f = '', qd = false;
  text = String(text).replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (qd) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else qd = false; } else f += c; continue; }
    if (c === '"') qd = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
    else f += c;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim() !== ''));
}
/** Changes one spreadsheet row makes to one title: `get(field)` gives the row's text for a field, or undefined if absent. */
function rowChanges(it, fields, get, blankClears) {
  const cur = current(it), changes = [];
  let error = null;
  for (const field of fields) {
    const raw = get(field) ?? '';
    if (String(raw).trim() === '' && !blankClears) continue;
    try {
      const next = coerce(field, raw);
      if (!same(next, cur[field])) changes.push({ field, before: cur[field], after: next });
    } catch (e) { error = `${FIELDS[field].label}: ${e.message}`; }
  }
  return { changes, error };
}

/** A CSV from the Jellyfin Bulk Metadata plugin: rows are matched to HallFlix titles by path, TMDb id, episode or title. */
async function jellyfinPlan(rows, blankClears) {
  const m = await jf.match(rows);
  const items = await load(m.rows.map((r) => r.id));
  const vals = new Map(m.rows.map((r) => [r.id, r.values]));
  const out = [];
  for (const it of items) {
    const v = vals.get(it.id);
    const { changes, error } = rowChanges(it, Object.keys(v), (f) => v[f], blankClears);
    if (changes.length || error) out.push({ id: it.id, title: it.title, kind: it.kind, library: it.library_name, changes, error });
  }
  return { planned: out, unknown: m.unmatched, source: 'jellyfin', rows: m.total, matched: m.matched, missed: m.missed };
}

async function csvPlan(text, blankClears) {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new HttpError(400, 'That file has no rows');
  const head = rows[0].map((h) => h.trim().toLowerCase());
  if (jf.isJellyfin(head)) return jellyfinPlan(rows, blankClears);
  const idAt = head.indexOf('id');
  if (idAt < 0) throw new HttpError(400, 'The first row needs an “id” column (export a file from here to get the right layout)');
  const cols = head.map((h, i) => ({ h, i })).filter((c) => FIELDS[c.h] && !READONLY.has(c.h));
  if (!cols.length) throw new HttpError(400, `No columns HallFlix can change. Use: ${Object.keys(FIELDS).join(', ')}`);
  const byId = new Map(rows.slice(1).map((r) => [+r[idAt], r]));
  const items = await load([...byId.keys()].filter(Boolean));
  const out = [];
  for (const it of items) {
    const r = byId.get(it.id), cur = current(it), changes = [];
    let error = null;
    for (const c of cols) {
      const raw = r[c.i] ?? '';
      if (raw.trim() === '' && !blankClears) continue;
      try {
        const next = coerce(c.h, raw);
        if (!same(next, cur[c.h])) changes.push({ field: c.h, before: cur[c.h], after: next });
      } catch (e) { error = `${FIELDS[c.h].label}: ${e.message}`; }
    }
    if (changes.length || error) out.push({ id: it.id, title: it.title, kind: it.kind, library: it.library_name, changes, error });
  }
  return { planned: out, unknown: [...byId.keys()].filter((id) => !items.some((it) => it.id === id)).length };
}

const summary = (planned) => ({ items: planned.filter((p) => !p.error).length, changes: planned.reduce((a, p) => a + (p.error ? 0 : p.changes.length), 0), errors: planned.filter((p) => p.error).length });

export function routes(r) {
  r.get('/api/studio/meta/catalog', async () => ({
    fields: Object.entries(FIELDS).map(([key, f]) => ({ key, ...f })), kinds: KINDS,
    libraries: await q('select id, name, kind from libraries order by position, id'),
    genres: (await q(`select distinct g from items, unnest(genres) g order by 1`)).map((x) => x.g),
    tags: (await q(`select distinct t from items, unnest(tags) t order by 1`)).map((x) => x.t),
    studios: (await q(`select distinct s from items, unnest(studios) s order by 1`)).map((x) => x.s),
    ratings: (await q(`select distinct rating from items where coalesce(rating,'') <> '' order by 1`)).map((x) => x.rating),
  }), admin);

  r.post('/api/studio/meta/search', async ({ req }) => {
    const f = await readJson(req);
    const args = [];
    const w = where(f, args);
    const total = (await q1(`select count(*)::int as n ${FROMQ} where ${w}`, args)).n;
    if (f.idsOnly) return { total, ids: (await q(`select i.id ${FROMQ} where ${w} order by ${SORTS[f.sort] || SORTS.title} limit 20000`, args)).map((x) => x.id) };
    const limit = Math.min(200, +f.limit || 100), offset = Math.max(0, +f.offset || 0);
    const rows = await q(`select i.id, i.kind, i.title, i.sort_title, i.year, i.rating, i.genres, i.tags, i.studios, i.author, i.overview is not null and i.overview <> '' as has_overview,
        i.poster is not null as has_poster, i.backdrop is not null as has_backdrop, i.tmdb_id, i.locked, i.season_no, i.episode_no, i.path, l.name as library, coalesce(s.title, p.title) as series
      ${FROMQ} where ${w} order by ${SORTS[f.sort] || SORTS.title} limit ${limit} offset ${offset}`, args);
    return { total, items: rows.map((x) => ({ ...x, locked: Object.keys(x.locked || {}), file: x.path ? path.basename(x.path) : null, path: undefined })) };
  }, admin);

  r.get('/api/studio/meta/item/:id', async ({ params }) => {
    const [it] = await load([params.id]);
    if (!it) throw new HttpError(404, 'Not found');
    return { id: it.id, kind: it.kind, library: it.library_name, path: it.path, series: it.show_title || it.parent_title, values: current(it), locked: Object.keys(it.locked || {}) };
  }, admin);

  // Edit one title directly (the per-title form): same path as a batch, so it lands in history too.
  r.post('/api/studio/meta/item/:id', async ({ req, params }) => {
    const b = await readJson(req);
    const [it] = await load([params.id]);
    if (!it) throw new HttpError(404, 'Not found');
    const ops = Object.entries(b.values || {}).filter(([k]) => FIELDS[k]).map(([field, value]) => ({ op: 'set', field, value: Array.isArray(value) ? value.join('|') : value ?? '' }));
    const planned = plan([it], ops, { lock: b.lock !== false });
    if (planned[0]?.error) throw new HttpError(400, planned[0].error);
    return { saved: await commit(planned, `Edited ${it.title}`, { lock: b.lock !== false }) };
  }, admin);

  r.post('/api/studio/meta/preview', async ({ req }) => {
    const b = await readJson(req);
    if (!b.ids?.length) throw new HttpError(400, 'Select some titles first');
    if (!b.ops?.length) throw new HttpError(400, 'Add at least one edit');
    const planned = plan(await load(b.ids), b.ops, b.options || {});
    return { ...summary(planned), selected: b.ids.length, planned: planned.slice(0, 500) };
  }, admin);
  r.post('/api/studio/meta/apply', async ({ req }) => {
    const b = await readJson(req);
    if (!b.ids?.length || !b.ops?.length) throw new HttpError(400, 'Select titles and add an edit');
    const opts = { lock: true, ...(b.options || {}) };
    const planned = plan(await load(b.ids), b.ops, opts);
    const saved = await commit(planned, b.label || describeOps(b.ops, b.ids.length), opts);
    return { saved, ...summary(planned) };
  }, admin);

  // ----- genres, tags, studios… with counts
  r.get('/api/studio/meta/values', async ({ query }) => {
    const field = query.field;
    if (!FIELDS[field] || !['list', 'text', 'int'].includes(FIELDS[field].kind) || ['title', 'sort_title', 'overview', 'tagline', 'tmdb_id'].includes(field)) throw new HttpError(400, 'Choose genres, tags, studios, rating, year or author');
    const scope = query.library ? 'and i.library_id = $1' : '';
    const args = query.library ? [+query.library] : [];
    const rows = FIELDS[field].kind === 'list'
      ? await q(`select v as value, count(*)::int as n from items i, unnest(i.${field}) v where i.kind <> 'clip' ${scope} group by v order by lower(v)`, args)
      : await q(`select i.${field}::text as value, count(*)::int as n from items i where i.kind <> 'clip' and i.${field} is not null and i.${field}::text <> '' ${scope} group by 1 order by 1`, args);
    return rows;
  }, admin);
  r.post('/api/studio/meta/values', async ({ req }) => {
    const b = await readJson(req);
    const def = FIELDS[b.field];
    if (!def) throw new HttpError(400, 'Unknown field');
    const from = splitList(b.from);
    if (!from.length) throw new HttpError(400, 'Choose at least one value');
    const to = b.action === 'delete' ? null : String(b.to ?? '').trim();
    if (b.action !== 'delete' && !to) throw new HttpError(400, 'Type the new name');
    const lowered = from.map((x) => x.toLowerCase());
    const ids = (def.kind === 'list'
      ? await q(`select id from items where exists (select 1 from unnest(${b.field}) v where lower(v) = any($1))`, [lowered])
      : await q(`select id from items where lower(${b.field}::text) = any($1)`, [lowered])).map((x) => x.id);
    const items = await load(ids);
    const planned = items.map((it) => {
      const cur = current(it);
      let after;
      if (def.kind === 'list') { const kept = cur[b.field].filter((v) => !lowered.includes(v.toLowerCase())); after = to && !kept.some((v) => v.toLowerCase() === to.toLowerCase()) ? [...kept, to] : kept; }
      else after = to == null ? null : coerce(b.field, to);
      return { id: it.id, title: it.title, changes: same(after, cur[b.field]) ? [] : [{ field: b.field, before: cur[b.field], after }] };
    }).filter((p) => p.changes.length);
    if (b.preview) return { items: planned.length, sample: planned.slice(0, 20).map((p) => p.title) };
    const label = b.action === 'delete' ? `Deleted ${def.label.toLowerCase()} ${from.join(', ')}` : from.length > 1 ? `Merged ${from.join(', ')} into ${to}` : `Renamed ${from[0]} to ${to}`;
    return { saved: await commit(planned, label, { lock: true }), items: planned.length };
  }, admin);

  // ----- spreadsheet
  r.post('/api/studio/meta/export', async ({ req, res }) => {
    const b = await readJson(req);
    let ids = b.ids;
    if (!ids?.length) { const args = []; ids = (await q(`select i.id ${FROMQ} where ${where(b.filter || {}, args)} order by i.library_id, ${SORTS.series} limit 50000`, args)).map((x) => x.id); }
    const cols = (b.columns?.length ? CSV_COLS.filter((c) => c === 'id' || b.columns.includes(c)) : CSV_COLS);
    const items = await load(ids);
    const order = new Map(ids.map((id, i) => [Number(id), i]));
    items.sort((a, z) => order.get(a.id) - order.get(z.id));
    const lines = [cols.join(',')];
    for (const it of items) lines.push(cols.map((c) => cell(csvValue(it, c))).join(','));
    const body = Buffer.from('﻿' + lines.join('\r\n') + '\r\n');
    res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="hallflix-metadata-${new Date().toISOString().slice(0, 10)}.csv"`, 'Content-Length': body.length, 'Cache-Control': 'no-store' });
    res.end(body);
  }, admin);
  r.post('/api/studio/meta/import', async ({ req, query }) => {
    const text = (await readBody(req, 30e6)).toString('utf8');
    const { planned, unknown, ...from } = await csvPlan(text, query.blank === '1');
    if (query.apply !== '1') return { ...summary(planned), unknown, ...from, planned: planned.slice(0, 500) };
    const label = from.source === 'jellyfin' ? `Imported from Jellyfin (${summary(planned).items} titles)` : `Imported a spreadsheet (${summary(planned).items} titles)`;
    return { saved: await commit(planned, label, { lock: query.lock !== '0' }), ...summary(planned), ...from };
  }, admin);

  // ----- online refresh
  r.post('/api/studio/meta/refresh', async ({ req }) => {
    const b = await readJson(req);
    const ids = (b.ids || []).map(Number);
    if (!ids.length) throw new HttpError(400, 'Select some titles first');
    const rows = await q(`select distinct library_id from items where id = any($1)`, [ids]);
    await q(`update items set matched=false where id = any($1) and kind in ('movie','show','episode')`, [ids]);
    const scan = await import('./scan.js');
    for (const r0 of rows) scan.startScan(r0.library_id);
    return { ok: true, libraries: rows.length };
  }, admin);

  // ----- history
  r.get('/api/studio/meta/history', async () => (await q('select id, label, undoes, undone, created_at, jsonb_array_length(changes) as n, (select count(distinct x->>\'id\') from jsonb_array_elements(changes) x)::int as items from meta_history order by id desc')), admin);
  r.get('/api/studio/meta/history/:id', async ({ params }) => {
    const h = await q1('select * from meta_history where id=$1', [params.id]);
    if (!h) throw new HttpError(404, 'Not found');
    const titles = new Map((await q('select id, title from items where id = any($1::bigint[])', [[...new Set(h.changes.map((c) => c.id))]])).map((x) => [x.id, x.title]));
    return { ...h, changes: h.changes.slice(0, 1000).map((c) => ({ ...c, title: titles.get(c.id) || '(removed)' })) };
  }, admin);
  r.post('/api/studio/meta/history/:id/undo', async ({ params, query }) => {
    const h = await q1('select * from meta_history where id=$1', [params.id]);
    if (!h) throw new HttpError(404, 'Not found');
    const byItem = new Map();
    for (const c of [...h.changes].reverse()) {
      if (!byItem.has(c.id)) byItem.set(c.id, []);
      byItem.get(c.id).push('lock' in c ? { field: c.field, lock: c.wasLocked } : { field: c.field, before: c.after, after: c.before, lockTo: c.wasLocked });
    }
    const exists = new Set((await q('select id from items where id = any($1::bigint[])', [[...byItem.keys()]])).map((x) => x.id));
    const planned = [...byItem].filter(([id]) => exists.has(id)).map(([id, changes]) => ({ id, changes }));
    if (query.preview === '1') return { items: planned.length, changes: planned.reduce((a, p) => a + p.changes.length, 0) };
    const saved = await commit(planned, `Undo: ${h.label}`, { lock: false, undoes: h.id });
    await q('update meta_history set undone=true where id=$1', [h.id]);
    return { saved };
  }, admin);
}

function describeOps(ops, n) {
  const verbs = { set: 'Set', clear: 'Cleared', add: 'Added to', remove: 'Removed from', replace: 'Replaced in', prepend: 'Added text to', append: 'Added text to', case: 'Recapitalized', copy: 'Copied into', trim: 'Cleaned up', sort: 'Sorted', lock: 'Locked', unlock: 'Unlocked' };
  const first = ops[0];
  const what = `${verbs[first.op] || 'Edited'} ${first.field === 'all' ? 'all fields' : (FIELDS[first.field]?.label || first.field).toLowerCase()}`;
  return `${what}${ops.length > 1 ? ` and ${ops.length - 1} more edit${ops.length > 2 ? 's' : ''}` : ''} on ${n} title${n === 1 ? '' : 's'}`;
}
