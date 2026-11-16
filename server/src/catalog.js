// Browsing: home rows, libraries, title pages, search, watch progress and My List.
import { q, q1 } from './db.js';
import { HttpError, readJson } from './http.js';

export function img(ref, size) {
  if (!ref) return null;
  if (ref.startsWith('tmdb:')) return `/img/t/${size}${ref.slice(5)}`;
  if (ref.startsWith('local:')) return `/img/l/${Buffer.from(ref.slice(6)).toString('base64url')}`;
  return ref;
}

const SEL = `i.*, s.title as show_title, s.poster as show_poster, s.backdrop as show_backdrop, s.logo as show_logo,
  s.rating as show_rating, s.genres as show_genres, p.position_s, p.duration_s, p.watched`;
const FROM = `from items i left join items s on s.id = i.show_id
  left join progress p on p.item_id = i.id and p.profile_id = $1`;

export function card(r) {
  const ep = r.kind === 'episode';
  return {
    id: r.id, kind: r.kind, title: r.title, year: r.year, rating: r.rating || r.show_rating || null,
    score: r.score ? Math.round(r.score * 10) / 10 : null, runtime: r.runtime_s || null,
    genres: r.genres?.length ? r.genres : (r.show_genres || []), overview: r.overview || null, library: r.library_id,
    poster: img(ep ? r.show_poster : r.poster, 'w342'),
    backdrop: img(r.backdrop || r.show_backdrop, 'w780'),
    logo: img(r.logo || r.show_logo, 'w500'),
    show: ep ? { id: r.show_id, title: r.show_title, season: r.season_no, episode: r.episode_no } : undefined,
    progress: r.position_s != null ? { position: r.position_s, duration: r.duration_s || r.runtime_s || 0, watched: !!r.watched } : undefined,
  };
}

function mediaInfo(r) {
  const st = r.streams || [];
  const v = st.find((x) => x.type === 'video');
  const quality = !v ? null : v.height >= 1600 || v.width >= 3000 ? '4K' : v.height >= 900 || v.width >= 1800 ? 'HD' : v.height >= 650 ? '720p' : 'SD';
  return {
    quality, hdr: !!v?.hdr,
    audio: st.filter((x) => x.type === 'audio').map((a) => ({ lang: a.lang, title: a.title, codec: a.codec, channels: a.channels })),
    subs: st.filter((x) => x.type === 'sub').map((x) => ({ lang: x.lang, title: x.title })),
  };
}

async function continueRow(pid) {
  const inProgress = await q(
    `select ${SEL}, p.updated_at as touched ${FROM}
     where p.profile_id = $1 and not p.watched and p.position_s > 20 and i.kind in ('movie','episode')
     order by p.updated_at desc limit 24`, [pid]);
  const nextUp = await q(
    `with last as (
       select distinct on (i.show_id) i.show_id, i.season_no, i.episode_no, p.updated_at
       from progress p join items i on i.id = p.item_id
       where p.profile_id = $1 and p.watched and i.kind = 'episode'
       order by i.show_id, p.updated_at desc)
     select n.*, s.title as show_title, s.poster as show_poster, s.backdrop as show_backdrop, s.logo as show_logo,
       s.rating as show_rating, s.genres as show_genres, null::real as position_s, null::real as duration_s, null::boolean as watched, l.updated_at as touched
     from last l
     join lateral (select * from items e where e.show_id = l.show_id and e.kind = 'episode' and e.season_no > 0
       and (e.season_no, e.episode_no) > (l.season_no, l.episode_no) order by e.season_no, e.episode_no limit 1) n on true
     join items s on s.id = n.show_id
     left join progress p on p.item_id = n.id and p.profile_id = $1
     where p.item_id is null
       and l.updated_at > now() - interval '120 days'`, [pid]);
  const shows = new Set(inProgress.filter((r) => r.show_id).map((r) => r.show_id));
  const all = [...inProgress, ...nextUp.filter((r) => !shows.has(r.show_id))];
  all.sort((a, b) => new Date(b.touched) - new Date(a.touched));
  return all.slice(0, 24).map(card);
}

