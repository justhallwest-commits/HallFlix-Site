// Studio API: everything the admin panel changes. Every route here requires an admin profile.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { clearClips } from './clips.js';
import { cfg } from './config.js';
import { q, q1, getSetting, setSetting } from './db.js';
import { HttpError, readJson, readBody } from './http.js';
import { hashPassword, publicProfile } from './auth.js';
import * as scan from './scan.js';
import * as tmdb from './tmdb.js';
import * as look from './look.js';
import * as plugins from './plugins.js';
import { checkTheme } from './themespec.js';
import { MOBILE_QUALITIES } from './playback.js';
import { IMAGE_EXT, isVideo } from './names.js';

/**
 * The Android app's home address, tidied to just "http(s)://host:port". "" turns it off; null means it isn't an address.
 * "100.117.23.98:8780" → "http://100.117.23.98:8780".
 */
export function directOrigin(raw) {
  let s = String(raw ?? '').trim().replace(/\/+$/, '');
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) s = 'http://' + s;
  try {
    const u = new URL(s);
    if (!u.hostname || u.username || u.password) return null;
    return u.origin;
  } catch { return null; }
}

const AUDIO_EXT = ['mp3', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'wav', 'flac'];
import { img } from './catalog.js';

const admin = { admin: true };
const KINDS = ['movies', 'shows', 'books', 'comics', 'music', 'prerolls'];

function insideMedia(p) {
  const full = path.resolve(String(p || cfg.mediaRoot));
  const root = path.resolve(cfg.mediaRoot);
  if (full !== root && !full.startsWith(root + path.sep)) throw new HttpError(400, `Choose a folder inside ${root}`);
  return full;
}

