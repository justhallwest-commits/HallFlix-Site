// The HallFlix API and web server.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { cfg } from './config.js';
import { migrate, q, q1, getSetting, setSetting } from './db.js';
import { Router, HttpError, json, readJson, sendFile, sendText, safeJoin } from './http.js';
import * as auth from './auth.js';
import * as catalog from './catalog.js';
import * as playback from './playback.js';
import * as downloads from './downloads.js';
import * as studio from './studio.js';
import * as manage from './manage.js';
import * as extras from './extras.js';
import * as shelf from './shelf.js';
import * as more from './more.js';
import * as look from './look.js';
import * as plugins from './plugins.js';
import * as scan from './scan.js';
import * as tmdb from './tmdb.js';
import * as guard from './guard.js';
import * as access from './access.js';
import * as meta from './meta.js';
import * as art from './art.js';
import * as prerollsMod from './prerolls.js';
import * as archive from './archive.js';
import * as profilesMod from './profiles.js';
import * as lyricsMod from './lyrics.js';
import * as musicMod from './music.js';
import * as clips from './clips.js';
import * as fit from './fit.js';
import { versionedPage } from './webpage.js';
import * as ratingsMod from './ratings.js';
import * as videosMod from './videos.js';
import * as subtitlesMod from './subtitles.js';
import { IMAGE_EXT } from './names.js';
import { themeFileSchema } from './themespec.js';

const open = { auth: false };
const r = new Router();

// The theme contract as a JSON Schema, for editors and plugin authors (the same file as docs/theme.schema.json).
r.get('/api/theme.schema.json', async () => themeFileSchema(), open);

// Everything an app needs to draw its first screen, in one request.
r.get('/api/boot', async (ctx) => {
  const profile = await auth.authenticate(ctx);
  const setup = !(await q1('select 1 from profiles limit 1'));
  const lk = await look.currentLook();
  const out = {
    version: cfg.version, setup, look: lk, plugins: setup ? [] : await plugins.clientPlugins(),
    profile: profile ? auth.publicProfile(profile) : null,
  };
  if (profile) out.media = { ratings: await ratingsMod.clientSettings(), subtitles: await subtitlesMod.clientSettings() };
  if (profile) {
    const acc = await access.forProfile(profile);
    out.libraries = (await q(`select id, name, kind from libraries where kind <> 'prerolls' order by position, id`)).filter((l) => !acc.libraries.includes(+l.id));
    out.access = { off: acc.off };
  }
  else if (!setup && (await getSetting('showProfilesOnLogin', true))) {
    out.profiles = (await q('select id, name, avatar, color from profiles order by id'));
  }
  return out;
}, open);

r.post('/api/setup', async ({ req, res }) => {
  if (await q1('select 1 from profiles limit 1')) throw new HttpError(403, 'HallFlix is already set up');
  const b = await readJson(req);
  const name = String(b.name || '').trim();
  if (!name || String(b.password || '').length < 4) throw new HttpError(400, 'Choose a name and a password of at least 4 characters');
  await q('insert into profiles (name, pass, is_admin) values ($1,$2,true)', [name, auth.hashPassword(b.password)]);
  let tmdbOk = null;
  if (b.tmdbKey?.trim()) {
    await setSetting('tmdbKey', b.tmdbKey.trim());
    try { tmdbOk = await tmdb.testKey(); } catch { tmdbOk = false; }
  }
  const out = await auth.login(req, { name, password: b.password });
  res.setHeader('Set-Cookie', auth.sessionCookie(out.token));
  return { ...out, tmdbOk };
}, open);

r.post('/api/login', async ({ req, res }) => {
  const out = await auth.login(req, await readJson(req));
  res.setHeader('Set-Cookie', auth.sessionCookie(out.token));
  return out;
}, open);
r.post('/api/logout', async (ctx) => {
  const token = auth.tokenFrom(ctx);
  if (token) await q('delete from sessions where token=$1', [token]);
  ctx.res.setHeader('Set-Cookie', auth.sessionCookie(''));
  return { ok: true };
}, open);
r.post('/api/password', async ({ req, profile }) => {
  const b = await readJson(req);
  if (!auth.checkPassword(b.current ?? '', profile.pass)) throw new HttpError(400, 'Current password is wrong');
  if (String(b.next || '').length < 4) throw new HttpError(400, 'Use at least 4 characters');
  await q('update profiles set pass=$1 where id=$2', [auth.hashPassword(b.next), profile.id]);
  return { ok: true };
});

