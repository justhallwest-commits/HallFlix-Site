import { execFile } from 'node:child_process';
import path from 'node:path';
import { cfg } from './config.js';

export function run(cmd, args, { timeout = 60e3, maxBuffer = 32e6 } = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout, maxBuffer }, (err, stdout, stderr) => {
      if (err) { err.stderr = stderr; reject(err); } else resolve(stdout);
    });
  });
}

function containerKey(formatName, file) {
  const f = String(formatName || '');
  const e = path.extname(file).slice(1).toLowerCase();
  if (f.includes('mp4')) return e === 'mov' ? 'mov' : 'mp4';
  if (f.includes('matroska')) return e === 'webm' ? 'webm' : 'mkv';
  if (f.includes('mpegts')) return 'ts';
  return f.split(',')[0] || e;
}

/** Read a media file's container and streams into the compact shape stored on each item. */
export async function probe(file) {
  const out = await run(cfg.ffprobe, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file]);
  const j = JSON.parse(out);
  const streams = [];
  for (const s of j.streams || []) {
    const tags = s.tags || {};
    const base = {
      index: s.index, codec: s.codec_name, lang: tags.language || null, title: tags.title || null,
      default: !!s.disposition?.default, forced: !!s.disposition?.forced,
    };
    if (s.codec_type === 'video') {
      if (s.disposition?.attached_pic) continue;
      const pm = /(10|12)(le|be)?$/.exec(s.pix_fmt || '');
      const depth = +s.bits_per_raw_sample || (pm ? +pm[1] : 8);
      streams.push({ ...base, type: 'video', profile: s.profile || null, pixFmt: s.pix_fmt || null, bitDepth: depth,
        width: s.width, height: s.height, hdr: /smpte2084|arib-std-b67/.test(s.color_transfer || '') });
    } else if (s.codec_type === 'audio') {
      streams.push({ ...base, type: 'audio', channels: s.channels || 2 });
    } else if (s.codec_type === 'subtitle') {
      streams.push({ ...base, type: 'sub', text: ['subrip', 'ass', 'ssa', 'mov_text', 'webvtt', 'text'].includes(s.codec_name) });
    }
  }
  return {
    container: containerKey(j.format?.format_name, file),
    duration: +j.format?.duration || 0,
    bitrate: +j.format?.bit_rate || 0,
    streams,
  };
}
