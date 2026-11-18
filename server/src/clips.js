// Spotlight clips: short pieces cut from the film (or a show's episode) itself, from a random moment in its opening
// minutes, so the banner never depends on YouTube. Each title keeps a few clips from different moments; one is chosen
// at random each time. Clips are made in the background, one at a time and at low priority, and kept in data/clips.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { cfg } from './config.js';
import { q, q1 } from './db.js';
import { HttpError, sendFile } from './http.js';
import { state as tx } from './transcoder.js';
import { currentLook } from './look.js';

const DIR = () => path.join(cfg.dataDir, 'clips');
const VARIANTS = 4; // clips kept per title, each from a different moment
const MAX_FILES = 400; // oldest clips go first beyond this
const queue = [];
const failed = new Map(); // id → when a clip last failed; such a title waits six hours before another try
let busy = false;

/** The clip settings from the look: where the window starts and ends (seconds), and how long each clip runs. */
async function settings() {
  const c = (await currentLook()).theme?.heroClips || {};
  const start = Math.max(0, Math.min(1800, +c.start || 60));
  const end = Math.max(start + 30, Math.min(3600, +c.end || 600));
  const length = Math.max(10, Math.min(60, +c.length || 30));
  return { start, end, length };
}

const ready = (id) => {
  try { return fs.readdirSync(DIR()).filter((f) => new RegExp(`^${+id}-\\d+\\.mp4$`).test(f)); } catch { return []; } // finished clips only
};

/** The file a clip of this title comes from: the movie, or for a show its first episode (or a random one). */
async function source(id) {
  const it = await q1(`select id, kind, path, runtime_s, streams from items where id = $1`, [id]);
  if (!it) return null;
  if (it.kind === 'movie' || it.kind === 'episode') return it.path ? it : null;
  if (it.kind === 'show') {
    return q1(`select id, path, runtime_s, streams from items where show_id = $1 and kind = 'episode' and path is not null
      order by (season_no = 1 and episode_no = 1) desc, random() limit 1`, [id]);
  }
  return null;
}

