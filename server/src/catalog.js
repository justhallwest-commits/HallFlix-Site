// Browsing: home rows, libraries, title pages, search, watch progress and My List.
import { q, q1, getSetting } from './db.js';
import { MOODS, collectionCards } from './extras.js';
import { smartSearch, top10Row, forYouRows, dedupe } from './more.js';
import { HttpError, readJson } from './http.js';

export function img(ref, size) {
  if (!ref) return null;
  if (ref.startsWith('tmdb:')) return `/img/t/${size}${ref.slice(5)}`;
  if (ref.startsWith('local:')) return `/img/l/${Buffer.from(ref.slice(6)).toString('base64url')}`;
  if (ref.startsWith('cover:')) return `/api/cover/${ref.slice(6)}`;
  return ref;
}

export const SEL = `i.*, s.title as show_title, s.poster as show_poster, s.backdrop as show_backdrop, s.logo as show_logo,
  s.rating as show_rating, s.genres as show_genres, p.position_s, p.duration_s, p.watched`;
export const FROM = `from items i left join items s on s.id = i.show_id
  left join progress p on p.item_id = i.id and p.profile_id = $1`;

// The kind of item each library type lists, and how many children a row has (issues in a series, albums by an artist).
export const MAIN_KIND = { movies: 'movie', shows: 'show', books: 'book', comics: 'series', music: 'album' };
export const COUNT = `(select count(*)::int from items c where c.parent_id = i.id and i.kind in ('series','artist','album')) as child_count`;

const hash = (str) => { let h = 0; for (const c of String(str)) h = (h * 31 + c.charCodeAt(0)) | 0; return h; };

