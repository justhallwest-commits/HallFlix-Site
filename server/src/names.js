// Turning file and folder names into titles, years and episode numbers.
import path from 'node:path';

export const VIDEO_EXT = new Set(['mkv', 'mp4', 'm4v', 'mov', 'avi', 'webm', 'ts', 'm2ts', 'wmv', 'mpg', 'mpeg', 'flv']);
export const IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif']);
export const ext = (p) => path.extname(p).slice(1).toLowerCase();
export const isVideo = (p) => VIDEO_EXT.has(ext(p));

const RELEASE = /\b(2160p|1080p|1080i|720p|576p|480p|4k|uhd|hdr10?|dv|bluray|blu-ray|brrip|bdrip|webrip|web-dl|webdl|web|hdtv|dvdrip|dvd|remux|x264|x265|h264|h265|hevc|avc|xvid|aac|ac3|dts|atmos|truehd|proper|repack|extended|unrated|remastered|imax|multi|internal|limited)\b/i;
const SKIP_DIRS = new Set(['extras', 'extra', 'featurettes', 'behind the scenes', 'deleted scenes', 'interviews', 'trailers', 'samples', 'sample', 'shorts', 'other', '@eadir', '#recycle', '.recycle']);
export const skipDir = (name) => name.startsWith('.') || SKIP_DIRS.has(name.toLowerCase());
export const skipFile = (name) => /(^sample\.[a-z0-9]+$|[.\-_ ]sample\.[a-z0-9]+$|-trailer\.|-featurette\.|-behindthescenes\.|-deleted\.|-interview\.|-scene\.|-short\.)/i.test(name);

export function tmdbHint(s) {
  const m = /[\[{(]tmdb(?:id)?[-= ](\d+)[\]})]/i.exec(s);
  return m ? +m[1] : null;
}

export function cleanTitle(raw) {
  let s = raw.replace(/[\[{][^\]}]*[\]}]/g, ' ');
  if (!/\s/.test(s.trim())) s = s.replace(/[._]+/g, ' ');
  s = s.replace(/_/g, ' ').replace(/\s+/g, ' ').replace(/[\s\-–(]+$/g, '').replace(/^[\s\-–]+/, '').trim();
  return s;
}

/** "Title (2019)", "Title.2019.1080p.BluRay" or "Title" → { title, year }. */
export function parseTitleYear(raw) {
  const hint = tmdbHint(raw);
  const s = raw.replace(/[\[{(]tmdb(?:id)?[-= ]\d+[\]})]/ig, ' ');
  const paren = /^(.+?)\s*\(((?:19|20)\d{2})\)/.exec(s);
  if (paren) return { title: cleanTitle(paren[1]), year: +paren[2], tmdbId: hint };
  // last standalone year that is not the whole title
  const years = [...s.matchAll(/(?:^|[\s._\-\[])((?:19|20)\d{2})(?=$|[\s._\-\]])/g)];
  for (let i = years.length - 1; i >= 0; i--) {
    const y = years[i];
    const before = s.slice(0, y.index);
    if (cleanTitle(before)) return { title: cleanTitle(before), year: +y[1], tmdbId: hint };
  }
  const rel = RELEASE.exec(s);
  const head = rel && rel.index > 0 ? s.slice(0, rel.index) : s;
  return { title: cleanTitle(head) || cleanTitle(s), year: null, tmdbId: hint };
}

/** A movie file: prefer its own folder's name when that folder carries a year. */
export function parseMovie(file, libRoot) {
  const base = path.basename(file, path.extname(file));
  const dir = path.dirname(file);
  const fromFile = parseTitleYear(base);
  if (path.resolve(dir) !== path.resolve(libRoot)) {
    const fromDir = parseTitleYear(path.basename(dir));
    if (fromDir.year && (!fromFile.year || fromDir.tmdbId)) return { ...fromDir, tmdbId: fromDir.tmdbId || fromFile.tmdbId };
    if (!fromFile.tmdbId && fromDir.tmdbId) fromFile.tmdbId = fromDir.tmdbId;
  }
  return fromFile;
}

/** Episode numbers from "S01E02", "1x02", or a "Season 1" folder plus "E02" / "Episode 2". */
export function parseEpisode(file) {
  const base = path.basename(file, path.extname(file));
  const dirName = path.basename(path.dirname(file));
  let m = /[Ss](\d{1,3})[ ._\-]*[Ee](\d{1,3})/.exec(base);
  if (!m) m = /(?:^|[^\d])(\d{1,2})x(\d{2,3})(?!\d)/.exec(base);
  if (m) {
    const rest = cleanTitle(base.slice(m.index + m[0].length).replace(/^(?:[ ._\-]*[Ee]\d{1,3})+/, '').split(RELEASE)[0] || '');
    return { season: +m[1], episode: +m[2], title: rest || null };
  }
  const sd = /^(?:season|series|s)[ ._\-]*(\d{1,3})$/i.exec(dirName);
  const special = /^specials?$/i.test(dirName);
  const e = /(?:^|[ ._\-])(?:e|ep|episode)[ ._\-]*(\d{1,3})(?!\d)/i.exec(base) || /^(\d{1,3})(?:[ ._\-]|$)/.exec(base);
  if ((sd || special) && e) return { season: special ? 0 : +sd[1], episode: +e[1], title: null };
  return null;
}

export function sortTitle(title) {
  return title.toLowerCase().replace(/^(the|a|an)\s+/, '').replace(/[^\p{L}\p{N} ]/gu, '').trim();
}

/** "Halloween_Bumper-01.mp4" → "Halloween Bumper 01" */
export const clipTitle = (file) => path.basename(file, path.extname(file)).replace(/[._\-]+/g, ' ').replace(/\s+/g, ' ').trim();
