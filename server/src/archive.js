// Reading files out of archives without unpacking them where possible.
// - ZIP (EPUB, CBZ, and the many "CBR" files that are really zips) is read here directly, one entry at a time.
// - RAR, 7z and tar (CBR, CB7, CBT) are unpacked once into a page cache, in the background and in order, so page 1
//   shows as soon as it is out and every later page turn is a plain file read. Solid RAR archives can't be read
//   one page at a time quickly, so this is what makes them feel as fast as a CBZ. bsdtar does the work, with
//   unrar or 7-Zip as a fallback for archives it can't open.
// The type of an archive comes from its first bytes, not its name.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const MAX_ENTRY = 200e6;
const listings = new Map(); // "path|mtime|size" -> { type, entries }, most recent last

function remember(key, value) {
  listings.delete(key);
  listings.set(key, value);
  if (listings.size > 64) listings.delete(listings.keys().next().value);
  return value;
}

async function stamp(file) {
  const st = await fs.promises.stat(file);
  return `${file}|${Math.floor(st.mtimeMs)}|${st.size}`;
}

/** zip, rar, 7z, tar, pdf or null, from the file's first bytes. */
export async function sniff(file) {
  const fh = await fs.promises.open(file, 'r');
  try {
    const b = Buffer.alloc(264);
    const { bytesRead } = await fh.read(b, 0, 264, 0);
    if (bytesRead >= 4 && b[0] === 0x50 && b[1] === 0x4b && [3, 5, 7].includes(b[2])) return 'zip';
    if (bytesRead >= 6 && b.toString('latin1', 0, 6) === 'Rar!\x1a\x07') return 'rar';
    if (bytesRead >= 6 && b.toString('latin1', 0, 6) === '7z\xbc\xaf\x27\x1c') return '7z';
    if (bytesRead >= 4 && b.toString('latin1', 0, 4) === '%PDF') return 'pdf';
    if (bytesRead >= 262 && b.toString('latin1', 257, 262) === 'ustar') return 'tar';
    return null;
  } finally { await fh.close(); }
}

