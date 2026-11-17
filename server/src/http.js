// A small HTTP toolkit: router, JSON helpers and range-aware file serving.
import fs from 'node:fs';
import path from 'node:path';

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const MIME = {
  html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8', json: 'application/json; charset=utf-8', webmanifest: 'application/manifest+json',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml', ico: 'image/x-icon',
  woff2: 'font/woff2', vtt: 'text/vtt; charset=utf-8', m3u8: 'application/vnd.apple.mpegurl', ts: 'video/mp2t', m4s: 'video/iso.segment',
  mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska', avi: 'video/x-msvideo',
};
export const mime = (file) => MIME[path.extname(file).slice(1).toLowerCase()] || 'application/octet-stream';

export function json(res, status, obj, headers = {}) {
  const body = Buffer.from(JSON.stringify(obj));
  res.writeHead(status, { 'Content-Type': MIME.json, 'Content-Length': body.length, 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}

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
  const raw = await readBody(req);
  if (!raw.length) return {};
  try { return JSON.parse(raw.toString('utf8')); } catch { throw new HttpError(400, 'Invalid JSON'); }
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
