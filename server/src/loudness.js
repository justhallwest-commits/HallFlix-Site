// Loudness: how loud each pre-roll, ident and feature really is, so pre-rolls can play at the same level as the movie
// that follows. Measured once per file with ffmpeg's EBU R128 meter (the broadcast standard, in LUFS) and kept with the
// file's modified time, so a replaced file is measured again. Clips and idents are measured whole; a feature is sampled
// at a few moments through it, which is close enough and takes seconds rather than minutes.
// Measuring runs in the background, one file at a time at low priority; playback never waits for it.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { cfg } from './config.js';
import { q, q1 } from './db.js';

/** Used for a feature that hasn't been measured yet: about where films and TV sit (the US broadcast level is −24). */
export const TYPICAL = -24;
const SAMPLES = 6, SAMPLE_S = 60;
const queue = new Map(); // path → { runtime, sample }
const failed = new Map(); // path → when it last failed (tried again after a day)
let busy = false;

const mtimeOf = (file) => { try { return Math.floor(fs.statSync(file).mtimeMs); } catch { return null; } };

/** The stored loudness of a file, or null when it hasn't been measured (or has changed since). */
export async function known(file) {
  if (!file) return null;
  const m = mtimeOf(file);
  if (m == null) return null;
  const row = await q1('select lufs, mtime from loudness where path = $1', [file]);
  return row && +row.mtime === m ? row.lufs : null;
}

/** Ask for a file to be measured soon. `sample` measures a few minutes spread through a long file instead of all of it. */
export function want(file, { runtime = 0, sample = false } = {}) {
  if (!file || queue.has(file) || Date.now() - (failed.get(file) || 0) < 86400e3) return;
  queue.set(file, { runtime, sample });
  setImmediate(work);
}

/** The adjustment for a clip at `clip` LUFS before a feature at `feature` LUFS, as a volume from 0.05 to 1.
 *  Players can only turn a sound down, so a clip quieter than the feature plays at full volume. */
export function gainFor(clip, feature, offsetDb = 0) {
  if (clip == null || feature == null) return null;
  const db = feature + (+offsetDb || 0) - clip;
  return Math.round(Math.max(0.05, Math.min(1, 10 ** (db / 20))) * 100) / 100;
}

/** Combine several measurements by their power, as the meter itself would. */
export function combine(list) {
  const ok = list.filter((x) => Number.isFinite(x) && x > -60);
  if (!ok.length) return null;
  return Math.round(10 * Math.log10(ok.reduce((a, x) => a + 10 ** (x / 10), 0) / ok.length) * 10) / 10;
}

/** Run the meter over part (or all) of a file and read its integrated loudness. */
export function meter(file, start = 0, length = 0) {
  return new Promise((resolve) => {
    const a = ['-n', '15', cfg.ffmpeg, '-nostdin', '-hide_banner', '-nostats'];
    if (start > 0) a.push('-ss', String(Math.floor(start)));
    if (length > 0) a.push('-t', String(length));
    a.push('-i', file, '-map', '0:a:0', '-vn', '-sn', '-dn', '-af', 'ebur128=framelog=quiet', '-f', 'null', '-');
    const p = spawn('nice', a, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => { err = (err + d).slice(-4000); });
    const kill = setTimeout(() => p.kill('SIGKILL'), 10 * 60e3);
    p.on('error', () => { clearTimeout(kill); resolve(null); });
    p.on('close', () => {
      clearTimeout(kill);
      const m = /Integrated loudness:\s*\n\s*I:\s*(-?[\d.]+|-inf)\s*LUFS/.exec(err);
      resolve(m && m[1] !== '-inf' ? +m[1] : null);
    });
  });
}

async function measure(file, { runtime, sample }) {
  if (sample && runtime > SAMPLES * SAMPLE_S * 2) {
    const out = [];
    for (let i = 0; i < SAMPLES; i++) out.push(await meter(file, runtime * (0.12 + (0.76 * i) / (SAMPLES - 1)), SAMPLE_S));
    return combine(out);
  }
  return meter(file);
}

async function work() {
  if (busy) return;
  busy = true;
  try {
    while (queue.size) {
      const [file, opt] = queue.entries().next().value;
      queue.delete(file);
      const m = mtimeOf(file);
      if (m == null || (await known(file)) != null) continue;
      const lufs = await measure(file, opt);
      if (lufs == null) { failed.set(file, Date.now()); continue; }
      await q(`insert into loudness (path, mtime, lufs) values ($1, $2, $3)
        on conflict (path) do update set mtime = excluded.mtime, lufs = excluded.lufs, measured_at = now()`, [file, m, lufs]);
    }
  } catch (e) { console.warn(`[loudness] ${e.message}`); } finally { busy = false; }
}

/** How many files are still waiting to be measured (for the Studio). */
export const waiting = () => queue.size + (busy ? 1 : 0);

/** The level of the title about to play: measured, or the average of other measured episodes of its show, or typical. */
export async function featureLevel(item) {
  const own = await known(item.path);
  if (own != null) return { lufs: own, measured: true };
  want(item.path, { runtime: +item.runtime_s || 0, sample: true });
  if (item.show_id) {
    const r = await q(`select l.lufs from loudness l join items i on i.path = l.path where i.show_id = $1 limit 12`, [item.show_id]);
    const avg = combine(r.map((x) => x.lufs));
    if (avg != null) return { lufs: avg, measured: true };
  }
  return { lufs: TYPICAL, measured: false };
}