/** Central directory of a zip: name, method, sizes and where each entry's data starts. */
async function zipEntries(file) {
  const fh = await fs.promises.open(file, 'r');
  try {
    const { size } = await fh.stat();
    const tailLen = Math.min(size, 66000 + 22);
    const tail = Buffer.alloc(tailLen);
    await fh.read(tail, 0, tailLen, size - tailLen);
    let eocd = -1;
    for (let i = tailLen - 22; i >= 0; i--) if (tail.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('Not a zip file');
    let count = tail.readUInt16LE(eocd + 10), cdSize = tail.readUInt32LE(eocd + 12), cdAt = tail.readUInt32LE(eocd + 16);
    // Zip64: the real numbers live in a second record just before.
    if (cdAt === 0xffffffff || count === 0xffff) {
      const loc = eocd - 20;
      if (loc >= 0 && tail.readUInt32LE(loc) === 0x07064b50) {
        const at = Number(tail.readBigUInt64LE(loc + 8));
        const rec = Buffer.alloc(56);
        await fh.read(rec, 0, 56, at);
        count = Number(rec.readBigUInt64LE(32)); cdSize = Number(rec.readBigUInt64LE(40)); cdAt = Number(rec.readBigUInt64LE(48));
      }
    }
    const cd = Buffer.alloc(cdSize);
    await fh.read(cd, 0, cdSize, cdAt);
    const out = [];
    let p = 0;
    for (let n = 0; n < count && p + 46 <= cd.length; n++) {
      if (cd.readUInt32LE(p) !== 0x02014b50) break;
      const flags = cd.readUInt16LE(p + 8), method = cd.readUInt16LE(p + 10);
      let csize = cd.readUInt32LE(p + 20), usize = cd.readUInt32LE(p + 24);
      const nlen = cd.readUInt16LE(p + 28), xlen = cd.readUInt16LE(p + 30), clen = cd.readUInt16LE(p + 32);
      let local = cd.readUInt32LE(p + 42);
      const name = cd.toString(flags & 0x800 ? 'utf8' : 'latin1', p + 46, p + 46 + nlen);
      // Zip64 extra field carries sizes and offsets too big for 32 bits.
      let x = p + 46 + nlen;
      const xend = x + xlen;
      while (x + 4 <= xend) {
        const id = cd.readUInt16LE(x), len = cd.readUInt16LE(x + 2);
        if (id === 1) {
          let q = x + 4;
          if (usize === 0xffffffff) { usize = Number(cd.readBigUInt64LE(q)); q += 8; }
          if (csize === 0xffffffff) { csize = Number(cd.readBigUInt64LE(q)); q += 8; }
          if (local === 0xffffffff) { local = Number(cd.readBigUInt64LE(q)); }
        }
        x += 4 + len;
      }
      p = xend + clen;
      if (!name.endsWith('/')) out.push({ name, method, csize, usize, local, encrypted: !!(flags & 1) });
    }
    return out;
  } finally { await fh.close(); }
}

async function zipRead(file, entry) {
  if (entry.encrypted) throw new Error('This archive is password protected');
  if (entry.usize > MAX_ENTRY) throw new Error('That page is too large');
  const fh = await fs.promises.open(file, 'r');
  try {
    const head = Buffer.alloc(30);
    await fh.read(head, 0, 30, entry.local);
    if (head.readUInt32LE(0) !== 0x04034b50) throw new Error('Corrupt archive');
    const at = entry.local + 30 + head.readUInt16LE(26) + head.readUInt16LE(28);
    const raw = Buffer.alloc(entry.csize);
    await fh.read(raw, 0, entry.csize, at);
    if (entry.method === 0) return raw;
    if (entry.method === 8) return zlib.inflateRawSync(raw, { maxOutputLength: MAX_ENTRY });
    throw new Error('Unsupported compression in this archive');
  } finally { await fh.close(); }
}

// ---------- outside tools ----------
const has = new Map();
/** Whether a program is installed (checked once). */
export async function tool(name) {
  if (!has.has(name)) has.set(name, exec(name, name === 'bsdtar' ? ['--version'] : [], { timeout: 10e3 }).then(() => true, (e) => e.code !== 'ENOENT'));
  return has.get(name);
}
const sevenZip = async () => { for (const t of ['7zz', '7z', '7za']) if (await tool(t)) return t; return null; };

/** bsdtar reads names as patterns; this makes a name match only itself. */
export const literal = (name) => String(name).replace(/[\\[\]*?]/g, '\\$&');

async function listOther(file, type) {
  try {
    const { stdout } = await exec('bsdtar', ['-tf', file], { maxBuffer: 32e6, timeout: 60e3 });
    return stdout.split('\n').filter((n) => n && !n.endsWith('/'));
  } catch (err) {
    if (type === 'rar' && (await tool('unrar'))) {
      const { stdout } = await exec('unrar', ['lb', '-p-', file], { maxBuffer: 32e6, timeout: 60e3 });
      return stdout.split('\n').map((n) => n.replace(/\r$/, '').replace(/\\/g, '/')).filter(Boolean);
    }
    const sz = await sevenZip();
    if (sz) {
      const { stdout } = await exec(sz, ['l', '-slt', '-p-', '-ba', file], { maxBuffer: 32e6, timeout: 60e3 }).catch(() => exec(sz, ['l', '-slt', '-p-', file], { maxBuffer: 32e6, timeout: 60e3 }));
      const out = [];
      for (const block of stdout.split(/\r?\n\r?\n/)) {
        const p = /^Path = (.+)$/m.exec(block)?.[1], folder = /^Folder = \+$/m.test(block) || /^Attributes = D/m.test(block);
        if (p && !folder && p !== file) out.push(p.replace(/\\/g, '/'));
      }
      if (out.length) return out;
    }
    throw new Error(/passw|encrypt/i.test(err.stderr || '') ? 'This archive is password protected' : 'This archive could not be opened');
  }
}

async function readOther(file, name, type) {
  try {
    const { stdout } = await exec('bsdtar', ['-xOf', file, literal(name)], { encoding: 'buffer', maxBuffer: MAX_ENTRY, timeout: 120e3 });
    if (stdout.length) return stdout;
  } catch { /* try the others */ }
  if (type === 'rar' && (await tool('unrar'))) {
    const { stdout } = await exec('unrar', ['p', '-inul', '-p-', file, name], { encoding: 'buffer', maxBuffer: MAX_ENTRY, timeout: 120e3 });
    if (stdout.length) return stdout;
  }
  const sz = await sevenZip();
  if (sz) {
    const { stdout } = await exec(sz, ['e', '-so', '-p-', file, name], { encoding: 'buffer', maxBuffer: MAX_ENTRY, timeout: 120e3 });
    if (stdout.length) return stdout;
  }
  throw new Error('That page could not be read from the archive');
}

async function info(file) {
  const key = await stamp(file);
  if (listings.has(key)) return remember(key, listings.get(key));
  let type = await sniff(file), entries = null;
  if (type === 'zip') {
    try { entries = await zipEntries(file); } catch { type = null; } // a damaged zip may still open with bsdtar
  }
  if (!entries) entries = (await listOther(file, type)).map((name) => ({ name, other: true }));
  return remember(key, { type: type || 'other', key, entries });
}

/** Every file name in the archive. */
export async function list(file) {
  return (await info(file)).entries.map((e) => e.name);
}

/** The archive's real type: zip, rar, 7z, tar or other. */
export async function typeOf(file) {
  return (await info(file)).type;
}

const findEntry = (entries, name) => entries.find((x) => x.name === name) || entries.find((x) => x.name.toLowerCase() === String(name).toLowerCase());

/** One file out of the archive, as a Buffer, or null if it is not there. */
export async function read(file, name) {
  const { type, entries, key } = await info(file);
  const e = findEntry(entries, name);
  if (!e) return null;
  if (!e.other) return zipRead(file, e);
  const done = unpacks.get(key);
  if (done?.finished.has(e.name)) return fs.promises.readFile(done.pathOf(e.name));
  return readOther(file, e.name, type);
}

/** Width and height of one page, reading as little of it as possible. */
export async function pageSize(file, name) {
  const { entries } = await info(file);
  const e = findEntry(entries, name);
  if (!e) return null;
  if (e.other) return fileImageSize(await extracted(file, e.name));
  if (e.encrypted || ![0, 8].includes(e.method)) return null;
  // The start of the entry is enough for most images: inflate just the first compressed bytes.
  const fh = await fs.promises.open(file, 'r');
  try {
    const head = Buffer.alloc(30);
    await fh.read(head, 0, 30, e.local);
    if (head.readUInt32LE(0) !== 0x04034b50) return null;
    const at = e.local + 30 + head.readUInt16LE(26) + head.readUInt16LE(28);
    const n = Math.min(e.csize, 96 * 1024);
    const raw = Buffer.alloc(n);
    await fh.read(raw, 0, n, at);
    let got = null;
    try { got = imageSize(e.method === 0 ? raw : zlib.inflateRawSync(raw, { finishFlush: zlib.constants.Z_SYNC_FLUSH, maxOutputLength: 4e6 })); } catch { /* fall through */ }
    if (got || n === e.csize) return got;
  } finally { await fh.close(); }
  return imageSize(await zipRead(file, e));
}

export const IMAGE = /\.(jpe?g|png|webp|gif|avif|bmp|tiff?|jxl|jp2)$/i;
/** Page formats a browser can't show; these are converted to JPEG on the way out. */
export const CONVERT = /\.(tiff?|jxl|jp2)$/i;
const natural = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
/** The page images of a comic, in reading order. */
export async function pages(file) {
  const names = await list(file);
  return names
    .filter((n) => IMAGE.test(n) && !/(^|\/)(__MACOSX|\.)/.test(n) && !/(^|\/)\._/.test(n))
    .sort((a, b) => natural.compare(a, b));
}

// ---------- the page cache for RAR, 7z and tar ----------
let cacheRoot = null, cacheLimit = 4e9;
/** Where unpacked comics go and how much room they may take (oldest are cleared first). */
export function configureCache(dir, limitBytes) { cacheRoot = dir; if (limitBytes) cacheLimit = limitBytes; }

const unpacks = new Map(); // archive key -> job
const keyDir = (key) => path.join(cacheRoot, crypto.createHash('sha1').update(key).digest('hex').slice(0, 20));

/**
 * The path of one file from a RAR, 7z or tar archive on disk, unpacking the archive in the background if needed.
 * Resolves as soon as that file is fully out, so the first page of a 300 MB comic shows after a moment.
 */
export async function extracted(file, name) {
  if (!cacheRoot) throw new Error('No page cache configured');
  const { type, entries, key } = await info(file);
  const e = findEntry(entries, name);
  if (!e || !e.other) return null;
  const job = unpacks.get(key) || startUnpack(file, type, key, entries);
  return job.wait(e.name);
}

/** Whether an archive is read through the page cache (RAR, 7z, tar) rather than directly (zip). */
export async function cached(file) {
  return (await info(file)).entries.some((e) => e.other);
}

function startUnpack(file, type, key, entries) {
  const dir = keyDir(key);
  const names = new Set(entries.map((e) => e.name));
  const job = { dir, finished: new Set(), waiters: new Map(), failed: null, done: false };
  job.pathOf = (name) => path.join(dir, name);
  const settle = (name) => {
    job.finished.add(name);
    for (const w of job.waiters.get(name) || []) w.resolve(job.pathOf(name));
    job.waiters.delete(name);
  };
  const finish = (err) => {
    job.done = true;
    if (err && !job.finished.size) job.failed = err;
    for (const [name, list] of job.waiters) for (const w of list) {
      if (job.finished.has(name)) w.resolve(job.pathOf(name)); else w.reject(job.failed || new Error('That page could not be read from the archive'));
    }
    job.waiters.clear();
    if (job.failed) unpacks.delete(key); // try again next time
  };
  job.wait = (name) => {
    if (job.finished.has(name)) { touch(dir); return Promise.resolve(job.pathOf(name)); }
    if (job.done) return Promise.reject(job.failed || new Error('That page could not be read from the archive'));
    return new Promise((resolve, reject) => {
      if (!job.waiters.has(name)) job.waiters.set(name, []);
      job.waiters.get(name).push({ resolve, reject });
    });
  };
  unpacks.set(key, job);
  (async () => {
    // Already unpacked by an earlier run?
    const mark = path.join(dir, '.hallflix-complete');
    if (fs.existsSync(mark)) {
      for (const n of names) if (await safeFile(dir, n)) settle(n);
      if (job.finished.size === names.size) { touch(dir); finish(); return; }
    }
    await fs.promises.rm(dir, { recursive: true, force: true });
    await fs.promises.mkdir(dir, { recursive: true });
    let ok = await viaBsdtar(file, dir, names, settle, job);
    if (!ok && type === 'rar' && (await tool('unrar'))) ok = await whole(['unrar', ['x', '-o+', '-y', '-inul', '-p-', file, `${dir}${path.sep}`]], dir, names, settle);
    if (!ok) { const sz = await sevenZip(); if (sz) ok = await whole([sz, ['x', '-y', '-p-', `-o${dir}`, file]], dir, names, settle); }
    if (ok) {
      const bytes = await dirSize(dir);
      await fs.promises.writeFile(mark, String(bytes));
      finish();
      prune(dir).catch(() => {});
    } else finish(new Error('This archive could not be opened'));
  })().catch((err) => finish(err));
  return job;
}

/** bsdtar names each entry ("x name") as it starts on it, so the one before is complete. */
function viaBsdtar(file, dir, names, settle, job) {
  return new Promise((resolve) => {
    const p = spawn('bsdtar', ['-xvf', file, '-C', dir, '--no-same-owner', '--no-same-permissions'], { stdio: ['ignore', 'ignore', 'pipe'] });
    let prev = null, buf = '';
    const timer = setTimeout(() => p.kill('SIGKILL'), 15 * 60e3);
    const done = async (name) => { if (name && names.has(name) && (await safeFile(dir, name))) settle(name); };
    p.stderr.on('data', (d) => {
      buf += d.toString('utf8');
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).replace(/\r$/, ''); buf = buf.slice(i + 1);
        const m = /^x (.+)$/.exec(line);
        if (m) { const before = prev; prev = m[1]; done(before); }
      }
    });
    p.on('error', () => { clearTimeout(timer); resolve(false); });
    p.on('close', async (code) => {
      clearTimeout(timer);
      if (code === 0) { await done(prev); for (const n of names) if (!job.finished.has(n) && (await safeFile(dir, n))) settle(n); resolve(true); return; }
      // A failure part-way still leaves the pages before it; only the last one may be cut short.
      resolve(false);
    });
  });
}

