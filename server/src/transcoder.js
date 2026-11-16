// The transcoder service: runs one ffmpeg per playback session and serves its HLS output.
// It only ever repackages or converts; files that a device can play as-is never come through here.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { cfg } from './config.js';
import { run } from './probe.js';
import { json, readJson, sendFile, HttpError } from './http.js';

const SEG = 4; // seconds per segment
const AHEAD_STOP = 40, AHEAD_GO = 20; // pause ffmpeg when this many segments are ready beyond the viewer
const IDLE_MS = 120e3, MAX_SESSIONS = 8;
const sessions = new Map();
export const state = { hw: null, tonemap: false };

const BITRATE = (h) => (h > 1200 ? '18M' : h > 800 ? '8M' : h > 500 ? '4M' : '1800k');

/** ffmpeg arguments for one session. `job`: { input, start, video: 'copy'|'h264', audio: 'copy'|'aac'|'none', audioIndex, height, srcHeight, seg, hdr } */
export function buildArgs(job, dir, hw = null) {
  const a = ['-hide_banner', '-loglevel', 'error', '-nostdin'];
  const useHw = hw && job.video === 'h264' && !job.hdr;
  const ss = job.seek ?? job.start;
  if (ss > 0) a.push('-ss', ss.toFixed(3));
  if (useHw) a.push('-hwaccel', 'vaapi', '-hwaccel_device', hw.device, '-hwaccel_output_format', 'vaapi');
  a.push('-i', job.input, '-map', '0:v:0');
  if (job.audio !== 'none') a.push('-map', `0:a:${job.audioIndex || 0}`);
  a.push('-sn', '-dn', '-map_metadata', '-1', '-map_chapters', '-1');
  if (job.video === 'copy') {
    a.push('-c:v', 'copy');
    if (job.seg === 'fmp4') a.push('-tag:v', 'hvc1');
  } else {
    const h = Math.min(job.height || 1080, job.srcHeight || 1080);
    const rate = BITRATE(h);
    if (useHw) {
      a.push('-vf', `scale_vaapi=w=-2:h=${h}:format=nv12`, '-c:v', 'h264_vaapi', '-rc_mode', 'VBR', '-b:v', rate, '-maxrate', rate);
    } else {
      const chain = [];
      if (job.hdr && state.tonemap) chain.push('zscale=t=linear:npl=100', 'format=gbrpf32le', 'zscale=p=bt709', 'tonemap=hable:desat=0', 'zscale=t=bt709:m=bt709:r=tv');
      chain.push(`scale=-2:${h}`, 'format=yuv420p');
      a.push('-vf', chain.join(','), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-maxrate', rate, '-bufsize', rate.replace(/[\d.]+/, (n) => n * 2));
    }
    a.push('-g', '120', '-keyint_min', '24', '-sc_threshold', '0', '-force_key_frames', `expr:gte(t,n_forced*${SEG})`);
  }
  if (job.audio === 'copy') a.push('-c:a', 'copy');
  else if (job.audio === 'aac') a.push('-c:a', 'aac', '-ac', '2', '-b:a', '192k');
  a.push('-max_muxing_queue_size', '4096', '-f', 'hls', '-hls_time', String(SEG), '-hls_list_size', '0',
    '-hls_playlist_type', 'event', '-hls_flags', 'independent_segments+temp_file', '-start_number', '0');
  if (job.seg === 'fmp4') a.push('-hls_segment_type', 'fmp4', '-hls_fmp4_init_filename', 'init.mp4', '-hls_segment_filename', path.join(dir, 's%05d.m4s'));
  else a.push('-hls_segment_type', 'mpegts', '-hls_segment_filename', path.join(dir, 's%05d.ts'));
  a.push(path.join(dir, 'index.m3u8'));
  return a;
}

/** When copying video, playback can only begin on a keyframe: find the one at or before `t`. */
export async function keyframeBefore(input, t) {
  if (!(t > 0)) return 0;
  try {
    const out = await run(cfg.ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-read_intervals', `${t.toFixed(3)}%+#1`,
      '-show_entries', 'packet=pts_time,flags', '-of', 'csv=p=0', input], { timeout: 20e3 });
    const k = parseFloat(out.split('\n')[0]);
    return Number.isFinite(k) && k <= t + 0.5 ? Math.max(0, k) : t;
  } catch { return t; }
}

function launch(s, hw) {
  fs.rmSync(s.dir, { recursive: true, force: true });
  fs.mkdirSync(s.dir, { recursive: true });
  s.usedHw = !!(hw && s.job.video === 'h264' && !s.job.hdr);
  s.stderr = ''; s.done = false; s.failed = false; s.stopped = false;
  const proc = spawn(cfg.ffmpeg, buildArgs(s.job, s.dir, hw), { stdio: ['ignore', 'ignore', 'pipe'] });
  s.proc = proc;
  proc.stderr.on('data', (d) => { s.stderr = (s.stderr + d).slice(-4000); });
  proc.on('exit', (code) => {
    if (s.proc !== proc) return;
    s.done = true;
    if (code && !s.killed) {
      if (s.usedHw && !s.retried && !fs.existsSync(path.join(s.dir, 'index.m3u8'))) {
        console.warn(`[transcoder] hardware path failed for ${s.id}, retrying in software:\n${s.stderr.trim()}`);
        s.retried = true; launch(s, null); return;
      }
      s.failed = true;
      console.error(`[transcoder] ffmpeg exit ${code} for ${s.id}: ${s.stderr.trim()}`);
    }
  });
}

