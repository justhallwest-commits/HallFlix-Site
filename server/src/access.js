// Menu access: what each profile can reach from the menu — which libraries, and features like Search, Timeline,
// My HallFlix, Surprise me, the remote and the year in review. Set by an admin in Studio → Profiles. Admins always see
// everything. A library turned off is locked, not just hidden: its titles leave Home, search and every list, and
// opening one directly answers "not found" (through the same filter parental controls use).
import { q, getSetting, setSetting } from './db.js';
import { readJson } from './http.js';

/** Menu features an admin can turn off, in the order the Studio lists them. Home and Switch profile always stay. */
export const FEATURES = [
  ['search', 'Search', 'The search box and voice search'],
  ['surprise', 'Surprise me', 'The dice button that picks something at random'],
  ['timeline', 'Timeline', 'Browse by decade'],
  ['me', 'My HallFlix', 'Their stats, history and playlists page'],
  ['remote', 'Remote', 'Using a phone as a remote for another screen'],
  ['wrapped', 'Year in review', 'Their year in review'],
  ['editProfile', 'Edit their profile', 'Changing their own name, picture and colour'],
];
const KEYS = new Set(FEATURES.map((f) => f[0]));
// API routes behind each feature, refused when it's off (the menu hides them too).
const ROUTES = { search: /^\/api\/search(\/|$)/, surprise: /^\/api\/surprise(\/|$)/, timeline: /^\/api\/timeline(\/|$)/, wrapped: /^\/api\/wrapped(\/|$)/,
  editProfile: /^\/api\/profiles\/(me$|\d+\/avatar)/ };
const WRITE_ONLY = new Set(['editProfile']); // reading your own profile is fine; changing it isn't

let version = 0;
export const changed = () => { version++; };
export const currentVersion = () => version;

async function all() { return (await getSetting('menuAccess', null)) || {}; }

/** What a profile can't reach: { libraries: [ids], off: [feature keys] }. Empty for admins and unrestricted profiles. */
export async function forProfile(profile) {
  if (!profile || profile.is_admin || profile.admin) return { libraries: [], off: [] };
  const a = (await all())[profile.id] || {};
  return { libraries: (a.libraries || []).map(Number), off: (a.off || []).filter((k) => KEYS.has(k)) };
}

/** Refuse a feature's API when it's off for this profile. */
export function refuse(method, pathname, rules) {
  for (const k of rules.off) if (ROUTES[k]?.test(pathname) && (!WRITE_ONLY.has(k) || method !== 'GET')) return true;
  return false;
}

/** The library an API path opens directly (/api/library/3, /api/comics/3, /api/music/3), if any. */
export function libraryOf(pathname) {
  const m = /^\/api\/(library|comics|music)\/(\d+)(\/|$)/.exec(pathname);
  return m ? +m[2] : null;
}

const cache = new Map(); // "1,4" -> { version, ids:Set }
/** Every item in some libraries (titles, seasons, episodes, issues, songs), for hiding. */
export async function itemsIn(libraryIds) {
  const key = [...libraryIds].sort((a, b) => a - b).join(',');
  const hit = cache.get(key);
  if (hit && hit.version === version && Date.now() - hit.at < 5 * 60e3) return hit.ids;
  const ids = new Set((await q('select id from items where library_id = any($1::int[])', [libraryIds])).map((r) => +r.id));
  if (cache.size > 30) cache.clear();
  cache.set(key, { version, at: Date.now(), ids });
  return ids;
}

export function routes(r) {
  const admin = { admin: true };
  r.get('/api/studio/access', async () => ({
    features: FEATURES.map(([key, name, about]) => ({ key, name, about })),
    libraries: await q(`select id, name, kind from libraries where kind <> 'prerolls' order by position, id`),
    profiles: await q('select id, name, is_admin as admin, avatar, color from profiles order by id'),
    access: await all(),
  }), admin);
  r.put('/api/studio/access', async ({ req }) => {
    const b = await readJson(req);
    const libs = new Set((await q('select id from libraries')).map((x) => +x.id));
    const admins = new Set((await q('select id from profiles where is_admin')).map((x) => +x.id));
    const out = {};
    for (const [id, v] of Object.entries(b.access || {})) {
      if (!/^\d+$/.test(id) || admins.has(+id)) continue;
      const libraries = [...new Set((v?.libraries || []).map(Number))].filter((x) => libs.has(x));
      const off = [...new Set((v?.off || []).map(String))].filter((k) => KEYS.has(k));
      if (libraries.length || off.length) out[id] = { libraries, off };
    }
    await setSetting('menuAccess', out);
    changed();
    return { ok: true, access: out };
  }, admin);
}

