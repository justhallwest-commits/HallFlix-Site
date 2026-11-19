// TV-sized stills of the look's pictures: GET /api/fit?src=<picture or video>&w=<width>.
// A Fire TV Stick has little memory, so a huge uploaded picture or animated GIF can fail to show at all, and a background
// video sits behind the page in the TV app's browser and vanishes. TVs ask for a JPEG instead: no wider than needed, the
// first frame of a GIF, or a frame a second into a video. Only pictures the look itself uses are converted (so this is
// not a general-purpose fetcher), and each is made once and kept.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { cfg } from './config.js';
import { HttpError, sendFile } from './http.js';
import { currentLook } from './look.js';
import { q, getSetting } from './db.js';

const DIR = () => path.join(cfg.dataDir, 'cache', 'fit');
const making = new Map(); // key → Promise, so two TVs asking at once make it once
const VIDEO = /\.(mp4|webm|m4v|mov)(\?|$)/i;

/** Is this picture part of the current look (any season, any library), or one of the uploads? */
async function allowed(src) {
  if (/^\/uploads\/[\w.-]+$/.test(src)) return true;
  const [look, theme, seasons] = await Promise.all([currentLook(), getSetting('theme', {}), q('select look from seasons')]);
  const all = JSON.stringify([look, theme, seasons]);
  return all.includes(JSON.stringify(src).slice(1, -1));
}

function ffmpeg(args) {
  return new Promise((resolve, reject) => {
    const p = spawn('nice', ['-n', '10', cfg.ffmpeg, '-hide_banner', '-loglevel', 'error', '-nostdin', '-y', ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => { err = (err + d).slice(-400); });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(err.trim() || `ffmpeg ${code}`))));
  });
}

async function make(src, w, out) {
  // Local pictures are read straight from disk; anything else (an imgur link, a NAS picture) is fetched first.
  let input = /^\/uploads\/[\w.-]+$/.test(src) ? path.join(cfg.dataDir, 'uploads', path.basename(src)) : null;
  let tmp = null;
  if (!input || !fs.existsSync(input)) {
    const url = src.startsWith('/') ? `http://127.0.0.1:${cfg.port}${src}` : src;
    if (!/^https?:\/\//.test(url)) throw new HttpError(400, 'Not a picture address');
    const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new HttpError(502, 'The picture could not be fetched');
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > 80e6) throw new HttpError(413, 'That picture is too large');
    tmp = `${out}.src`;
    fs.writeFileSync(tmp, buf);
    input = tmp;
  }
  try {
    const seek = VIDEO.test(src) ? ['-ss', '1'] : [];
    await ffmpeg([...seek, '-i', input, '-frames:v', '1', '-vf', `scale='min(${w},iw)':-2`, '-q:v', '4', `${out}.part.jpg`]);
    fs.renameSync(`${out}.part.jpg`, out);
  } finally { if (tmp) fs.rmSync(tmp, { force: true }); }
}

/** Widths a picture is resized to, so a handful of copies cover every screen (and the cache stays small). */
export const WIDTHS = [160, 240, 360, 480, 720, 1080, 1280, 1920];
export const bucket = (w) => WIDTHS.find((x) => x >= w) || WIDTHS.at(-1);

/**
 * A local artwork file (poster.jpg beside a film, often 2000+ px) at about the width it is shown, made once and kept.
 * Returns the resized file, or null when it can't be made (the caller then sends the original).
 */
export async function resizedLocal(file, w) {
  const st = await fs.promises.stat(file).catch(() => null);
  if (!st) return null;
  const width = bucket(w);
  const key = crypto.createHash('sha1').update(`${file}|${st.mtimeMs}|${st.size}|${width}`).digest('hex').slice(0, 20);
  const out = path.join(DIR(), `l-${key}.jpg`);
  if (fs.existsSync(out)) return out;
  await fs.promises.mkdir(DIR(), { recursive: true });
  if (!making.has(key)) {
    making.set(key, ffmpeg(['-i', file, '-frames:v', '1', '-vf', `scale='min(${width},iw)':-2`, '-q:v', '4', `${out}.part.jpg`])
      .then(() => fs.renameSync(`${out}.part.jpg`, out)).finally(() => making.delete(key)));
  }
  try { await making.get(key); return out; } catch (e) { console.warn('[fit] local', path.basename(file), e.message); return null; }
}

export function routes(r, open) {
  r.get('/api/fit', async ({ req, res, query }) => {
    const src = String(query.src || '');
    const w = Math.max(320, Math.min(2560, +query.w || 1920));
    if (!src || src.length > 2000 || !(await allowed(src))) throw new HttpError(404, 'Not found');
    const key = crypto.createHash('sha1').update(`${src}|${w}`).digest('hex').slice(0, 20);
    const out = path.join(DIR(), `${key}.jpg`);
    if (!fs.existsSync(out)) {
      await fs.promises.mkdir(DIR(), { recursive: true });
      if (!making.has(key)) making.set(key, make(src, w, out).finally(() => making.delete(key)));
      try { await making.get(key); } catch (e) {
        // Couldn't make a still: send the TV to the original rather than nothing.
        if (e.status === 404) throw e;
        console.warn('[fit]', src, e.message);
        res.writeHead(302, { Location: src, 'Cache-Control': 'no-store' }); res.end(); return undefined;
      }
    }
    await sendFile(req, res, out, { cache: 'public, max-age=604800', type: 'image/jpeg' });
    return undefined;
  }, open);
}
