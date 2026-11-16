// Removing titles. Two ways, both admin-only:
//  - hide: HallFlix forgets the title and skips it on every rescan; the files stay on the NAS. Can be undone.
//  - delete: the files are removed from the NAS. Only possible when the media share is mounted writable.
import fs from 'node:fs';
import path from 'node:path';
import { cfg } from './config.js';
import { q, q1 } from './db.js';
import { HttpError } from './http.js';
import * as names from './names.js';
import * as scan from './scan.js';

const admin = { admin: true };

/** Is `p` inside `root` (and not `root` itself)? */
const within = (root, p) => { const r = path.resolve(root), x = path.resolve(p); return x !== r && x.startsWith(r + path.sep); };

export async function writable(dir) {
  try { await fs.promises.access(dir, fs.constants.W_OK); return true; } catch { return false; }
}

async function walkAll(dir, out = []) {
  let list = [];
  try { list = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of list) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await walkAll(p, out);
    else { try { out.push({ path: p, size: (await fs.promises.stat(p)).size }); } catch { /* gone */ } }
  }
  return out;
}

/** Files beside a video that belong to it: "Movie (2020).en.srt", "Movie (2020)-poster.jpg", "Movie (2020).nfo". */
async function sidecars(file) {
  const dir = path.dirname(file), stem = path.basename(file, path.extname(file));
  let list = [];
  try { list = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return []; }
  return list.filter((e) => e.isFile() && e.name !== path.basename(file) && (e.name.startsWith(`${stem}.`) || e.name.startsWith(`${stem}-`)) && !names.isVideo(e.name))
    .map((e) => path.join(dir, e.name));
}

/** Does this folder hold any other real video (not an extra or sample) besides `except`? */
async function otherVideos(dir, except) {
  const all = await walkAll(dir);
  return all.some((f) => names.isVideo(f.path) && !except.has(f.path) && !names.skipFile(path.basename(f.path))
    && !path.relative(dir, path.dirname(f.path)).split(path.sep).some((part) => part && names.skipDir(part)));
}

/** Work out exactly what deleting an item would remove: whole folders where a folder belongs only to it, otherwise files. */
export async function plan(item) {
  const lib = await q1('select id, name, path, kind from libraries where id=$1', [item.library_id]);
  if (!lib) throw new HttpError(404, 'Library not found');
  const targets = []; // { path, folder }
  const fileSet = async (file) => { targets.push({ path: file, folder: false }); for (const s of await sidecars(file)) targets.push({ path: s, folder: false }); };
  if (item.kind === 'movie') {
    const dir = path.dirname(item.path);
    if (within(lib.path, dir) && !(await otherVideos(dir, new Set([item.path])))) targets.push({ path: dir, folder: true });
    else await fileSet(item.path);
  } else if (item.kind === 'episode') {
    await fileSet(item.path);
  } else if (item.kind === 'show') {
    targets.push({ path: item.path, folder: true });
  } else if (item.kind === 'season') {
    const eps = await q(`select path from items where parent_id=$1 and kind='episode' and path is not null`, [item.id]);
    const dirs = [...new Set(eps.map((e) => path.dirname(e.path)))];
    const show = await q1('select path from items where id=$1', [item.show_id]);
    if (dirs.length === 1 && show && within(show.path, dirs[0]) && !(await otherVideos(dirs[0], new Set(eps.map((e) => e.path))))) targets.push({ path: dirs[0], folder: true });
    else for (const e of eps) await fileSet(e.path);
  } else throw new HttpError(400, 'This kind of item cannot be removed here');
  // Never anything outside the library, and never the library folder itself.
  for (const t of targets) if (!within(lib.path, t.path) || !within(cfg.mediaRoot, t.path)) throw new HttpError(400, `Refusing to touch ${t.path}: it is outside the library folder`);
  let size = 0, files = 0;
  for (const t of targets) {
    if (t.folder) { const all = await walkAll(t.path); files += all.length; size += all.reduce((a, f) => a + f.size, 0); }
    else { try { size += (await fs.promises.stat(t.path)).size; files++; } catch { /* already gone */ } }
  }
  return { library: lib, targets, files, size, canDelete: await writable(lib.path) };
}

