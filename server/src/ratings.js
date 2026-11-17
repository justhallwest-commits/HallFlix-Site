// Ratings: IMDb, Rotten Tomatoes, Metacritic, Letterboxd and more, from rating services.
// TMDb's score is built in (it comes with the metadata). OMDb (IMDb, Rotten Tomatoes, Metacritic) and MDBList (all of
// those plus Letterboxd, Trakt, audience scores) need a free key. Any JSON ratings API can be added in the Studio, and
// plugins can declare services too. Services are asked in order; for each source the first answer wins.
// What's found is kept for two weeks; a short copy goes on the item so cards can show a badge without asking again.
import { cfg } from './config.js';
import { q, q1, getSetting, setSetting } from './db.js';
import { HttpError, readJson } from './http.js';
import { listPlugins } from './plugins.js';
import * as tmdb from './tmdb.js';
import { dig, fill, cleanHeaders, getJson, hideSecrets, keepSecret, ServiceError } from './services.js';

const STALE_DAYS = 14;
const RETRY_MISSING_DAYS = 3;

/** Every source HallFlix knows how to show, its scale, and how it reads. */
export const SOURCES = {
  imdb: { label: 'IMDb', max: 10 },
  rt: { label: 'Rotten Tomatoes', max: 100 },
  rtAudience: { label: 'Popcornmeter', max: 100 },
  metacritic: { label: 'Metacritic', max: 100 },
  metacriticUser: { label: 'Metacritic users', max: 10 },
  letterboxd: { label: 'Letterboxd', max: 5 },
  trakt: { label: 'Trakt', max: 100 },
  tmdb: { label: 'TMDb', max: 10 },
  mal: { label: 'MyAnimeList', max: 10 },
  rogerebert: { label: 'Roger Ebert', max: 4 },
};
const ALIASES = {
  imdb: 'imdb', 'internet movie database': 'imdb', 'rotten tomatoes': 'rt', tomatoes: 'rt', tomatometer: 'rt', rt: 'rt',
  popcorn: 'rtAudience', popcornmeter: 'rtAudience', tomatoesaudience: 'rtAudience', audience: 'rtAudience', 'rotten tomatoes audience': 'rtAudience',
  metacritic: 'metacritic', metascore: 'metacritic', metacriticuser: 'metacriticUser', letterboxd: 'letterboxd', trakt: 'trakt',
  tmdb: 'tmdb', themoviedb: 'tmdb', 'the movie database': 'tmdb', myanimelist: 'mal', mal: 'mal', rogerebert: 'rogerebert', 'roger ebert': 'rogerebert',
};
export const sourceKey = (name) => ALIASES[String(name || '').trim().toLowerCase()] || null;
const DEFAULT_SHOW = ['imdb', 'rt', 'rtAudience', 'metacritic', 'letterboxd', 'trakt', 'tmdb'];