export function routes(r) {
  r.get('/api/studio/overview', async () => {
    const counts = await q(`select l.id, l.name, l.kind, l.path, l.position, l.look,
        (select count(*)::int from items i where i.library_id = l.id and i.kind in ('movie','show','clip','book','series','album')) as titles,
        (select count(*)::int from items i where i.library_id = l.id and i.kind in ('episode','comic','track')) as episodes,
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
  // Backdrops already in a library, to pick one as the library's background.
  r.get('/api/studio/libraries/:id/backdrops', async ({ params }) => {
    const rows = await q(`select distinct on (backdrop) id, title, backdrop from items where library_id=$1 and backdrop is not null
      and kind not in ('episode','season','track') order by backdrop, added_at desc limit 300`, [params.id]);
    rows.sort(() => Math.random() - 0.5);
    return rows.slice(0, 48).map((r) => ({ id: r.id, title: r.title, thumb: img(r.backdrop, 'w300'), url: img(r.backdrop, 'w1280') }));
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
    return { tmdbKey: key ? `${key.slice(0, 4)}…${key.slice(-4)}` : '', hasTmdb: !!key, prerolls: await getSetting('prerolls', {}), showProfilesOnLogin: await getSetting('showProfilesOnLogin', true), mobileQuality: String(await getSetting('mobileQuality', 720)), directUrl: await getSetting('directUrl', cfg.directUrl) };
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
    if (b.mobileQuality != null && MOBILE_QUALITIES.includes(+b.mobileQuality)) await setSetting('mobileQuality', +b.mobileQuality);
    if (typeof b.directUrl === 'string') {
      const d = directOrigin(b.directUrl);
      if (d === null) return { ok: false, error: 'The home address should look like http://100.117.23.98:8780' };
      await setSetting('directUrl', d);
    }
    if (b.prerolls) await setSetting('prerolls', { ...(await getSetting('prerolls', {})), enabled: b.prerolls.enabled !== false, max: Math.max(0, Math.min(6, +b.prerolls.max || 0)), onResume: !!b.prerolls.onResume });
    if (b.showProfilesOnLogin !== undefined) await setSetting('showProfilesOnLogin', !!b.showProfilesOnLogin);
    return { ok: true };
  }, admin);

  // ----- look
  r.get('/api/studio/look', async () => ({
    defaults: look.DEFAULT_THEME, theme: await getSetting('theme', {}), options: look.OPTIONS, dateRules: look.DATE_RULES, fastTv: look.FAST_TV,
    presets: [...look.PRESETS, ...(await plugins.listPlugins()).filter((p) => p.enabled).flatMap((p) => p.themes)],
    seasons: await q('select * from seasons order by starts, id'),
    // Each library with a recent picture from it, for the Studio's mini tiles (where logos are dragged into place).
    libraries: (await q(`select l.id, l.name, l.kind, l.look,
        (select i.backdrop from items i where i.library_id = l.id and i.backdrop is not null order by i.added_at desc, i.id desc limit 1) as art
      from libraries l where l.kind <> 'prerolls' order by l.position, l.id`)).map(({ art, ...l }) => ({ ...l, art: img(art, 'w780') })),
    active: (await look.currentLook()).season,
  }), admin);
  r.put('/api/studio/theme', async ({ req }) => {
    // Checked against the theme contract before it is saved: what the apps read is always something they can draw.
    const { theme, problems } = checkTheme((await readJson(req)).theme || {}, { unknown: 'keep' });
    const before = (await getSetting('theme', {})).heroClips || {};
    await setSetting('theme', theme);
    // New clip window or length: the old clips no longer fit, so they are made again as the banner asks for them.
    const after = theme.heroClips || {};
    if (['start', 'end', 'length'].some((k) => (before[k] ?? null) !== (after[k] ?? null))) clearClips();
    return { ok: true, theme, problems };
  }, admin);
  r.post('/api/studio/look/preview', async ({ req }) => {
    const b = await readJson(req);
    const libraries = (await q('select id, look from libraries')).map((l) => (b.libraries?.[l.id] ? { id: l.id, look: b.libraries[l.id] } : l));
    let seasons = await q('select * from seasons order by id');
    if (b.season) { seasons = seasons.filter((s) => s.id !== b.season.id); seasons.push({ ...b.season, id: b.season.id ?? -1, enabled: true }); }
    return look.resolve({ theme: b.theme ?? (await getSetting('theme', {})), libraries, seasons, forceSeason: b.season ? b.season.id ?? -1 : b.noSeason ? -2 : null });
  }, admin);
  r.post('/api/studio/seasons', async ({ req }) => {
    const b = await readJson(req);
    if (!b.name?.trim() || !look.validDate(b.starts) || !look.validDate(b.ends)) throw new HttpError(400, 'A season needs a name, a start date and an end date');
    if (b.look?.theme) b.look = { ...b.look, theme: checkTheme(b.look.theme, { unknown: 'keep' }).theme };
    if (b.id) return q1('update seasons set name=$1, starts=$2, ends=$3, enabled=$4, look=$5::jsonb where id=$6 returning *', [b.name.trim(), b.starts, b.ends, b.enabled !== false, JSON.stringify(b.look || {}), b.id]);
    return q1('insert into seasons (name, starts, ends, enabled, look) values ($1,$2,$3,$4,$5::jsonb) returning *', [b.name.trim(), b.starts, b.ends, b.enabled !== false, JSON.stringify(b.look || {})]);
  }, admin);
  r.delete('/api/studio/seasons/:id', async ({ params }) => { await q('delete from seasons where id=$1', [params.id]); return { ok: true }; }, admin);

  // Upload an image (or a short looping video) for backgrounds and logos, or a sound or song for the sound effects and
  // sign-in music. The body is the raw file.
  r.post('/api/studio/upload', async ({ req, query }) => {
    const e = path.extname(String(query.name || '')).slice(1).toLowerCase();
    if (![...IMAGE_EXT, 'mp4', 'webm', ...AUDIO_EXT].includes(e)) throw new HttpError(400, 'Upload a picture (JPG, PNG, WebP, GIF), a video (MP4, WebM) or a sound (MP3, M4A, OGG, WAV, FLAC)');
    const buf = await readBody(req, 250e6);
    if (!buf.length) throw new HttpError(400, 'Empty file');
    const name = `${crypto.createHash('sha1').update(buf).digest('hex').slice(0, 16)}.${e}`;
    const dir = path.join(cfg.dataDir, 'uploads');
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(path.join(dir, name), buf);
    return { url: `/uploads/${name}` };
  }, admin);
  // Songs from the music library, for the sign-in music: find them, then copy one beside the other uploads so the
  // sign-in page (which has no session yet) can play it. Formats a browser can't play are converted to MP3 once.
  r.get('/api/studio/songs', async ({ query }) => {
    const like = `%${String(query.q || '').trim().replace(/[%_\\]/g, '\\$&')}%`;
    const rows = await q(`select t.id, t.title, coalesce(t.author, ar.title) as artist, al.title as album, t.runtime_s from items t
        left join items al on al.id = t.parent_id left join items ar on ar.id = t.show_id
      where t.kind = 'track' and (t.title ilike $1 or t.author ilike $1 or al.title ilike $1 or ar.title ilike $1)
      order by (t.title ilike $1) desc, t.sort_title limit 30`, [like]);
    return { songs: rows.map((x) => ({ id: +x.id, title: x.title, artist: x.artist || '', album: x.album || '', seconds: Math.round(x.runtime_s || 0) })) };
  }, admin);
  r.post('/api/studio/songs/:id/use', async ({ params }) => {
    const t = await q1(`select t.id, t.title, t.path, t.mtime, coalesce(t.author, ar.title) as artist from items t left join items ar on ar.id = t.show_id where t.id = $1 and t.kind = 'track'`, [params.id]);
    if (!t?.path) throw new HttpError(404, 'That song is not in the music library');
    const src = path.extname(t.path).slice(1).toLowerCase();
    const plays = ['mp3', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'wav', 'flac'].includes(src);
    const ext = plays ? src : 'mp3';
    const name = `song-${crypto.createHash('sha1').update(`${t.path}:${t.mtime}`).digest('hex').slice(0, 16)}.${ext}`;
    const dir = path.join(cfg.dataDir, 'uploads'), out = path.join(dir, name);
    await fs.promises.mkdir(dir, { recursive: true });
    if (!fs.existsSync(out)) {
      if (plays) await fs.promises.copyFile(t.path, out);
      else {
        await new Promise((resolve, reject) => {
          const ff = spawn(cfg.ffmpeg || 'ffmpeg', ['-v', 'error', '-y', '-i', t.path, '-vn', '-c:a', 'libmp3lame', '-b:a', '192k', `${out}.part.mp3`]);
          ff.on('error', reject);
          ff.on('close', (code) => (code === 0 ? resolve() : reject(new HttpError(500, 'The song could not be converted'))));
        });
        await fs.promises.rename(`${out}.part.mp3`, out);
      }
    }
    return { url: `/uploads/${name}`, name: [t.artist, t.title].filter(Boolean).join(' – ') };
  }, admin);
  // Use a picture that already lives on the NAS.
  r.post('/api/studio/pick', async ({ req }) => {
    const file = insideMedia((await readJson(req)).path);
    return { url: img(`local:${file}`) };
  }, admin);

  // ----- profiles
  // (The list of profiles, with activity, lives in profiles.js.)
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