async function whole([cmd, args], dir, names, settle) {
  try {
    await exec(cmd, args, { timeout: 15 * 60e3, maxBuffer: 8e6 });
  } catch { /* some tools exit non-zero after extracting what they could */ }
  let got = 0;
  for (const n of names) if (await safeFile(dir, n)) { settle(n); got++; }
  return got > 0;
}

/** A plain file inside the cache folder: no links pointing elsewhere, no ../ tricks. */
async function safeFile(dir, name) {
  const p = path.resolve(dir, name);
  if (!p.startsWith(path.resolve(dir) + path.sep)) return false;
  try { const st = await fs.promises.lstat(p); return st.isFile(); } catch { return false; }
}

function touch(dir) { const now = new Date(); fs.promises.utimes(dir, now, now).catch(() => {}); }

async function dirSize(dir) {
  let total = 0;
  for (const e of await fs.promises.readdir(dir, { withFileTypes: true, recursive: true })) {
    if (e.isFile()) { try { total += (await fs.promises.stat(path.join(e.parentPath ?? e.path, e.name))).size; } catch { /* gone */ } }
  }
  return total;
}

/** Keep the page cache under its limit by clearing the comics read longest ago. */
async function prune(keep) {
  const dirs = [];
  for (const name of await fs.promises.readdir(cacheRoot).catch(() => [])) {
    const d = path.join(cacheRoot, name);
    try {
      const bytes = +(await fs.promises.readFile(path.join(d, '.hallflix-complete'), 'utf8')) || 0;
      dirs.push({ d, bytes, at: (await fs.promises.stat(d)).mtimeMs });
    } catch { /* still unpacking or not ours */ }
  }
  let total = dirs.reduce((a, x) => a + x.bytes, 0);
  for (const x of dirs.sort((a, b) => a.at - b.at)) {
    if (total <= cacheLimit) break;
    if (x.d === keep || [...unpacks.values()].some((j) => j.dir === x.d && !j.done)) continue;
    await fs.promises.rm(x.d, { recursive: true, force: true });
    for (const [k, j] of unpacks) if (j.dir === x.d) unpacks.delete(k);
    total -= x.bytes;
  }
}