async function create(job) {
  if (!job.input || !fs.existsSync(job.input)) throw new HttpError(404, 'Media file not found');
  if (sessions.size >= MAX_SESSIONS) {
    const oldest = [...sessions.values()].sort((x, y) => x.last - y.last)[0];
    destroy(oldest);
  }
  job.start = Math.max(0, +job.start || 0);
  if (job.video === 'copy' && job.start > 0) {
    // Copied video can only begin on a keyframe. Find it, then aim ffmpeg a little way inside that
    // keyframe's group so its own seek rounding cannot slip to the group before.
    job.start = await keyframeBefore(job.input, job.start);
    if (job.start > 0) job.seek = job.start + 0.25;
  }
  const id = crypto.randomBytes(12).toString('hex');
  const s = { id, job, dir: path.join(cfg.transcodeDir, id), last: Date.now(), maxReq: 0 };
  sessions.set(id, s);
  launch(s, state.hw);
  return { id, start: job.start, hw: s.usedHw };
}

function destroy(s) {
  if (!s) return;
  s.killed = true;
  sessions.delete(s.id);
  try { s.proc.kill('SIGCONT'); s.proc.kill('SIGKILL'); } catch { /* gone */ }
  fs.rm(s.dir, { recursive: true, force: true }, () => {});
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(s, test, ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (test()) return true;
    if (s.failed || s.killed) return false;
    if (s.done && !test()) return test();
    await sleep(80);
  }
  return test();
}

function housekeeping() {
  const now = Date.now();
  for (const s of sessions.values()) {
    if (now - s.last > IDLE_MS) { destroy(s); continue; }
    if (s.done) continue;
    let produced = 0;
    try { produced = fs.readdirSync(s.dir).filter((f) => /^s\d+\.(ts|m4s)$/.test(f)).length; } catch { /* not yet */ }
    const ahead = produced - 1 - s.maxReq;
    try {
      if (!s.stopped && ahead > AHEAD_STOP) { s.proc.kill('SIGSTOP'); s.stopped = true; }
      else if (s.stopped && ahead < AHEAD_GO) { s.proc.kill('SIGCONT'); s.stopped = false; }
    } catch { /* exited */ }
  }
}

async function detect() {
  try { state.tonemap = (await run(cfg.ffmpeg, ['-hide_banner', '-filters'])).includes(' zscale '); } catch { /* no ffmpeg? */ }
  if (cfg.hw === 'off') return;
  for (const device of ['/dev/dri/renderD128', '/dev/dri/renderD129']) {
    if (!fs.existsSync(device)) continue;
    try {
      await run(cfg.ffmpeg, ['-v', 'error', '-vaapi_device', device, '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=24', '-t', '0.5',
        '-vf', 'format=nv12,hwupload', '-c:v', 'h264_vaapi', '-f', 'null', '-'], { timeout: 20e3 });
      state.hw = { type: 'vaapi', device };
      console.log(`[transcoder] hardware video conversion ready on ${device}`);
      return;
    } catch (e) { console.warn(`[transcoder] ${device} present but not usable: ${String(e.stderr || e.message).trim().split('\n').pop()}`); }
  }
  console.log('[transcoder] no usable graphics device; converting in software');
}

export async function startTranscoder(port = cfg.transcoderPort) {
  // Empty the folder rather than removing it: in Docker it is a mounted volume and cannot be deleted.
  fs.mkdirSync(cfg.transcodeDir, { recursive: true });
  for (const name of fs.readdirSync(cfg.transcodeDir)) fs.rmSync(path.join(cfg.transcodeDir, name), { recursive: true, force: true });
  await detect();
  const timer = setInterval(housekeeping, 1000);
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x');
      const parts = url.pathname.split('/').filter(Boolean);
      if (req.method === 'GET' && url.pathname === '/status') {
        return json(res, 200, { ok: true, hw: state.hw?.type || 'software', tonemap: state.tonemap, sessions: sessions.size });
      }
      if (req.method === 'POST' && url.pathname === '/sessions') return json(res, 200, await create(await readJson(req)));
      const s = sessions.get(parts[1]);
      if (parts[0] === 'sessions' && req.method === 'DELETE') { destroy(s); return json(res, 200, { ok: true }); }
      if (parts[0] === 'sessions' && parts[2] === 'ping') { if (s) s.last = Date.now(); return json(res, s ? 200 : 404, { ok: !!s }); }
      if (parts[0] === 's' && s && parts[2] && /^[\w.]+$/.test(parts[2])) {
        s.last = Date.now();
        const file = path.join(s.dir, parts[2]);
        if (parts[2] === 'index.m3u8') {
          const ready = await waitFor(s, () => { try { return fs.readFileSync(file, 'utf8').includes('#EXTINF'); } catch { return false; } }, 30e3);
          if (!ready) throw new HttpError(500, `Could not start playback: ${s.stderr.trim().split('\n').pop() || 'timed out'}`);
          return sendFile(req, res, file, { cache: 'no-store' });
        }
        const m = /^s(\d+)\./.exec(parts[2]);
        if (m) s.maxReq = Math.max(s.maxReq, +m[1]);
        await waitFor(s, () => fs.existsSync(file), 15e3);
        return sendFile(req, res, file, { cache: 'no-store' });
      }
      throw new HttpError(404, 'Not found');
    } catch (e) {
      if (!res.headersSent) json(res, e.status || 500, { error: e.message });
      else res.destroy();
    }
  });
  await new Promise((resolve) => server.listen(port, resolve));
  console.log(`[transcoder] listening on ${port}`);
  return { server, close: () => { clearInterval(timer); for (const s of [...sessions.values()]) destroy(s); return new Promise((r) => server.close(r)); } };
}
