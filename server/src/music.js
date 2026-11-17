// The music front page (jump back in, new albums, most played, rediscover, artists and genre mixes),
// radio and mixes built from a song, artist, album or genre, and Liked songs.
import { q, q1 } from './db.js';
import { HttpError, readJson } from './http.js';
import { SEL, FROM, COUNT, card, img, trackCard, TRACKS } from './catalog.js';

const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
/** Mix a list so the same artist rarely plays twice in a row. */
function spread(list) {
  const out = [], pool = shuffle([...list]);
  while (pool.length) {
    const last = out.at(-1)?.author;
    const i = pool.findIndex((t) => t.author !== last);
    out.push(pool.splice(i < 0 ? 0 : i, 1)[0]);
  }
  return out;
}

export function routes(r) {
  r.get('/api/music/:id', async ({ profile, params }) => {
    const lib = await q1('select id, name, kind from libraries where id=$1', [params.id]);
    if (!lib || lib.kind !== 'music') throw new HttpError(404, 'Library not found');
    const pid = profile.id, L = lib.id;
    const albumsBy = async (sql, args) => (await q(`select ${SEL}, ${COUNT} ${FROM} ${sql}`, [pid, L, ...args])).map(card);
    const jumpBack = await albumsBy(`join (select t.parent_id, max(pl.played_at) as last from plays pl join items t on t.id = pl.item_id
        where pl.profile_id = $1 and t.library_id = $2 group by 1) x on x.parent_id = i.id order by x.last desc limit 12`, []);
    const recent = await albumsBy(`where i.library_id = $2 and i.kind = 'album' order by i.added_at desc, i.year desc nulls last limit 20`, []);
    const top = (await q(`${TRACKS(`i.library_id = $2 and i.kind = 'track'`).replace(' where ', ` join (select item_id, count(*)::int as n from plays where profile_id = $1 and played_at > now() - interval '120 days' group by 1) pc on pc.item_id = i.id where `)}
        order by pc.n desc, i.title limit 20`, [pid, L])).map(trackCard);
    const rediscover = await albumsBy(`join (select t.parent_id, max(pl.played_at) as last from plays pl join items t on t.id = pl.item_id
        where pl.profile_id = $1 and t.library_id = $2 group by 1 having max(pl.played_at) < now() - interval '45 days') x on x.parent_id = i.id order by random() limit 12`, []);
    const something = await albumsBy(`where i.library_id = $2 and i.kind = 'album' and not exists (select 1 from items t join plays pl on pl.item_id = t.id and pl.profile_id = $1 where t.parent_id = i.id)
        order by random() limit 12`, []);
    const artists = (await q(`select ${SEL}, ${COUNT}, coalesce(x.n, 0) as plays ${FROM} left join (select t.show_id, count(*)::int as n from plays pl join items t on t.id = pl.item_id
        where pl.profile_id = $1 and t.library_id = $2 group by 1) x on x.show_id = i.id where i.library_id = $2 and i.kind = 'artist' order by coalesce(x.n, 0) desc, random() limit 16`, [pid, L])).map(card);
    const genres = await q(`select g as name, count(distinct a.id)::int as albums, (array_agg(a.poster order by a.year desc nulls last) filter (where a.poster is not null))[1:3] as art
        from items a, unnest(a.genres) g where a.library_id = $1 and a.kind = 'album' group by g order by count(distinct a.id) desc, g limit 18`, [L]);
    const totals = await q1(`select count(*) filter (where kind='album')::int as albums, count(*) filter (where kind='artist')::int as artists,
        count(*) filter (where kind='track')::int as songs, coalesce(sum(runtime_s) filter (where kind='track'), 0)::float as seconds from items where library_id = $1`, [L]);
    const liked = (await q1(`select count(*)::int as n from mylist m join items t on t.id = m.item_id where m.profile_id = $1 and t.kind = 'track' and t.library_id = $2`, [pid, L])).n;
    return {
      library: lib, totals, liked, jumpBack, recent, top, rediscover, something, artists,
      genres: genres.map((x) => ({ name: x.name, albums: x.albums, art: [...new Set(x.art || [])].map((a) => img(a, 'w342')) })),
    };
  });

  // A mix: seed=track:ID (song radio), artist:ID, album:ID, genre:NAME, liked, top or all (shuffle everything).
  r.get('/api/radio', async ({ profile, query }) => {
    const pid = profile.id;
    const [kind, ...rest] = String(query.seed || 'all').split(':');
    const val = rest.join(':');
    const lib = query.library ? +query.library : null;
    const inLib = lib ? ` and i.library_id = ${Math.floor(lib)}` : '';
    const pick = async (where, args, n) => (await q(`${TRACKS(`i.kind = 'track'${inLib} and ${where}`)} order by random() limit ${n}`, [pid, ...args])).map(trackCard);
    let tracks = [], title = 'Shuffle';
    if (kind === 'track') {
      const t = await q1(`select i.*, al.genres as album_genres from items i join items al on al.id = i.parent_id where i.id = $1 and i.kind = 'track'`, [val]);
      if (!t) throw new HttpError(404, 'Not found');
      const genres = [...new Set([...(t.genres || []), ...(t.album_genres || [])])];
      const first = (await q(`${TRACKS('i.id = $2')}`, [pid, t.id])).map(trackCard);
      const sameArtist = await pick('i.show_id = $2 and i.id <> $3', [t.show_id, t.id], 8);
      const sameGenre = genres.length ? await pick('i.show_id <> $2 and (i.genres && $3::text[] or al.genres && $3::text[])', [t.show_id, genres], 40) : [];
      const fill = sameGenre.length < 20 ? await pick('i.show_id <> $2', [t.show_id], 30 - sameGenre.length) : [];
      tracks = [...first, ...spread([...sameArtist, ...sameGenre, ...fill])];
      title = `${t.title} radio`;
    } else if (kind === 'artist') {
      const a = await q1(`select * from items where id = $1 and kind = 'artist'`, [val]);
      if (!a) throw new HttpError(404, 'Not found');
      const own = await pick('i.show_id = $2', [a.id], 25);
      const g = (await q(`select distinct unnest(genres) as g from items where show_id = $1 or (parent_id = $1 and kind = 'album')`, [a.id])).map((x) => x.g);
      const like = g.length ? await pick('i.show_id <> $2 and (i.genres && $3::text[] or al.genres && $3::text[])', [a.id, g], 25) : [];
      tracks = spread([...own, ...like]); title = `${a.title} radio`;
    } else if (kind === 'album') {
      tracks = (await q(`${TRACKS(`i.parent_id = $2 and i.kind = 'track'`)} order by i.season_no, i.episode_no nulls last`, [pid, val])).map(trackCard);
      tracks = shuffle(tracks); title = 'Album shuffle';
    } else if (kind === 'genre') {
      tracks = spread(await pick('(i.genres @> array[$2]::text[] or al.genres @> array[$2]::text[])', [val], 60)); title = `${val} mix`;
    } else if (kind === 'liked') {
      tracks = shuffle((await q(`${TRACKS(`i.kind = 'track'${inLib}`).replace(' where ', ' join mylist m on m.item_id = i.id and m.profile_id = $1 where ')} order by m.added_at desc`, [pid])).map(trackCard));
      title = 'Liked songs';
    } else if (kind === 'top') {
      tracks = (await q(`${TRACKS(`i.kind = 'track'${inLib}`).replace(' where ', ' join (select item_id, count(*)::int as n from plays where profile_id = $1 group by 1) pc on pc.item_id = i.id where ')} order by pc.n desc limit 50`, [pid])).map(trackCard);
      title = 'Your most played';
    } else {
      tracks = spread(await pick('true', [], 100));
    }
    return { title, tracks };
  });

  // Liked songs: a heart on any song, kept in each profile's list.
  r.get('/api/music/liked/songs', async ({ profile }) => ({
    tracks: (await q(`${TRACKS(`i.kind = 'track'`).replace(' where ', ' join mylist m on m.item_id = i.id and m.profile_id = $1 where ')} order by m.added_at desc`, [profile.id])).map(trackCard),
  }));
  r.get('/api/music/liked/ids', async ({ profile }) => (await q(`select m.item_id from mylist m join items t on t.id = m.item_id where m.profile_id = $1 and t.kind = 'track'`, [profile.id])).map((x) => x.item_id));
  // Queue order changes on the server are not needed: the queue lives in the player. This saves a queue as a playlist.
  r.post('/api/music/queue-to-playlist', async ({ profile, req }) => {
    const b = await readJson(req);
    const name = String(b.name || '').trim().slice(0, 80);
    const ids = (Array.isArray(b.ids) ? b.ids : []).map(Number).filter(Boolean).slice(0, 2000);
    if (!name || !ids.length) throw new HttpError(400, 'Give the playlist a name');
    const p = await q1('insert into playlists (profile_id, name) values ($1,$2) returning id, name', [profile.id, name]);
    await q(`insert into playlist_items (playlist_id, item_id, position) select $1, t.id, x.ord from unnest($2::bigint[]) with ordinality as x(id, ord)
             join items t on t.id = x.id and t.kind = 'track' on conflict do nothing`, [p.id, ids]);
    return p;
  });
}