// ---------- image sizes ----------
/** Width and height from the first bytes of a JPEG, PNG, GIF, WebP or BMP, or null. */
export function imageSize(b) {
  if (!b || b.length < 24) return null;
  if (b[0] === 0x89 && b.toString('latin1', 1, 4) === 'PNG') return [b.readUInt32BE(16), b.readUInt32BE(20)];
  if (b.toString('latin1', 0, 3) === 'GIF') return [b.readUInt16LE(6), b.readUInt16LE(8)];
  if (b[0] === 0x42 && b[1] === 0x4d) return [b.readInt32LE(18), Math.abs(b.readInt32LE(22))];
  if (b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') {
    const c = b.toString('latin1', 12, 16);
    if (c === 'VP8 ' && b.length >= 30) return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff];
    if (c === 'VP8L' && b.length >= 25) { const n = b.readUInt32LE(21); return [(n & 0x3fff) + 1, ((n >> 14) & 0x3fff) + 1]; }
    if (c === 'VP8X' && b.length >= 30) return [1 + b.readUIntLE(24, 3), 1 + b.readUIntLE(27, 3)];
    return null;
  }
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7) || m === 0xff) { i += m === 0xff ? 1 : 2; continue; }
      if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)];
      i += 2 + b.readUInt16BE(i + 2);
    }
  }
  return null;
}

/** Image size of a file on disk, reading only its start (more if a JPEG keeps its size further in). */
export async function fileImageSize(p) {
  const fh = await fs.promises.open(p, 'r');
  try {
    for (const n of [65536, 1 << 20, 16 << 20]) {
      const b = Buffer.alloc(n);
      const { bytesRead } = await fh.read(b, 0, n, 0);
      const got = imageSize(b.subarray(0, bytesRead));
      if (got || bytesRead < n) return got;
    }
    return null;
  } finally { await fh.close(); }
}

export const MIME = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif', bmp: 'image/bmp', svg: 'image/svg+xml',
  xhtml: 'application/xhtml+xml; charset=utf-8', html: 'text/html; charset=utf-8', htm: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8',
  xml: 'application/xml', ncx: 'application/xml', opf: 'application/xml', ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2',
  js: 'text/plain; charset=utf-8',
};
export const mimeOf = (name) => MIME[path.extname(name).slice(1).toLowerCase()] || 'application/octet-stream';
