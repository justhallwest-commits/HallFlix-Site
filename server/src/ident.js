// A TV-safe copy of the welcome ident (Studio → Look and feel → Sign-in page → After signing in).
// Fire TV sticks play only some videos: WebM, HEVC, 10-bit or 4K files often fail, and the ident then ends before it
// starts. So each uploaded ident also gets a 1080p H.264 + AAC copy beside it ("<name>.tv.mp4"), made once in the
// background; the TV and the Android app play that copy, and the original if the copy can't be made.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { cfg } from './config.js';

const making = new Map(); // upload file → promise, so a copy is only made once at a time

const uploadsDir = () => path.join(cfg.dataDir, 'uploads');

/** "/uploads/ab12.webm" → its file on disk, or null for anything that isn't a video upload. */
function uploadFile(url) {
  const m = /^\/uploads\/([\w-]+\.(mp4|webm|mov|m4v))$/i.exec(String(url || ''));
  if (!m || m[1].includes('.tv.')) return null;
  return path.join(uploadsDir(), m[1]);
}

const tvName = (file) => file.replace(/\.[^.]+$/, '.tv.mp4');

/** The ffmpeg arguments for the copy: at most 1920×1080, H.264 High 4.1, 8-bit 4:2:0, AAC stereo, fast start. */
export function tvArgs(src, out) {
  return ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-i', src,
    '-map', '0:v:0', '-map', '0:a:0?', '-sn', '-dn',
    '-vf', "scale='min(1920,iw)':'min(1080,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,format=yuv420p",
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-profile:v', 'high', '-level:v', '4.1', '-r', '30',
    '-c:a', 'aac', '-b:a', '160k', '-ac', '2', '-movflags', '+faststart', '-f', 'mp4', out];
}

/** Start making the copy if it isn't there yet. Resolves to the copy's URL, or '' if it couldn't be made. */
export function makeTvCopy(url) {
  const file = uploadFile(url);
  if (!file) return Promise.resolve('');
  const out = tvName(file), tvUrl = `/uploads/${path.basename(out)}`;
  if (fs.existsSync(out)) return Promise.resolve(tvUrl);
  if (!fs.existsSync(file)) return Promise.resolve('');
  if (making.has(file)) return making.get(file);
  const tmp = `${out}.part`;
  const job = new Promise((resolve) => {
    const ff = spawn('nice', ['-n', '15', cfg.ffmpeg, ...tvArgs(file, tmp)], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    ff.stderr.on('data', (d) => { err = (err + d).slice(-2000); });
    ff.on('error', () => resolve(''));
    ff.on('close', (code) => {
      if (code === 0) { try { fs.renameSync(tmp, out); resolve(tvUrl); return; } catch { /* fall through */ } }
      fs.rm(tmp, { force: true }, () => {});
      if (err) console.warn(`ident: no TV copy of ${url}: ${err.trim().split('\n').at(-1)}`);
      resolve('');
    });
  }).finally(() => making.delete(file));
  making.set(file, job);
  return job;
}

const VIDEO = /\.(mp4|webm|mov|m4v)$/i;
const LIB_VIDEO_KEYS = ['tileVideo', 'tileBackground', 'background'];

/**
 * Every uploaded video a TV may play in a look: welcome idents (main, per-device, seasonal), and library tile and page
 * videos (the TV app plays the focused library tile's video).
 */
export function identsIn(look) {
  const found = new Set();
  const walk = (o) => {
    if (!o || typeof o !== 'object') return;
    if (o.splash && typeof o.splash.video === 'string' && o.splash.video) found.add(o.splash.video);
    for (const k of LIB_VIDEO_KEYS) if (typeof o[k] === 'string' && VIDEO.test(o[k])) found.add(o[k]);
    for (const v of Object.values(o)) walk(v);
  };
  walk(look);
  return [...found];
}

/**
 * { original URL → TV copy URL } for the idents whose copy is ready. Copies that are missing are started in the
 * background, so they are ready by the next sign-in.
 */
export function tvCopies(look) {
  const map = {};
  for (const url of identsIn(look)) {
    const file = uploadFile(url);
    if (!file) continue;
    if (fs.existsSync(tvName(file))) map[url] = `/uploads/${path.basename(tvName(file))}`;
    else makeTvCopy(url);
  }
  return map;
}
