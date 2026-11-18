// Ways to browse and watch beyond the basics: moods, Surprise Me, the timeline, collections, year in review,
// scrub previews, intro/credits marks, the Home layout, and watch parties.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { cfg } from './config.js';
import { q, q1, getSetting, setSetting } from './db.js';
import { HttpError, readJson, sendFile } from './http.js';
import { card, img, SEL, FROM } from './catalog.js';
import { run } from './probe.js';

const admin = { admin: true };

export const MOODS = [
  { id: 'cozy', name: 'Cozy', genres: ['Family', 'Animation', 'Romance', 'Comedy', 'Kids'] },
  { id: 'funny', name: 'Funny', genres: ['Comedy'] },
  { id: 'intense', name: 'Intense', genres: ['Thriller', 'Action', 'Crime', 'War', 'Action & Adventure'] },
  { id: 'mind-bending', name: 'Mind-bending', genres: ['Science Fiction', 'Mystery', 'Fantasy', 'Sci-Fi & Fantasy'] },
  { id: 'dark', name: 'Dark', genres: ['Horror', 'Thriller', 'Crime'] },
  { id: 'epic', name: 'Epic', genres: ['Adventure', 'History', 'War', 'Western', 'Fantasy'] },
  { id: 'true', name: 'True stories', genres: ['Documentary', 'History'] },
];

export async function collectionCards() {
  const rows = await q(
    `select c.id, c.name, c.description, c.backdrop, c.logo, count(ci.item_id)::int as count,
       (array_agg(i.backdrop order by ci.position) filter (where i.backdrop is not null))[1] as art,
       (array_agg(i.poster order by ci.position) filter (where i.poster is not null))[1:3] as posters
     from collections c left join collection_items ci on ci.collection_id = c.id left join items i on i.id = ci.item_id
     group by c.id order by c.position, c.id`);
  return rows.filter((c) => c.count).map((c) => ({
    id: c.id, name: c.name, description: c.description, count: c.count, logo: c.logo || null,
    backdrop: c.backdrop || img(c.art, 'w1280'), posters: (c.posters || []).map((p) => img(p, 'w342')),
  }));
}

// ---------- scrub previews ----------
// One sheet of small frames per title, made from keyframes only (fast, light on the NAS), one title at a time.
const thumbJobs = new Map();
let thumbChain = Promise.resolve();
function thumbSpec(item) {
  const v = (item.streams || []).find((s) => s.type === 'video');
  const dur = item.runtime_s || 0;
  if (!v || dur < 12) return null;
  const every = Math.max(dur < 600 ? 2 : 10, Math.ceil(dur / 200));
  const count = Math.ceil(dur / every);
  const cols = 10, rows = Math.ceil(count / cols);
  const w = 240, h = Math.max(2, Math.round((240 * (v.height || 9)) / (v.width || 16) / 2) * 2);
  return { every, count, cols, rows, w, h, file: path.join(cfg.dataDir, 'cache', 'thumbs', `${item.id}-${item.mtime}.jpg`) };
}
function makeThumbs(item, spec) {
  if (thumbJobs.has(item.id)) return;
  const job = thumbChain.then(async () => {
    await fs.promises.mkdir(path.dirname(spec.file), { recursive: true });
    const tmp = `${spec.file}.${process.pid}.tmp.jpg`;
    await run(cfg.ffmpeg, ['-v', 'error', '-nostdin', '-y', '-skip_frame', 'nokey', '-i', item.path, '-an', '-sn',
      '-vf', `fps=1/${spec.every},scale=${spec.w}:${spec.h},tile=${spec.cols}x${spec.rows}`, '-frames:v', '1', '-q:v', '6', tmp], { timeout: 30 * 60e3 });
    await fs.promises.rename(tmp, spec.file);
  }).catch((e) => console.error('[thumbs]', item.id, e.message)).finally(() => thumbJobs.delete(item.id));
  thumbJobs.set(item.id, job);
  thumbChain = job;
}
export const thumbsIdle = () => thumbChain;