async function getItem(id) {
  const item = await q1('select id, library_id, kind, title, path, show_id, parent_id, season_no from items where id=$1', [id]);
  if (!item || item.kind === 'clip') throw new HttpError(404, 'Not found');
  return item;
}
const label = async (item) => {
  if (item.kind === 'episode' || item.kind === 'season') {
    const show = await q1('select title from items where id=$1', [item.show_id]);
    return `${show?.title || ''} · ${item.kind === 'season' ? item.title : item.title}`;
  }
  return item.title;
};

/** Forget the item in the database, and tidy up seasons or shows left empty. */
async function forget(item) {
  await q('delete from items where id=$1', [item.id]);
  if (item.show_id && item.kind !== 'show') {
    await q(`delete from items s where s.show_id=$1 and s.kind='season' and not exists (select 1 from items e where e.parent_id=s.id)`, [item.show_id]);
    const left = await q1(`select count(*)::int as n from items where show_id=$1 and kind='episode'`, [item.show_id]);
    if (!left.n) await q('delete from items where id=$1', [item.show_id]);
  }
}

export function routes(r) {
  r.get('/api/studio/items/:id/remove', async ({ params }) => {
    const item = await getItem(params.id);
    const p = await plan(item);
    return {
      id: item.id, kind: item.kind, title: await label(item), library: p.library.name,
      canDelete: p.canDelete, files: p.files, size: p.size,
      targets: p.targets.map((t) => ({ path: t.path, folder: t.folder })),
    };
  }, admin);

  r.post('/api/studio/items/:id/hide', async ({ params }) => {
    const item = await getItem(params.id);
    const paths = item.kind === 'season'
      ? (await q(`select path from items where parent_id=$1 and kind='episode' and path is not null`, [item.id])).map((e) => e.path)
      : [item.path];
    const title = await label(item);
    for (const p of paths.filter(Boolean)) {
      await q(`insert into hidden (library_id, path, title, kind) values ($1,$2,$3,$4) on conflict (path) do nothing`, [item.library_id, p, title, item.kind]);
    }
    await forget(item);
    return { ok: true, title };
  }, admin);

  r.post('/api/studio/items/:id/delete', async ({ params }) => {
    const item = await getItem(params.id);
    const p = await plan(item);
    if (!p.canDelete) throw new HttpError(409, 'The media folder is shared with HallFlix as read-only, so files cannot be deleted. See “Deleting files” in the install guide.');
    const title = await label(item);
    const failed = [];
    for (const t of p.targets) {
      try { await fs.promises.rm(t.path, { recursive: t.folder, force: true }); } catch (e) { failed.push(`${t.path}: ${e.code || e.message}`); }
    }
    if (failed.length) throw new HttpError(500, `Some files could not be deleted: ${failed.slice(0, 3).join('; ')}`);
    await forget(item);
    console.log(`[delete] ${title}: removed ${p.files} file(s), ${p.targets.map((t) => t.path).join(', ')}`);
    return { ok: true, title, files: p.files, size: p.size };
  }, admin);

  r.get('/api/studio/hidden', async () => q(`select h.id, h.title, h.kind, h.path, h.hidden_at, l.name as library from hidden h left join libraries l on l.id = h.library_id order by h.hidden_at desc`), admin);

  r.delete('/api/studio/hidden/:id', async ({ params }) => {
    const row = await q1('delete from hidden where id=$1 returning library_id, title', [params.id]);
    if (!row) throw new HttpError(404, 'Not found');
    // Restoring a show or season brings back every hidden episode with the same title.
    await q('delete from hidden where library_id=$1 and title=$2', [row.library_id, row.title]);
    scan.startScan(row.library_id);
    return { ok: true, title: row.title };
  }, admin);
}
