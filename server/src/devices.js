// Studio → Devices: every signed-in device, what it is, which app version, how it connects, and signing it out.
// Studio → Health: disk space, scans, the transcoder, and whether HallFlix's addresses answer.
import fs from 'node:fs';
import { q, q1, getSetting } from './db.js';
import { cfg } from './config.js';
import { status as scanStatus } from './scan.js';

const admin = { admin: true };

/** "Fire TV app 1.4", "Android phone app 1.4", "Chrome on Windows", "Roku"… from a user agent. */
export function describe(ua = '') {
  const app = /HallFlixApp\/([\w.]+)/.exec(ua)?.[1] || null;
  let kind = 'other', name = 'A browser';
  if (/Roku/i.test(ua)) { kind = 'tv'; name = 'Roku'; }
  else if (/AFT\w*/.test(ua)) { kind = 'tv'; name = 'Fire TV'; }
  else if (/Android TV|GoogleTV|BRAVIA|AndroidTV/i.test(ua)) { kind = 'tv'; name = 'Android TV'; }
  else if (/Tizen|Web0S|SmartTV/i.test(ua)) { kind = 'tv'; name = 'Smart TV'; }
  else if (/iPhone|iPod/.test(ua)) { kind = 'phone'; name = 'iPhone'; }
  else if (/iPad/.test(ua)) { kind = 'tablet'; name = 'iPad'; }
  else if (/Android/.test(ua)) { kind = /Mobile/.test(ua) || app ? 'phone' : 'tablet'; name = /Mobile/.test(ua) || app ? 'Android phone' : 'Android tablet'; }
  else if (/Windows/.test(ua)) { kind = 'computer'; name = 'Windows'; }
  else if (/Macintosh|Mac OS X/.test(ua)) { kind = 'computer'; name = 'Mac'; }
  else if (/Linux|CrOS/.test(ua)) { kind = 'computer'; name = /CrOS/.test(ua) ? 'Chromebook' : 'Linux'; }
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : '';
  const label = app ? `${name} app` : kind === 'tv' && name === 'Roku' ? 'Roku channel' : browser ? `${browser} on ${name}` : name;
  return { kind, name, label, app, browser };
}

/** Does an address answer as HallFlix? Asked from the server, so a device's own network may differ. */
async function answers(url) {
  if (!url) return { url, ok: null };
  const t0 = Date.now();
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    const r = await fetch(url.replace(/\/+$/, '') + '/api/hello', { signal: ctrl.signal });
    clearTimeout(timer);
    const j = await r.json().catch(() => ({}));
    return { url, ok: r.ok && j.hallflix === true, ms: Date.now() - t0, status: r.status };
  } catch (e) {
    return { url, ok: false, error: e.name === 'AbortError' ? 'no answer in 4 seconds' : String(e.cause?.code || e.message || e) };
  }
}

function disk(dir) {
  try {
    const s = fs.statfsSync(dir);
    return { path: dir, total: s.blocks * s.bsize, free: s.bavail * s.bsize };
  } catch (e) { return { path: dir, error: e.code === 'ENOENT' ? 'folder not found' : String(e.message || e) }; }
}

export function routes(r) {
  r.get('/api/studio/devices', async ({ req }) => {
    const rows = await q(`select md5(s.token) as id, s.device, s.ua, s.via, s.ip, s.created_at, s.seen_at, p.id as profile_id, p.name as profile
      from sessions s join profiles p on p.id = s.profile_id order by s.seen_at desc`);
    const mine = /(?:^|;\s*)hf_token=([^;]+)/.exec(req.headers.cookie || '')?.[1] || (req.headers.authorization || '').replace(/^Bearer /, '');
    const mineId = mine ? (await q1('select md5($1::text) as id', [mine])).id : null;
    const devices = rows.map((d) => ({ ...describe(d.ua || d.device || ''), id: d.id, profile: d.profile, profileId: d.profile_id, via: d.via || null, ip: d.ip || null,
      signedIn: d.created_at, seen: d.seen_at, current: d.id === mineId }));
    const versions = devices.map((d) => d.app).filter(Boolean).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    return { devices, newestApp: versions[0] || null };
  }, admin);

  r.post('/api/studio/devices/:id/signout', async ({ params }) => {
    const n = (await q('delete from sessions where md5(token) = $1 returning 1', [String(params.id)])).length;
    return { ok: n > 0 };
  }, admin);

  r.get('/api/studio/health', async ({ req }) => {
    const libs = await q(`select l.id, l.name, l.kind, l.path, (select count(*)::int from items i where i.library_id = l.id and i.parent_id is null) as items from libraries l order by l.position, l.id`);
    // Where the Studio is open now, the home (Tailscale) address, and the public address if the Studio isn't on it.
    const here = `${req.headers['x-forwarded-proto'] || (req.headers['cf-ray'] ? 'https' : 'http')}://${req.headers.host}`;
    const direct = await getSetting('directUrl', cfg.directUrl);
    const publicUrl = cfg.publicUrl;
    const addresses = [...new Set([publicUrl, direct, here].filter(Boolean))];
    let transcoder;
    try {
      const ctrl = new AbortController(); setTimeout(() => ctrl.abort(), 3000);
      transcoder = { ok: true, ...(await (await fetch(cfg.transcoderUrl + '/status', { signal: ctrl.signal })).json()) };
    } catch (e) { transcoder = { ok: false, error: 'The transcoder is not answering' }; }
    const counts = await q1(`select count(*) filter (where kind = 'movie')::int as movies, count(*) filter (where kind = 'show')::int as shows,
      count(*) filter (where kind = 'episode')::int as episodes, count(*) filter (where kind in ('book','series'))::int as books, count(*) filter (where kind = 'track')::int as tracks from items`);
    const db = await q1('select pg_database_size(current_database())::bigint as size');
    return {
      version: cfg.version,
      uptime: Math.round(process.uptime()),
      memory: process.memoryUsage().rss,
      disks: [{ ...disk(cfg.dataDir), label: 'HallFlix data (pictures, uploads, cache)' }, ...libs.map((l) => ({ ...disk(l.path), label: l.name }))],
      libraries: libs.map((l) => ({ id: l.id, name: l.name, kind: l.kind, path: l.path, items: l.items, missing: !fs.existsSync(l.path) })),
      scan: { running: scanStatus.running, library: scanStatus.library, phase: scanStatus.phase, done: scanStatus.done, total: scanStatus.total, errors: scanStatus.errors.slice(0, 20), finishedAt: scanStatus.finishedAt },
      transcoder,
      addresses: await Promise.all(addresses.map(answers)),
      counts,
      database: Number(db?.size || 0),
      tmdb: !!(await getSetting('tmdbKey', '')) || !!process.env.TMDB_API_KEY,
    };
  }, admin);
}
