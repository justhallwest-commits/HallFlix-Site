// A small HTTP toolkit: router, JSON helpers and range-aware file serving.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const MIME = {
  html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8', json: 'application/json; charset=utf-8', webmanifest: 'application/manifest+json',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml', ico: 'image/x-icon',
  woff2: 'font/woff2', vtt: 'text/vtt; charset=utf-8', m3u8: 'application/vnd.apple.mpegurl', ts: 'video/mp2t', m4s: 'video/iso.segment',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', wav: 'audio/wav', flac: 'audio/flac',
  mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska', avi: 'video/x-msvideo',
};
export const mime = (file) => MIME[path.extname(file).slice(1).toLowerCase()] || 'application/octet-stream';

const gzipOk = (req) => /\bgzip\b/.test(req?.headers?.['accept-encoding'] || '');
export function json(res, status, obj, headers = {}) {
  let body = Buffer.from(JSON.stringify(obj));
  const extra = {};
  // Bigger answers (Home, a library page) are about a sixth of their size gzipped: quicker over Wi-Fi and the internet.
  if (body.length > 1400 && gzipOk(res.req)) { body = zlib.gzipSync(body, { level: 5 }); extra['Content-Encoding'] = 'gzip'; extra.Vary = 'Accept-Encoding'; }
  res.writeHead(status, { 'Content-Type': MIME.json, 'Content-Length': body.length, 'Cache-Control': 'no-store', ...extra, ...headers });
  res.end(body);
}

// Text files (scripts, styles, pages) are sent gzipped from memory; the packed copy is kept until the file changes.
const PACK = /^(text\/|application\/(json|manifest\+json|javascript)|image\/svg)/;
const packed = new Map(); // file → { key, buf }
function packedCopy(file, st) {
  const key = `${st.size}:${st.mtimeMs}`;
  const hit = packed.get(file);
  if (hit?.key === key) return hit.buf;
  const buf = zlib.gzipSync(fs.readFileSync(file), { level: 7 });
  packed.set(file, { key, buf });
  if (packed.size > 400) packed.delete(packed.keys().next().value);
  return buf;
}
/** Send text the server built itself (a page with its script versions filled in), gzipped when the browser accepts it. */
export function sendText(req, res, text, { type = MIME.html, cache = 'no-cache' } = {}) {
  let body = Buffer.from(text);
  const etag = `"${crypto_hash(body)}"`;
  const headers = { 'Content-Type': type, 'Cache-Control': cache, ETag: etag, Vary: 'Accept-Encoding' };
  if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers); return res.end(); }
  if (gzipOk(req)) { body = zlib.gzipSync(body, { level: 7 }); headers['Content-Encoding'] = 'gzip'; }
  headers['Content-Length'] = body.length;
  res.writeHead(200, headers);
  res.end(req.method === 'HEAD' ? undefined : body);
}
const crypto_hash = (buf) => { let h = 2166136261; for (let i = 0; i < buf.length; i++) { h ^= buf[i]; h = Math.imul(h, 16777619); } return (h >>> 0).toString(36) + buf.length.toString(36); };

export function readBody(req, limit = 2e6) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413, 'Too large')); req.destroy(); } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export async function readJson(req) {
  if (req.hfJson !== undefined) return req.hfJson; // read once, so the server can look at a body before the route does
  const raw = await readBody(req);
  if (!raw.length) return (req.hfJson = {});
  try { return (req.hfJson = JSON.parse(raw.toString('utf8'))); } catch { throw new HttpError(400, 'Invalid JSON'); }
}

/** Serve a file with ETag and byte-range support (what video players need to seek). */
export async function sendFile(req, res, file, { cache = 'no-cache', type } = {}) {
  let st;
  try { st = await fs.promises.stat(file); } catch { throw new HttpError(404, 'Not found'); }
  if (!st.isFile()) throw new HttpError(404, 'Not found');
  const etag = `"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
  const headers = {
    'Content-Type': type || mime(file), 'Accept-Ranges': 'bytes', ETag: etag,
    'Cache-Control': cache, 'Last-Modified': st.mtime.toUTCString(),
  };
  const range = req.headers.range;
  if (!range && req.headers['if-none-match'] === etag) { res.writeHead(304, headers); return res.end(); }
  if (!range && PACK.test(headers['Content-Type']) && st.size > 1000 && st.size < 4e6) {
    headers.Vary = 'Accept-Encoding';
    if (gzipOk(req)) {
      const buf = packedCopy(file, st);
      headers['Content-Encoding'] = 'gzip'; headers['Content-Length'] = buf.length;
      res.writeHead(200, headers);
      return res.end(req.method === 'HEAD' ? undefined : buf);
    }
  }
  let start = 0, end = st.size - 1, status = 200;
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (m && (m[1] || m[2])) {
      if (m[1]) { start = +m[1]; if (m[2]) end = Math.min(+m[2], end); }
      else { start = Math.max(0, st.size - +m[2]); }
      if (start > end || start >= st.size) {
        res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); return res.end();
      }
      status = 206; headers['Content-Range'] = `bytes ${start}-${end}/${st.size}`;
    }
  }
  headers['Content-Length'] = end - start + 1;
  res.writeHead(status, headers);
  if (req.method === 'HEAD' || st.size === 0) return res.end();
  const stream = fs.createReadStream(file, { start, end, highWaterMark: 1 << 20 });
  stream.on('error', () => res.destroy());
  res.on('close', () => stream.destroy());
  stream.pipe(res);
}

export class Router {
  routes = [];
  add(method, pattern, fn, opts = {}) {
    const keys = [];
    // One pass, so keys stay in the same order as the groups (":id/…/:rest*").
    const rx = new RegExp('^' + pattern.replace(/:(\w+)(\*)?/g, (_, k, star) => { keys.push(k); return star ? '(.+)' : '([^/]+)'; }) + '$');
    this.routes.push({ method, rx, keys, fn, opts });
    return this;
  }
  get(p, fn, o) { return this.add('GET', p, fn, o); }
  post(p, fn, o) { return this.add('POST', p, fn, o); }
  put(p, fn, o) { return this.add('PUT', p, fn, o); }
  delete(p, fn, o) { return this.add('DELETE', p, fn, o); }
  match(method, pathname) {
    if (method === 'HEAD') method = 'GET';
    for (const r of this.routes) {
      if (r.method !== method) continue;
      const m = r.rx.exec(pathname);
      if (!m) continue;
      const params = {};
      r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      return { fn: r.fn, opts: r.opts, params };
    }
    return null;
  }
}

/** Resolve `rel` inside `root`, refusing anything that escapes it. */
export function safeJoin(root, rel) {
  const full = path.resolve(root, '.' + path.sep + rel);
  const base = path.resolve(root);
  if (full !== base && !full.startsWith(base + path.sep)) throw new HttpError(400, 'Bad path');
  return full;
}
