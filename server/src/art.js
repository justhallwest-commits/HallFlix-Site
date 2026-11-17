// Artwork Studio: posters, backdrops, logos and thumbs for every title, from an upload, a web link, the NAS or TMDb.
// Also the pictures for each library's tile and the screensaver gallery.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cfg } from './config.js';
import { q, q1, getSetting, setSetting } from './db.js';
import { HttpError, readJson } from './http.js';
import { IMAGE_EXT } from './names.js';
import { img } from './catalog.js';
import * as tmdb from './tmdb.js';

const exec = promisify(execFile);
const admin = { admin: true };
const SHELF = new Set(['book', 'series', 'comic', 'album', 'artist']);

// What each kind of title can have, and what HallFlix uses it for.
const SLOT = {
  poster: { label: 'Poster', hint: 'Rows, grids and the title page · 2:3, about 1000×1500', ratio: '2/3' },
  cover: { label: 'Cover', hint: 'Shelves and the reader · books 2:3, albums square', ratio: '2/3', col: 'poster' },
  photo: { label: 'Picture', hint: 'The artist page and cards · square', ratio: '1/1', col: 'poster' },
  backdrops: { label: 'Backdrops', hint: 'The spotlight, the title page and the screensaver · 16:9, 1920×1080 or larger · the first is the main one', ratio: '16/9', multi: true },
  still: { label: 'Still', hint: 'The episode list and Continue watching · 16:9', ratio: '16/9', col: 'backdrop' },
  logo: { label: 'Logo', hint: 'The title drawn over the picture · transparent PNG, about 800×310', ratio: '800/310', clear: true },
  thumb: { label: 'Thumb', hint: 'Wide cards such as Continue watching · 16:9 with the title in it, about 1000×562', ratio: '16/9' },
};
const SLOTS_FOR = { movie: ['poster', 'backdrops', 'logo', 'thumb'], show: ['poster', 'backdrops', 'logo', 'thumb'], episode: ['still'],
  book: ['cover'], series: ['cover'], comic: ['cover'], album: ['cover'], artist: ['photo'] };
const ART_KINDS = Object.keys(SLOTS_FOR);
const colOf = (slot) => SLOT[slot].col || (slot === 'backdrops' ? 'backdrop' : slot);

// ---------- NAS folders ----------
let rootsCache = null;
export async function roots() {
  if (!rootsCache) rootsCache = [...new Set([path.resolve(cfg.mediaRoot), ...((await getSetting('artRoots', [])) || []).map((p) => path.resolve(p))])];
  return rootsCache;
}
/** True when a file sits inside the media folder or one of the artwork folders. */
export async function allowed(file) {
  const full = path.resolve(file);
  return (await roots()).some((r) => full === r || full.startsWith(r + path.sep));
}
async function insideRoot(p) {
  const full = path.resolve(String(p || ''));
  if (!(await allowed(full))) throw new HttpError(400, 'That folder is not one of your artwork folders');
  return full;
}
const isImage = (n) => IMAGE_EXT.has(path.extname(n).slice(1).toLowerCase());

