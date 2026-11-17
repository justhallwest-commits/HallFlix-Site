// Profiles: pictures, editing your own profile, and the admin tools for managing everyone
// (last active, signed-in devices, sign out everywhere, clear history).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cfg } from './config.js';
import { q, q1 } from './db.js';
import { HttpError, readJson, readBody } from './http.js';
import { publicProfile, tokenFrom } from './auth.js';
import { imageSize } from './archive.js';

const exec = promisify(execFile);
const admin = { admin: true };
const avatarDir = () => path.join(cfg.dataDir, 'uploads', 'avatars');
const COLOR = /^#[0-9a-f]{6}$/i;

function mayEdit(me, id) {
  if (!me.is_admin && me.id !== id) throw new HttpError(403, 'You can only change your own profile');
}

/** Any picture becomes a 512 × 512 JPEG with nothing else inside it (no location or camera data). */
async function saveAvatar(buf, id) {
  const size = imageSize(buf);
  if (!size || size[0] < 16 || size[1] < 16) throw new HttpError(400, 'Use a JPG, PNG, WebP or GIF picture');
  if (size[0] * size[1] > 80e6) throw new HttpError(400, 'That picture is too large');
  const dir = avatarDir();
  await fs.promises.mkdir(dir, { recursive: true });
  const name = `${id}-${crypto.createHash('sha1').update(buf).digest('hex').slice(0, 12)}.jpg`;
  const tmp = path.join(dir, `.${name}.${process.pid}.in`);
  await fs.promises.writeFile(tmp, buf);
  try {
    await exec(cfg.ffmpeg, ['-v', 'error', '-nostdin', '-y', '-i', tmp, '-vf', 'scale=512:512:force_original_aspect_ratio=increase:flags=lanczos,crop=512:512', '-frames:v', '1', '-q:v', '3',
      '-map_metadata', '-1', '-f', 'mjpeg', path.join(dir, `${name}.part`)], { timeout: 60e3 });
    await fs.promises.rename(path.join(dir, `${name}.part`), path.join(dir, name));
  } catch { throw new HttpError(400, 'That picture could not be read'); } finally { fs.promises.rm(tmp, { force: true }).catch(() => {}); }
  return `/uploads/avatars/${name}`;
}

/** Remove a picture HallFlix stored, once no profile uses it. */
async function dropAvatar(url) {
  if (!url || !url.startsWith('/uploads/avatars/')) return;
  if (await q1('select 1 from profiles where avatar=$1', [url])) return;
  await fs.promises.rm(path.join(avatarDir(), path.basename(url)), { force: true }).catch(() => {});
}

export function routes(r) {
  // A new picture for a profile: the raw image is the body. Admins can change anyone's; others only their own.
  r.post('/api/profiles/:id/avatar', async ({ req, profile, params }) => {
    const id = +params.id;
    mayEdit(profile, id);
    const cur = await q1('select * from profiles where id=$1', [id]);
    if (!cur) throw new HttpError(404, 'Profile not found');
    const url = await saveAvatar(await readBody(req, 15e6), id);
    const out = await q1('update profiles set avatar=$1 where id=$2 returning *', [url, id]);
    if (cur.avatar !== url) await dropAvatar(cur.avatar);
    return publicProfile(out);
  });
  r.delete('/api/profiles/:id/avatar', async ({ profile, params }) => {
    const id = +params.id;
    mayEdit(profile, id);
    const cur = await q1('select * from profiles where id=$1', [id]);
    if (!cur) throw new HttpError(404, 'Profile not found');
    const out = await q1('update profiles set avatar=null where id=$1 returning *', [id]);
    await dropAvatar(cur.avatar);
    return publicProfile(out);
  });

  // Your own profile: name and colour (pictures above, password at /api/password).
  r.get('/api/profiles/me', async ({ profile, req, query }) => {
    const sessions = await q('select count(*)::int as n from sessions where profile_id=$1', [profile.id]);
    return { ...publicProfile(profile), devices: sessions[0].n, current: !!tokenFrom({ req, query }) };
  });
  r.put('/api/profiles/me', async ({ profile, req }) => {
    const b = await readJson(req);
    const name = b.name === undefined ? profile.name : String(b.name).trim();
    if (!name) throw new HttpError(400, 'A profile needs a name');
    if (name.length > 40) throw new HttpError(400, 'Use a shorter name');
    const color = b.color === undefined ? profile.color : b.color && COLOR.test(b.color) ? b.color : null;
    try { return publicProfile(await q1('update profiles set name=$1, color=$2 where id=$3 returning *', [name, color, profile.id])); }
    catch (e) { if (e.code === '23505') throw new HttpError(400, 'That name is already taken'); throw e; }
  });
  r.post('/api/profiles/me/signout-others', async ({ profile, req, query }) => {
    const token = tokenFrom({ req, query });
    await q('delete from sessions where profile_id=$1 and token<>$2', [profile.id, token || '']);
    return { ok: true };
  });

  // ----- admin
  // Everyone, with when they were last active, how many devices are signed in and how much they've finished.
  r.get('/api/studio/profiles', async () => {
    const rows = await q(`select p.*, (select max(seen_at) from sessions s where s.profile_id = p.id) as seen,
        (select count(*)::int from sessions s where s.profile_id = p.id) as devices,
        (select count(*)::int from progress g join items i on i.id = g.item_id where g.profile_id = p.id and g.watched and i.kind in ('movie','episode')) as watched,
        (select count(*)::int from progress g join items i on i.id = g.item_id where g.profile_id = p.id and g.watched and i.kind in ('book','comic')) as read
      from profiles p order by p.id`);
    return rows.map((p) => ({ ...publicProfile(p), seen: p.seen, created: p.created_at, devices: p.devices, watched: p.watched, read: p.read }));
  }, admin);
  r.post('/api/studio/profiles/:id/signout', async ({ params, profile, req, query }) => {
    const keep = +params.id === profile.id ? tokenFrom({ req, query }) || '' : '';
    await q('delete from sessions where profile_id=$1 and token<>$2', [params.id, keep]);
    return { ok: true };
  }, admin);
  r.post('/api/studio/profiles/:id/clear', async ({ params }) => {
    if (!(await q1('select 1 from profiles where id=$1', [params.id]))) throw new HttpError(404, 'Profile not found');
    await q('delete from progress where profile_id=$1', [params.id]);
    return { ok: true };
  }, admin);
}
