// Studio API: everything the admin panel changes. Every route here requires an admin profile.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { cfg } from './config.js';
import { q, q1, getSetting, setSetting } from './db.js';
import { HttpError, readJson, readBody } from './http.js';
import { hashPassword, publicProfile } from './auth.js';
import * as scan from './scan.js';
import * as tmdb from './tmdb.js';
import * as look from './look.js';
import * as plugins from './plugins.js';
import { IMAGE_EXT, isVideo } from './names.js';
import { img } from './catalog.js';

const admin = { admin: true };
const KINDS = ['movies', 'shows', 'prerolls'];

function insideMedia(p) {
  const full = path.resolve(String(p || cfg.mediaRoot));
  const root = path.resolve(cfg.mediaRoot);
  if (full !== root && !full.startsWith(root + path.sep)) throw new HttpError(400, `Choose a folder inside ${root}`);
  return full;
}

export function routes(r) {
  r.get('/api/studio/overview', async () => {
    const counts = await q(`select l.id, l.name, l.kind, l.path, l.position, l.look,
        (select count(*)::int from items i where i.library_id = l.id and i.kind in ('movie','show','clip')) as titles,
        (select count(*)::int from items i where i.library_id = l.id and i.kind = 'episode') as episodes,
        (select count(*)::int from items i where i.library_id = l.id and i.kind in ('movie','show') and not i.matched) as unmatched
      from libraries l order by l.position, l.id`);
    let transcoder = { ok: false };
    try { transcoder = await (await fetch(cfg.transcoderUrl + '/status', { signal: AbortSignal.timeout(3000) })).json(); } catch { /* down */ }
    return { version: cfg.version, libraries: counts, scan: scan.status, transcoder, tmdb: !!(await tmdb.tmdbKey()), mediaRoot: cfg.mediaRoot };
  }, admin);

  // ----- libraries
  r.get('/api/studio/fs', async ({ query }) => {
    const dir = insideMedia(query.path);
    const root = path.resolve(cfg.mediaRoot);
    let entries;
    try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch (e) {
      if (e.code === 'EACCES' || e.code === 'EPERM') throw new HttpError(403, `HallFlix is not allowed to read ${dir}. Check the shared folder's permissions on the NAS.`);
      throw new HttpError(404, dir === root ? `Nothing is mounted at ${root}. Check the media line in the Docker compose file.` : 'Folder not found');
    }
    // Some NAS file systems and shared-folder links do not say whether an entry is a folder, so ask the disk.
    const typed = await Promise.all(entries.map(async (e) => {
      let isDir = e.isDirectory(), isFile = e.isFile();
      if (!isDir && !isFile) { try { const st = await fs.promises.stat(path.join(dir, e.name)); isDir = st.isDirectory(); isFile = st.isFile(); } catch { /* broken link */ } }
      return { name: e.name, isDir, isFile };
    }));
    const want = query.files; // 'images' | 'videos' | undefined
    const hidden = (n) => n.startsWith('.') || n.startsWith('@') || n.startsWith('#');
    const keep = (e) => e.isDir ? !hidden(e.name)
      : !e.isFile ? false : want === 'images' ? IMAGE_EXT.has(path.extname(e.name).slice(1).toLowerCase()) || /\.(mp4|webm)$/i.test(e.name) : want === 'videos' ? isVideo(e.name) : false;
    const shown = typed.filter(keep);
    const files = typed.filter((e) => e.isFile && !hidden(e.name)).length;
    let note = '';
    if (!shown.length) {
      if (!typed.length && dir === root) note = `HallFlix sees nothing at all in ${root}. The media line in the Docker compose file is not pointing at your share (or the share is empty). Fix the left side of that line and redeploy.`;
      else if (!typed.length) note = 'This folder is empty.';
      else if (files && !want) note = `No sub-folders here, only ${files} file${files > 1 ? 's' : ''}. If these are your movies, this is the folder to use.`;
      else note = 'Nothing usable here.';
    }
    return {
      path: dir, root, parent: dir === root ? null : path.dirname(dir), note,
      entries: shown.map((e) => ({ name: e.name, dir: e.isDir, path: path.join(dir, e.name) }))
        .sort((a, b) => b.dir - a.dir || a.name.localeCompare(b.name, undefined, { numeric: true })),
    };
  }, admin);
  r.post('/api/studio/libraries', async ({ req }) => {
    const b = await readJson(req);
    if (!b.name?.trim() || !KINDS.includes(b.kind)) throw new HttpError(400, 'A library needs a name and a type');
    const dir = insideMedia(b.path);
    const pos = (await q1('select coalesce(max(position), 0) + 1 as p from libraries')).p;
    const lib = await q1('insert into libraries (name, kind, path, position) values ($1,$2,$3,$4) returning *', [b.name.trim(), b.kind, dir, pos]);
    scan.startScan(lib.id);
    return lib;
  }, admin);
  r.put('/api/studio/libraries/:id', async ({ req, params }) => {
    const b = await readJson(req);
    const lib = await q1('select * from libraries where id=$1', [params.id]);
    if (!lib) throw new HttpError(404, 'Library not found');
    const name = b.name?.trim() || lib.name, position = b.position ?? lib.position;
    const dir = b.path ? insideMedia(b.path) : lib.path;
    const lk = b.look !== undefined ? b.look : lib.look;
    const out = await q1('update libraries set name=$1, path=$2, position=$3, look=$4::jsonb where id=$5 returning *', [name, dir, position, JSON.stringify(lk), lib.id]);
    if (dir !== lib.path) scan.startScan(lib.id);
    return out;
  }, admin);
  r.delete('/api/studio/libraries/:id', async ({ params }) => { await q('delete from libraries where id=$1', [params.id]); return { ok: true }; }, admin);
  r.post('/api/studio/scan', async ({ req }) => {
    const b = await readJson(req);
    if (b.fresh && b.libraryId) await q(`update items set matched=false where library_id=$1 and kind in ('movie','show','episode')`, [b.libraryId]);
    if (b.libraryId) scan.startScan(+b.libraryId); else await scan.scanAll();
    return { ok: true };
  }, admin);

  // ----- settings
  r.get('/api/studio/settings', async () => {
    const key = await tmdb.tmdbKey();
    return { tmdbKey: key ? `${key.slice(0, 4)}…${key.slice(-4)}` : '', hasTmdb: !!key, prerolls: await getSetting('prerolls', {}), showProfilesOnLogin: await getSetting('showProfilesOnLogin', true) };
  }, admin);
  r.put('/api/studio/settings', async ({ req }) => {
    const b = await readJson(req);
    if (typeof b.tmdbKey === 'string' && !b.tmdbKey.includes('…')) {
      await setSetting('tmdbKey', b.tmdbKey.trim());
      if (b.tmdbKey.trim()) {
        let ok = false, error = '';
        try { ok = await tmdb.testKey(); } catch (e) { error = e.message; }
        if (!ok) return { ok: false, error: error || 'TMDb did not accept that key' };
        scan.scanAll();
      }
    }
    if (b.prerolls) await setSetting('prerolls', { enabled: b.prerolls.enabled !== false, max: Math.max(0, Math.min(6, +b.prerolls.max || 0)), onResume: !!b.prerolls.onResume });
    if (b.showProfilesOnLogin !== undefined) await setSetting('showProfilesOnLogin', !!b.showProfilesOnLogin);
    return { ok: true };
  }, admin);

  // ----- look
  r.get('/api/studio/look', async () => ({
    defaults: look.DEFAULT_THEME, theme: await getSetting('theme', {}), options: look.OPTIONS,
    presets: [...look.PRESETS, ...(await plugins.listPlugins()).filter((p) => p.enabled).flatMap((p) => p.themes)],
    seasons: await q('select * from seasons order by starts, id'),
    libraries: await q(`select id, name, kind, look from libraries where kind <> 'prerolls' order by position, id`),
    active: (await look.currentLook()).season,
  }), admin);
  r.put('/api/studio/theme', async ({ req }) => { await setSetting('theme', (await readJson(req)).theme || {}); return { ok: true }; }, admin);
  r.post('/api/studio/look/preview', async ({ req }) => {
    const b = await readJson(req);
    const libraries = (await q('select id, look from libraries')).map((l) => (b.libraries?.[l.id] ? { id: l.id, look: b.libraries[l.id] } : l));
    let seasons = await q('select * from seasons order by id');
    if (b.season) { seasons = seasons.filter((s) => s.id !== b.season.id); seasons.push({ ...b.season, id: b.season.id ?? -1, enabled: true }); }
    return look.resolve({ theme: b.theme ?? (await getSetting('theme', {})), libraries, seasons, forceSeason: b.season ? b.season.id ?? -1 : b.noSeason ? -2 : null });
  }, admin);
  r.post('/api/studio/seasons', async ({ req }) => {
    const b = await readJson(req);
    if (!b.name?.trim() || !/^\d\d-\d\d$/.test(b.starts) || !/^\d\d-\d\d$/.test(b.ends)) throw new HttpError(400, 'A season needs a name, a start date and an end date');
    if (b.id) return q1('update seasons set name=$1, starts=$2, ends=$3, enabled=$4, look=$5::jsonb where id=$6 returning *', [b.name.trim(), b.starts, b.ends, b.enabled !== false, JSON.stringify(b.look || {}), b.id]);
    return q1('insert into seasons (name, starts, ends, enabled, look) values ($1,$2,$3,$4,$5::jsonb) returning *', [b.name.trim(), b.starts, b.ends, b.enabled !== false, JSON.stringify(b.look || {})]);
  }, admin);
  r.delete('/api/studio/seasons/:id', async ({ params }) => { await q('delete from seasons where id=$1', [params.id]); return { ok: true }; }, admin);

  // Upload an image (or a short looping video) for backgrounds and logos. The body is the raw file.
  r.post('/api/studio/upload', async ({ req, query }) => {
    const e = path.extname(String(query.name || '')).slice(1).toLowerCase();
    if (![...IMAGE_EXT, 'mp4', 'webm'].includes(e)) throw new HttpError(400, 'Upload a JPG, PNG, WebP, GIF, MP4 or WebM file');
    const buf = await readBody(req, 250e6);
    if (!buf.length) throw new HttpError(400, 'Empty file');
    const name = `${crypto.createHash('sha1').update(buf).digest('hex').slice(0, 16)}.${e}`;
    const dir = path.join(cfg.dataDir, 'uploads');
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(path.join(dir, name), buf);
    return { url: `/uploads/${name}` };
  }, admin);
  // Use a picture that already lives on the NAS.
  r.post('/api/studio/pick', async ({ req }) => {
    const file = insideMedia((await readJson(req)).path);
    return { url: img(`local:${file}`) };
  }, admin);

  // ----- pre-rolls
  r.get('/api/studio/prerolls', async () => ({
    settings: { enabled: true, max: 2, onResume: false, ...(await getSetting('prerolls', {})) },
    rules: await q('select * from preroll_rules order by position, id'),
    clips: (await q(`select id, title, tags, runtime_s, library_id from items where kind='clip' order by sort_title`)),
    libraries: await q(`select id, name, kind from libraries order by position, id`),
    genres: (await q(`select distinct g from items i, unnest(i.genres) g order by g`)).map((x) => x.g),
    ratings: (await q(`select distinct rating from items where rating is not null and rating <> '' order by rating`)).map((x) => x.rating),
  }), admin);
  r.post('/api/studio/prerolls/rules', async ({ req }) => {
    const b = await readJson(req);
    if (!b.name?.trim()) throw new HttpError(400, 'Give the rule a name');
    const vals = [b.name.trim(), b.enabled !== false, +b.position || 0, JSON.stringify(b.clips || { mode: 'all' }), JSON.stringify(b.match || {}), Math.max(1, Math.min(6, +b.count || 1))];
    if (b.id) return q1('update preroll_rules set name=$1, enabled=$2, position=$3, clips=$4::jsonb, match=$5::jsonb, count=$6 where id=$7 returning *', [...vals, b.id]);
    return q1('insert into preroll_rules (name, enabled, position, clips, match, count) values ($1,$2,$3,$4::jsonb,$5::jsonb,$6) returning *', vals);
  }, admin);
  r.delete('/api/studio/prerolls/rules/:id', async ({ params }) => { await q('delete from preroll_rules where id=$1', [params.id]); return { ok: true }; }, admin);

  // ----- profiles
  r.get('/api/studio/profiles', async () => (await q('select * from profiles order by id')).map(publicProfile), admin);
  r.post('/api/studio/profiles', async ({ req, profile }) => {
    const b = await readJson(req);
    const name = String(b.name || '').trim();
    if (!name) throw new HttpError(400, 'A profile needs a name');
    if (b.password !== undefined && String(b.password).length < 4) throw new HttpError(400, 'Use a password or PIN of at least 4 characters');
    try {
      if (b.id) {
        if (b.id === profile.id && b.admin === false) throw new HttpError(400, 'You cannot remove your own admin access');
        const cur = await q1('select * from profiles where id=$1', [b.id]);
        if (!cur) throw new HttpError(404, 'Profile not found');
        return publicProfile(await q1('update profiles set name=$1, is_admin=$2, avatar=$3, color=$4, pass=$5 where id=$6 returning *',
          [name, b.admin ?? cur.is_admin, b.avatar ?? cur.avatar, b.color ?? cur.color, b.password ? hashPassword(b.password) : cur.pass, b.id]));
      }
      if (!b.password) throw new HttpError(400, 'Use a password or PIN of at least 4 characters');
      return publicProfile(await q1('insert into profiles (name, pass, is_admin, avatar, color) values ($1,$2,$3,$4,$5) returning *',
        [name, hashPassword(b.password), !!b.admin, b.avatar || null, b.color || null]));
    } catch (e) { if (e.code === '23505') throw new HttpError(400, 'That name is already taken'); throw e; }
  }, admin);
  r.delete('/api/studio/profiles/:id', async ({ params, profile }) => {
    if (+params.id === profile.id) throw new HttpError(400, 'You cannot delete the profile you are signed in with');
    await q('delete from profiles where id=$1', [params.id]);
    return { ok: true };
  }, admin);

  // ----- plugins
  r.get('/api/studio/plugins', async () => plugins.listPlugins(), admin);
  r.post('/api/studio/plugins', async ({ req }) => ({ id: await plugins.installZip(await readBody(req, 60e6)) }), admin);
  r.put('/api/studio/plugins/:id', async ({ req, params }) => { await plugins.setEnabled(params.id, (await readJson(req)).enabled); return { ok: true }; }, admin);
  r.delete('/api/studio/plugins/:id', async ({ params }) => { await plugins.removePlugin(params.id); return { ok: true }; }, admin);
}
