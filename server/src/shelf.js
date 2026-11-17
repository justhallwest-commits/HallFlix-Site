// Books, comics and music: scanning their folders, and serving pages, chapters, covers and audio.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cfg } from './config.js';
import { q, q1 } from './db.js';
import { HttpError, sendFile } from './http.js';
import * as archive from './archive.js';
import * as names from './names.js';
import { status, pool, rootMissing, hiddenFor } from './scan.js';

const exec = promisify(execFile);
export const SHELF_KINDS = ['books', 'comics', 'music'];
const BOOK_EXT = new Set(['epub', 'pdf']);
const COMIC_EXT = new Set(['cbz', 'cbr', 'cb7', 'cbt', 'pdf']);
const AUDIO_EXT = new Set(['mp3', 'flac', 'm4a', 'm4b', 'aac', 'ogg', 'oga', 'opus', 'wav', 'wma', 'aiff', 'aif', 'ape', 'wv', 'alac']);
const natural = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const skip = (n) => n.startsWith('.') || /^(@eadir|#recycle|\.recycle|__macosx)$/i.test(n);

async function walk(dir, exts, out = []) {
  let entries;
  try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (skip(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) await walk(full, exts, out);
    else if (exts.has(names.ext(e.name))) {
      try { const st = await fs.promises.stat(full); out.push({ path: full, size: st.size, mtime: Math.floor(st.mtimeMs) }); } catch { /* vanished */ }
    }
  }
  return out;
}

/** The common steps for every shelf scan: find files, drop ones that vanished, and hand back what is new or changed. */
async function prepare(lib, exts, kind) {
  if (await rootMissing(lib.path)) throw new Error(`Folder not found: ${lib.path}`);
  const isHidden = await hiddenFor(lib);
  const files = (await walk(lib.path, exts)).filter((f) => !isHidden(f.path));
  const existing = new Map((await q(`select id, path, size, mtime from items where library_id=$1 and kind=$2`, [lib.id, kind])).map((r) => [r.path, r]));
  const present = new Set(files.map((f) => f.path));
  const gone = [...existing.values()].filter((r) => !present.has(r.path)).map((r) => r.id);
  if (gone.length && (files.length || !(await rootMissing(lib.path)))) await q('delete from items where id = any($1)', [gone]);
  return { files, todo: files.filter((f) => { const e = existing.get(f.path); return !e || e.size !== f.size || e.mtime !== f.mtime; }) };
}

const decode = (s) => s.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&amp;/g, '&');
/** Plain text from XML text that may hold (escaped) HTML. */
const clean = (s) => decode(decode(String(s ?? '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')).replace(/<[^>]+>/g, ' ')).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const yearOf = (s) => { const m = /(1[5-9]\d\d|20\d\d)/.exec(String(s || '')); return m ? +m[1] : null; };
const attr = (tag, name) => { const m = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(tag); return m ? (m[2] ?? m[3]) : null; };
const tags = (xml, name) => [...xml.matchAll(new RegExp(`<(?:[\\w-]+:)?${name}\\b([^>]*)>([\\s\\S]*?)</(?:[\\w-]+:)?${name}>`, 'gi'))].map((m) => ({ attrs: m[1], text: clean(m[2]) }));
const first = (xml, name) => tags(xml, name)[0]?.text || null;
const resolve = (base, href) => path.posix.normalize(path.posix.join(path.posix.dirname(base), decodeURIComponent(String(href).split('#')[0])));

