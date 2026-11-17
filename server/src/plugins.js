// Plugins: folders under /data/plugins that add looks, styles, scripts and effects without
// touching HallFlix itself. See docs/PLUGINS.md.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { cfg } from './config.js';
import { getSetting, setSetting } from './db.js';
import { HttpError, safeJoin } from './http.js';

export const pluginsDir = () => path.join(cfg.dataDir, 'plugins');
const ID = /^[a-z0-9][a-z0-9-]{1,40}$/;

export const RATING_FIELDS = ['list', 'source', 'value', 'votes', 'link', 'label', 'max'];
export const SUBTITLE_FIELDS = ['list', 'language', 'release', 'download', 'hi', 'downloads'];
const isUrl = (u) => typeof u === 'string' && /^https?:\/\//i.test(u);
/** Services a plugin describes (ratings or subtitles): a name, an address with {placeholders}, and field paths. */
function services(list, from, fields) {
  return (Array.isArray(list) ? list : []).filter((x) => x && x.name && isUrl(x.url)).slice(0, 5).map((x) => ({
    key: String(x.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40), name: String(x.name).slice(0, 60),
    description: String(x.description || `From ${from}`).slice(0, 200), url: x.url,
    headers: x.headers && typeof x.headers === 'object' ? x.headers : {},
    ...Object.fromEntries(fields.map((f) => [f, String(x[f] ?? '').slice(0, 200)])),
  }));
}

export async function listPlugins() {
  const enabled = await getSetting('plugins', {});
  let dirs = [];
  try { dirs = await fs.promises.readdir(pluginsDir(), { withFileTypes: true }); } catch { /* none yet */ }
  const out = [];
  for (const d of dirs) {
    if (!d.isDirectory() || !ID.test(d.name)) continue;
    try {
      const m = JSON.parse(await fs.promises.readFile(path.join(pluginsDir(), d.name, 'plugin.json'), 'utf8'));
      const c = m.contributes || {};
      const files = (list) => (Array.isArray(list) ? list : []).filter((f) => typeof f === 'string' && /^[\w./-]+$/.test(f) && !f.includes('..'));
      out.push({
        id: d.name, name: String(m.name || d.name), version: String(m.version || ''), description: String(m.description || ''),
        author: String(m.author || ''), enabled: enabled[d.name] !== false,
        css: files(c.css), js: files(c.js),
        // Lyrics services, described rather than coded: the server asks them (see docs/PLUGINS.md).
        lyrics: (Array.isArray(c.lyrics) ? c.lyrics : []).filter((l) => l && typeof l.url === 'string' && /^https?:\/\//i.test(l.url) && l.name).slice(0, 5).map((l) => ({
          key: String(l.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40), name: String(l.name).slice(0, 60), description: String(l.description || `From ${m.name || d.name}`).slice(0, 200),
          url: l.url, searchUrl: typeof l.searchUrl === 'string' && /^https?:\/\//i.test(l.searchUrl) ? l.searchUrl : '', result: String(l.result || ''), synced: String(l.synced || ''), plain: String(l.plain || ''),
          searchList: String(l.searchList || ''), searchTitle: String(l.searchTitle || ''), searchArtist: String(l.searchArtist || ''), headers: l.headers && typeof l.headers === 'object' ? l.headers : {} })),
        // Ratings and subtitle services work the same way: an address to ask and where the answer sits.
        ratings: services(c.ratings, m.name || d.name, RATING_FIELDS),
        subtitles: services(c.subtitles, m.name || d.name, SUBTITLE_FIELDS),
        themes: (Array.isArray(c.themes) ? c.themes : []).filter((t) => t && t.name && typeof t.theme === 'object')
          .map((t) => ({ id: `${d.name}:${String(t.name).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, name: String(t.name), description: String(t.description || `From ${m.name || d.name}`), theme: t.theme })),
      });
    } catch (e) { out.push({ id: d.name, name: d.name, enabled: false, broken: `plugin.json: ${e.message}`, css: [], js: [], themes: [], lyrics: [], ratings: [], subtitles: [] }); }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** What the apps load at start: only enabled, working plugins. */
export async function clientPlugins() {
  return (await listPlugins()).filter((p) => p.enabled && !p.broken).map((p) => ({
    id: p.id, name: p.name, version: p.version,
    css: p.css.map((f) => `/plugins/${p.id}/${f}?v=${encodeURIComponent(p.version)}`),
    js: p.js.map((f) => `/plugins/${p.id}/${f}?v=${encodeURIComponent(p.version)}`),
  }));
}

export async function setEnabled(id, on) {
  const enabled = { ...(await getSetting('plugins', {})) };
  enabled[id] = !!on;
  await setSetting('plugins', enabled);
}

export async function removePlugin(id) {
  if (!ID.test(id)) throw new HttpError(400, 'Bad plugin id');
  await fs.promises.rm(path.join(pluginsDir(), id), { recursive: true, force: true });
}

/** Minimal ZIP reader (stored + deflate), enough for plugin packages. */
export function unzip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66000); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new HttpError(400, 'Not a zip file');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  if (count > 500) throw new HttpError(400, 'Too many files in the zip');
  const files = [];
  let total = 0;
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new HttpError(400, 'Corrupt zip');
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    p += 46 + nlen + xlen + clen;
    if (name.endsWith('/')) continue;
    total += usize;
    if (total > 60e6) throw new HttpError(400, 'Plugin is too large');
    const dataAt = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(dataAt, dataAt + csize);
    const data = method === 0 ? raw : method === 8 ? zlib.inflateRawSync(raw, { maxOutputLength: 60e6 }) : null;
    if (!data) throw new HttpError(400, `Unsupported compression in ${name}`);
    files.push({ name, data });
  }
  return files;
}

export async function installZip(buf) {
  let files = unzip(buf).filter((f) => !f.name.startsWith('__MACOSX/'));
  // GitHub-style zips wrap everything in one top folder: strip it.
  if (!files.some((f) => f.name === 'plugin.json')) {
    const top = files[0]?.name.split('/')[0];
    if (top && files.every((f) => f.name.startsWith(top + '/'))) files = files.map((f) => ({ ...f, name: f.name.slice(top.length + 1) }));
  }
  const manifest = files.find((f) => f.name === 'plugin.json');
  if (!manifest) throw new HttpError(400, 'The zip has no plugin.json');
  let m;
  try { m = JSON.parse(manifest.data.toString('utf8')); } catch { throw new HttpError(400, 'plugin.json is not valid JSON'); }
  if (!ID.test(String(m.id || ''))) throw new HttpError(400, 'plugin.json needs an "id" of lowercase letters, numbers and dashes');
  const dir = path.join(pluginsDir(), m.id);
  await fs.promises.rm(dir, { recursive: true, force: true });
  for (const f of files) {
    const dest = safeJoin(dir, f.name);
    await fs.promises.mkdir(path.dirname(dest), { recursive: true });
    await fs.promises.writeFile(dest, f.data);
  }
  return m.id;
}