// ---------- watch parties ----------
// Small rooms kept in memory: one title, everyone's player follows play, pause and seek.
const parties = new Map();
function party(code) {
  const p = parties.get(String(code || '').toUpperCase());
  if (!p) throw new HttpError(404, 'That watch party has ended');
  return p;
}
function tell(p, msg, except = null) {
  const line = `data: ${JSON.stringify(msg)}\n\n`;
  for (const c of p.clients) if (c !== except) c.res.write(line);
}
setInterval(() => {
  for (const [code, p] of parties) {
    if (!p.clients.size && Date.now() - p.touched > 30 * 60e3) parties.delete(code);
    else for (const c of p.clients) c.res.write(': keep\n\n');
  }
}, 25e3).unref();

export function routes(r) {
  // ----- moods -----
  r.get('/api/mood/:id', async ({ profile, params }) => {
    const mood = MOODS.find((m) => m.id === params.id);
    if (!mood) throw new HttpError(404, 'Not found');
    const day = new Date().toISOString().slice(0, 10);
    const rows = [];
    for (const [kind, label] of [['movie', 'movies'], ['show', 'shows']]) {
      const items = await q(`select ${SEL} ${FROM} where i.kind = $2 and i.genres && $3::text[] order by md5(i.id::text || $4) limit 30`, [profile.id, kind, mood.genres, day]);
      if (items.length) rows.push({ id: `mood-${kind}`, title: `${mood.name} ${label}`, items: items.map(card) });
    }
    const best = await q(`select ${SEL} ${FROM} where i.kind in ('movie','show') and i.genres && $2::text[] and i.score is not null order by i.score desc limit 20`, [profile.id, mood.genres]);
    if (best.length >= 4) rows.push({ id: 'mood-top', title: `Best rated · ${mood.name}`, items: best.map(card) });
    const fresh = await q(`select ${SEL} ${FROM} where i.kind in ('movie','show') and i.genres && $2::text[] and p.item_id is null order by i.added_at desc limit 20`, [profile.id, mood.genres]);
    if (fresh.length >= 4) rows.push({ id: 'mood-unwatched', title: `Not watched yet · ${mood.name}`, items: fresh.map(card) });
    return { mood: { id: mood.id, name: mood.name }, rows };
  });

  // ----- Surprise Me -----
  r.get('/api/surprise', async ({ profile, query }) => {
    const args = [profile.id];
    let where = `i.kind in ('movie','show') and i.poster is not null`;
    if (query.kind === 'movie' || query.kind === 'show') { args.push(query.kind); where += ` and i.kind = $${args.length}`; }
    if (+query.max > 0) { args.push(+query.max * 60); where += ` and (i.kind = 'show' or i.runtime_s <= $${args.length})`; }
    if (query.unwatched === '1') where += ` and p.item_id is null and not exists (select 1 from progress pp join items e on e.id = pp.item_id where pp.profile_id = $1 and e.show_id = i.id)`;
    const mood = MOODS.find((m) => m.id === query.mood);
    if (mood) { args.push(mood.genres); where += ` and i.genres && $${args.length}::text[]`; }
    const items = await q(`select ${SEL} ${FROM} where ${where} order by random() limit 14`, args);
    return { items: items.map((x) => ({ ...card(x), backdrop: img(x.backdrop, 'w1280'), tagline: x.tagline })) };
  });

  // ----- timeline -----
  r.get('/api/timeline', async () => ({
    decades: await q(`select (year / 10) * 10 as decade, count(*)::int as count from items where kind in ('movie','show') and year between 1900 and 2100 group by 1 order by 1`),
  }));
  r.get('/api/timeline/:decade', async ({ profile, params }) => {
    const d = Math.floor(+params.decade / 10) * 10;
    if (!(d >= 1900 && d <= 2100)) throw new HttpError(404, 'Not found');
    const items = await q(`select ${SEL} ${FROM} where i.kind in ('movie','show') and i.year between $2 and $3 order by i.year, i.sort_title limit 300`, [profile.id, d, d + 9]);
    return { decade: d, items: items.map(card) };
  });

  // ----- collections -----
  r.get('/api/collections/:id', async ({ profile, params }) => {
    const c = await q1('select * from collections where id=$1', [params.id]);
    if (!c) throw new HttpError(404, 'Not found');
    const items = await q(`select ${SEL} ${FROM} join collection_items ci on ci.item_id = i.id and ci.collection_id = $2 order by ci.position, i.year nulls last, i.sort_title`, [profile.id, c.id]);
    const art = items.find((x) => x.backdrop);
    return { id: c.id, name: c.name, description: c.description, logo: c.logo || null, backdrop: c.backdrop || img(art?.backdrop, 'w1280'),
      items: items.map((x) => ({ ...card(x), backdrop: img(x.backdrop, 'w780') })) };
  });
  r.get('/api/studio/collections', async () => {
    const list = await q('select * from collections order by position, id');
    const items = await q(`select ci.collection_id, i.id, i.title, i.year, i.kind, i.poster from collection_items ci join items i on i.id = ci.item_id order by ci.position, i.year nulls last, i.sort_title`);
    return list.map((c) => ({ ...c, items: items.filter((i) => i.collection_id === c.id).map((i) => ({ id: i.id, title: i.title, year: i.year, kind: i.kind, poster: img(i.poster, 'w185') })) }));
  }, admin);
  r.post('/api/studio/collections', async ({ req }) => {
    const b = await readJson(req);
    if (!String(b.name || '').trim()) throw new HttpError(400, 'Give the collection a name');
    const vals = [b.name.trim(), b.description || null, b.backdrop || null, b.logo || null];
    const c = b.id ? await q1('update collections set name=$1, description=$2, backdrop=$3, logo=$4 where id=$5 returning *', [...vals, b.id])
      : await q1('insert into collections (name, description, backdrop, logo, position) values ($1,$2,$3,$4,(select coalesce(max(position),0)+1 from collections)) returning *', vals);
    if (!c) throw new HttpError(404, 'Not found');
    if (Array.isArray(b.items)) {
      await q('delete from collection_items where collection_id=$1', [c.id]);
      const ids = [...new Set(b.items.map(Number).filter(Boolean))];
      if (ids.length) {
        await q(`insert into collection_items (collection_id, item_id, position)
                 select $1, x.id, x.ord from unnest($2::bigint[]) with ordinality as x(id, ord) join items i on i.id = x.id and i.kind in ('movie','show')`, [c.id, ids]);
      }
    }
    return c;
  }, admin);
  r.delete('/api/studio/collections/:id', async ({ params }) => { await q('delete from collections where id=$1', [params.id]); return { ok: true }; }, admin);

  // ----- year in review -----
  r.get('/api/wrapped', async ({ profile, query }) => {
    const year = +query.year || new Date().getFullYear();
    const args = [profile.id, `${year}-01-01`, `${year + 1}-01-01`];
    const base = `from progress p join items i on i.id = p.item_id left join items s on s.id = i.show_id
      where p.profile_id = $1 and p.updated_at >= $2 and p.updated_at < $3`;
    const t = await q1(`select count(*) filter (where p.watched and i.kind='movie')::int as movies, count(*) filter (where p.watched and i.kind='episode')::int as episodes,
        coalesce(sum(case when p.watched then coalesce(p.duration_s, i.runtime_s, 0) else p.position_s end), 0)::float as seconds ${base}`, args);
    const genres = await q(`select g, count(*)::int as n ${base.replace('where', ', unnest(case when i.kind = \'episode\' then s.genres else i.genres end) g where')} group by g order by n desc, g limit 5`, args);
    const shows = await q(`select s.id, s.title, s.poster, count(*)::int as episodes ${base} and i.kind='episode' and p.watched group by s.id order by episodes desc, s.title limit 3`, args);
    const months = await q(`select extract(month from p.updated_at)::int as m, count(*)::int as n ${base} group by 1 order by 1`, args);
    const longest = await q1(`select i.id, i.title, i.poster, i.runtime_s ${base} and i.kind='movie' and p.watched order by i.runtime_s desc nulls last limit 1`, args);
    const first = await q1(`select i.title, s.title as show_title, p.updated_at ${base} order by p.updated_at limit 1`, args);
    const posters = await q(`select distinct on (coalesce(s.id, i.id)) coalesce(s.poster, i.poster) as poster, p.updated_at ${base} and coalesce(s.poster, i.poster) is not null order by coalesce(s.id, i.id), p.updated_at desc limit 40`, args);
    const busiest = [...months].sort((a, b) => b.n - a.n)[0];
    return {
      year, name: profile.name, movies: t.movies, episodes: t.episodes, hours: Math.round(t.seconds / 360) / 10,
      genres: genres.map((g) => ({ name: g.g, count: g.n })),
      shows: shows.map((s) => ({ id: s.id, title: s.title, poster: img(s.poster, 'w342'), episodes: s.episodes })),
      months: Array.from({ length: 12 }, (_, i) => months.find((m) => m.m === i + 1)?.n || 0), busiest: busiest ? busiest.m : null,
      longest: longest ? { id: longest.id, title: longest.title, poster: img(longest.poster, 'w342'), minutes: Math.round((longest.runtime_s || 0) / 60) } : null,
      first: first ? { title: first.show_title ? `${first.show_title}: ${first.title}` : first.title, date: first.updated_at } : null,
      posters: posters.slice(0, 18).map((x) => img(x.poster, 'w185')),
    };
  });

  // ----- scrub previews -----
  r.get('/api/thumbs/:id', async ({ params }) => {
    const item = await q1(`select id, path, mtime, runtime_s, streams from items where id=$1 and kind in ('movie','episode')`, [params.id]);
    const spec = item?.path ? thumbSpec(item) : null;
    if (!spec) return { ready: false, never: true };
    const out = { every: spec.every, count: spec.count, cols: spec.cols, rows: spec.rows, w: spec.w, h: spec.h, url: `/api/thumbs/${item.id}/sheet.jpg?v=${item.mtime}` };
    if (fs.existsSync(spec.file)) return { ready: true, ...out };
    makeThumbs(item, spec);
    return { ready: false, ...out };
  });
  r.get('/api/thumbs/:id/sheet.jpg', async ({ req, res, params }) => {
    const item = await q1('select id, mtime, runtime_s, streams from items where id=$1', [params.id]);
    const spec = item ? thumbSpec(item) : null;
    if (!spec || !fs.existsSync(spec.file)) throw new HttpError(404, 'Not ready');
    await sendFile(req, res, spec.file, { cache: 'private, max-age=604800', type: 'image/jpeg' });
  });

  // ----- intro and credits marks -----
  r.post('/api/studio/items/:id/marks', async ({ req, params }) => {
    const b = await readJson(req);
    const item = await q1(`select id, kind, parent_id, marks from items where id=$1 and kind in ('movie','episode')`, [params.id]);
    if (!item) throw new HttpError(404, 'Not found');
    const marks = { ...(item.marks || {}) };
    for (const k of ['introStart', 'introEnd', 'credits']) {
      if (b[k] === null) delete marks[k];
      else if (b[k] !== undefined && +b[k] >= 0) marks[k] = Math.round(+b[k] * 10) / 10;
    }
    if (marks.introEnd != null && (marks.introStart == null || marks.introStart >= marks.introEnd)) marks.introStart = Math.max(0, Math.min(marks.introStart ?? 0, marks.introEnd - 1));
    await q('update items set marks=$1::jsonb where id=$2', [JSON.stringify(marks), item.id]);
    let season = 0;
    // "Whole season" copies the intro to every episode; credits are set from the end, so each keeps its own length.
    if (b.season && item.kind === 'episode') {
      const fromEnd = marks.credits != null ? (await q1('select runtime_s from items where id=$1', [item.id])).runtime_s - marks.credits : null;
      const eps = await q('select id, runtime_s, marks from items where parent_id=$1 and kind=$2 and id<>$3', [item.parent_id, 'episode', item.id]);
      for (const e of eps) {
        const m = { ...(e.marks || {}) };
        if (marks.introEnd != null) { m.introStart = marks.introStart; m.introEnd = marks.introEnd; } else { delete m.introStart; delete m.introEnd; }
        if (fromEnd != null && fromEnd > 0 && e.runtime_s > fromEnd + 60) m.credits = Math.round((e.runtime_s - fromEnd) * 10) / 10; else if (marks.credits == null) delete m.credits;
        await q('update items set marks=$1::jsonb where id=$2', [JSON.stringify(m), e.id]);
        season++;
      }
    }
    return { ok: true, marks, season };
  }, admin);

  // ----- Home layout -----
  r.get('/api/studio/home', async ({ profile }) => {
    const home = await getSetting('home', {});
    const spot = home.spotlight?.length ? await q(`select id, title, year, kind, poster from items where id = any($1)`, [home.spotlight]) : [];
    return {
      order: home.order || [], hidden: home.hidden || [], announcement: home.announcement || { text: '', link: '' },
      banner: { shuffle: 'visit', pickedOnly: true, favourNew: true, count: 8, ...(home.banner || {}) },
      spotlight: (home.spotlight || []).map((id) => spot.find((x) => x.id === id)).filter(Boolean).map((x) => ({ id: x.id, title: x.title, year: x.year, kind: x.kind, poster: img(x.poster, 'w185') })),
      sections: [['libraries', 'Library tiles'], ['continue', `Continue watching`], ['reading', 'Continue reading'], ['mylist', 'My List'], ['top10', 'Most watched this month'], ['foryou', 'Because you watched and Hidden gems'], ['recent', 'New in each library'], ['top', 'Top rated'], ['collections', 'Collections'], ['genres', 'Genre rows']].map(([id, name]) => ({ id, name })),
      me: profile.name,
    };
  }, admin);
  r.put('/api/studio/home', async ({ req }) => {
    const b = await readJson(req);
    await setSetting('home', {
      order: (b.order || []).map(String).slice(0, 20), hidden: (b.hidden || []).map(String).slice(0, 20),
      spotlight: (b.spotlight || []).map(Number).filter(Boolean).slice(0, 8),
      announcement: { text: String(b.announcement?.text || '').slice(0, 200), link: String(b.announcement?.link || '').slice(0, 300) },
      banner: {
        shuffle: ['visit', 'hour', 'day'].includes(b.banner?.shuffle) ? b.banner.shuffle : 'visit',
        pickedOnly: b.banner?.pickedOnly !== false, favourNew: b.banner?.favourNew !== false,
        count: Math.max(3, Math.min(12, +b.banner?.count || 8)),
      },
    });
    return { ok: true };
  }, admin);

  // ----- watch parties -----
  r.post('/api/party', async ({ profile, req }) => {
    const { itemId } = await readJson(req);
    const item = await q1(`select i.id, i.title, s.title as show_title from items i left join items s on s.id = i.show_id where i.id=$1 and i.kind in ('movie','episode')`, [itemId]);
    if (!item) throw new HttpError(404, 'Nothing to watch');
    let code;
    do code = crypto.randomBytes(4).toString('hex').toUpperCase().slice(0, 6); while (parties.has(code));
    parties.set(code, { code, itemId: item.id, title: item.show_title ? `${item.show_title} · ${item.title}` : item.title, host: profile.name,
      clients: new Set(), state: { playing: false, position: 0, at: Date.now() }, touched: Date.now() });
    return { code };
  });
  r.get('/api/party/:code', async ({ params }) => {
    const p = party(params.code);
    return { code: p.code, itemId: p.itemId, title: p.title, host: p.host, people: [...p.clients].map((c) => c.name) };
  });
  r.get('/api/party/:code/events', async ({ req, res, profile, params }) => {
    const p = party(params.code);
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    const me = { res, name: profile.name, id: crypto.randomBytes(6).toString('hex') };
    p.clients.add(me); p.touched = Date.now();
    const s = p.state;
    res.write(`data: ${JSON.stringify({ type: 'hello', you: me.id, people: [...p.clients].map((c) => c.name),
      state: { playing: s.playing, position: s.playing ? s.position + (Date.now() - s.at) / 1000 : s.position } })}\n\n`);
    tell(p, { type: 'people', people: [...p.clients].map((c) => c.name), joined: me.name }, me);
    req.on('close', () => { p.clients.delete(me); p.touched = Date.now(); tell(p, { type: 'people', people: [...p.clients].map((c) => c.name), left: me.name }); });
  });
  r.post('/api/party/:code/send', async ({ req, profile, params }) => {
    const p = party(params.code);
    const b = await readJson(req);
    p.touched = Date.now();
    const from = [...p.clients].find((c) => c.id === b.you) || null;
    if (['play', 'pause', 'seek'].includes(b.type)) {
      p.state = { playing: b.type === 'play' ? true : b.type === 'pause' ? false : p.state.playing, position: Math.max(0, +b.position || 0), at: Date.now() };
      tell(p, { type: b.type, position: p.state.position, by: profile.name }, from);
    } else if (b.type === 'react' && typeof b.emoji === 'string' && b.emoji.length <= 8) {
      tell(p, { type: 'react', emoji: b.emoji, by: profile.name });
    } else throw new HttpError(400, 'Unknown message');
    return { ok: true };
  });
}
