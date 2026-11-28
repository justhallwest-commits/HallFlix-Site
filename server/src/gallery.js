// Studio → Theme gallery: the built-in looks and plugin looks, ready-made Fire TV layouts, and an online catalog of
// looks and plugins to install in one click. The catalog is a JSON file (by default in the HallFlix-Site repository on
// GitHub); see catalog/README.md for its format.
import { getSetting, setSetting } from './db.js';
import { HttpError, readJson } from './http.js';
import * as look from './look.js';
import * as plugins from './plugins.js';
import { checkTheme } from './themespec.js';

const admin = { admin: true };
export const DEFAULT_CATALOG = 'https://raw.githubusercontent.com/justhallwest-commits/HallFlix-Site/main/catalog/looks.json';

/** Ready-made designs for the Fire TV app's native screens (theme.tvApp). Each only changes what makes it different. */
export const TV_LAYOUTS = [
  { id: 'hallflix', name: 'HallFlix', description: 'The standard layout: a big picture that follows the highlighted title, a top menu, library tiles and rows.', tvApp: {} },
  { id: 'jellyfin', name: 'Jellyfin style', description: 'A full-width backdrop behind everything, centred menu, wide library tiles and smaller posters, like the Jellyfin TV app.',
    tvApp: { hero: { width: 100, height: 50, brightness: 75, overview: true }, nav: { align: 'center' }, tiles: { width: 260, height: 146, counts: false }, rows: { posterWidth: 110, captions: 'always' }, cards: { radius: 4, scale: 106 } } },
  { id: 'streaming', name: 'Streaming service', description: 'A tall cinematic picture with logos, big posters and no names on cards: the Netflix and Max look.',
    tvApp: { hero: { height: 62, width: 78, logos: true, rotate: 10 }, tiles: { show: false }, rows: { posterWidth: 132, captions: 'never', gap: 22 }, cards: { radius: 6, scale: 110, focus: 'white' } } },
  { id: 'big-tiles', name: 'Big library tiles', description: 'Large library tiles first, for homes that browse by library more than by row.',
    tvApp: { hero: { height: 44 }, tiles: { width: 320, height: 180, names: true, counts: true }, rows: { posterWidth: 128 } } },
  { id: 'compact', name: 'Compact', description: 'Smaller cards and a shorter picture so more rows fit: good on 1080p TVs viewed close up.',
    tvApp: { hero: { height: 42, overview: false }, tiles: { width: 190, height: 107 }, rows: { posterWidth: 100, wideWidth: 190, gap: 10, titleSize: 15 }, cards: { radius: 6, scale: 106, ring: 2 } } },
  { id: 'minimal', name: 'Minimal', description: 'No big picture and a quiet menu: rows over your background picture.',
    tvApp: { hero: { show: false }, nav: { libraries: false }, background: { use: 'image', dim: 80 }, rows: { captions: 'always' }, cards: { focus: 'accent' } } },
];

// The online catalog, kept for ten minutes.
let cached = null;
async function catalog() {
  const url = await getSetting('galleryUrl', DEFAULT_CATALOG);
  if (cached && cached.url === url && Date.now() - cached.at < 10 * 60e3) return cached;
  const out = { url, at: Date.now(), entries: [], error: null };
  try {
    if (!/^https:\/\//i.test(url)) throw new Error('the catalog address must start with https://');
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 8000);
    const r = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    if (!r.ok) throw new Error(`it answered ${r.status}`);
    const data = await r.json();
    const base = new URL(url);
    out.entries = (Array.isArray(data.entries) ? data.entries : []).slice(0, 200).flatMap((e) => {
      if (!e || typeof e.id !== 'string' || typeof e.name !== 'string' || !['look', 'plugin', 'tv'].includes(e.kind)) return [];
      // Addresses in the catalog may be relative to the catalog file.
      const abs = (u) => { try { return u ? new URL(u, base).href : ''; } catch { return ''; } };
      return [{ id: e.id.slice(0, 60), kind: e.kind, name: e.name.slice(0, 60), author: String(e.author || '').slice(0, 60), description: String(e.description || '').slice(0, 300),
        url: abs(e.url), preview: abs(e.preview), colors: e.colors && typeof e.colors === 'object' ? e.colors : null, tvApp: e.kind === 'tv' && e.tvApp && typeof e.tvApp === 'object' ? e.tvApp : null }];
    });
  } catch (e) {
    out.error = `The online gallery couldn’t be read (${e.name === 'AbortError' ? 'no answer' : e.message}).`;
  }
  cached = out;
  return out;
}

async function download(url, max) {
  if (!/^https:\/\//i.test(url)) throw new HttpError(400, 'Only https:// addresses can be installed');
  const r = await fetch(url);
  if (!r.ok) throw new HttpError(502, `The download answered ${r.status}`);
  const len = +r.headers.get('content-length') || 0;
  if (len > max) throw new HttpError(413, 'That download is too big');
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > max) throw new HttpError(413, 'That download is too big');
  return buf;
}

export function routes(r) {
  r.get('/api/studio/gallery', async ({ query }) => {
    if (query.refresh) cached = null;
    const installed = await plugins.listPlugins();
    const c = await catalog();
    return {
      looks: [...look.PRESETS.map((p) => ({ ...p, from: 'HallFlix' })),
        ...installed.filter((p) => p.enabled).flatMap((p) => (p.themes || []).map((t) => ({ ...t, from: p.name || p.id })))],
      tvLayouts: TV_LAYOUTS,
      online: c.entries.map((e) => ({ ...e, installed: e.kind === 'plugin' && installed.some((p) => p.id === e.id) })),
      onlineError: c.error,
      catalogUrl: c.url,
      defaultCatalog: DEFAULT_CATALOG,
    };
  }, admin);

  r.put('/api/studio/gallery', async ({ req }) => {
    const { catalogUrl } = await readJson(req);
    const u = String(catalogUrl || '').trim();
    if (u && !/^https:\/\/\S+$/i.test(u)) throw new HttpError(400, 'The catalog address must start with https://');
    await setSetting('galleryUrl', u || DEFAULT_CATALOG);
    cached = null;
    return { ok: true };
  }, admin);

  // Install something from the online gallery: a plugin (a zip) is installed; a look (a .hallflix-look.json) is checked
  // and handed back for the Studio to apply. Only addresses listed in the catalog can be installed.
  r.post('/api/studio/gallery/install', async ({ req }) => {
    const { id } = await readJson(req);
    const entry = (await catalog()).entries.find((e) => e.id === id);
    if (!entry) throw new HttpError(404, 'That isn’t in the online gallery');
    if (entry.kind === 'tv') return { kind: 'tv', tvApp: checkTheme({ tvApp: entry.tvApp || {} }).theme.tvApp || {} };
    if (!entry.url) throw new HttpError(400, 'That gallery entry has no download address');
    if (entry.kind === 'plugin') return { kind: 'plugin', id: await plugins.installZip(await download(entry.url, 60e6)) };
    let data;
    try { data = JSON.parse((await download(entry.url, 2e6)).toString('utf8')); } catch (e) { if (e instanceof HttpError) throw e; throw new HttpError(400, 'That look isn’t valid JSON'); }
    const t = data?.format === 'hallflix-look' ? data.theme : data?.theme || data;
    const { theme, problems } = checkTheme(t || {});
    return { kind: 'look', name: data?.name || entry.name, theme, problems };
  }, admin);
}
