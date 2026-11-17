// Plain-language search, the Top 10 and "for you" rows, the personal hub, cast pages, chapters, lyrics, playlists,
// bookmarks, signing a TV in from a phone, and using a phone as a remote.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cfg } from './config.js';
import { q, q1 } from './db.js';
import { HttpError, readJson } from './http.js';
import { card, img, SEL, FROM, COUNT } from './catalog.js';
import { MOODS } from './extras.js';
import * as auth from './auth.js';

const exec = promisify(execFile);

// ---------- plain-language search ----------
const FEEL = [
  [/\b(funny|comed(y|ies)|hilarious|laughs?|upbeat|light[- ]?hearted)\b/, 'Funny', ['Comedy']],
  [/\b(scary|spooky|horror|creepy|frightening)\b/, 'Scary', ['Horror']],
  [/\b(romantic|romance|love story|date night)\b/, 'Romantic', ['Romance']],
  [/\b(cozy|cosy|feel[- ]?good|comforting|wholesome)\b/, 'Cozy', MOODS.find((m) => m.id === 'cozy').genres],
  [/\b(intense|exciting|thrilling|action[- ]?packed|gripping|edge of (my|your) seat)\b/, 'Intense', MOODS.find((m) => m.id === 'intense').genres],
  [/\b(mind[- ]?bending|trippy|weird|strange|thought[- ]?provoking)\b/, 'Mind-bending', MOODS.find((m) => m.id === 'mind-bending').genres],
  [/\b(dark|gritty|grim|bleak)\b/, 'Dark', MOODS.find((m) => m.id === 'dark').genres],
  [/\b(epic|sweeping)\b/, 'Epic', MOODS.find((m) => m.id === 'epic').genres],
  [/\b(true stor(y|ies)|based on (a )?true|real[- ]life)\b/, 'True stories', ['Documentary', 'History']],
  [/\b(for (the )?kids|kid[- ]?friendly|family[- ]?friendly|for (the )?family|children'?s?)\b/, 'For the family', ['Family', 'Animation', 'Kids']],
  [/\b(sad|tear[- ]?jerker|emotional|moving)\b/, 'Emotional', ['Drama']],
  [/\b(sci[- ]?fi|science fiction|space)\b/, 'Science fiction', ['Science Fiction', 'Sci-Fi & Fantasy']],
];
const STOP = new Set(('a an the some something anything show me i want to watch find give us we looking for that is are with and or of in on from not too but really very kind like maybe please ' +
  'movie movies film films shows series tv one ones stuff thing things good great best top rated new old short long under over less more than hours hour minutes minute mins min its it s').split(' '));

/** Turn "a short dark mystery from the 90s" into filters. Returns null when the words carry none. */
export function understand(term, genreNames = []) {
  let s = ` ${String(term).toLowerCase().replace(/[^\p{L}\p{N}'\- ]+/gu, ' ').replace(/\s+/g, ' ')} `;
  const f = { labels: [], genreSets: [] };
  const take = (rx, fn) => { const m = rx.exec(s); if (m) { s = s.replace(m[0], ' '); fn(m); } return !!m; };
  take(/\b(haven'?t (seen|watched)|not (seen|watched)( yet)?|unwatched|unseen|new to me)\b/, () => { f.unwatched = true; f.labels.push('Not watched yet'); });
  take(/\b(?:under|less than|shorter than|max(?:imum)?)\s+(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m)\b/, (m) => { f.maxMin = /^h/.test(m[2]) ? +m[1] * 60 : +m[1]; f.labels.push(`Under ${m[1]} ${/^h/.test(m[2]) ? (+m[1] === 1 ? 'hour' : 'hours') : 'minutes'}`); });
  take(/\b(?:over|more than|longer than)\s+(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m)\b/, (m) => { f.minMin = /^h/.test(m[2]) ? +m[1] * 60 : +m[1]; f.labels.push(`Over ${m[1]} ${/^h/.test(m[2]) ? 'hours' : 'minutes'}`); });
  take(/\b(not too long|short|quick)\b/, () => { f.maxMin ??= 100; f.labels.push('Short'); });
  take(/\b(long|epic[- ]length)\b/, () => { f.minMin ??= 150; f.labels.push('Long'); });
  take(/\b(?:from |in |of )?(?:the )?((?:19|20)\d0)'?s\b/, (m) => { f.from = +m[1]; f.to = +m[1] + 9; f.labels.push(`${m[1]}s`); })
    || take(/\b(?:from |in |of )?(?:the )?'?(\d0)'?s\b/, (m) => { const d = +m[1] + (+m[1] <= 20 ? 2000 : 1900); f.from = d; f.to = d + 9; f.labels.push(`${d}s`); });
  take(/\b(?:before|older than|pre)\s+((?:19|20)\d\d)\b/, (m) => { f.to = +m[1] - 1; f.labels.push(`Before ${m[1]}`); });
  take(/\b(?:after|since|newer than)\s+((?:19|20)\d\d)\b/, (m) => { f.from = +m[1]; f.labels.push(`Since ${m[1]}`); });
  take(/\b(?:from|in|of)\s+((?:19|20)\d\d)\b/, (m) => { f.from = f.to = +m[1]; f.labels.push(m[1]); });
  take(/\b(classics?|old(er)?|vintage)\b/, () => { f.to ??= 1989; f.labels.push('Classics'); });
  take(/\b(recent(ly added)?|new(est)?|latest|just added)\b/, () => { f.recent = true; f.labels.push('Recently added'); });
  take(/\b(best|top[- ]rated|highest rated|acclaimed|great|masterpieces?)\b/, () => { f.best = true; f.labels.push('Top rated'); });
  take(/\brated\s+(g|pg|pg-13|r|nc-17|tv-ma|tv-14|tv-pg|tv-y7?|tv-g)\b/, (m) => { f.rating = m[1].toUpperCase(); f.labels.push(`Rated ${f.rating}`); });
  for (const [rx, label, genres] of FEEL) take(rx, () => { f.genreSets.push(genres); f.labels.push(label); });
  for (const g of [...genreNames].sort((a, b) => b.length - a.length)) {
    const esc = g.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rx = new RegExp(`\\b${esc.endsWith('y') ? `${esc.slice(0, -1)}(?:y|ies)` : `${esc}s?`}\\b`);
    take(rx, () => { if (!f.genreSets.some((set) => set.length === 1 && set[0] === g)) { f.genreSets.push([g]); f.labels.push(g); } });
  }
  take(/\b(mysteries)\b/, () => { f.genreSets.push(['Mystery']); f.labels.push('Mystery'); });
  if (/\b(movies?|films?)\b/.test(s)) f.kind = 'movie'; else if (/\b(shows?|series|tv)\b/.test(s)) f.kind = 'show';
  if (f.kind && f.labels.length) f.labels.unshift(f.kind === 'movie' ? 'Movies' : 'Shows');
  f.rest = s.split(' ').filter((w) => w && !STOP.has(w)).join(' ').trim();
  return f.labels.length ? f : null;
}

export async function smartSearch(pid, term) {
  const names = (await q(`select distinct g from items i, unnest(i.genres) g where i.kind in ('movie','show')`)).map((r) => r.g);
  const f = understand(term, names);
  if (!f) return null;
  const run = async (withRest) => {
    const args = [pid];
    let where = `i.kind in ('movie','show')`;
    const add = (v, sql) => { args.push(v); where += ` and ${sql.replace('?', `$${args.length}`)}`; };
    if (f.kind) add(f.kind, 'i.kind = ?');
    for (const set of f.genreSets) add(set, 'i.genres && ?::text[]');
    if (f.from) add(f.from, 'i.year >= ?');
    if (f.to) add(f.to, 'i.year <= ?');
    if (f.maxMin) add(f.maxMin * 60, `i.kind = 'movie' and i.runtime_s <= ?`);
    if (f.minMin) add(f.minMin * 60, `i.kind = 'movie' and i.runtime_s >= ?`);
    if (f.rating) add(f.rating, 'upper(i.rating) = ?');
    if (f.best) where += ' and i.score >= 7';
    if (f.recent) where += ` and i.added_at > now() - interval '60 days'`;
    if (f.unwatched) where += ` and p.item_id is null and not exists (select 1 from progress pp join items e on e.id = pp.item_id where pp.profile_id = $1 and e.show_id = i.id)`;
    if (withRest) add(`%${f.rest.replace(/[%_\\]/g, '\\$&')}%`, `(i.title ilike ? or exists (select 1 from jsonb_array_elements(i.people) x where x->>'name' ilike $${args.length + 1}))`);
    const order = f.best ? 'i.score desc nulls last' : f.recent ? 'i.added_at desc' : 'i.score desc nulls last, i.sort_title';
    return q(`select ${SEL} ${FROM} where ${where} order by ${order} limit 60`, args);
  };
  let items = f.rest.length >= 3 ? await run(true) : [];
  if (!items.length) items = await run(false);
  return { items: items.map(card), understood: f.labels };
}

// ---------- rows for Home ----------
export async function top10Row(pid) {
  const rows = await q(
    `with plays as (
       select coalesce(i.show_id, i.id) as id, count(distinct (p.profile_id, p.item_id))::int as n, max(p.updated_at) as last
       from progress p join items i on i.id = p.item_id
       where p.updated_at > now() - interval '30 days' and i.kind in ('movie','episode') group by 1)
     select ${SEL}, pl.n ${FROM} join plays pl on pl.id = i.id order by pl.n desc, pl.last desc limit 10`, [pid]);
  return rows.length >= 4 ? { id: 'top10', title: 'Most watched here this month', shape: 'ranked', items: rows.map(card) } : null;
}

export async function forYouRows(pid) {
  const out = [];
  const last = await q1(
    `select coalesce(s.id, i.id) as id, coalesce(s.title, i.title) as title, coalesce(s.genres, i.genres) as genres, coalesce(s.kind, i.kind) as kind
     from progress p join items i on i.id = p.item_id left join items s on s.id = i.show_id
     where p.profile_id = $1 and i.kind in ('movie','episode') and (p.watched or p.position_s > 600) order by p.updated_at desc limit 1`, [pid]);
  if (last?.genres?.length) {
    const like = await q(
      `select ${SEL} ${FROM} where i.kind in ('movie','show') and i.id <> $2 and i.genres && $3::text[] and p.item_id is null
         and not exists (select 1 from progress pp join items e on e.id = pp.item_id where pp.profile_id = $1 and e.show_id = i.id)
       order by cardinality(array(select unnest(i.genres) intersect select unnest($3::text[]))) desc, i.score desc nulls last limit 20`, [pid, last.id, last.genres]);
    if (like.length >= 4) out.push({ id: 'because', title: `Because you watched ${last.title}`, items: like.map(card) });
  }
  const gems = await q(
    `select ${SEL} ${FROM} where i.kind in ('movie','show') and i.score >= 7 and i.added_at < now() - interval '45 days' and p.item_id is null
       and not exists (select 1 from progress pp join items e on e.id = pp.item_id where e.show_id = i.id or e.id = i.id)
     order by i.score desc, md5(i.id::text || current_date::text) limit 20`, [pid]);
  if (gems.length >= 4) out.push({ id: 'gems', title: 'Hidden gems nobody has opened', items: gems.map(card) });
  return out;
}

/** A title appears once among the discovery rows; rows left too thin are dropped. */
export function dedupe(rows) {
  const seen = new Set();
  return rows.filter((r) => {
    if (!['top10', 'because', 'gems', 'top'].includes(r.id) && !r.id.startsWith('genre-')) return true;
    const fresh = r.items.filter((it) => !seen.has(it.id));
    if (r.id === 'top10') { for (const it of r.items) seen.add(it.id); return true; }
    if (fresh.length < Math.min(4, r.items.length)) return false;
    r.items = fresh;
    for (const it of fresh) seen.add(it.id);
    return true;
  });
}

// ---------- pairing a TV from a phone, and the phone remote ----------
const pairs = new Map();
const devices = new Map(); // profile id -> Map(device id -> { name, state, seen, commands })
setInterval(() => {
  const now = Date.now();
  for (const [code, p] of pairs) if (now > p.expires) pairs.delete(code);
  for (const [pid, m] of devices) { for (const [id, d] of m) if (now - d.seen > 15e3) m.delete(id); if (!m.size) devices.delete(pid); }
}, 5e3).unref();
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function lrc(text) {
  const out = [];
  for (const line of text.replace(/\r/g, '').split('\n')) {
    const stamps = [...line.matchAll(/\[(\d+):(\d+(?:[.:]\d+)?)\]/g)];
    const words = line.replace(/\[[^\]]*\]/g, '').trim();
    for (const m of stamps) out.push({ t: +m[1] * 60 + parseFloat(m[2].replace(':', '.')), text: words });
  }
  return out.sort((a, b) => a.t - b.t);
}

export function routes(r) {
  // ----- the personal hub -----
  r.get('/api/me', async ({ profile }) => {
    const pid = profile.id;
    const rows = [];
    const cont = await q(`select ${SEL} ${FROM} where p.profile_id=$1 and not p.watched and p.position_s > 20 and i.kind in ('movie','episode') order by p.updated_at desc limit 24`, [pid]);
    if (cont.length) rows.push({ id: 'continue', title: 'Continue watching', shape: 'wide', items: cont.map(card) });
    const reading = await q(`select ${SEL} ${FROM} where p.profile_id=$1 and not p.watched and p.position_s > 0 and i.kind in ('book','comic') order by p.updated_at desc limit 24`, [pid]);
    if (reading.length) rows.push({ id: 'reading', title: 'Continue reading', items: reading.map(card) });
    const mine = await q(`select ${SEL}, ${COUNT} ${FROM} join mylist m on m.item_id = i.id and m.profile_id = $1 order by m.added_at desc limit 60`, [pid]);
    if (mine.length) rows.push({ id: 'mylist', title: 'My List', items: mine.map(card) });
    const albums = await q(
      `select ${SEL}, ${COUNT} ${FROM} join (select t.parent_id, max(pp.updated_at) as last from progress pp join items t on t.id = pp.item_id where pp.profile_id=$1 and t.kind='track' group by 1) x on x.parent_id = i.id
       order by x.last desc limit 20`, [pid]);
    if (albums.length) rows.push({ id: 'played', title: 'Recently played', shape: 'square', items: albums.map(card) });
    const done = await q(`select ${SEL} ${FROM} where p.profile_id=$1 and p.watched and i.kind in ('movie','book') order by p.updated_at desc limit 24`, [pid]);
    if (done.length) rows.push({ id: 'finished', title: 'Recently finished', items: done.map(card) });
    const t = await q1(`select count(*) filter (where p.watched and i.kind='movie')::int as movies, count(*) filter (where p.watched and i.kind='episode')::int as episodes,
        count(*) filter (where p.watched and i.kind in ('book','comic'))::int as read from progress p join items i on i.id = p.item_id where p.profile_id=$1`, [pid]);
    const playlists = await q(`select pl.id, pl.name, count(pi.item_id)::int as count from playlists pl left join playlist_items pi on pi.playlist_id = pl.id where pl.profile_id=$1 group by pl.id order by pl.name`, [pid]);
    return { name: profile.name, color: profile.color, totals: t, rows, playlists };
  });

  // ----- cast and crew -----
  r.get('/api/person', async ({ profile, query }) => {
    const name = String(query.name || '').trim();
    if (!name) throw new HttpError(404, 'Not found');
    const rows = await q(
      `select ${SEL}, x->>'role' as role, x->>'photo' as photo ${FROM}, jsonb_array_elements(i.people) x
       where i.kind in ('movie','show') and lower(x->>'name') = lower($2) order by i.year desc nulls last, i.sort_title`, [profile.id, name]);
    if (!rows.length) throw new HttpError(404, 'Nobody by that name in your library');
    const photo = rows.find((x) => x.photo)?.photo;
    return { name, photo: img(photo, 'w500'), items: rows.map((x) => ({ ...card(x), role: x.role, backdrop: img(x.backdrop, 'w780') })) };
  });

  // ----- chapters (read from the file the first time they are asked for) -----
  r.get('/api/chapters/:id', async ({ params }) => {
    const item = await q1(`select id, path, mtime, extra from items where id=$1 and kind in ('movie','episode')`, [params.id]);
    if (!item?.path) throw new HttpError(404, 'Not found');
    if (item.extra?.chaptersAt === item.mtime) return { chapters: item.extra.chapters || [] };
    let chapters = [];
    try {
      const { stdout } = await exec(cfg.ffprobe, ['-v', 'error', '-show_chapters', '-of', 'json', item.path], { timeout: 30e3, maxBuffer: 4e6 });
      chapters = (JSON.parse(stdout).chapters || []).map((c, i) => ({ start: +c.start_time || 0, title: c.tags?.title || `Chapter ${i + 1}` })).filter((c, i, a) => i === 0 || c.start - a[i - 1].start > 5);
      if (chapters.length < 2) chapters = [];
    } catch { /* no chapters */ }
    await q(`update items set extra = extra || $1::jsonb where id=$2`, [JSON.stringify({ chapters, chaptersAt: item.mtime }), item.id]);
    return { chapters };
  });

  // ----- lyrics: a .lrc or .txt beside the song, or lyrics stored in its tags -----
  r.get('/api/lyrics/:id', async ({ params }) => {
    const item = await q1(`select path from items where id=$1 and kind='track'`, [params.id]);
    if (!item?.path) throw new HttpError(404, 'Not found');
    const stem = item.path.slice(0, -path.extname(item.path).length);
    for (const ext of ['.lrc', '.LRC']) {
      try { const lines = lrc(await fs.promises.readFile(stem + ext, 'utf8')); if (lines.length) return { synced: lines }; } catch { /* next */ }
    }
    try { const text = (await fs.promises.readFile(`${stem}.txt`, 'utf8')).trim(); if (text) return { plain: text.slice(0, 20000) }; } catch { /* next */ }
    try {
      const { stdout } = await exec(cfg.ffprobe, ['-v', 'error', '-show_entries', 'format_tags:stream_tags', '-of', 'json', item.path], { timeout: 30e3, maxBuffer: 4e6 });
      const j = JSON.parse(stdout);
      const tags = Object.assign({}, ...(j.streams || []).map((s) => s.tags || {}), j.format?.tags || {});
      const key = Object.keys(tags).find((k) => /^(lyrics|unsyncedlyrics|uslt)(-|$)/i.test(k));
      if (key && tags[key].trim()) { const text = tags[key].trim(); const lines = lrc(text); return lines.length > 2 ? { synced: lines } : { plain: text.slice(0, 20000) }; }
    } catch { /* none */ }
    return {};
  });

  // ----- playlists -----
  const mine = async (profile, id) => { const p = await q1('select * from playlists where id=$1 and profile_id=$2', [id, profile.id]); if (!p) throw new HttpError(404, 'Playlist not found'); return p; };
  r.get('/api/playlists', async ({ profile }) => q(
    `select pl.id, pl.name, count(pi.item_id)::int as count, (array_agg(al.poster order by pi.position) filter (where al.poster is not null))[1:4] as art
     from playlists pl left join playlist_items pi on pi.playlist_id = pl.id left join items t on t.id = pi.item_id left join items al on al.id = t.parent_id
     where pl.profile_id=$1 group by pl.id order by pl.name`, [profile.id]).then((rows) => rows.map((p) => ({ ...p, art: [...new Set(p.art || [])].map((a) => img(a, 'w342')) }))));
  r.post('/api/playlists', async ({ profile, req }) => {
    const name = String((await readJson(req)).name || '').trim().slice(0, 80);
    if (!name) throw new HttpError(400, 'Give the playlist a name');
    return q1('insert into playlists (profile_id, name) values ($1,$2) returning id, name', [profile.id, name]);
  });
  r.get('/api/playlists/:id', async ({ profile, params }) => {
    const p = await mine(profile, params.id);
    const tracks = await q(`select ${SEL}, al.title as album_title, al.poster as album_poster ${FROM} join playlist_items pi on pi.item_id = i.id and pi.playlist_id = $2
      join items al on al.id = i.parent_id order by pi.position, pi.added_at`, [profile.id, p.id]);
    return { id: p.id, name: p.name, tracks: tracks.map((t) => ({ ...card(t), album: t.album_title, albumId: t.parent_id, poster: img(t.album_poster, 'w342'), codec: t.extra?.codec, container: t.container })) };
  });
  r.post('/api/playlists/:id/tracks', async ({ profile, req, params }) => {
    const p = await mine(profile, params.id);
    const b = await readJson(req);
    if (b.remove?.length) await q('delete from playlist_items where playlist_id=$1 and item_id = any($2)', [p.id, b.remove.map(Number)]);
    if (b.add?.length) {
      await q(`insert into playlist_items (playlist_id, item_id, position)
               select $1, t.id, (select coalesce(max(position), 0) from playlist_items where playlist_id=$1) + x.ord
               from unnest($2::bigint[]) with ordinality as x(id, ord) join items t on t.id = x.id and t.kind='track' on conflict do nothing`, [p.id, b.add.map(Number)]);
    }
    return { ok: true, count: (await q1('select count(*)::int as n from playlist_items where playlist_id=$1', [p.id])).n };
  });
  r.delete('/api/playlists/:id', async ({ profile, params }) => { await mine(profile, params.id); await q('delete from playlists where id=$1', [params.id]); return { ok: true }; });

  // ----- bookmarks in books and comics -----
  r.get('/api/bookmarks/:item', async ({ profile, params }) => q('select id, position, label, created_at from bookmarks where profile_id=$1 and item_id=$2 order by position', [profile.id, params.item]));
  r.post('/api/bookmarks/:item', async ({ profile, req, params }) => {
    const b = await readJson(req);
    if (!(await q1(`select 1 from items where id=$1 and kind in ('book','comic')`, [params.item]))) throw new HttpError(404, 'Not found');
    return q1('insert into bookmarks (profile_id, item_id, position, label) values ($1,$2,$3,$4) returning id, position, label, created_at', [profile.id, params.item, +b.position || 0, String(b.label || '').slice(0, 120)]);
  });
  r.delete('/api/bookmarks/:item/:id', async ({ profile, params }) => { await q('delete from bookmarks where id=$1 and profile_id=$2', [params.id, profile.id]); return { ok: true }; });

  // ----- sign a TV in from a phone -----
  r.post('/api/pair', async ({ req }) => {
    if (pairs.size > 500) throw new HttpError(429, 'Too many sign-ins in progress. Try again in a minute.');
    let code;
    do code = Array.from(crypto.randomBytes(6), (b) => ALPHA[b % ALPHA.length]).join(''); while (pairs.has(code));
    const secret = crypto.randomBytes(24).toString('base64url');
    pairs.set(code, { secret, expires: Date.now() + 10 * 60e3, token: null, device: String(req.headers['user-agent'] || '').slice(0, 200) });
    return { code, secret, expiresIn: 600 };
  }, { auth: false });
  r.get('/api/pair/:code', async ({ res, query, params }) => {
    const p = pairs.get(params.code.toUpperCase());
    if (!p || p.secret !== query.secret) throw new HttpError(404, 'That code has expired');
    if (!p.token) return { status: 'waiting' };
    pairs.delete(params.code.toUpperCase());
    res.setHeader('Set-Cookie', auth.sessionCookie(p.token));
    return { status: 'approved', token: p.token, profile: p.profile };
  }, { auth: false });
  r.get('/api/pair/:code/info', async ({ params }) => {
    const p = pairs.get(params.code.toUpperCase());
    if (!p || p.token) throw new HttpError(404, 'That code has expired. Start again on the TV.');
    const ua = p.device;
    return { device: /AFT|Fire TV/i.test(ua) ? 'Fire TV' : /Android TV|GoogleTV|BRAVIA/i.test(ua) ? 'Android TV' : /Roku/i.test(ua) ? 'Roku' : /Tizen|Web0S|SmartTV/i.test(ua) ? 'Smart TV' : /Android|iPhone|iPad/i.test(ua) ? 'Phone or tablet' : 'Computer' };
  });
  r.post('/api/pair/:code/approve', async ({ profile, params }) => {
    const p = pairs.get(params.code.toUpperCase());
    if (!p || p.token) throw new HttpError(404, 'That code has expired. Start again on the TV.');
    const token = crypto.randomBytes(32).toString('base64url');
    await q('insert into sessions (token, profile_id, device) values ($1, $2, $3)', [token, profile.id, p.device]);
    p.token = token; p.profile = auth.publicProfile(profile);
    return { ok: true };
  });

  // ----- phone as a remote: a playing device reports in every couple of seconds and collects its commands -----
  r.post('/api/remote/state', async ({ profile, req }) => {
    const b = await readJson(req);
    const id = String(b.device || '').slice(0, 40);
    if (!id) throw new HttpError(400, 'Missing device');
    if (!devices.has(profile.id)) devices.set(profile.id, new Map());
    const m = devices.get(profile.id);
    if (b.closed) { m.delete(id); return { commands: [] }; }
    const d = m.get(id) || { commands: [] };
    Object.assign(d, { name: String(b.name || 'A screen').slice(0, 60), seen: Date.now(),
      state: { itemId: +b.itemId || null, title: String(b.title || '').slice(0, 200), subtitle: String(b.subtitle || '').slice(0, 200), position: +b.position || 0, duration: +b.duration || 0, paused: !!b.paused, art: String(b.art || '').slice(0, 300), hasNext: !!b.hasNext, at: Date.now() } });
    m.set(id, d);
    return { commands: d.commands.splice(0) };
  });
  r.get('/api/remote/devices', async ({ profile }) => [...(devices.get(profile.id) || new Map())].map(([id, d]) => ({ id, name: d.name, ...d.state, position: d.state.paused ? d.state.position : d.state.position + (Date.now() - d.state.at) / 1000 })));
  r.post('/api/remote/command', async ({ profile, req }) => {
    const b = await readJson(req);
    const d = devices.get(profile.id)?.get(String(b.device));
    if (!d) throw new HttpError(404, 'That screen is no longer playing');
    if (!['toggle', 'play', 'pause', 'seek', 'skip', 'next', 'stop'].includes(b.cmd)) throw new HttpError(400, 'Unknown command');
    if (d.commands.length < 20) d.commands.push({ cmd: b.cmd, value: +b.value || 0 });
    return { ok: true };
  });
}