// ---------- turning any source into a stored picture ----------
const uploadsDir = () => path.join(cfg.dataDir, 'uploads');
async function store(buf, ext) {
  const name = `${crypto.createHash('sha1').update(buf).digest('hex').slice(0, 16)}.${ext}`;
  await fs.promises.mkdir(uploadsDir(), { recursive: true });
  const file = path.join(uploadsDir(), name);
  if (!fs.existsSync(file)) await fs.promises.writeFile(file, buf);
  return `/uploads/${name}`;
}
function sniff(buf) {
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'jpg';
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') return 'webp';
  if (buf.slice(0, 3).toString() === 'GIF') return 'gif';
  return null;
}
/** Share links from Google Drive, Dropbox, OneDrive and Imgur become direct picture links. */
export function shareLink(url) {
  const u = String(url || '').trim();
  const drive = /drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:export=\w+&)?id=)([\w-]{10,})/.exec(u);
  if (drive) return `https://drive.google.com/uc?export=download&id=${drive[1]}`;
  if (/dropbox\.com\//i.test(u)) { let x = u.replace(/([?&])dl=0/, '$1raw=1'); if (!/raw=1|dl=1/.test(x)) x += (x.includes('?') ? '&' : '?') + 'raw=1'; return x; }
  if (/1drv\.ms\//i.test(u) && !/download=1/.test(u)) return u + (u.includes('?') ? '&' : '?') + 'download=1';
  const imgur = /^https?:\/\/imgur\.com\/([A-Za-z0-9]{5,8})$/.exec(u);
  if (imgur) return `https://i.imgur.com/${imgur[1]}.jpg`;
  return u;
}
async function download(url, depth = 0) {
  const u = shareLink(url);
  if (!/^https?:\/\//i.test(u)) throw new HttpError(400, 'Use a link that starts with http:// or https://');
  let res;
  try { res = await fetch(u, { redirect: 'follow', signal: AbortSignal.timeout(45e3), headers: { 'User-Agent': 'Mozilla/5.0 HallFlix', Accept: 'image/*,text/html;q=0.8' } }); }
  catch (e) { throw new HttpError(400, `HallFlix couldn't reach that link (${e.cause?.code || e.message}). The NAS has to be able to open it.`); }
  if (!res.ok) throw new HttpError(400, `That link answered ${res.status}. Make sure the picture is public.`);
  const len = +res.headers.get('content-length') || 0;
  if (len > 40e6) throw new HttpError(400, 'That picture is over 40 MB');
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > 40e6) throw new HttpError(400, 'That picture is over 40 MB');
  const ext = sniff(buf);
  if (ext) return store(buf, ext);
  // A web page: use the picture it advertises for sharing.
  const og = /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)/i.exec(buf.toString('utf8', 0, 200000)) || /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image/i.exec(buf.toString('utf8', 0, 200000));
  if (og && depth < 1) return download(new URL(og[1].replace(/&amp;/g, '&'), res.url).href, depth + 1);
  throw new HttpError(400, "That link isn't a picture. Open the picture itself and copy its address (right-click → Copy image address).");
}
/** Shrink a stored picture wider than `max` pixels (big photos for the screensaver) using ffmpeg. */
async function shrink(ref, max = 3840) {
  if (!ref.startsWith('/uploads/')) return ref;
  const file = path.join(uploadsDir(), path.basename(ref));
  try {
    const { stdout } = await exec(cfg.ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width', '-of', 'csv=p=0', file], { timeout: 20e3 });
    if (+stdout.trim() <= max) return ref;
    const out = file.replace(/\.\w+$/, `-${max}.jpg`);
    await exec(cfg.ffmpeg, ['-v', 'error', '-y', '-i', file, '-vf', `scale=${max}:-2`, '-q:v', '3', out], { timeout: 60e3 });
    return `/uploads/${path.basename(out)}`;
  } catch { return ref; }
}
/** source: { type: 'ref'|'url'|'nas'|'tmdb', ref?, url?, path?, mode?: 'copy'|'link' } → a stored reference. */
export async function resolve(source = {}) {
  if (source.type === 'url') return download(source.url);
  if (source.type === 'tmdb') { if (!/^\/[\w-]+\.(jpg|png|svg|webp)$/.test(source.path || '')) throw new HttpError(400, 'Bad TMDb picture'); return `tmdb:${source.path}`; }
  if (source.type === 'nas') {
    const file = await insideRoot(source.path);
    if (!isImage(file)) throw new HttpError(400, 'Choose a JPG, PNG, WebP or GIF');
    if (source.mode === 'link') return `local:${file}`;
    const buf = await fs.promises.readFile(file).catch(() => { throw new HttpError(404, 'That file is gone'); });
    return store(buf, path.extname(file).slice(1).toLowerCase().replace('jpeg', 'jpg'));
  }
  if (source.type === 'ref' && /^(\/uploads\/[\w.-]+|tmdb:\/[\w.-]+|local:\/.+|https?:\/\/.+)$/.test(source.ref || '')) {
    if (/^https?:/.test(source.ref)) return download(source.ref);
    if (source.ref.startsWith('local:') && !(await allowed(source.ref.slice(6)))) throw new HttpError(400, 'That file is outside your artwork folders');
    return source.ref;
  }
  throw new HttpError(400, 'Choose a picture first');
}

// ---------- reading and writing a title's pictures ----------
const showUrl = (ref, size) => img(ref, size);
function slotsOf(it) {
  return (SLOTS_FOR[it.kind] || []).map((key) => {
    const s = SLOT[key];
    let refs;
    if (key === 'backdrops') refs = [it.backdrop, ...(it.extra?.backdrops || [])].filter(Boolean);
    else if (key === 'thumb') refs = [it.extra?.thumb].filter(Boolean);
    else refs = [it[colOf(key)]].filter(Boolean);
    return { key, ...s, locked: !!it.locked?.[key === 'thumb' ? 'thumb' : colOf(key)],
      images: refs.map((ref, index) => ({ index, ref, url: showUrl(ref, key === 'backdrops' || key === 'still' || key === 'thumb' ? 'w1280' : 'w500'), full: showUrl(ref, 'original'),
        source: ref.startsWith('tmdb:') ? 'TMDb' : ref.startsWith('local:') ? 'NAS' : ref.startsWith('/uploads/') ? 'Saved in HallFlix' : ref.startsWith('cover:') ? 'From the file' : 'Link' })) };
  });
}
/** Write a slot's pictures. `refs` is the full list for backdrops, or one picture (or none) for the others. */
async function write(id, slot, refs, { lock = true } = {}) {
  const it = await q1('select id, kind, backdrop, extra, locked, edits from items where id=$1', [id]);
  if (!it) throw new HttpError(404, 'Not found');
  if (!(SLOTS_FOR[it.kind] || []).includes(slot)) throw new HttpError(400, `A ${it.kind} has no ${slot}`);
  const locked = { ...(it.locked || {}) }, edits = { ...(it.edits || {}) }, extra = { ...(it.extra || {}) };
  const sets = [], vals = [];
  const put = (sql, v) => { vals.push(v); sets.push(sql.replace('?', `$${vals.length}`)); };
  if (slot === 'backdrops') {
    const [main = null, ...rest] = refs;
    put('backdrop=?', main);
    extra.backdrops = rest;
    if (lock) { locked.backdrop = true; edits.backdrop = main; edits['extra.backdrops'] = rest; }
  } else if (slot === 'thumb') {
    extra.thumb = refs[0] || null;
    if (lock) { locked.thumb = true; edits['extra.thumb'] = extra.thumb; }
  } else {
    const col = colOf(slot);
    put(`${col}=?`, refs[0] || null);
    if (lock) { locked[col] = true; edits[col] = refs[0] || null; }
  }
  put('extra=?::jsonb', JSON.stringify(extra));
  put('locked=?::jsonb', JSON.stringify(locked));
  put('edits=?::jsonb', JSON.stringify(edits));
  vals.push(id);
  await q(`update items set ${sets.join(', ')} where id=$${vals.length}`, vals);
}
async function refsOf(id, slot) {
  const it = await q1('select * from items where id=$1', [id]);
  if (!it) throw new HttpError(404, 'Not found');
  return slotsOf(it).find((s) => s.key === slot)?.images.map((x) => x.ref) || [];
}

// ---------- TMDb pictures ----------
export async function online(it, slot, lang = 'en') {
  if (!(await tmdb.tmdbKey())) throw new HttpError(400, 'Add a TMDb key in Settings to search online');
  const show = it.kind === 'episode' ? await q1('select tmdb_id from items where id=$1', [it.show_id]) : null;
  const id = it.kind === 'episode' ? show?.tmdb_id : it.tmdb_id;
  if (!id || !['movie', 'show', 'episode'].includes(it.kind)) throw new HttpError(400, it.kind === 'episode' ? 'Match the show to TMDb first' : SHELF.has(it.kind) ? 'Online pictures cover movies and shows. For this one, use an upload, a link or the NAS.' : "This title isn't matched to TMDb yet. Fix the match (or set its TMDb id in Metadata), then try again.");
  const langs = lang === 'all' ? undefined : `${lang},null`;
  const d = it.kind === 'episode'
    ? await tmdb.call(`/tv/${id}/season/${it.season_no}/episode/${it.episode_no}/images`)
    : await tmdb.call(`/${it.kind === 'movie' ? 'movie' : 'tv'}/${id}/images`, { include_image_language: langs });
  const list = { poster: d?.posters, backdrops: d?.backdrops, still: d?.stills, logo: d?.logos, thumb: d?.backdrops }[slot] || [];
  return list.map((x) => ({ path: x.file_path, url: `/img/t/${slot === 'poster' || slot === 'logo' ? 'w342' : 'w780'}${x.file_path}`, w: x.width, h: x.height, lang: x.iso_639_1 || null, score: x.vote_average || 0, votes: x.vote_count || 0 }))
    .sort((a, z) => z.score - a.score || z.votes - a.votes || z.w - a.w);
}

// ---------- the screensaver gallery ----------
const SAVER = { mode: 'mixed', share: 50, pictures: [] };
export async function saverSettings() { return { ...SAVER, ...((await getSetting('screensaver', null)) || {}) }; }
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

export function routes(r) {
  // A list for the app's screensaver: the admin's pictures, title backdrops, or both.
  r.get('/api/screensaver', async () => {
    const s = await saverSettings();
    const mine = shuffle(s.pictures.map((p) => ({ image: img(p.url, 'original'), title: p.caption || '', sub: '' })));
    const want = 40;
    const nMine = s.mode === 'mine' || !mine.length ? (s.mode === 'mine' ? Math.min(want, mine.length) : 0) : Math.min(mine.length, Math.round(want * (s.share / 100)));
    let titles = [];
    if (s.mode !== 'mine' || !mine.length) {
      const rows = await q(`select id, kind, title, year, genres, backdrop, extra from items where kind in ('movie','show') and backdrop is not null order by random() limit 80`);
      titles = shuffle(rows.flatMap((x) => [x.backdrop, ...(x.extra?.backdrops || [])].map((b) => ({ id: x.id, kind: x.kind, image: img(b, 'original'), title: x.title, sub: [x.year, ...(x.genres || []).slice(0, 2)].filter(Boolean).join(' · ') }))));
    }
    const out = [...mine.slice(0, nMine), ...titles.slice(0, want - nMine)];
    return shuffle(out);
  });

  r.get('/api/studio/art/items', async ({ query }) => {
    const args = [], w = [];
    const arg = (v) => { args.push(v); return `$${args.length}`; };
    const kind = ART_KINDS.includes(query.kind) ? [query.kind] : ['movie', 'show', 'book', 'series', 'album', 'artist'];
    w.push(`i.kind = any(${arg(kind)})`);
    if (query.library) w.push(`i.library_id = ${arg(+query.library)}`);
    if (query.q?.trim()) w.push(`(i.title ilike ${arg(`%${query.q.trim().replace(/[%_\\]/g, '\\$&')}%`)} or s.title ilike $${args.length})`);
    const MISSING = { poster: 'i.poster is null', backdrop: 'i.backdrop is null', logo: `i.logo is null and i.kind in ('movie','show')`, thumb: `i.extra->>'thumb' is null and i.kind in ('movie','show')`, still: `i.backdrop is null and i.kind = 'episode'` };
    if (MISSING[query.missing]) w.push(MISSING[query.missing]);
    const W = w.join(' and ');
    const total = (await q1(`select count(*)::int as n from items i left join items s on s.id = i.show_id where ${W}`, args)).n;
    const limit = Math.min(200, +query.limit || 60), offset = +query.offset || 0;
    const rows = await q(`select i.id, i.kind, i.title, i.year, i.poster, i.backdrop, i.logo, i.extra, i.season_no, i.episode_no, s.title as show_title, l.name as library
      from items i left join items s on s.id = i.show_id join libraries l on l.id = i.library_id where ${W} order by coalesce(s.sort_title, i.sort_title), i.season_no, i.episode_no, i.id limit ${limit} offset ${offset}`, args);
    return { total, items: rows.map((x) => ({ id: x.id, kind: x.kind, title: x.title, year: x.year, library: x.library,
      series: x.show_title ? `${x.show_title} · S${x.season_no} E${x.episode_no}` : null,
      image: img(x.kind === 'episode' ? x.backdrop : x.poster, x.kind === 'episode' ? 'w300' : 'w342'),
      has: { poster: !!x.poster, backdrop: !!x.backdrop, logo: !!x.logo, thumb: !!x.extra?.thumb } })) };
  }, admin);

  r.get('/api/studio/art/item/:id', async ({ params }) => {
    const it = await q1('select i.*, s.title as show_title from items i left join items s on s.id = i.show_id where i.id=$1', [params.id]);
    if (!it || !SLOTS_FOR[it.kind]) throw new HttpError(404, 'Not found');
    const show = it.kind === 'episode' ? await q1('select tmdb_id from items where id=$1', [it.show_id]) : null;
    return { id: it.id, kind: it.kind, title: it.title, year: it.year, series: it.show_title, online: ['movie', 'show'].includes(it.kind) ? !!it.tmdb_id : it.kind === 'episode' ? !!show?.tmdb_id : false, slots: slotsOf(it) };
  }, admin);

  // Put a picture in a slot. For backdrops, leave out `index` to add one, or give it to replace that one.
  r.post('/api/studio/art/item/:id/set', async ({ req, params }) => {
    const b = await readJson(req);
    const ref = await resolve(b.source);
    const cur = await refsOf(params.id, b.slot);
    let next;
    if (b.slot === 'backdrops') {
      next = [...cur];
      if (b.main) next = [ref, ...cur.filter((x) => x !== ref)];
      else if (b.index == null || b.index >= next.length) next.push(ref);
      else next[b.index] = ref;
    }
    else next = [ref];
    await write(params.id, b.slot, [...new Set(next)]);
    return { ok: true, ref, url: img(ref, 'w780') };
  }, admin);
  r.post('/api/studio/art/item/:id/remove', async ({ req, params }) => {
    const b = await readJson(req);
    const cur = await refsOf(params.id, b.slot);
    await write(params.id, b.slot, b.slot === 'backdrops' ? cur.filter((_, i) => i !== +b.index) : []);
    return { ok: true };
  }, admin);
  r.post('/api/studio/art/item/:id/order', async ({ req, params }) => {
    const b = await readJson(req);
    const cur = await refsOf(params.id, 'backdrops');
    const order = (b.order || []).map(Number).filter((i) => cur[i]);
    if (order.length !== cur.length || new Set(order).size !== cur.length) throw new HttpError(400, 'Send every backdrop once');
    await write(params.id, 'backdrops', order.map((i) => cur[i]));
    return { ok: true };
  }, admin);
  // Hand a slot back to HallFlix: the next scan or match picks a picture again.
  r.post('/api/studio/art/item/:id/auto', async ({ req, params }) => {
    const b = await readJson(req);
    const it = await q1('select * from items where id=$1', [params.id]);
    if (!it) throw new HttpError(404, 'Not found');
    const locked = { ...(it.locked || {}) }, edits = { ...(it.edits || {}) };
    const col = b.slot === 'thumb' ? 'thumb' : colOf(b.slot);
    delete locked[col]; delete edits[col]; delete edits[`extra.${b.slot}`];
    if (b.slot === 'backdrops') delete edits['extra.backdrops'];
    await q('update items set locked=$1::jsonb, edits=$2::jsonb where id=$3', [JSON.stringify(locked), JSON.stringify(edits), it.id]);
    if (['book', 'comic'].includes(it.kind) && col === 'poster') await q(`update items set poster='cover:'||id where id=$1`, [it.id]);
    if (['movie', 'show'].includes(it.kind)) {
      const best = it.tmdb_id && b.slot !== 'thumb' ? (await online(it, b.slot).catch(() => []))[0] : null;
      if (best) await write(it.id, b.slot, b.slot === 'backdrops' ? [`tmdb:${best.path}`] : [`tmdb:${best.path}`], { lock: false });
      else if (b.slot === 'thumb') await q(`update items set extra = extra - 'thumb' where id=$1`, [it.id]);
    }
    return { ok: true };
  }, admin);

  r.get('/api/studio/art/item/:id/online', async ({ params, query }) => {
    const it = await q1('select * from items where id=$1', [params.id]);
    if (!it) throw new HttpError(404, 'Not found');
    return online(it, query.slot, query.lang || 'en');
  }, admin);

  // Many titles at once: fill what's missing from TMDb, or put one picture on all of them.
  r.post('/api/studio/art/fill', async ({ req }) => {
    const b = await readJson(req);
    const slots = (b.slots || ['poster', 'backdrops', 'logo']).filter((s) => ['poster', 'backdrops', 'logo'].includes(s));
    const items = await q(`select * from items where id = any($1::bigint[]) and kind in ('movie','show')`, [(b.ids || []).map(Number)]);
    let filled = 0, skipped = 0;
    for (const it of items) {
      for (const s of slots) {
        if (it[colOf(s)]) continue;
        const best = (await online(it, s, b.lang || 'en').catch(() => []))[0];
        if (!best) { skipped++; continue; }
        await write(it.id, s, [`tmdb:${best.path}`], { lock: false });
        filled++;
      }
    }
    return { filled, skipped, checked: items.length, ignored: (b.ids || []).length - items.length };
  }, admin);
  r.post('/api/studio/art/bulk', async ({ req }) => {
    const b = await readJson(req);
    if (!b.ids?.length) throw new HttpError(400, 'Select some titles first');
    const ref = await resolve(b.source);
    let done = 0, skipped = 0;
    for (const id of b.ids) {
      const it = await q1('select * from items where id=$1', [id]);
      if (!it || !(SLOTS_FOR[it.kind] || []).includes(b.slot)) { skipped++; continue; }
      const cur = slotsOf(it).find((s) => s.key === b.slot).images.map((x) => x.ref);
      if (b.skipExisting && cur.length) { skipped++; continue; }
      await write(it.id, b.slot, b.slot === 'backdrops' ? [ref, ...cur.filter((x) => x !== ref)] : [ref]);
      done++;
    }
    return { done, skipped };
  }, admin);

  // Turn a source into a stored picture without attaching it (libraries, the screensaver, the Look page).
  r.post('/api/studio/art/resolve', async ({ req }) => { const ref = await resolve((await readJson(req)).source); return { ref, url: img(ref, 'original') }; }, admin);

  // ----- NAS
  r.get('/api/studio/art/roots', async () => Promise.all((await roots()).map(async (p) => ({ path: p, media: p === path.resolve(cfg.mediaRoot), found: await fs.promises.stat(p).then((s) => s.isDirectory(), () => false) }))), admin);
  r.put('/api/studio/art/roots', async ({ req }) => {
    const list = ((await readJson(req)).roots || []).map((p) => String(p).trim()).filter((p) => p.startsWith('/')).map((p) => path.resolve(p)).filter((p) => p !== path.resolve(cfg.mediaRoot));
    await setSetting('artRoots', [...new Set(list)]);
    rootsCache = null;
    return { ok: true };
  }, admin);
  r.get('/api/studio/art/browse', async ({ query }) => {
    const all = await roots();
    const dir = await insideRoot(query.path || all[0]);
    let entries;
    try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { throw new HttpError(404, `HallFlix can't open ${dir}`); }
    const root = all.find((r0) => dir === r0 || dir.startsWith(r0 + path.sep));
    const vis = entries.filter((e) => !/^[.@#]/.test(e.name));
    const folders = vis.filter((e) => e.isDirectory()).map((e) => ({ name: e.name, path: path.join(dir, e.name) }));
    const images = vis.filter((e) => e.isFile() && isImage(e.name)).map((e) => ({ name: e.name, path: path.join(dir, e.name), url: img(`local:${path.join(dir, e.name)}`) }));
    const by = (a, z) => a.name.localeCompare(z.name, undefined, { numeric: true });
    return { path: dir, root, roots: all, parent: dir === root ? null : path.dirname(dir), folders: folders.sort(by), images: images.sort(by).slice(0, 600), more: Math.max(0, images.length - 600) };
  }, admin);
  r.get('/api/studio/art/search', async ({ query }) => {
    const dir = await insideRoot(query.path || (await roots())[0]);
    const words = String(query.q || '').toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) throw new HttpError(400, 'Type part of a file name');
    const out = [];
    const walk = async (d, depth) => {
      if (out.length >= 300 || depth > 8) return;
      let es; try { es = await fs.promises.readdir(d, { withFileTypes: true }); } catch { return; }
      for (const e of es) {
        if (out.length >= 300 || /^[.@#]/.test(e.name)) continue;
        const full = path.join(d, e.name);
        if (e.isDirectory()) await walk(full, depth + 1);
        else if (isImage(e.name)) { const hay = full.toLowerCase(); if (words.every((w) => hay.includes(w))) out.push({ name: e.name, path: full, folder: path.relative(dir, d) || '.', url: img(`local:${full}`) }); }
      }
    };
    await walk(dir, 0);
    return { images: out, capped: out.length >= 300 };
  }, admin);

  // ----- screensaver gallery
  r.get('/api/studio/art/screensaver', async () => { const s = await saverSettings(); return { ...s, pictures: s.pictures.map((p, i) => ({ ...p, index: i, thumb: img(p.url, 'w500') })) }; }, admin);
  r.put('/api/studio/art/screensaver', async ({ req }) => {
    const b = await readJson(req), s = await saverSettings();
    await setSetting('screensaver', { ...s, mode: b.mode === 'mine' ? 'mine' : 'mixed', share: Math.max(0, Math.min(100, +b.share || 0)) });
    return { ok: true };
  }, admin);
  r.post('/api/studio/art/screensaver', async ({ req }) => {
    const b = await readJson(req), s = await saverSettings();
    const sources = b.sources || [b.source];
    const added = [];
    for (const src of sources) added.push({ url: await shrink(await resolve(src)), caption: String(b.caption || '').slice(0, 120), added: new Date().toISOString() });
    await setSetting('screensaver', { ...s, pictures: [...s.pictures, ...added].filter((p, i, a) => a.findIndex((x) => x.url === p.url) === i) });
    return { added: added.length };
  }, admin);
  r.delete('/api/studio/art/screensaver/:index', async ({ params }) => {
    const s = await saverSettings();
    await setSetting('screensaver', { ...s, pictures: s.pictures.filter((_, i) => i !== +params.index) });
    return { ok: true };
  }, admin);
}
