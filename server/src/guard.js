// Content Guard: rule sets that hide titles from chosen profiles by tag, genre or rating.
// Seasons, episodes, issues, albums and songs follow the title they belong to, and the server enforces it everywhere:
// lists never show a hidden title, and asking for one directly (details, playback, files, covers) answers "not found".
import { q, q1, getSetting, setSetting } from './db.js';
import { HttpError, readJson } from './http.js';

const VIDEO = new Set(['movie', 'show', 'season', 'episode']);
let version = 0; // bumped whenever titles or rules change
const cache = new Map(); // rule-set key -> { version, at, hidden: Map<id, reason> }

export const changed = () => { version++; };
export async function rules() { return (await getSetting('guard', null))?.rules || []; }
export async function saveRules(list) { await setSetting('guard', { rules: list }); changed(); }

const norm = (s) => String(s ?? '').trim().toLowerCase();
/** "Horror*" matches "Horror Comedy"; matching ignores case. */
export function wild(pattern) {
  const p = norm(pattern);
  if (!p.includes('*')) return (v) => norm(v) === p;
  const rx = new RegExp(`^${p.split('*').map((x) => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
  return (v) => rx.test(norm(v));
}

/** Compile a rule set into a test: item facts in, the reason it is hidden out (or null). Pure, so it can be unit tested. */
export function compile(rule) {
  const m = (list) => (list || []).filter((x) => norm(x)).map((x) => ({ text: x, test: wild(x) }));
  const tags = m(rule.blockTags), genres = m(rule.blockGenres), ratings = m(rule.blockRatings), allow = m(rule.allowTags);
  return (f) => {
    for (const t of tags) { const hit = f.tags.find(t.test); if (hit) return `tag “${hit}” (blocked: ${t.text})`; }
    for (const g of genres) { const hit = f.genres.find(g.test); if (hit) return `genre “${hit}” (blocked: ${g.text})`; }
    for (const r of ratings) if (f.rating && r.test(f.rating)) return `rated ${f.rating} (blocked: ${r.text})`;
    if (rule.hideUnrated && VIDEO.has(f.kind) && !f.rating) return 'no rating, and unrated titles are hidden';
    if (allow.length && !f.tags.some((t) => allow.some((a) => a.test(t)))) return `not tagged ${allow.map((a) => a.text).join(' or ')} (allow-only)`;
    return null;
  };
}

/** Every item with the tags, genres and rating it inherits from the show, series, album or artist above it. */
async function facts() {
  const rows = await q(`select i.id, i.kind, i.title, i.tags, i.genres, i.rating,
      coalesce(s.tags, '{}') as s_tags, coalesce(s.genres, '{}') as s_genres, s.rating as s_rating,
      coalesce(p.tags, '{}') as p_tags, coalesce(p.genres, '{}') as p_genres, p.rating as p_rating,
      coalesce(g.tags, '{}') as g_tags, g.rating as g_rating
    from items i left join items s on s.id = i.show_id left join items p on p.id = i.parent_id left join items g on g.id = p.parent_id
    where i.kind <> 'clip'`);
  return rows.map((r) => ({
    id: r.id, kind: r.kind, title: r.title,
    tags: [...new Set([...r.tags, ...r.s_tags, ...r.p_tags, ...r.g_tags])],
    genres: [...new Set([...r.genres, ...r.s_genres, ...r.p_genres])],
    rating: r.rating || r.s_rating || r.p_rating || r.g_rating || null,
  }));
}

const activeFor = (list, profile) => list.filter((r) => r.enabled !== false && (r.profiles || []).map(Number).includes(profile.id));

/** Map of hidden item id -> reason for this profile, or null when no rule applies to it. */
export async function hiddenFor(profile) {
  if (!profile) return null;
  const mine = activeFor(await rules(), profile);
  if (!mine.length) return null;
  return evaluate(mine);
}
export async function evaluate(list) {
  const key = JSON.stringify(list.map((r) => [r.blockTags, r.blockGenres, r.blockRatings, r.allowTags, !!r.hideUnrated, r.name]));
  const hit = cache.get(key);
  if (hit && hit.version === version && Date.now() - hit.at < 5 * 60e3) return hit.hidden;
  const tests = list.map((r) => ({ name: r.name, test: compile(r) }));
  const hidden = new Map();
  for (const f of await facts()) {
    for (const t of tests) { const why = t.test(f); if (why) { hidden.set(f.id, `${t.name}: ${why}`); break; } }
  }
  if (cache.size > 30) cache.clear();
  cache.set(key, { version, at: Date.now(), hidden });
  return hidden;
}

const ITEM_KINDS = new Set(['movie', 'show', 'season', 'episode', 'book', 'comic', 'series', 'album', 'artist', 'track']);
const isCard = (x) => x && typeof x === 'object' && typeof x.id === 'number' && ITEM_KINDS.has(x.kind);

/** Remove hidden titles from any JSON the API is about to send: rows, grids, search, similar titles, seasons, next episode… */
export function scrub(value, hidden) {
  if (!hidden?.size || value == null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    const out = [];
    for (const v of value) {
      if (isCard(v) && hidden.has(v.id)) continue;
      const before = Array.isArray(v?.items) ? v.items.length : Array.isArray(v?.episodes) ? v.episodes.length : -1;
      const s = scrub(v, hidden);
      const after = Array.isArray(s?.items) ? s.items.length : Array.isArray(s?.episodes) ? s.episodes.length : -1;
      if (before > 0 && after === 0) continue; // a row or season left empty disappears
      out.push(s);
    }
    return out;
  }
  for (const [k, v] of Object.entries(value)) {
    if (isCard(v) && hidden.has(v.id)) value[k] = null;
    else if (v && typeof v === 'object') value[k] = scrub(v, hidden);
  }
  return value;
}

// Routes whose :id (or :item) is an item. Anything else with an id (playlists, collections, parties) is not.
const ITEM_ROUTE = /^\/api\/(items|file|subs|cover|read|audio|chapters|lyrics|thumbs|bookmarks)\//;
const BODY_ROUTE = /^\/api\/(play|play\/session|progress|mylist|watched|party|bookmarks\/\d+)$/;
export function blocked(pathname, params, body, hidden) {
  if (!hidden?.size) return false;
  if (ITEM_ROUTE.test(pathname)) for (const k of ['id', 'item']) if (params[k] && hidden.has(+params[k])) return true;
  if (body && BODY_ROUTE.test(pathname) && body.itemId != null && hidden.has(+body.itemId)) return true;
  if (body && /^\/api\/playlists\/\d+\/tracks$/.test(pathname) && (body.add || []).some((x) => hidden.has(+x))) return true;
  return false;
}
export const needsBody = (method, pathname) => method === 'POST' && (BODY_ROUTE.test(pathname) || /^\/api\/playlists\/\d+\/tracks$/.test(pathname));

// ---------- Studio ----------
const clean = (list) => [...new Set((Array.isArray(list) ? list : String(list || '').split(/[,\n|]/)).map((x) => String(x).trim()).filter(Boolean))];
const TOP = new Set(['movie', 'show', 'book', 'series', 'album', 'artist']);

export function routes(r) {
  const admin = { admin: true };
  r.get('/api/studio/guard', async () => ({
    rules: await rules(),
    profiles: await q('select id, name, is_admin, color, avatar from profiles order by id'),
    tags: (await q(`select t, count(*)::int as n from items, unnest(tags) t where kind <> 'clip' group by t order by lower(t)`)),
    genres: (await q(`select g, count(*)::int as n from items, unnest(genres) g where kind <> 'clip' group by g order by lower(g)`)),
    ratings: (await q(`select rating as r, count(*)::int as n from items where coalesce(rating,'') <> '' and kind <> 'clip' group by rating order by rating`)),
  }), admin);
  r.put('/api/studio/guard', async ({ req }) => {
    const { rules: list } = await readJson(req);
    const out = (list || []).map((x, i) => ({
      id: x.id || `g${Date.now().toString(36)}${i}`, name: String(x.name || '').trim() || `Rule set ${i + 1}`, enabled: x.enabled !== false,
      profiles: (x.profiles || []).map(Number).filter(Boolean), blockTags: clean(x.blockTags), blockGenres: clean(x.blockGenres), blockRatings: clean(x.blockRatings),
      allowTags: clean(x.allowTags), hideUnrated: !!x.hideUnrated,
    }));
    await saveRules(out);
    return { ok: true, rules: out };
  }, admin);
  // What a rule set (saved or not) would hide.
  r.post('/api/studio/guard/preview', async ({ req }) => {
    const { rule } = await readJson(req);
    const hidden = await evaluate([{ ...rule, name: rule.name || 'This rule set', blockTags: clean(rule.blockTags), blockGenres: clean(rule.blockGenres), blockRatings: clean(rule.blockRatings), allowTags: clean(rule.allowTags) }]);
    const ids = [...hidden.keys()];
    const rows = ids.length ? await q(`select id, kind, title, year from items where id = any($1::bigint[]) and kind = any($2) order by sort_title limit 400`, [ids, [...TOP]]) : [];
    const counts = ids.length ? await q(`select kind, count(*)::int as n from items where id = any($1::bigint[]) group by kind`, [ids]) : [];
    return { total: ids.length, counts: Object.fromEntries(counts.map((c) => [c.kind, c.n])), items: rows.map((x) => ({ ...x, why: hidden.get(x.id).replace(/^[^:]+: /, '') })) };
  }, admin);
  // "Can this profile see it?" for a title search.
  r.get('/api/studio/guard/test', async ({ query }) => {
    const profile = await q1('select * from profiles where id=$1', [query.profile]);
    if (!profile) throw new HttpError(404, 'Choose a profile');
    const term = String(query.q || '').trim();
    const rows = term ? await q(`select i.id, i.kind, i.title, i.year, s.title as show_title from items i left join items s on s.id = i.show_id
      where i.kind <> 'clip' and (i.title ilike $1 or s.title ilike $1) order by (i.kind = any($2)) desc, i.sort_title limit 30`, [`%${term.replace(/[%_\\]/g, '\\$&')}%`, [...TOP]]) : [];
    const hidden = await hiddenFor(profile);
    const applies = activeFor(await rules(), profile).map((x) => x.name);
    return { profile: profile.name, applies, items: rows.map((x) => ({ ...x, visible: !hidden?.has(x.id), why: hidden?.get(x.id) || null })) };
  }, admin);
}