// ---------- EPUB ----------
const epubCache = new Map();
/** Title, author, cover, reading order and table of contents of an EPUB. */
export async function epub(file) {
  const st = await fs.promises.stat(file);
  const key = `${file}|${st.mtimeMs}`;
  if (epubCache.has(key)) return epubCache.get(key);
  const container = (await archive.read(file, 'META-INF/container.xml'))?.toString('utf8') || '';
  const opfPath = attr(/<rootfile\b[^>]*>/i.exec(container)?.[0] || '', 'full-path') || (await archive.list(file)).find((n) => n.endsWith('.opf'));
  if (!opfPath) throw new Error('No package file in this EPUB');
  const opf = (await archive.read(file, opfPath))?.toString('utf8') || '';
  const manifest = new Map();
  for (const m of opf.matchAll(/<(?:\w+:)?item\b[^>]*>/gi)) {
    const id = attr(m[0], 'id'), href = attr(m[0], 'href');
    if (id && href) manifest.set(id, { href: resolve(opfPath, href), type: attr(m[0], 'media-type') || '', props: attr(m[0], 'properties') || '' });
  }
  const spine = [...opf.matchAll(/<(?:\w+:)?itemref\b[^>]*>/gi)].map((m) => manifest.get(attr(m[0], 'idref'))).filter((x) => x && /html|xml/.test(x.type)).map((x) => x.href);
  const metaCover = attr([...opf.matchAll(/<meta\b[^>]*>/gi)].map((m) => m[0]).find((t) => attr(t, 'name') === 'cover') || '', 'content');
  const cover = [...manifest.values()].find((x) => /cover-image/.test(x.props))?.href || manifest.get(metaCover)?.href
    || [...manifest.entries()].find(([id, x]) => /cover/i.test(id + x.href) && /^image\//.test(x.type))?.[1].href || null;
  // Table of contents: the EPUB 3 nav document, or the EPUB 2 NCX.
  let toc = [];
  const nav = [...manifest.values()].find((x) => /\bnav\b/.test(x.props));
  if (nav) {
    const doc = (await archive.read(file, nav.href))?.toString('utf8') || '';
    const block = /<nav\b[^>]*toc[^>]*>([\s\S]*?)<\/nav>/i.exec(doc)?.[1] || doc;
    toc = [...block.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].map((m) => ({ label: clean(m[2]), href: resolve(nav.href, attr(m[1], 'href') || '') + (/#/.test(attr(m[1], 'href') || '') ? `#${attr(m[1], 'href').split('#')[1]}` : '') }));
  }
  if (!toc.length) {
    const ncxId = attr(/<(?:\w+:)?spine\b[^>]*>/i.exec(opf)?.[0] || '', 'toc');
    const ncx = manifest.get(ncxId) || [...manifest.values()].find((x) => x.href.endsWith('.ncx'));
    if (ncx) {
      const doc = (await archive.read(file, ncx.href))?.toString('utf8') || '';
      toc = [...doc.matchAll(/<navPoint\b[\s\S]*?<text>([\s\S]*?)<\/text>[\s\S]*?<content\b([^>]*)>/gi)].map((m) => {
        const src = attr(m[2], 'src') || '';
        return { label: clean(m[1]), href: resolve(ncx.href, src) + (src.includes('#') ? `#${src.split('#')[1]}` : '') };
      });
    }
  }
  const out = {
    title: first(opf, 'title'), author: first(opf, 'creator'), description: first(opf, 'description'), year: yearOf(first(opf, 'date')),
    subjects: tags(opf, 'subject').map((t) => t.text).filter(Boolean).slice(0, 6), publisher: first(opf, 'publisher'),
    series: attr([...opf.matchAll(/<meta\b[^>]*>/gi)].map((m) => m[0]).find((t) => attr(t, 'name') === 'calibre:series') || '', 'content'),
    cover, spine, toc: toc.filter((t) => t.label),
  };
  epubCache.set(key, out);
  if (epubCache.size > 40) epubCache.delete(epubCache.keys().next().value);
  return out;
}

async function pdfInfo(file) {
  try {
    const { stdout } = await exec('pdfinfo', [file], { timeout: 30e3 });
    const get = (k) => new RegExp(`^${k}:\\s*(.*)$`, 'm').exec(stdout)?.[1]?.trim() || null;
    return { title: get('Title'), author: get('Author'), pages: +get('Pages') || 0, year: yearOf(get('CreationDate')) };
  } catch { return { pages: 0 }; }
}

/** Calibre keeps metadata.opf and cover.jpg beside each book. */
async function calibre(dir) {
  const out = {};
  try {
    const opf = await fs.promises.readFile(path.join(dir, 'metadata.opf'), 'utf8');
    Object.assign(out, { title: first(opf, 'title'), author: first(opf, 'creator'), description: first(opf, 'description'), year: yearOf(first(opf, 'date')),
      subjects: tags(opf, 'subject').map((t) => t.text).slice(0, 6), publisher: first(opf, 'publisher') });
  } catch { /* not a Calibre folder */ }
  for (const n of ['cover.jpg', 'cover.jpeg', 'cover.png', 'folder.jpg']) if (fs.existsSync(path.join(dir, n))) { out.poster = `local:${path.join(dir, n)}`; break; }
  return out;
}

/** "Author - Title" or "Title (2019)" from a file name; the author can also come from the first folder (Author/Title/book.epub). */
function bookName(lib, file) {
  let stem = path.basename(file, path.extname(file)).replace(/[_]+/g, ' ').replace(/\s*\[[^\]]*\]\s*/g, ' ').trim();
  const year = yearOf(stem);
  stem = stem.replace(/\s*\((1[5-9]\d\d|20\d\d)\)\s*/, ' ').trim();
  const rel = path.relative(lib.path, path.dirname(file)).split(path.sep).filter(Boolean);
  let author = rel.length >= 1 && rel.length <= 2 ? rel[0] : null;
  const dash = /^(.+?)\s+-\s+(.+)$/.exec(stem);
  if (dash) { author ||= dash[1]; stem = dash[1] === author ? dash[2] : stem; }
  return { title: stem, author, year };
}

export async function scanBooks(lib) {
  const { files, todo } = await prepare(lib, BOOK_EXT, 'book');
  const epubs = new Set(files.filter((f) => f.path.endsWith('.epub')).map((f) => f.path.slice(0, -5)));
  const work = todo.filter((f) => !(f.path.endsWith('.pdf') && epubs.has(f.path.slice(0, -4)))); // one book, two formats: keep the EPUB
  Object.assign(status, { phase: 'Adding books', total: work.length, done: 0 });
  await pool(work, 3, async (f) => {
    const isEpub = f.path.endsWith('.epub');
    const named = bookName(lib, f.path);
    let meta = {}, pages = 0;
    if (isEpub) { const e = await epub(f.path); meta = e; pages = e.spine.length; } else { const p = await pdfInfo(f.path); meta = p; pages = p.pages; }
    const cal = await calibre(path.dirname(f.path));
    const title = cal.title || (meta.title && !/^(untitled|unknown|microsoft word)/i.test(meta.title) ? meta.title : null) || named.title;
    const row = await q1(
      `insert into items (library_id, kind, title, sort_title, author, overview, year, genres, studios, pages, path, size, mtime, container, poster, extra, matched)
       values ($1,'book',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,true)
       on conflict (path) do update set title=excluded.title, sort_title=excluded.sort_title, author=excluded.author, overview=excluded.overview, year=excluded.year,
         genres=excluded.genres, studios=excluded.studios, pages=excluded.pages, size=excluded.size, mtime=excluded.mtime, container=excluded.container,
         poster=coalesce(excluded.poster, items.poster), extra=excluded.extra
       returning id`,
      [lib.id, title, names.sortTitle(title), cal.author || meta.author || named.author || null, cal.description || meta.description || null,
        cal.year || meta.year || named.year || null, cal.subjects?.length ? cal.subjects : meta.subjects || [], [cal.publisher || meta.publisher].filter(Boolean),
        pages, f.path, f.size, f.mtime, isEpub ? 'epub' : 'pdf', cal.poster || null, JSON.stringify({ format: isEpub ? 'epub' : 'pdf', series: meta.series || null })]);
    await q(`update items set poster='cover:'||id where id=$1 and poster is null`, [row.id]);
  });
}

// ---------- comics ----------
/** Series and issue number from a file name: "Saga 012 (2013).cbz", "Batman #4.cbr", "Hellboy v02.cbz". */
export function comicName(file) {
  let s = path.basename(file, path.extname(file)).replace(/_/g, ' ');
  const year = yearOf(/\((1[5-9]\d\d|20\d\d)\)/.exec(s)?.[1]);
  s = s.replace(/\s*[([][^)\]]*[)\]]/g, '').trim();
  let number = null, m;
  if ((m = /^(.*?)\s*(?:#|issue\s*|no\.?\s*)(\d+(?:\.\d+)?)\b/i.exec(s))) { number = +m[2]; s = m[1]; }
  else if ((m = /^(.*?)\s+v(?:ol(?:ume)?)?\.?\s*(\d+)\b/i.exec(s))) { number = +m[2]; s = m[1]; }
  else if ((m = /^(.*?)\s+(\d{1,4}(?:\.\d+)?)$/.exec(s)) && m[1]) { number = +m[2]; s = m[1]; }
  return { series: s.replace(/[\s-]+$/, '').trim() || path.basename(file, path.extname(file)), number, year };
}

async function comicInfo(file) {
  if (file.endsWith('.pdf')) return {};
  try {
    const name = (await archive.list(file)).find((n) => /(^|\/)comicinfo\.xml$/i.test(n));
    if (!name) return {};
    const x = (await archive.read(file, name)).toString('utf8');
    const v = (k) => first(x, k);
    return { series: v('Series'), number: v('Number') != null && !isNaN(parseFloat(v('Number'))) ? parseFloat(v('Number')) : null, title: v('Title'), summary: v('Summary'),
      writer: v('Writer'), year: +v('Year') || null, publisher: v('Publisher'), genres: (v('Genre') || '').split(',').map((g) => g.trim()).filter(Boolean),
      manga: /^yes/i.test(v('Manga') || '') };
  } catch { return {}; }
}

export async function comicPages(file) {
  if (file.endsWith('.pdf')) return (await pdfInfo(file)).pages;
  return (await archive.pages(file)).length;
}

export async function scanComics(lib) {
  const { todo } = await prepare(lib, COMIC_EXT, 'comic');
  Object.assign(status, { phase: 'Adding comics', total: todo.length, done: 0 });
  const touched = new Set();
  await pool(todo, 3, async (f) => {
    const named = comicName(f.path), info = await comicInfo(f.path), pages = await comicPages(f.path);
    if (!pages) throw new Error('No pages found');
    const folder = path.dirname(f.path) === lib.path ? null : path.basename(path.dirname(f.path)).replace(/\s*\((1[5-9]\d\d|20\d\d)\)\s*$/, '');
    const seriesName = info.series || folder || named.series;
    const key = `series:${lib.id}:${seriesName.toLowerCase()}`;
    const series = await q1(
      `insert into items (library_id, kind, title, sort_title, path, matched) values ($1,'series',$2,$3,$4,true)
       on conflict (path) do update set title=excluded.title returning id`, [lib.id, seriesName, names.sortTitle(seriesName), key]);
    touched.add(series.id);
    const number = info.number ?? (folder && named.series.toLowerCase() !== folder.toLowerCase() && named.number == null ? null : named.number);
    const title = info.title || (number != null ? `${seriesName} #${number}` : named.series);
    const row = await q1(
      `insert into items (library_id, kind, parent_id, title, sort_title, author, overview, year, genres, studios, pages, path, size, mtime, container, extra, matched)
       values ($1,'comic',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,true)
       on conflict (path) do update set parent_id=excluded.parent_id, title=excluded.title, sort_title=excluded.sort_title, author=excluded.author, overview=excluded.overview,
         year=excluded.year, genres=excluded.genres, studios=excluded.studios, pages=excluded.pages, size=excluded.size, mtime=excluded.mtime, container=excluded.container, extra=excluded.extra
       returning id, (xmax = 0) as fresh`,
      [lib.id, series.id, title, names.sortTitle(title), info.writer || null, info.summary || null, info.year || named.year || null, info.genres || [],
        [info.publisher].filter(Boolean), pages, f.path, f.size, f.mtime, names.ext(f.path), JSON.stringify({ number, manga: !!info.manga })]);
    await q(`update items set poster='cover:'||id where id=$1`, [row.id]);
    if (row.fresh) await q('update items set added_at=now() where id=$1', [series.id]);
  });
  // Each series takes its cover, writer and years from its issues; empty series go.
  await q(`delete from items s where s.library_id=$1 and s.kind='series' and not exists (select 1 from items c where c.parent_id=s.id)`, [lib.id]);
  await q(`update items s set poster = 'cover:' || f.id, author = coalesce(f.author, s.author), year = f.year, overview = coalesce(s.overview, f.overview),
             genres = f.genres, studios = f.studios
           from (select distinct on (parent_id) * from items where library_id=$1 and kind='comic'
                 order by parent_id, (extra->>'number')::float nulls last, sort_title) f
           where s.id = f.parent_id and (s.locked->>'poster') is null`, [lib.id]);
}

// ---------- music ----------
async function audioTags(file) {
  const { stdout } = await exec(cfg.ffprobe, ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', file], { timeout: 60e3, maxBuffer: 8e6 });
  const j = JSON.parse(stdout);
  const t = {};
  for (const src of [j.format?.tags || {}, ...(j.streams || []).map((s) => s.tags || {})]) for (const [k, v] of Object.entries(src)) { const key = k.toLowerCase(); if (!(key in t)) t[key] = v; }
  const a = (j.streams || []).find((s) => s.codec_type === 'audio');
  if (!a) throw new Error('No audio in this file');
  const art = (j.streams || []).some((s) => s.codec_type === 'video' && (s.disposition?.attached_pic || ['mjpeg', 'png'].includes(s.codec_name)));
  const num = (v) => (v == null ? null : parseInt(String(v).split('/')[0], 10) || null);
  return {
    title: t.title || null, artist: t.artist || null, albumArtist: t.album_artist || t['album artist'] || t.albumartist || null, album: t.album || null,
    track: num(t.track || t.tracknumber), disc: num(t.disc || t.discnumber), year: yearOf(t.date || t.year || t.originaldate), genre: t.genre || null,
    duration: +j.format?.duration || +a.duration || 0, codec: a.codec_name, container: names.ext(file), bitrate: +j.format?.bit_rate || null, art,
  };
}

const COVER_NAMES = ['cover', 'folder', 'front', 'album', 'albumart'];
async function folderCover(dir) {
  let entries;
  try { entries = await fs.promises.readdir(dir); } catch { return null; }
  const lower = new Map(entries.map((e) => [e.toLowerCase(), e]));
  for (const s of COVER_NAMES) for (const x of names.IMAGE_EXT) { const hit = lower.get(`${s}.${x}`); if (hit) return `local:${path.join(dir, hit)}`; }
  const any = entries.find((e) => names.IMAGE_EXT.has(names.ext(e)));
  return any ? `local:${path.join(dir, any)}` : null;
}

export async function scanMusic(lib) {
  const { todo } = await prepare(lib, AUDIO_EXT, 'track');
  Object.assign(status, { phase: 'Adding music', total: todo.length, done: 0 });
  const albumIds = new Set();
  const albumKey = (artist, album) => `album:${lib.id}:${artist.toLowerCase()}:${album.toLowerCase()}`;
  await pool(todo, 4, async (f) => {
    const t = await audioTags(f.path);
    const dir = path.dirname(f.path), inRoot = dir === lib.path;
    const folderAlbum = inRoot ? null : path.basename(dir).replace(/^(cd|disc)\s*\d+$/i, '') || path.basename(path.dirname(dir));
    const discFolder = /^(cd|disc)\s*\d+$/i.test(path.basename(dir));
    const albumDir = discFolder ? path.dirname(dir) : dir;
    const folderArtist = inRoot ? null : path.relative(lib.path, albumDir).split(path.sep).length >= 2 ? path.relative(lib.path, albumDir).split(path.sep)[0] : null;
    const artist = (t.albumArtist || t.artist || folderArtist || 'Unknown artist').trim();
    const album = (t.album || (discFolder ? path.basename(albumDir) : folderAlbum) || 'Singles').trim();
    const title = t.title || path.basename(f.path, path.extname(f.path)).replace(/^\d+[\s.\-_]+/, '');
    const art = await q1(
      `insert into items (library_id, kind, title, sort_title, path, matched) values ($1,'artist',$2,$3,$4,true)
       on conflict (path) do update set title=excluded.title returning id`, [lib.id, artist, names.sortTitle(artist), `artist:${lib.id}:${artist.toLowerCase()}`]);
    const cover = await folderCover(albumDir);
    const alb = await q1(
      `insert into items (library_id, kind, parent_id, show_id, title, sort_title, author, year, path, poster, matched) values ($1,'album',$2,$2,$3,$4,$5,$6,$7,$8,true)
       on conflict (path) do update set title=excluded.title, author=excluded.author, year=coalesce(items.year, excluded.year),
         poster=case when items.locked->>'poster' is null then coalesce(excluded.poster, items.poster) else items.poster end
       returning id, (xmax = 0) as fresh`,
      [lib.id, art.id, album, names.sortTitle(album), artist, t.year, albumKey(artist, album), cover]);
    albumIds.add(alb.id);
    await q(
      `insert into items (library_id, kind, parent_id, show_id, title, sort_title, author, year, genres, runtime_s, path, size, mtime, container, bitrate, season_no, episode_no, extra, matched)
       values ($1,'track',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,true)
       on conflict (path) do update set parent_id=excluded.parent_id, show_id=excluded.show_id, title=excluded.title, sort_title=excluded.sort_title, author=excluded.author,
         year=excluded.year, genres=excluded.genres, runtime_s=excluded.runtime_s, size=excluded.size, mtime=excluded.mtime, container=excluded.container, bitrate=excluded.bitrate,
         season_no=excluded.season_no, episode_no=excluded.episode_no, extra=excluded.extra`,
      [lib.id, alb.id, art.id, title, names.sortTitle(title), t.artist || artist, t.year, t.genre ? [t.genre] : [], t.duration, f.path, f.size, f.mtime, t.container, t.bitrate,
        t.disc || 1, t.track, JSON.stringify({ codec: t.codec, art: t.art })]);
    if (alb.fresh) await q('update items set added_at=now() where id=$1', [art.id]);
  });
  // Tidy: albums and artists left empty go; each album totals its tracks; an album with no picture uses one embedded in a track.
  await q(`delete from items a where a.library_id=$1 and a.kind='album' and not exists (select 1 from items t where t.parent_id=a.id)`, [lib.id]);
  await q(`delete from items a where a.library_id=$1 and a.kind='artist' and not exists (select 1 from items t where t.parent_id=a.id)`, [lib.id]);
  await q(`update items a set runtime_s = x.total, genres = x.genres, year = coalesce(a.year, x.year), pages = x.n
           from (select parent_id, sum(runtime_s) as total, count(*)::int as n, min(year) as year,
                   coalesce(array_agg(distinct g) filter (where g is not null), '{}') as genres
                 from items left join lateral unnest(genres) g on true where library_id=$1 and kind='track' group by parent_id) x
           where a.id = x.parent_id`, [lib.id]);
  await q(`update items a set poster = 'cover:' || a.id where a.library_id=$1 and a.kind='album' and a.poster is null
             and exists (select 1 from items t where t.parent_id=a.id and (t.extra->>'art')::boolean)`, [lib.id]);
  await q(`update items r set poster = x.poster from (select distinct on (parent_id) parent_id, poster from items where library_id=$1 and kind='album' and poster is not null
             order by parent_id, year desc nulls last) x where r.id = x.parent_id and (r.locked->>'poster') is null`, [lib.id]);
}

// ---------- serving ----------
const cacheDir = (...p) => path.join(cfg.dataDir, 'cache', ...p);
const busy = new Map(); // file -> promise, so two requests for the same page render it once

function once(key, fn) {
  if (busy.has(key)) return busy.get(key);
  const p = fn().finally(() => busy.delete(key));
  busy.set(key, p);
  return p;
}

async function shrink(buf, out, width) {
  await fs.promises.mkdir(path.dirname(out), { recursive: true });
  const tmp = `${out}.${process.pid}.${Date.now()}.tmp`;
  await fs.promises.writeFile(tmp, buf);
  try {
    await exec(cfg.ffmpeg, ['-v', 'error', '-nostdin', '-y', '-i', tmp, '-vf', `scale='min(${width},iw)':-2`, '-frames:v', '1', '-q:v', '4', '-f', 'mjpeg', `${out}.part`], { timeout: 60e3 });
    await fs.promises.rename(`${out}.part`, out);
  } finally { fs.promises.rm(tmp, { force: true }).catch(() => {}); }
}

async function pdfPage(file, n, out, width) {
  await fs.promises.mkdir(path.dirname(out), { recursive: true });
  const base = `${out}.${process.pid}.${Date.now()}`;
  await exec('pdftoppm', ['-f', String(n), '-l', String(n), '-singlefile', '-jpeg', '-jpegopt', 'quality=85', '-scale-to', String(width), file, base], { timeout: 120e3 });
  await fs.promises.rename(`${base}.jpg`, out);
}

/** A cover image for a book, comic, series or album, made once and kept. */
async function coverFile(item) {
  if (item.kind === 'series') {
    const firstIssue = await q1(`select * from items where parent_id=$1 and kind='comic' order by (extra->>'number')::float nulls last, sort_title limit 1`, [item.id]);
    if (!firstIssue) return null;
    return coverFile(firstIssue);
  }
  if (item.kind === 'artist') {
    const alb = await q1(`select * from items where parent_id=$1 and kind='album' and poster like 'cover:%' order by year desc nulls last limit 1`, [item.id]);
    return alb ? coverFile(alb) : null;
  }
  const out = cacheDir('covers', `${item.id}-${item.mtime || 0}.jpg`);
  if (fs.existsSync(out)) return out;
  return once(out, async () => {
    if (item.kind === 'album') {
      const t = await q1(`select path from items where parent_id=$1 and kind='track' and (extra->>'art')::boolean order by season_no, episode_no nulls last limit 1`, [item.id]);
      if (!t) return null;
      await fs.promises.mkdir(path.dirname(out), { recursive: true });
      await exec(cfg.ffmpeg, ['-v', 'error', '-nostdin', '-y', '-i', t.path, '-an', '-map', '0:v:0', '-frames:v', '1', '-vf', "scale='min(600,iw)':-2", '-f', 'mjpeg', `${out}.part`], { timeout: 60e3 });
      await fs.promises.rename(`${out}.part`, out);
      return out;
    }
    if (item.path.endsWith('.pdf')) { await pdfPage(item.path, 1, out, 600); return out; }
    if (item.kind === 'book') {
      const e = await epub(item.path);
      const img = e.cover && (await archive.read(item.path, e.cover));
      if (!img) return null;
      await shrink(img, out, 600);
      return out;
    }
    const list = await archive.pages(item.path);
    if (!list.length) return null;
    await shrink(await archive.read(item.path, list[0]), out, 600);
    return out;
  });
}

async function readable(id) {
  const item = await q1(`select * from items where id=$1 and kind in ('book','comic')`, [id]);
  if (!item?.path) throw new HttpError(404, 'Not found');
  return item;
}

export function routes(r) {
  r.get('/api/cover/:id', async ({ req, res, params }) => {
    const item = await q1(`select * from items where id=$1 and kind in ('book','comic','series','album','artist')`, [params.id]);
    if (!item) throw new HttpError(404, 'Not found');
    let file = null;
    try { file = await coverFile(item); } catch (e) { console.error('[cover]', item.id, e.message); }
    if (!file) throw new HttpError(404, 'No cover');
    await sendFile(req, res, file, { cache: 'private, max-age=604800', type: 'image/jpeg' });
  });

  // What a reader needs to open a book or comic: pages for comics and PDFs, the reading order for EPUBs.
  r.get('/api/read/:id', async ({ profile, params }) => {
    const item = await readable(params.id);
    const prog = await q1('select position_s, duration_s, watched from progress where profile_id=$1 and item_id=$2', [profile.id, item.id]);
    const out = { id: item.id, kind: item.kind, title: item.title, author: item.author, progress: prog ? { position: prog.position_s, duration: prog.duration_s, finished: prog.watched } : null };
    if (item.kind === 'comic') {
      out.mode = 'pages'; out.pages = item.pages || (await comicPages(item.path)); out.rtl = !!item.extra?.manga;
      const series = await q1('select id, title from items where id=$1', [item.parent_id]);
      out.series = series;
      const next = await q1(`select id, title from items where parent_id=$1 and kind='comic' and id<>$2 and
          ((extra->>'number')::float, sort_title) > ($3::float, $4) order by (extra->>'number')::float nulls last, sort_title limit 1`,
        [item.parent_id, item.id, item.extra?.number ?? -1, item.sort_title]);
      out.next = next || null;
    } else if (item.container === 'pdf') {
      out.mode = 'pages'; out.pages = item.pages || (await pdfInfo(item.path)).pages;
    } else {
      const e = await epub(item.path);
      out.mode = 'epub'; out.base = `/api/read/${item.id}/epub/`; out.spine = e.spine; out.toc = e.toc;
    }
    return out;
  });

  r.get('/api/read/:id/page/:n', async ({ req, res, params }) => {
    const item = await readable(params.id);
    const n = parseInt(params.n, 10);
    if (!(n >= 1)) throw new HttpError(404, 'Not found');
    if (item.path.endsWith('.pdf')) {
      const out = cacheDir('pages', `${item.id}-${item.mtime}`, `${n}.jpg`);
      if (!fs.existsSync(out)) {
        if (n > (item.pages || 0)) throw new HttpError(404, 'Not found');
        await once(out, () => pdfPage(item.path, n, out, 1800));
      }
      return sendFile(req, res, out, { cache: 'private, max-age=604800', type: 'image/jpeg' });
    }
    const list = await archive.pages(item.path);
    const name = list[n - 1];
    if (!name) throw new HttpError(404, 'Not found');
    const buf = await archive.read(item.path, name);
    res.writeHead(200, { 'Content-Type': archive.mimeOf(name), 'Content-Length': buf.length, 'Cache-Control': 'private, max-age=604800' });
    res.end(req.method === 'HEAD' ? undefined : buf);
  });

  // EPUB contents, file by file. Scripts inside books never run.
  r.get('/api/read/:id/epub/:rest*', async ({ req, res, params }) => {
    const item = await readable(params.id);
    if (item.container !== 'epub') throw new HttpError(404, 'Not found');
    const name = path.posix.normalize(params.rest).replace(/^(\.\.\/)+/, '');
    const buf = await archive.read(item.path, name);
    if (!buf) throw new HttpError(404, 'Not found');
    res.writeHead(200, {
      'Content-Type': archive.mimeOf(name), 'Content-Length': buf.length, 'Cache-Control': 'private, max-age=86400',
      'Content-Security-Policy': "default-src 'self' data: blob:; script-src 'none'; object-src 'none'; style-src 'self' 'unsafe-inline' data:; img-src 'self' data: blob:; font-src 'self' data:",
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(req.method === 'HEAD' ? undefined : buf);
  });

  // Audio a browser cannot play as-is (ALAC, WMA, APE…) comes out as MP3, starting at ?at= seconds (?t= is the sign-in token).
  r.get('/api/audio/:id', async ({ req, res, query, params }) => {
    const item = await q1(`select path from items where id=$1 and kind='track'`, [params.id]);
    if (!item?.path) throw new HttpError(404, 'Not found');
    const t = Math.max(0, +query.at || 0);
    res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store' });
    if (req.method === 'HEAD') return res.end();
    const ff = spawn(cfg.ffmpeg, ['-v', 'error', '-nostdin', ...(t ? ['-ss', String(t)] : []), '-i', item.path, '-map', '0:a:0', '-vn', '-c:a', 'libmp3lame', '-b:a', '320k', '-f', 'mp3', 'pipe:1']);
    ff.stdout.pipe(res);
    ff.on('error', () => res.destroy());
    res.on('close', () => ff.kill('SIGKILL'));
  });
}