/** "7.7/10", "83%", "67/100" or a bare number, on the source's own scale. */
export function parseValue(v, defMax = 10) {
  if (v == null || v === '' || v === 'N/A') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? { value: v, max: defMax } : null;
  const s = String(v).replace(/,/g, '').trim();
  let m = /^(-?\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/.exec(s);
  if (m) return { value: +m[1], max: +m[2] };
  m = /^(\d+(?:\.\d+)?)\s*%$/.exec(s);
  if (m) return { value: +m[1], max: 100 };
  m = /^-?\d+(?:\.\d+)?$/.exec(s);
  return m ? { value: +s, max: defMax } : null;
}

export function display(source, value, max) {
  if (max === 100) return ['rt', 'rtAudience', 'trakt'].includes(source) || !SOURCES[source] ? `${Math.round(value)}%` : String(Math.round(value));
  if (max === 4) return `${Math.round(value * 10) / 10}/4`;
  return (Math.round(value * 10) / 10).toFixed(1);
}

/** One rating, checked and put on the source's usual scale. */
function entry(source, raw, { label, votes, url, from, score } = {}) {
  const meta = SOURCES[source];
  const p = parseValue(raw, meta?.max || 10);
  if (!p || p.value <= 0) return null;
  let { value, max } = p;
  if (meta && max !== meta.max) {
    // An answer on another scale (MDBList gives TMDb out of 100, for example): convert it.
    if (max === 100 && meta.max === 10 && value > 10) value /= 10;
    else if (score != null && +score > 0) value = (+score / 100) * meta.max;
    else value = (value / max) * meta.max;
    max = meta.max;
  }
  if (value > max) return null;
  const v = Math.round(value * 10) / 10;
  const n = votes == null ? null : +String(votes).replace(/[^\d]/g, '') || null;
  return { source, label: label || meta?.label || source, value: v, max, display: display(source, v, max), votes: n, url: /^https?:\/\//.test(url || '') ? url : null, from };
}

// ---------- services ----------
const BUILTIN = [
  { id: 'tmdb', name: 'TMDb', kind: 'builtin', description: 'The score that comes with your metadata. Always available, no key needed.', needsKey: false, gives: ['tmdb'] },
  { id: 'omdb', name: 'OMDb', kind: 'builtin', description: 'IMDb, Rotten Tomatoes and Metacritic. A free key from omdbapi.com allows 1,000 lookups a day.', needsKey: true, keyUrl: 'https://www.omdbapi.com/apikey.aspx', gives: ['imdb', 'rt', 'metacritic'] },
  { id: 'mdblist', name: 'MDBList', kind: 'builtin', description: 'IMDb, Rotten Tomatoes and its Popcornmeter, Metacritic, Letterboxd, Trakt and more in one lookup. Free key in your mdblist.com preferences.', needsKey: true, keyUrl: 'https://mdblist.com/preferences/', gives: ['imdb', 'rt', 'rtAudience', 'metacritic', 'letterboxd', 'trakt', 'tmdb', 'rogerebert', 'mal'] },
];

/** The movie or show behind any item (an episode or season asks for its show). */
async function titleFor(id) {
  let r = await q1(`select id, kind, title, year, tmdb_id, score, show_id from items where id=$1`, [id]);
  if (r && (r.kind === 'episode' || r.kind === 'season') && r.show_id) r = await q1(`select id, kind, title, year, tmdb_id, score, show_id from items where id=$1`, [r.show_id]);
  if (!r || !['movie', 'show'].includes(r.kind)) throw new HttpError(404, 'Ratings are for movies and shows');
  return r;
}

/** IMDb's id for a title, from TMDb, kept with the ratings so it's asked once. */
async function imdbFor(t) {
  if (t.imdb !== undefined) return t.imdb;
  t.imdb = null;
  if (t.tmdb) {
    try { t.imdb = (await tmdb.call(`/${t.type}/${t.tmdb}/external_ids`))?.imdb_id || null; } catch { /* no TMDb */ }
  }
  return t.imdb;
}

async function ask(p, t) {
  if (p.id === 'tmdb') return t.score ? [entry('tmdb', +t.score, { from: 'TMDb', url: t.tmdb ? `https://www.themoviedb.org/${t.type}/${t.tmdb}` : null })] : [];
  if (p.id === 'omdb') {
    if (!p.apiKey) return [];
    const imdb = await imdbFor(t);
    const qs = new URLSearchParams({ apikey: p.apiKey, ...(imdb ? { i: imdb } : { t: t.title, type: t.type === 'tv' ? 'series' : 'movie', ...(t.year ? { y: String(t.year) } : {}) }) });
    const d = await getJson(`${cfg.omdbBase.replace(/\/$/, '')}/?${qs}`);
    if (!d) return [];
    if (d.Response === 'False') { if (/key/i.test(d.Error || '')) throw new ServiceError(d.Error); return []; }
    if (d.imdbID && !t.imdb) t.imdb = d.imdbID;
    const out = [];
    for (const x of d.Ratings || []) { const k = sourceKey(x.Source); if (k) out.push(entry(k, x.Value, { from: 'OMDb' })); }
    if (!out.some((x) => x?.source === 'imdb') && d.imdbRating) out.push(entry('imdb', d.imdbRating, { from: 'OMDb' }));
    if (!out.some((x) => x?.source === 'metacritic') && d.Metascore) out.push(entry('metacritic', d.Metascore, { from: 'OMDb' }));
    const imdbHit = out.find((x) => x?.source === 'imdb');
    if (imdbHit && d.imdbVotes) imdbHit.votes = +String(d.imdbVotes).replace(/[^\d]/g, '') || null;
    return out;
  }
  if (p.id === 'mdblist') {
    if (!p.apiKey) return [];
    const kind = t.type === 'tv' ? 'show' : 'movie';
    const base = cfg.mdblistBase.replace(/\/$/, '');
    let d = null;
    if (t.tmdb) d = await getJson(`${base}/tmdb/${kind}/${t.tmdb}?${new URLSearchParams({ apikey: p.apiKey })}`);
    if (!d) { const imdb = await imdbFor(t); if (imdb) d = await getJson(`${base}/imdb/${kind}/${imdb}?${new URLSearchParams({ apikey: p.apiKey })}`); }
    if (!d || d.error) { if (d?.error && /key/i.test(d.error)) throw new ServiceError(d.error); return []; }
    const imdbId = d.ids?.imdb || d.imdbid;
    if (imdbId && !t.imdb) t.imdb = imdbId;
    return (d.ratings || []).map((x) => { const k = sourceKey(x.source); return k ? entry(k, x.value, { votes: x.votes, url: x.url, score: x.score, from: 'MDBList' }) : null; });
  }
  // A service added in the Studio or by a plugin.
  if (!p.url) return [];
  const need = (k) => p.url.includes(`{${k}}`);
  if (need('imdb')) await imdbFor(t);
  if ((need('imdb') && !t.imdb) || (need('tmdb') && !t.tmdb)) return [];
  const vals = { imdb: t.imdb || '', tmdb: t.tmdb || '', type: t.type, kind: t.type === 'tv' ? 'show' : 'movie', title: t.title, year: t.year || '', key: p.apiKey || '' };
  const d = await getJson(fill(p.url, vals), { headers: cleanHeaders(p.headers) });
  if (!d) return [];
  if (p.list) {
    const list = dig(d, p.list);
    return (Array.isArray(list) ? list : []).map((x) => {
      const name = dig(x, p.source || 'source');
      const k = sourceKey(name) || `x-${String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30)}`;
      return entry(k, dig(x, p.value || 'value'), { label: SOURCES[k] ? undefined : String(name || p.name), votes: p.votes ? dig(x, p.votes) : null, url: p.link ? dig(x, p.link) : null, from: p.name });
    });
  }
  const k = sourceKey(p.label || p.name) || `x-${String(p.id).replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 30)}`;
  const raw = dig(d, p.value || 'rating');
  const max = +p.max || SOURCES[k]?.max || 10;
  const parsed = parseValue(raw, max);
  return parsed ? [entry(k, parsed.max === max ? `${parsed.value}/${max}` : raw, { label: SOURCES[k] ? undefined : String(p.label || p.name), votes: p.votes ? dig(d, p.votes) : null, url: p.link ? dig(d, p.link) : null, from: p.name })] : [];
}

/** Every service, in the order the Studio set, with plugin services added at the end the first time they appear. */
export async function providers() {
  const saved = await getSetting('ratings', {});
  const list = Array.isArray(saved.providers) ? saved.providers : [];
  const fromPlugins = [];
  for (const pl of await listPlugins()) {
    if (!pl.enabled || pl.broken) continue;
    for (const x of pl.ratings || []) fromPlugins.push({ ...x, id: `plugin:${pl.id}:${x.key}`, kind: 'plugin', plugin: pl.name });
  }
  const known = new Map([...BUILTIN, ...fromPlugins].map((p) => [p.id, p]));
  const out = [], seen = new Set();
  for (const s of list) {
    if (!s || seen.has(s.id)) continue;
    if (known.has(s.id)) out.push({ ...known.get(s.id), enabled: s.enabled !== false, apiKey: s.apiKey || '' });
    else if (String(s.id).startsWith('custom:') && s.url) out.push({ ...s, kind: 'custom', enabled: s.enabled !== false });
    else continue;
    seen.add(s.id);
  }
  // New services start switched on, except the ones that need a key nobody has given yet.
  for (const p of known.values()) if (!seen.has(p.id)) out.push({ ...p, enabled: true, apiKey: '' });
  return out;
}

export async function settings() {
  const s = await getSetting('ratings', {});
  const show = Array.isArray(s.show) ? s.show.filter((k) => SOURCES[k] || String(k).startsWith('x-')) : DEFAULT_SHOW;
  return { show, badge: typeof s.badge === 'string' ? s.badge : 'auto', autoFetch: s.autoFetch !== false };
}

/** What the apps need to know at start: which badge goes on cards. */
export async function clientSettings() { const s = await settings(); return { badge: s.badge, show: s.show }; }

/** Ask every enabled service, in order; for each source the first answer wins. */
async function lookUp(t) {
  const got = new Map();
  const errors = [];
  for (const p of (await providers()).filter((x) => x.enabled)) {
    if (p.needsKey && !p.apiKey) continue;
    try { for (const e of await ask(p, t)) if (e && !got.has(e.source)) got.set(e.source, e); }
    catch (e) { errors.push(`${p.name}: ${e.message}`); }
  }
  if (errors.length) console.log('[ratings]', t.title, errors.join('; '));
  return { list: [...got.values()], errors };
}

const typeOf = (r) => (r.kind === 'show' ? 'tv' : 'movie');
const summary = (list) => Object.fromEntries(list.map((e) => [e.source, [e.value, e.max]]));

async function store(r, t, list) {
  await q(`insert into ratings (item_id, data, imdb_id, missing, fetched_at) values ($1,$2::jsonb,$3,$4,now())
           on conflict (item_id) do update set data=excluded.data, imdb_id=coalesce(excluded.imdb_id, ratings.imdb_id), missing=excluded.missing, fetched_at=now()`,
    [r.id, JSON.stringify(list), t.imdb || null, !list.length]);
  await q(`update items set extra = jsonb_set(coalesce(extra,'{}'), '{ratings}', $2::jsonb) where id=$1`, [r.id, JSON.stringify(summary(list))]);
}

const inflight = new Map();
async function refresh(r, cached) {
  if (!inflight.has(r.id)) {
    const t = { type: typeOf(r), title: r.title, year: r.year, tmdb: r.tmdb_id, score: r.score, ...(cached?.imdb_id ? { imdb: cached.imdb_id } : {}) };
    inflight.set(r.id, lookUp(t).then(async ({ list }) => { await store(r, t, list); return { list, imdb: t.imdb }; }).finally(() => inflight.delete(r.id)));
  }
  return inflight.get(r.id);
}

function links(r, imdb) {
  const type = typeOf(r);
  return {
    imdb: imdb ? `https://www.imdb.com/title/${imdb}/` : null,
    tmdb: r.tmdb_id ? `https://www.themoviedb.org/${type}/${r.tmdb_id}` : null,
    letterboxd: type === 'movie' && r.tmdb_id ? `https://letterboxd.com/tmdb/${r.tmdb_id}/` : null,
    trakt: r.tmdb_id ? `https://trakt.tv/search/tmdb/${r.tmdb_id}?id_type=${type === 'tv' ? 'show' : 'movie'}` : null,
  };
}

/** Put the ratings in the order the Studio chose, with each one's link filled in where the service gave none. */
function shape(r, list, imdb, s) {
  const l = links(r, imdb);
  const byKey = new Map(list.map((e) => [e.source, e]));
  const order = [...s.show, ...list.map((e) => e.source).filter((k) => k.startsWith('x-') && !s.show.includes(k))];
  const fallback = { imdb: l.imdb, tmdb: l.tmdb, letterboxd: l.letterboxd, trakt: l.trakt };
  return { ratings: order.map((k) => byKey.get(k)).filter(Boolean).map((e) => ({ ...e, url: e.url || fallback[e.source] || null })), imdb: imdb || null, links: l };
}

/** Ratings for a movie or show (or the show an episode belongs to). */
export async function ratingsFor(id, { fetch: fetchOnline = true } = {}) {
  const r = await titleFor(id);
  const s = await settings();
  const row = await q1('select * from ratings where item_id=$1', [r.id]);
  const age = row ? Date.now() - new Date(row.fetched_at) : Infinity;
  const tmdbOnly = () => (r.score ? [entry('tmdb', +r.score, { from: 'TMDb' })] : []);
  if (row && !row.missing) {
    if (age > STALE_DAYS * 86400e3 && fetchOnline && s.autoFetch) refresh(r, row).catch(() => {});
    return shape(r, row.data, row.imdb_id, s);
  }
  if (row?.missing && age < RETRY_MISSING_DAYS * 86400e3) return shape(r, tmdbOnly(), row.imdb_id, s);
  if (!fetchOnline || !s.autoFetch) return shape(r, tmdbOnly(), row?.imdb_id, s);
  const got = await refresh(r, row);
  return shape(r, got.list, got.imdb, s);
}

// ---------- fetching for a whole library ----------
export const job = { running: false, done: 0, total: 0, found: 0, errors: 0, started: null, finished: null };
async function refreshAll({ missingOnly = true } = {}) {
  if (job.running) return;
  const rows = await q(`select i.id, i.kind, i.title, i.year, i.tmdb_id, i.score from items i left join ratings r on r.item_id = i.id
    where i.kind in ('movie','show') ${missingOnly ? 'and r.item_id is null' : ''} order by i.added_at desc`);
  Object.assign(job, { running: true, done: 0, total: rows.length, found: 0, errors: 0, started: new Date().toISOString(), finished: null });
  try {
    for (const r of rows) {
      if (!job.running) break;
      try { const got = await refresh(r, await q1('select imdb_id from ratings where item_id=$1', [r.id])); if (got.list.length) job.found++; }
      catch { job.errors++; }
      job.done++;
      await new Promise((ok) => setTimeout(ok, cfg.ratingsDelayMs ?? 1100)); // be kind to free tiers (about 1,000 lookups a day)
    }
  } finally { job.running = false; job.finished = new Date().toISOString(); }
}

export function routes(r) {
  r.get('/api/ratings/:id', async ({ params }) => ratingsFor(params.id));

  const admin = { admin: true };
  r.get('/api/studio/ratings', async () => {
    const counts = await q1(`select count(*) filter (where not missing)::int as found, count(*) filter (where missing)::int as missing,
      (select count(*)::int from items where kind in ('movie','show')) as titles from ratings`);
    return { ...(await settings()), providers: (await providers()).map(hideSecrets), sources: SOURCES, counts, job };
  }, admin);
  r.put('/api/studio/ratings', async ({ req }) => {
    const b = await readJson(req);
    const before = new Map((await providers()).map((p) => [p.id, p]));
    const list = (Array.isArray(b.providers) ? b.providers : []).slice(0, 30).map((p) => {
      const id = String(p.id || '');
      const apiKey = keepSecret(p, before.get(id), 'apiKey');
      if (id.startsWith('custom:')) {
        const url = String(p.url || '').trim();
        if (!/^https?:\/\//i.test(url)) throw new HttpError(400, `“${p.name || 'A custom service'}” needs a web address starting with http:// or https://`);
        return { id, name: String(p.name || 'My ratings service').slice(0, 60), enabled: p.enabled !== false, url, apiKey, headers: cleanHeaders(p.headers),
          ...Object.fromEntries(['list', 'source', 'value', 'votes', 'link', 'label', 'max'].map((k) => [k, String(p[k] ?? '').slice(0, 100)])) };
      }
      return { id, enabled: p.enabled !== false, apiKey };
    });
    const show = (Array.isArray(b.show) ? b.show : DEFAULT_SHOW).map(String).filter((k) => SOURCES[k] || k.startsWith('x-')).slice(0, 20);
    const badge = typeof b.badge === 'string' && (b.badge === 'auto' || b.badge === 'none' || SOURCES[b.badge]) ? b.badge : 'auto';
    await setSetting('ratings', { providers: list, show, badge, autoFetch: b.autoFetch !== false });
    return { ok: true, ...(await settings()), providers: (await providers()).map(hideSecrets) };
  }, admin);
  // Try the services with one title, to check a key or a new service.
  r.post('/api/studio/ratings/test', async ({ req }) => {
    const b = await readJson(req);
    let t;
    if (b.itemId) { const row = await titleFor(b.itemId); t = { type: typeOf(row), title: row.title, year: row.year, tmdb: row.tmdb_id, score: row.score }; }
    else {
      const title = String(b.title || '').trim();
      if (!title) throw new HttpError(400, 'Give a title to try');
      t = { type: b.kind === 'show' ? 'tv' : 'movie', title, year: +b.year || null, tmdb: +b.tmdbId || null, score: null };
    }
    const out = [];
    for (const p of await providers()) {
      if (b.only && p.id !== b.only) continue;
      const started = Date.now();
      if (p.needsKey && !p.apiKey) { out.push({ id: p.id, name: p.name, enabled: p.enabled, found: false, error: 'No key yet' }); continue; }
      try {
        const got = (await ask(p, t)).filter(Boolean);
        out.push({ id: p.id, name: p.name, enabled: p.enabled, ms: Date.now() - started, found: got.length > 0, ratings: got.map((e) => `${e.label} ${e.display}`) });
      } catch (e) { out.push({ id: p.id, name: p.name, enabled: p.enabled, ms: Date.now() - started, found: false, error: e.message }); }
    }
    return { results: out, imdb: t.imdb || null };
  }, admin);
  r.post('/api/studio/ratings/refresh', async ({ req }) => {
    const b = await readJson(req);
    if (b.stop) { job.running = false; return { job }; }
    refreshAll({ missingOnly: b.all !== true }).catch((e) => console.error('[ratings]', e));
    await new Promise((ok) => setTimeout(ok, 50));
    return { job };
  }, admin);
  r.delete('/api/studio/ratings/cache', async () => {
    await q('delete from ratings');
    await q(`update items set extra = extra - 'ratings' where extra ? 'ratings'`);
    return { ok: true };
  }, admin);
}