catalog.routes(r);
clips.routes(r);
fit.routes(r, open);
playback.routes(r);
downloads.routes(r);
studio.routes(r);
manage.routes(r);
extras.routes(r);
shelf.routes(r);
more.routes(r);
meta.routes(r);
guard.routes(r);
access.routes(r);
art.routes(r);
prerollsMod.routes(r);
profilesMod.routes(r);
lyricsMod.routes(r);
ratingsMod.routes(r);
videosMod.routes(r);
subtitlesMod.routes(r);
musicMod.routes(r);

// TMDb artwork, fetched once and then served from the NAS.
const SIZES = new Set(['w185', 'w300', 'w342', 'w500', 'w780', 'w1280', 'original']);
const fetching = new Map();
// Short links for installing the apps: type <server>/get/android into Downloader on a Fire TV.
const APPS = 'https://github.com/justhallwest-commits/HallFlix-Site/releases/download/apps';
r.get('/get/:app', async ({ res, params }) => {
  const file = { android: 'hallflix.apk', apk: 'hallflix.apk', roku: 'hallflix-roku.zip' }[params.app];
  if (!file) throw new HttpError(404, 'Not found');
  res.writeHead(302, { Location: `${APPS}/${file}`, 'Cache-Control': 'no-store' });
  res.end();
}, open);

r.get('/img/t/:size/:file', async ({ req, res, params }) => {
  if (!SIZES.has(params.size) || !/^[\w-]+\.(jpg|png|svg|webp)$/.test(params.file)) throw new HttpError(404, 'Not found');
  const dir = path.join(cfg.dataDir, 'cache', 'tmdb', params.size);
  const file = path.join(dir, params.file);
  if (!fs.existsSync(file)) {
    const key = `${params.size}/${params.file}`;
    if (!fetching.has(key)) {
      fetching.set(key, (async () => {
        const up = await fetch(`${cfg.tmdbImg}/${key}`, { signal: AbortSignal.timeout(20e3) });
        if (!up.ok) throw new HttpError(404, 'Not found');
        await fs.promises.mkdir(dir, { recursive: true });
        const tmp = `${file}.${process.pid}.tmp`;
        await fs.promises.writeFile(tmp, Buffer.from(await up.arrayBuffer()));
        await fs.promises.rename(tmp, file);
      })().finally(() => fetching.delete(key)));
    }
    try { await fetching.get(key); } catch (e) { throw e.status ? e : new HttpError(502, 'Artwork unavailable'); }
  }
  await sendFile(req, res, file, { cache: 'public, max-age=31536000, immutable' });
}, open);

// Artwork that lives beside the media or was picked from the NAS.
// ?w=<width> sends a copy about that wide (made once and kept), so a 3000 px poster isn't sent to a 250 px slot.
r.get('/img/l/:ref', async ({ req, res, params, query }) => {
  const file = path.resolve(Buffer.from(params.ref, 'base64url').toString('utf8'));
  const e = path.extname(file).slice(1).toLowerCase();
  if (!(await art.allowed(file)) || !(IMAGE_EXT.has(e) || e === 'mp4' || e === 'webm')) throw new HttpError(404, 'Not found');
  if (+query.w > 0 && ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'tif', 'tiff'].includes(e)) {
    const small = await fit.resizedLocal(file, Math.min(2560, +query.w));
    if (small) return sendFile(req, res, small, { cache: 'public, max-age=604800', type: 'image/jpeg' });
  }
  await sendFile(req, res, file, { cache: 'public, max-age=86400' });
}, open);

/**
 * TVs get the page laid out at a computer-like width from the very first paint (Studio → Look and feel → TVs → Size).
 * The Fire TV WebView otherwise lays pages out 960 px wide, so everything looks about 1.7x too big.
 */
