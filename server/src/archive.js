// Reading files out of archives without unpacking them: EPUB and CBZ are zip files (read here directly, one entry at
// a time, so a 500 MB comic never sits in memory); CBR, CB7 and CBT go through bsdtar (libarchive).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const MAX_ENTRY = 200e6;
const listings = new Map(); // "path|mtime" -> entries, most recent last

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

const isZip = (file) => /\.(epub|cbz|zip)$/i.test(file);

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

/** Every file name in the archive. */
export async function list(file) {
  const key = await stamp(file);
  if (listings.has(key)) return remember(key, listings.get(key)).map((e) => e.name);
  let entries;
  if (isZip(file)) {
    try { entries = await zipEntries(file); } catch { entries = null; } // misnamed archives fall through to bsdtar
  }
  if (!entries) {
    const { stdout } = await exec('bsdtar', ['-tf', file], { maxBuffer: 32e6, timeout: 60e3 });
    entries = stdout.split('\n').filter((n) => n && !n.endsWith('/')).map((name) => ({ name, tar: true }));
  }
  return remember(key, entries).map((e) => e.name);
}

/** One file out of the archive, as a Buffer, or null if it is not there. */
export async function read(file, name) {
  const key = await stamp(file);
  if (!listings.has(key)) await list(file);
  const entries = listings.get(key);
  const e = entries.find((x) => x.name === name) || entries.find((x) => x.name.toLowerCase() === String(name).toLowerCase());
  if (!e) return null;
  if (!e.tar) return zipRead(file, e);
  const { stdout } = await exec('bsdtar', ['-xOf', file, e.name], { encoding: 'buffer', maxBuffer: MAX_ENTRY, timeout: 120e3 });
  return stdout;
}

const IMAGE = /\.(jpe?g|png|webp|gif|avif|bmp)$/i;
const natural = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
/** The page images of a comic, in reading order. */
export async function pages(file) {
  const names = await list(file);
  return names
    .filter((n) => IMAGE.test(n) && !/(^|\/)(__MACOSX|\.)/.test(n) && !/(^|\/)\._/.test(n))
    .sort((a, b) => natural.compare(a, b));
}

export const MIME = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif', bmp: 'image/bmp', svg: 'image/svg+xml',
  xhtml: 'application/xhtml+xml; charset=utf-8', html: 'text/html; charset=utf-8', htm: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8',
  xml: 'application/xml', ncx: 'application/xml', opf: 'application/xml', ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2',
  js: 'text/plain; charset=utf-8',
};
export const mimeOf = (name) => MIME[path.extname(name).slice(1).toLowerCase()] || 'application/octet-stream';