export function routes(r) {
  r.get('/api/home', async ({ profile }) => {
    const pid = profile.id;
    const day = new Date().toISOString().slice(0, 10);
    const libs = await q(`select id, name, kind from libraries where kind in ('movies','shows') order by position, id`);
    const rows = [];
    const cont = await continueRow(pid);
    if (cont.length) rows.push({ id: 'continue', title: `Continue watching for ${profile.name}`, shape: 'wide', items: cont });
    const mine = await q(`select ${SEL} ${FROM} join mylist m on m.item_id = i.id and m.profile_id = $1 order by m.added_at desc limit 30`, [pid]);
    if (mine.length) rows.push({ id: 'mylist', title: 'My List', items: mine.map(card) });
    for (const l of libs) {
      const kind = l.kind === 'movies' ? 'movie' : 'show';
      const recent = await q(`select ${SEL} ${FROM} where i.library_id = $2 and i.kind = $3 order by i.added_at desc, i.id desc limit 24`, [pid, l.id, kind]);
      if (recent.length) rows.push({ id: `recent-${l.id}`, title: `New in ${l.name}`, library: l.id, items: recent.map(card) });
    }
    const genres = await q(
      `select g, count(*)::int as n from items i, unnest(i.genres) g where i.kind in ('movie','show') group by g having count(*) >= 4
       order by md5(g || $1) limit 8`, [day]);
    for (const g of genres) {
      const items = await q(`select ${SEL} ${FROM} where i.kind in ('movie','show') and $2 = any(i.genres) order by md5(i.id::text || $3) limit 24`, [pid, g.g, day]);
      rows.push({ id: `genre-${g.g}`, title: g.g, items: items.map(card) });
    }
    const top = await q(`select ${SEL} ${FROM} where i.kind in ('movie','show') and i.score is not null order by i.score desc, i.id limit 20`, [pid]);
    if (top.length >= 6) rows.splice(Math.min(rows.length, 3), 0, { id: 'top', title: 'Top rated', items: top.map(card) });
    const spotlight = await q(
      `select ${SEL} ${FROM} where i.kind in ('movie','show') and i.backdrop is not null
       order by (i.added_at > now() - interval '45 days') desc, md5(i.id::text || $2) limit 6`, [pid, day]);
    return { spotlight: spotlight.map((x) => ({ ...card(x), backdrop: img(x.backdrop, 'w1280'), tagline: x.tagline })), rows };
  });

  r.get('/api/library/:id', async ({ profile, params, query }) => {
    const lib = await q1('select id, name, kind from libraries where id=$1', [params.id]);
    if (!lib || lib.kind === 'prerolls') throw new HttpError(404, 'Library not found');
    const kind = lib.kind === 'movies' ? 'movie' : 'show';
    const sorts = { title: 'i.sort_title asc', added: 'i.added_at desc', year: 'i.year desc nulls last, i.sort_title', score: 'i.score desc nulls last, i.sort_title' };
    const order = sorts[query.sort] || sorts.title;
    const args = [profile.id, lib.id, kind];
    let where = 'i.library_id = $2 and i.kind = $3';
    if (query.genre) { args.push(query.genre); where += ` and $${args.length} = any(i.genres)`; }
    const total = (await q1(`select count(*)::int as n from items i where ${where.replace(/\$(\d)/g, (_, n) => `$${n - 1}`)}`, args.slice(1))).n;
    const limit = Math.min(+query.limit || 60, 200), offset = +query.offset || 0;
    const items = await q(`select ${SEL} ${FROM} where ${where} order by ${order}, i.id limit ${limit} offset ${offset}`, args);
    const genres = await q(`select g, count(*)::int as n from items i, unnest(i.genres) g where i.library_id=$1 and i.kind=$2 group by g order by g`, [lib.id, kind]);
    return { library: lib, total, items: items.map(card), genres: genres.map((g) => g.g) };
  });

  r.get('/api/items/:id', async ({ profile, params }) => {
    const pid = profile.id;
    let row = await q1(`select ${SEL} ${FROM} where i.id = $2`, [pid, params.id]);
    if (!row || row.kind === 'clip') throw new HttpError(404, 'Not found');
    let focus = null;
    if (row.kind === 'episode' || row.kind === 'season') { focus = row.kind === 'episode' ? row.id : null; row = await q1(`select ${SEL} ${FROM} where i.id = $2`, [pid, row.show_id]); }
    const out = {
      ...card(row), backdrop: img(row.backdrop, 'w1280'), poster: img(row.poster, 'w500'), tagline: row.tagline, studios: row.studios,
      people: (row.people || []).map((x) => ({ name: x.name, role: x.role, photo: img(x.photo, 'w185') })),
      trailer: row.trailer, inList: !!(await q1('select 1 from mylist where profile_id=$1 and item_id=$2', [pid, row.id])), focus,
    };
    if (row.kind === 'movie') { out.media = mediaInfo(row); out.playId = row.id; }
    if (row.kind === 'show') {
      const eps = await q(`select ${SEL} ${FROM} where i.show_id = $2 and i.kind = 'episode' order by i.season_no, i.episode_no`, [pid, row.id]);
      const seasons = await q(`select id, title, season_no, overview from items where parent_id=$1 and kind='season' order by (season_no = 0), season_no`, [row.id]);
      out.seasons = seasons.map((s) => ({
        id: s.id, title: s.title, number: s.season_no,
        episodes: eps.filter((e) => e.season_no === s.season_no).map((e) => ({ ...card(e), still: img(e.backdrop, 'w300'), number: e.episode_no, premiered: e.premiered })),
      }));
      const regular = eps.filter((e) => e.season_no > 0);
      const list = regular.length ? regular : eps;
      const started = eps.filter((e) => e.position_s != null);
      let play = focus ? eps.find((e) => e.id === focus) : null;
      if (!play && started.length) {
        const latest = (await q1(
          `select p.item_id, p.watched from progress p join items i on i.id = p.item_id
           where p.profile_id=$1 and i.show_id=$2 order by p.updated_at desc limit 1`, [pid, row.id]));
        const idx = list.findIndex((e) => e.id === latest?.item_id);
        play = idx < 0 ? null : latest.watched ? list[idx + 1] || list[0] : list[idx];
      }
      play = play || list[0];
      if (play) { out.playId = play.id; out.playLabel = `S${play.season_no} E${play.episode_no}`; out.playProgress = card(play).progress; out.media = mediaInfo(play); }
      out.episodeCount = eps.length;
    }
    const similar = await q(
      `select ${SEL} ${FROM} where i.kind = $2 and i.id <> $3 and i.genres && $4::text[]
       order by cardinality(array(select unnest(i.genres) intersect select unnest($4::text[]))) desc, i.score desc nulls last limit 12`,
      [pid, row.kind, row.id, row.genres || []]);
    out.similar = similar.map(card);
    return out;
  });

  r.get('/api/search', async ({ profile, query }) => {
    const term = String(query.q || '').trim();
    if (!term) return { items: [] };
    const like = `%${term.replace(/[%_\\]/g, '\\$&')}%`;
    const items = await q(
      `select ${SEL} ${FROM} where i.kind in ('movie','show') and (i.title ilike $2 or $3 ilike any(i.genres)
         or exists (select 1 from jsonb_array_elements(i.people) x where x->>'name' ilike $2))
       order by (i.title ilike $4) desc, nullif(position(lower($3) in lower(i.title)), 0) nulls last, i.sort_title limit 60`,
      [profile.id, like, term, `${term.replace(/[%_\\]/g, '\\$&')}%`]);
    return { items: items.map(card) };
  });

  r.post('/api/mylist', async ({ profile, req }) => {
    const { itemId, on } = await readJson(req);
    if (on) await q('insert into mylist (profile_id, item_id) values ($1,$2) on conflict do nothing', [profile.id, itemId]);
    else await q('delete from mylist where profile_id=$1 and item_id=$2', [profile.id, itemId]);
    return { ok: true };
  });

  r.post('/api/progress', async ({ profile, req }) => {
    const { itemId, position, duration, ended } = await readJson(req);
    const it = await q1(`select id, kind, runtime_s from items where id=$1`, [itemId]);
    if (!it || !['movie', 'episode'].includes(it.kind)) return { ok: true };
    const dur = +duration || it.runtime_s || 0;
    const pos = Math.max(0, +position || 0);
    const watched = !!ended || (dur > 0 && pos / dur >= 0.92);
    await q(
      `insert into progress (profile_id, item_id, position_s, duration_s, watched, updated_at) values ($1,$2,$3,$4,$5,now())
       on conflict (profile_id, item_id) do update set position_s=excluded.position_s, duration_s=excluded.duration_s,
         watched=excluded.watched, updated_at=now()`, [profile.id, itemId, watched ? 0 : pos, dur, watched]);
    return { ok: true, watched };
  });

  r.post('/api/watched', async ({ profile, req }) => {
    const { itemId, watched } = await readJson(req);
    const it = await q1('select id, kind from items where id=$1', [itemId]);
    if (!it) throw new HttpError(404, 'Not found');
    const ids = it.kind === 'show' ? (await q(`select id from items where show_id=$1 and kind='episode'`, [it.id])).map((x) => x.id)
      : it.kind === 'season' ? (await q(`select id from items where parent_id=$1`, [it.id])).map((x) => x.id) : [it.id];
    if (watched) {
      await q(`insert into progress (profile_id, item_id, position_s, watched, updated_at) select $1, unnest($2::bigint[]), 0, true, now()
               on conflict (profile_id, item_id) do update set position_s=0, watched=true, updated_at=now()`, [profile.id, ids]);
    } else await q('delete from progress where profile_id=$1 and item_id = any($2)', [profile.id, ids]);
    return { ok: true };
  });
}