const TV_UA = /AFT|Android TV|GoogleTV|BRAVIA|SmartTV|Tizen|Web0S/i;
async function tvPage(req, html) {
  if (!TV_UA.test(req.headers['user-agent'] || '')) return html;
  let w = 1600;
  try { const lk = await look.currentLook(); w = Math.max(960, Math.min(1920, +(lk.devices?.tv?.theme || lk.theme)?.tv?.width || 1600)); } catch {}
  return html.replace(/<meta name="viewport" content="[^"]*">/, `<meta name="viewport" content="width=${w}, viewport-fit=cover">`);
}
async function serveStatic(req, res, pathname) {
  if (pathname.startsWith('/uploads/')) return sendFile(req, res, safeJoin(path.join(cfg.dataDir, 'uploads'), pathname.slice(9)), { cache: 'public, max-age=31536000, immutable' });
  if (pathname.startsWith('/plugins/')) return sendFile(req, res, safeJoin(plugins.pluginsDir(), pathname.slice(9)));
  let rel = pathname;
  if (rel === '/' || rel === '') rel = '/index.html';
  else if (rel === '/studio' || rel === '/studio/') rel = '/studio/index.html';
  // The pages carry each script's version (see webpage.js); a versioned file never changes, so it is kept for good.
  if (rel === '/index.html' || rel === '/studio/index.html') return sendText(req, res, await tvPage(req, versionedPage(cfg.webDir, rel)));
  const versioned = /[?&]v=[0-9a-f]{6,}/.test(req.url || '');
  const long = rel.startsWith('/assets/fonts/') || rel.startsWith('/vendor/');
  try { return await sendFile(req, res, safeJoin(cfg.webDir, rel), { cache: versioned ? 'public, max-age=31536000, immutable' : long ? 'public, max-age=2592000' : 'no-cache' }); }
  catch (e) {
    if (e.status === 404 && !path.extname(rel)) return sendText(req, res, await tvPage(req, versionedPage(cfg.webDir, '/index.html')));
    throw e;
  }
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); } catch { return json(res, 400, { error: 'Bad request' }); }
  const ctx = { req, res, url, query: Object.fromEntries(url.searchParams), params: {} };
  try {
    const m = r.match(req.method, url.pathname);
    if (m) {
      ctx.params = m.params;
      if (m.opts.auth !== false) {
        ctx.profile = await auth.authenticate(ctx);
        if (!ctx.profile) throw new HttpError(401, 'Sign in first');
        if (m.opts.admin && !ctx.profile.is_admin) throw new HttpError(403, 'Only an admin can do that');
        // Content Guard: titles hidden from this profile can't be listed, opened or played.
        if (!m.opts.admin && !pathname.startsWith('/api/studio/')) {
          // Menu access: features and libraries an admin turned off for this profile.
          ctx.access = await access.forProfile(ctx.profile);
          if (access.refuse(req.method, url.pathname, ctx.access)) throw new HttpError(403, 'That isn’t turned on for your profile');
          const lib = access.libraryOf(url.pathname);
          if (lib && ctx.access.libraries.includes(lib)) throw new HttpError(404, 'Library not found');
          ctx.hidden = await guard.hiddenFor(ctx.profile, ctx.access);
          if (ctx.hidden) {
            const body = guard.needsBody(req.method, url.pathname) ? await readJson(req) : null;
            if (guard.blocked(url.pathname, ctx.params, body, ctx.hidden)) throw new HttpError(404, 'Not found');
          }
        }
      }
      let out = await m.fn(ctx);
      if (ctx.hidden?.size && out && typeof out === 'object') out = guard.scrub(out, ctx.hidden);
      if (out !== undefined && !res.headersSent) json(res, 200, out);
      return;
    }
    if (pathname.startsWith('/api/') || pathname.startsWith('/hls/') || pathname.startsWith('/img/')) throw new HttpError(404, 'Not found');
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed');
    await serveStatic(req, res, pathname);
  } catch (e) {
    if (!e.status) console.error('[http]', req.method, url.pathname, e);
    if (!res.headersSent) json(res, e.status || 500, { error: e.status ? e.message : 'Something went wrong on the server' });
    else res.destroy();
  }
}

export async function startServer(port = cfg.port) {
  await migrate();
  for (const d of ['uploads', 'plugins', 'cache']) await fs.promises.mkdir(path.join(cfg.dataDir, d), { recursive: true });
  archive.configureCache(path.join(cfg.dataDir, 'cache', 'unpacked'), cfg.comicCacheGB * 1e9);
  const server = http.createServer(handle);
  server.keepAliveTimeout = 65e3;
  await new Promise((resolve) => server.listen(port, resolve));
  console.log(`[hallflix] v${cfg.version} listening on ${port}`);
  // Keep libraries fresh: a scan shortly after start, then every six hours.
  const first = setTimeout(() => scan.scanAll().catch(() => {}), 15e3);
  const timer = setInterval(() => scan.scanAll().catch(() => {}), 6 * 3600e3);
  first.unref(); timer.unref();
  return { server, close: () => { clearTimeout(first); clearInterval(timer); return new Promise((res) => server.close(res)); } };
}