/** The file's real length in seconds (the listed runtime can be wrong). */
function fileLength(file) {
  return new Promise((resolve) => {
    const p = spawn(cfg.ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file], { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.on('error', () => resolve(0));
    p.on('close', () => resolve(+out.trim() || 0));
  });
}

function make(job) {
  return new Promise((resolve) => {
    const { out, file, at, length, hdr } = job;
    const useHw = tx.hw && !hdr;
    const a = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-ss', at.toFixed(1)];
    if (useHw) a.push('-hwaccel', 'vaapi', '-hwaccel_device', tx.hw.device, '-hwaccel_output_format', 'vaapi');
    a.push('-t', String(length), '-i', file, '-map', '0:v:0', '-map', '0:a:0?', '-sn', '-dn', '-map_metadata', '-1', '-map_chapters', '-1');
    if (useHw) a.push('-vf', 'scale_vaapi=w=-2:h=720:format=nv12', '-c:v', 'h264_vaapi', '-b:v', '3M', '-maxrate', '3M');
    else {
      const chain = [];
      if (hdr && tx.tonemap) chain.push('zscale=t=linear:npl=100', 'format=gbrpf32le', 'zscale=p=bt709', 'tonemap=hable:desat=0', 'zscale=t=bt709:m=bt709:r=tv');
      chain.push('scale=-2:720', 'format=yuv420p');
      a.push('-vf', chain.join(','), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24', '-threads', '2');
    }
    a.push('-c:a', 'aac', '-b:a', '128k', '-ac', '2', '-movflags', '+faststart', `${out}.part.mp4`);
    // Low priority, so a clip never slows down someone who is watching.
    const ff = spawn('nice', ['-n', '15', cfg.ffmpeg, ...a], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    ff.stderr.on('data', (d) => { err = (err + d).slice(-500); });
    ff.on('error', () => resolve(false));
    ff.on('close', (code) => {
      // A clip with (almost) nothing in it is thrown away rather than shown.
      if (code === 0) { try { if (fs.statSync(`${out}.part.mp4`).size > 20000) { fs.renameSync(`${out}.part.mp4`, out); resolve(true); return; } } catch { /* fall through */ } }
      fs.rm(`${out}.part.mp4`, { force: true }, () => {});
      if (err) console.warn(`[clips] ${path.basename(file)}: ${err.trim().split('\n').pop()}`);
      resolve(false);
    });
  });
}

function prune() {
  try {
    const files = fs.readdirSync(DIR()).filter((f) => /^\d+-\d+\.mp4$/.test(f)).map((f) => ({ f, t: fs.statSync(path.join(DIR(), f)).mtimeMs }));
    if (files.length <= MAX_FILES) return;
    files.sort((x, y) => x.t - y.t).slice(0, files.length - MAX_FILES).forEach(({ f }) => fs.rmSync(path.join(DIR(), f), { force: true }));
  } catch { /* nothing to prune */ }
}

async function work() {
  if (busy) return;
  busy = true;
  try {
    while (queue.length) {
      const id = queue.shift();
      const have = ready(id);
      if (have.length >= VARIANTS) continue;
      const src = await source(id);
      if (!src?.path || !fs.existsSync(src.path)) continue;
      const s = await settings();
      const dur = (await fileLength(src.path)) || +src.runtime_s || 0;
      // A random moment in the window (after the first minute, within the first ten by default) so the clip ends inside
      // the window and well before the end of the file; a short file just starts nearer the beginning.
      let lo = s.start, hi = s.end - s.length;
      if (dur) hi = Math.min(hi, dur - s.length - 5);
      if (hi < lo) { lo = Math.max(0, Math.min(lo, hi)); hi = Math.max(lo, hi); }
      const at = Math.max(0, lo + Math.random() * (hi - lo));
      const n = [...Array(VARIANTS).keys()].find((k) => !have.includes(`${id}-${k}.mp4`));
      await fs.promises.mkdir(DIR(), { recursive: true });
      const hdr = (src.streams || []).some?.((x) => x?.type === 'video' && x.hdr) || false;
      if (!(await make({ out: path.join(DIR(), `${id}-${n}.mp4`), file: src.path, at, length: s.length, hdr }))) failed.set(id, Date.now());
      prune();
    }
  } finally { busy = false; }
}

/** Ask for clips of these titles to be made (in the background). */
export function warmClips(ids) {
  for (const id of ids) {
    if (!id || queue.includes(+id) || ready(+id).length >= VARIANTS || queue.length >= 40) continue;
    if (Date.now() - (failed.get(+id) || 0) < 6 * 3600e3) continue;
    queue.push(+id);
  }
  work();
}

/** Forget every clip (the clip settings changed). */
export function clearClips() {
  queue.length = 0; failed.clear();
  fs.rm(DIR(), { recursive: true, force: true }, () => {});
}

/** Forget a title's clips (its file changed). */
export function dropClips(id) {
  for (const f of ready(id)) fs.rmSync(path.join(DIR(), f), { force: true });
}

export function routes(r) {
  // A clip for the spotlight: one of the title's clips at random, or "not yet" while the first is being made.
  r.get('/api/clips/:id', async ({ params }) => {
    const id = +params.id;
    if (!id) throw new HttpError(400, 'Which title?');
    const have = ready(id);
    if (have.length < VARIANTS) warmClips([id]); // more variety for next time
    if (!have.length) return { url: null, pending: true };
    const f = have[Math.floor(Math.random() * have.length)];
    return { url: `/api/clips/${id}/file/${f.replace(/^\d+-|\.mp4$/g, '')}` };
  });
  r.get('/api/clips/:id/file/:n', async ({ req, res, params }) => {
    const file = path.join(DIR(), `${+params.id}-${+params.n}.mp4`);
    if (!fs.existsSync(file)) throw new HttpError(404, 'That clip is gone');
    await sendFile(req, res, file, { cache: 'private, max-age=86400', type: 'video/mp4' });
    return undefined;
  });
}
