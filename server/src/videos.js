// The front page of a movie or show library: a spotlight, then rows (what you're watching, new, top rated, hidden gems,
// short ones, by decade and by genre), like the library pages of the big streaming apps.
import { q, q1 } from './db.js';
import { HttpError } from './http.js';
import { SEL, FROM, card, img, continueRow, RATED } from './catalog.js';

export function routes(r) {
  r.get('/api/videos/:id', async ({ profile, params, query }) => {
    const lib = await q1('select id, name, kind from libraries where id=$1', [params.id]);
    if (!lib || !['movies', 'shows'].includes(lib.kind)) throw new HttpError(404, 'Library not found');
    const pid = profile.id, kind = lib.kind === 'movies' ? 'movie' : 'show', day = new Date().toISOString().slice(0, 10);
    const lite = !!query.lite, n = lite ? 14 : 24;
    const W = `i.library_id = $2 and i.kind = '${kind}'`;
    // Shows count as watched once every episode is, and as started once any is.
    const seen = kind === 'movie' ? 'coalesce(p.watched, false)'
      : `(not exists (select 1 from items e left join progress pe on pe.item_id = e.id and pe.profile_id = $1 where e.show_id = i.id and e.kind = 'episode' and not coalesce(pe.watched, false)))`;
    const started = kind === 'movie' ? 'p.position_s > 0' : `exists (select 1 from progress pe join items e on e.id = pe.item_id where e.show_id = i.id and pe.profile_id = $1)`;
    const rows = [];
    const add = (id, title, list, extra = {}) => { if (list.length >= (extra.min ?? 4)) rows.push({ id, title, items: list.map(card), ...extra }); };
    const pick = (where, order, args = [], limit = n) => q(`select ${SEL} ${FROM} where ${W} and ${where} order by ${order} limit ${limit}`, [pid, lib.id, ...args]);

    const cont = (await continueRow(pid)).filter((c) => c.library === lib.id);
    if (cont.length) rows.push({ id: 'continue', title: 'Continue watching', shape: 'wide', items: cont });
    add('recent', kind === 'movie' ? 'Recently added' : 'New episodes and shows', kind === 'movie' ? await pick('true', 'i.added_at desc, i.id desc')
      : await q(`select ${SEL} ${FROM} where ${W} order by (select max(e.added_at) from items e where e.show_id = i.id) desc nulls last, i.added_at desc limit ${n}`, [pid, lib.id]), { min: 1 });
    add('top', 'Top rated', await pick(`${RATED} is not null`, `${RATED} desc, i.id`, [], 10), { shape: 'ranked', min: 6 });
    add('gems', kind === 'movie' ? 'You haven’t seen these yet' : 'Shows you haven’t started', await pick(`not ${started} and not ${seen}`, `coalesce(${RATED}, 6) desc, md5(i.id::text || $3)`, [day]));
    if (kind === 'movie') add('short', 'Under 100 minutes', await pick('i.runtime_s between 1800 and 6000 and not coalesce(p.watched, false)', `md5(i.id::text || $3)`, [day]));
    const decades = await q(`select (i.year / 10) * 10 as d from items i where i.library_id = $1 and i.kind = '${kind}' and i.year is not null
      group by 1 having count(*) >= 5 order by md5(((i.year / 10) * 10)::text || $2) limit 2`, [lib.id, day]);
    for (const d of decades) add(`decade-${d.d}`, `From the ${String(d.d).slice(2)}s`, await pick('i.year between $3 and $3 + 9', `coalesce(${RATED}, 0) desc, i.id`, [d.d]));
    const genres = await q(`select g, count(*)::int as c from items i, unnest(i.genres) g where i.library_id = $1 and i.kind = '${kind}'
      group by g having count(*) >= 4 order by count(*) desc, g limit ${lite ? 4 : 8}`, [lib.id]);
    for (const g of genres) add(`genre-${g.g}`, g.g, await pick('$3 = any(i.genres)', `md5(i.id::text || $4)`, [g.g, day]), { genre: g.g });

    const spot = await q(`select ${SEL} ${FROM} where ${W} and i.backdrop is not null
      order by (i.added_at > now() - interval '30 days') desc, (not coalesce(p.watched, false)) desc, md5(i.id::text || $3) limit 6`, [pid, lib.id, day]);
    const total = (await q1(`select count(*)::int as n from items i where i.library_id = $1 and i.kind = $2`, [lib.id, kind])).n;
    return {
      library: lib, total, rows,
      spotlight: spot.map((x) => ({ ...card(x), backdrop: img(x.backdrop || x.poster, 'w1280'), tagline: x.tagline, trailer: x.trailer })),
    };
  });
}