export function card(r) {
  const ep = r.kind === 'episode';
  return {
    id: r.id, kind: r.kind, title: r.title, year: r.year, rating: r.rating || r.show_rating || null,
    score: r.score ? Math.round(r.score * 10) / 10 : null, runtime: r.runtime_s || null,
    genres: r.genres?.length ? r.genres : (r.show_genres || []), overview: r.overview || null, library: r.library_id,
    poster: img(ep ? r.show_poster : r.poster, 'w342'),
    backdrop: img(r.backdrop || r.show_backdrop, 'w780'),
    logo: img(r.logo || r.show_logo, 'w500'),
    thumb: r.extra?.thumb ? img(r.extra.thumb, 'w780') : undefined,
    show: ep ? { id: r.show_id, title: r.show_title, season: r.season_no, episode: r.episode_no } : undefined,
    progress: r.position_s != null ? { position: r.position_s, duration: r.duration_s || r.runtime_s || 0, watched: !!r.watched } : undefined,
    author: r.author || undefined, pages: r.pages ?? undefined, number: r.extra?.number ?? undefined, count: r.child_count ?? undefined,
    read: r.read_count ?? undefined, reading: r.reading_count ?? undefined, publisher: r.kind === 'series' || r.kind === 'comic' ? r.studios?.[0] || undefined : undefined,
    track: r.kind === 'track' ? r.episode_no : undefined, disc: r.kind === 'track' ? r.season_no : undefined,
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
  r.get('/api/home', async ({ profile, query }) => {
    const pid = profile.id;
    const day = new Date().toISOString().slice(0, 10);
    const libs = await q(`select id, name, kind from libraries where kind <> 'prerolls' order by position, id`);
    const home = await getSetting('home', {});
    const sec = { continue: [], reading: [], mylist: [], top10: [], foryou: await forYouRows(pid), recent: [], top: [], genres: [] };
    const t10 = await top10Row(pid); if (t10) sec.top10.push(t10);
    const reading = await q(`select ${SEL} ${FROM} where i.kind in ('book','comic') and p.profile_id = $1 and not p.watched and p.position_s > 0 order by p.updated_at desc limit 20`, [pid]);
    if (reading.length) sec.reading.push({ id: 'reading', title: 'Continue reading', items: reading.map(card) });
    const cont = await continueRow(pid);
    if (cont.length) sec.continue.push({ id: 'continue', title: `Continue watching for ${profile.name}`, shape: 'wide', items: cont });
    const mine = await q(`select ${SEL} ${FROM} join mylist m on m.item_id = i.id and m.profile_id = $1 order by m.added_at desc limit 30`, [pid]);
    if (mine.length) sec.mylist.push({ id: 'mylist', title: 'My List', items: mine.map(card) });
    for (const l of libs) {
      const kind = MAIN_KIND[l.kind];
      const recent = await q(`select ${SEL}, ${COUNT} ${FROM} where i.library_id = $2 and i.kind = $3 order by i.added_at desc, i.id desc limit 24`, [pid, l.id, kind]);
      if (recent.length) sec.recent.push({ id: `recent-${l.id}`, title: `New in ${l.name}`, library: l.id, shape: l.kind === 'music' ? 'square' : undefined, items: recent.map(card) });
    }
    const genres = await q(
      `select g, count(*)::int as n from items i, unnest(i.genres) g where i.kind in ('movie','show') group by g having count(*) >= 4
       order by md5(g || $1) limit 8`, [day]);
    for (const g of genres) {
      const items = await q(`select ${SEL} ${FROM} where i.kind in ('movie','show') and $2 = any(i.genres) order by md5(i.id::text || $3) limit 24`, [pid, g.g, day]);
      sec.genres.push({ id: `genre-${g.g}`, title: g.g, items: items.map(card) });
    }
    const top = await q(`select ${SEL} ${FROM} where i.kind in ('movie','show') and i.score is not null order by i.score desc, i.id limit 20`, [pid]);
    if (top.length >= 6) sec.top.push({ id: 'top', title: 'Top rated', items: top.map(card) });
    // The Studio's Home layout decides the order of sections and which are hidden.
    const known = ['libraries', 'continue', 'reading', 'mylist', 'top10', 'recent', 'foryou', 'top', 'collections', 'genres'];
    const order = [...(home.order || []).filter((x) => known.includes(x)), ...known.filter((x) => !(home.order || []).includes(x))];
    const hidden = new Set(home.hidden || []);
    let rows = [];
    const layout = { tilesAt: -1, collectionsAt: -1 };
    for (const id of order) {
      if (hidden.has(id)) continue;
      if (id === 'libraries') layout.tilesAt = rows.length;
      else if (id === 'collections') layout.collectionsAt = rows.length;
      else rows.push(...sec[id]);
    }
    // Dedupe, then re-point the tile and collection positions at the rows they sat in front of.
    const before = rows; rows = dedupe(rows);
    const shift = (at) => (at < 0 ? at : before.slice(0, at).filter((r) => rows.includes(r)).length);
    layout.tilesAt = shift(layout.tilesAt); layout.collectionsAt = shift(layout.collectionsAt);
    // Slower TV sticks ask for a lighter Home.
    if (query.lite) for (const r of rows) r.items = r.items.slice(0, 14);
    let pinned = [];
    if (home.spotlight?.length) {
      const got = await q(`select ${SEL} ${FROM} where i.id = any($2) and i.kind in ('movie','show')`, [pid, home.spotlight]);
      pinned = home.spotlight.map((id) => got.find((x) => x.id === id)).filter(Boolean);
    }
    const spotlight = await q(
      `select ${SEL} ${FROM} where i.kind in ('movie','show') and i.backdrop is not null
       order by (i.added_at > now() - interval '45 days') desc, md5(i.id::text || $2) limit 6`, [pid, day]);
    // Library tiles: each library's own background if it has one in its look, otherwise art from a recent title.
    const tiles = [];
    for (const l of libs) {
      const kind = MAIN_KIND[l.kind];
      const stats = await q1(`select count(*)::int as n, count(*) filter (where added_at > now() - interval '14 days')::int as fresh from items where library_id=$1 and kind=$2`, [l.id, kind]);
      if (!stats.n) continue;
      const art = await q(`select backdrop, poster from items where library_id=$1 and kind=$2 and (backdrop is not null or poster is not null) order by added_at desc, id desc limit 12`, [l.id, kind]);
      const pick = art.filter((a) => a.backdrop);
      tiles.push({
        id: l.id, name: l.name, kind: l.kind, count: stats.n, fresh: stats.fresh,
        backdrop: pick.length ? img(pick[Math.abs(hash(day + l.id)) % pick.length].backdrop, 'w1280') : null,
        posters: art.filter((a) => a.poster).slice(0, 3).map((a) => img(a.poster, 'w342')),
      });
    }
    const spot = [...pinned, ...spotlight.filter((x) => !pinned.some((p) => p.id === x.id))].slice(0, Math.max(6, pinned.length));
    const moods = await q(`select distinct g from items i, unnest(i.genres) g where i.kind in ('movie','show')`);
    const have = new Set(moods.map((m) => m.g));
    const ann = home.announcement?.text ? { text: home.announcement.text, link: home.announcement.link || '' } : null;
    return {
      spotlight: spot.map((x) => ({ ...card(x), backdrop: img(x.backdrop || x.poster, 'w1280'), tagline: x.tagline, trailer: x.trailer })),
      libraries: layout.tilesAt < 0 ? [] : tiles, rows, layout,
      collections: layout.collectionsAt < 0 ? [] : await collectionCards(),
      moods: MOODS.filter((m) => m.genres.some((g) => have.has(g))).map((m) => ({ id: m.id, name: m.name })),
      announcement: ann,
    };
  });

  r.get('/api/library/:id', async ({ profile, params, query, hidden }) => {
    const lib = await q1('select id, name, kind from libraries where id=$1', [params.id]);
    if (!lib || lib.kind === 'prerolls') throw new HttpError(404, 'Library not found');
    // Music lists albums, artists or songs.
    const view = lib.kind === 'music' ? (['artists', 'songs'].includes(query.view) ? query.view : 'albums') : null;
    const kind = view === 'artists' ? 'artist' : view === 'songs' ? 'track' : MAIN_KIND[lib.kind];
    const sorts = {
      title: 'i.sort_title asc', added: 'i.added_at desc', year: 'i.year desc nulls last, i.sort_title', score: 'i.score desc nulls last, i.sort_title',
      author: 'lower(i.author) asc nulls last, i.sort_title', artist: 'lower(i.author) asc nulls last, i.year, i.sort_title',
    };
    let order = sorts[query.sort] || sorts.title;
    if (kind === 'track' && !sorts[query.sort]) order = 'lower(i.author), i.parent_id, i.season_no, i.episode_no nulls last';
    const args = [profile.id, lib.id, kind];
    let where = 'i.library_id = $2 and i.kind = $3';
    if (query.genre) { args.push(query.genre); where += ` and $${args.length} = any(i.genres)`; }
    // Comics: how much of each series this profile has read, and filters by read status and publisher.
    let extraSel = '';
    if (kind === 'series') {
      const pid = Number(profile.id);
      const readN = `(select count(*)::int from items c join progress pp on pp.item_id = c.id and pp.profile_id = ${pid} and pp.watched where c.parent_id = i.id)`;
      const readingN = `(select count(*)::int from items c join progress pp on pp.item_id = c.id and pp.profile_id = ${pid} and not pp.watched and pp.position_s > 0 where c.parent_id = i.id)`;
      const totalN = `(select count(*)::int from items c where c.parent_id = i.id)`;
      extraSel = `, ${readN} as read_count, ${readingN} as reading_count`;
      if (query.status === 'unread') where += ` and ${readN} = 0 and ${readingN} = 0`;
      if (query.status === 'reading') where += ` and (${readingN} > 0 or (${readN} > 0 and ${readN} < ${totalN}))`;
      if (query.status === 'read') where += ` and ${readN} >= ${totalN} and ${totalN} > 0`;
      if (query.publisher) { args.push(query.publisher); where += ` and $${args.length} = any(i.studios)`; }
      sorts.updated = `(select max(c.added_at) from items c where c.parent_id = i.id) desc nulls last, i.sort_title`;
      sorts.read = `(select max(pp.updated_at) from items c join progress pp on pp.item_id = c.id and pp.profile_id = ${pid} where c.parent_id = i.id) desc nulls last, i.sort_title`;
      order = sorts[query.sort] || sorts.title;
    }
    if (hidden?.size) { args.push([...hidden.keys()]); where += ` and not (i.id = any($${args.length}::bigint[]))`; } // pages and counts stay right
    const total = (await q1(`select count(*)::int as n from items i where ${where.replace(/\$(\d)/g, (_, n) => `$${n - 1}`)}`, args.slice(1))).n;
    const limit = Math.min(+query.limit || 60, kind === 'track' ? 500 : 200), offset = +query.offset || 0;
    const items = await q(`select ${SEL}, ${COUNT}${extraSel}, al.title as album_title, al.poster as album_poster ${FROM} left join items al on al.id = i.parent_id and i.kind = 'track'
      where ${where} order by ${order}, i.id limit ${limit} offset ${offset}`, args);
    const genres = await q(`select g, count(*)::int as n from items i, unnest(i.genres) g where i.library_id=$1 and i.kind=$2 group by g having count(*) > 0 order by g`, [lib.id, kind === 'track' || kind === 'artist' ? 'album' : kind]);
    const publishers = kind === 'series' ? (await q(`select p, count(*)::int as n from items i, unnest(i.studios) p where i.library_id=$1 and i.kind='series' group by p order by n desc, p`, [lib.id])).map((x) => x.p) : undefined;
    return {
      library: lib, view, total, genres: kind === 'artist' ? [] : genres.map((g) => g.g), publishers,
      items: items.map((x) => (x.kind === 'track' ? { ...card(x), album: x.album_title, albumId: x.parent_id, poster: img(x.album_poster, 'w342'), codec: x.extra?.codec, container: x.container } : card(x))),
    };
  });

  r.get('/api/items/:id', async ({ profile, params }) => {
    const pid = profile.id;
    let row = await q1(`select ${SEL} ${FROM} where i.id = $2`, [pid, params.id]);
    if (!row || row.kind === 'clip') throw new HttpError(404, 'Not found');
    if (['book', 'comic', 'series', 'album', 'artist', 'track'].includes(row.kind)) return shelfItem(pid, row);
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

  // The front page of a comics library: what you're reading, the next issue of series you've started, new issues,
  // and a row per publisher.
  r.get('/api/comics/:id', async ({ profile, params }) => {
    const lib = await q1('select id, name, kind from libraries where id=$1', [params.id]);
    if (!lib || lib.kind !== 'comics') throw new HttpError(404, 'Library not found');
    const pid = profile.id;
    const issue = (x) => ({ ...card(x), poster: img(x.poster, 'w342'), seriesTitle: x.series_title, seriesId: x.parent_id, publisher: x.series_publisher || undefined });
    const ISSUE = `select ${SEL}, ser.title as series_title, ser.studios[1] as series_publisher ${FROM} join items ser on ser.id = i.parent_id`;
    const reading = await q(`${ISSUE} where i.library_id = $2 and i.kind = 'comic' and p.position_s > 0 and not p.watched order by p.updated_at desc limit 16`, [pid, lib.id]);
    const upNext = await q(
      `with last as (
         select distinct on (c.parent_id) c.parent_id, coalesce((c.extra->>'number')::float, -1) as num, c.sort_title, p.updated_at
         from progress p join items c on c.id = p.item_id
         where p.profile_id = $1 and p.watched and c.kind = 'comic' and c.library_id = $2
         order by c.parent_id, p.updated_at desc)
       select n.*, ser.title as series_title, ser.studios[1] as series_publisher, s.title as show_title, s.poster as show_poster, s.backdrop as show_backdrop, s.logo as show_logo,
         s.rating as show_rating, s.genres as show_genres, null::real as position_s, null::real as duration_s, null::boolean as watched
       from last l
       join lateral (select * from items e where e.parent_id = l.parent_id and e.kind = 'comic'
         and (coalesce((e.extra->>'number')::float, -1), e.sort_title) > (l.num, l.sort_title)
         order by (e.extra->>'number')::float nulls last, e.sort_title limit 1) n on true
       join items ser on ser.id = n.parent_id
       left join items s on s.id = n.show_id
       left join progress p on p.item_id = n.id and p.profile_id = $1
       where p.item_id is null
       order by l.updated_at desc limit 16`, [pid, lib.id]);
    const recent = await q(`${ISSUE} where i.library_id = $2 and i.kind = 'comic' order by i.added_at desc, (i.extra->>'number')::float desc nulls last limit 24`, [pid, lib.id]);
    const counts = await q1(
      `select count(*) filter (where kind='series')::int as series, count(*) filter (where kind='comic')::int as issues,
         (select count(*)::int from progress p join items c on c.id = p.item_id where p.profile_id = $2 and p.watched and c.library_id = $1 and c.kind = 'comic') as read
       from items where library_id = $1`, [lib.id, pid]);
    const pubs = await q(`select p, count(*)::int as n from items i, unnest(i.studios) p where i.library_id=$1 and i.kind='series' group by p having count(*) >= 2 order by n desc, p limit 4`, [lib.id]);
    const readN = `(select count(*)::int from items c join progress pp on pp.item_id = c.id and pp.profile_id = $1 and pp.watched where c.parent_id = i.id) as read_count`;
    const readingN = `(select count(*)::int from items c join progress pp on pp.item_id = c.id and pp.profile_id = $1 and not pp.watched and pp.position_s > 0 where c.parent_id = i.id) as reading_count`;
    const publishers = [];
    for (const { p } of pubs) {
      const items = await q(`select ${SEL}, ${COUNT}, ${readN}, ${readingN} ${FROM} where i.library_id = $2 and i.kind = 'series' and $3 = any(i.studios) order by i.sort_title limit 24`, [pid, lib.id, p]);
      publishers.push({ name: p, items: items.map(card) });
    }
    const fresh = await q(`select ${SEL}, ${COUNT}, ${readN}, ${readingN} ${FROM} where i.library_id = $2 and i.kind = 'series' order by i.added_at desc limit 24`, [pid, lib.id]);
    // Something to start when nothing is under way: the newest series nobody here has opened.
    const start = !reading.length ? await q1(`select ${SEL}, ${COUNT} ${FROM} where i.library_id = $2 and i.kind = 'series'
        and not exists (select 1 from items c join progress pp on pp.item_id = c.id and pp.profile_id = $1 where c.parent_id = i.id)
        order by i.added_at desc limit 1`, [pid, lib.id]) : null;
    return {
      library: lib, totals: counts, continue: reading.map(issue), upNext: upNext.map(issue), recent: recent.map(issue),
      newSeries: fresh.map(card), publishers, start: start ? { ...card(start), poster: img(start.poster, 'w500') } : null,
    };
  });

  r.get('/api/search', async ({ profile, query }) => {
    const term = String(query.q || '').trim();
    if (!term) return { items: [] };
    const direct = await q1(`select 1 from items where kind in ('movie','show','book','series','album','artist') and (title ilike $1 or author ilike $1) limit 1`, [`%${term.replace(/[%_\\]/g, '\\$&')}%`]);
    if (!direct) { const smart = await smartSearch(profile.id, term); if (smart?.items.length) return smart; }
    const like = `%${term.replace(/[%_\\]/g, '\\$&')}%`;
    const items = await q(
      `select ${SEL}, ${COUNT} ${FROM} where i.kind in ('movie','show','book','series','album','artist') and (i.title ilike $2 or $3 ilike any(i.genres) or i.author ilike $2
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
    if (it?.kind === 'track') { // a played song: remembered for Recently played
      await q(`insert into progress (profile_id, item_id, position_s, watched, updated_at) values ($1,$2,0,true,now()) on conflict (profile_id, item_id) do update set updated_at=now()`, [profile.id, itemId]);
      return { ok: true };
    }
    if (!it || !['movie', 'episode', 'book', 'comic'].includes(it.kind)) return { ok: true };
    const dur = +duration || it.runtime_s || 0;
    const pos = Math.max(0, +position || 0);
    const watched = !!ended || (dur > 0 && pos / dur >= (it.kind === 'book' || it.kind === 'comic' ? 0.999 : 0.92));
    await q(
      `insert into progress (profile_id, item_id, position_s, duration_s, watched, updated_at) values ($1,$2,$3,$4,$5,now())
       on conflict (profile_id, item_id) do update set position_s=excluded.position_s, duration_s=excluded.duration_s,
         watched=excluded.watched, updated_at=now()`, [profile.id, itemId, watched ? 0 : pos, dur, watched]);
    return { ok: true, watched };
  });

  r.post('/api/watched', async ({ profile, req, hidden }) => {
    const { itemId, itemIds, watched } = await readJson(req);
    if (Array.isArray(itemIds)) { // several issues at once, like "mark read up to here"
      const ids = itemIds.map(Number).filter((x) => x > 0 && !hidden?.has(x)).slice(0, 2000);
      if (watched) {
        await q(`insert into progress (profile_id, item_id, position_s, watched, updated_at) select $1, i.id, 0, true, now() from items i where i.id = any($2::bigint[]) and i.kind in ('comic','book','episode','movie')
                 on conflict (profile_id, item_id) do update set position_s=0, watched=true, updated_at=now()`, [profile.id, ids]);
      } else await q('delete from progress where profile_id=$1 and item_id = any($2)', [profile.id, ids]);
      return { ok: true };
    }
    const it = await q1('select id, kind from items where id=$1', [itemId]);
    if (!it) throw new HttpError(404, 'Not found');
    const ids = it.kind === 'show' ? (await q(`select id from items where show_id=$1 and kind='episode'`, [it.id])).map((x) => x.id)
      : it.kind === 'season' || it.kind === 'series' ? (await q(`select id from items where parent_id=$1`, [it.id])).map((x) => x.id) : [it.id];
    if (watched) {
      await q(`insert into progress (profile_id, item_id, position_s, watched, updated_at) select $1, unnest($2::bigint[]), 0, true, now()
               on conflict (profile_id, item_id) do update set position_s=0, watched=true, updated_at=now()`, [profile.id, ids]);
    } else await q('delete from progress where profile_id=$1 and item_id = any($2)', [profile.id, ids]);
    return { ok: true };
  });
}

// ---------- books, comics and music ----------
const trackCard = (t) => ({ ...card(t), album: t.album_title, albumId: t.parent_id, poster: img(t.album_poster, 'w342'), codec: t.extra?.codec, container: t.container });
const TRACKS = (where) => `select ${SEL}, al.title as album_title, al.poster as album_poster ${FROM} join items al on al.id = i.parent_id where ${where}`;

async function shelfItem(pid, row) {
  let focus = null;
  if (row.kind === 'comic' || row.kind === 'track') { focus = row.id; row = await q1(`select ${SEL} ${FROM} where i.id = $2`, [pid, row.parent_id]); }
  const lib = await q1('select id, name, kind from libraries where id=$1', [row.library_id]);
  const out = { ...card(row), poster: img(row.poster, 'w500'), library: lib?.id, libraryName: lib?.name, publisher: row.studios?.[0] || null, focus,
    inList: !!(await q1('select 1 from mylist where profile_id=$1 and item_id=$2', [pid, row.id])) };
  if (row.kind === 'book') {
    out.format = row.container;
    out.more = (await q(`select ${SEL} ${FROM} where i.kind='book' and i.id<>$2 and i.author is not distinct from $3 and $3 is not null order by i.year nulls last, i.sort_title limit 20`, [pid, row.id, row.author])).map(card);
  }
  if (row.kind === 'series') {
    const issues = await q(`select ${SEL} ${FROM} where i.parent_id = $2 and i.kind='comic' order by (i.extra->>'number')::float nulls last, i.sort_title`, [pid, row.id]);
    out.issues = issues.map(card);
    const started = issues.filter((x) => x.position_s != null && !x.watched);
    out.next = (started[0] || issues.find((x) => !x.watched) || issues[0])?.id || null;
    out.resuming = !!started.length;
  }
  if (row.kind === 'album') {
    out.tracks = (await q(TRACKS(`i.parent_id = $2 and i.kind='track'`) + ' order by i.season_no, i.episode_no nulls last, i.sort_title', [pid, row.id])).map(trackCard);
    out.discs = new Set(out.tracks.map((t) => t.disc)).size;
    out.artistId = row.parent_id;
    out.more = (await q(`select ${SEL} ${FROM} where i.kind='album' and i.parent_id=$2 and i.id<>$3 order by i.year desc nulls last`, [pid, row.parent_id, row.id])).map(card);
  }
  if (row.kind === 'artist') {
    out.albums = (await q(`select ${SEL} ${FROM} where i.kind='album' and i.parent_id=$2 order by i.year desc nulls last, i.sort_title`, [pid, row.id])).map(card);
    out.tracks = (await q(TRACKS(`i.show_id = $2 and i.kind='track'`) + ' order by al.year desc nulls last, al.sort_title, i.season_no, i.episode_no nulls last', [pid, row.id])).map(trackCard);
  }
  return out;
}
