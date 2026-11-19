// Pre-rolls: which clips play before a title, and the Studio tools around them (clips, schedules, test, health, activity, backup).
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cfg } from './config.js';
import { q, q1, getSetting, setSetting } from './db.js';
import { HttpError, readJson, sendFile } from './http.js';
import { inRange, currentLook } from './look.js';
import * as loudness from './loudness.js';

const exec = promisify(execFile);
const admin = { admin: true };
export const DEFAULTS = { enabled: true, max: 2, onResume: false, order: 'shuffle', everyMinutes: 0, skipProfiles: [], maxSeconds: 0, tz: '', evenVolume: false, volumeOffset: 0 };
export async function settings() { return { ...DEFAULTS, ...((await getSetting('prerolls', {})) || {}) }; }

const lower = (list) => (list || []).map((x) => String(x).toLowerCase());

// ---------- Pre-roll tags: only the pre-roll tool uses them (not the metadata tags) ----------
/** Clips with their pre-roll tags: the sub-folders they sit in ("halloween/bump.mp4" → "halloween") plus tags typed in the Studio. */
const CLIPS = `select i.*, l.path as lib_path, coalesce((select array_agg(t.tag order by t.tag) from preroll_tags t where t.clip_id = i.id), '{}') as own_tags
  from items i left join libraries l on l.id = i.library_id where i.kind = 'clip'`;
export function folderTags(clip) {
  if (!clip.lib_path || !clip.path) return [];
  const rel = path.relative(clip.lib_path, path.dirname(clip.path));
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel.split(path.sep).filter(Boolean).map((t) => t.toLowerCase()) : [];
}
function withTags(c) {
  const folder = folderTags(c), own = c.own_tags || [];
  return { ...c, folderTags: folder, ownTags: own, tags: [...new Set([...folder, ...own])], lib_path: undefined, own_tags: undefined };
}
export async function loadClips(where = '', args = []) { return (await q(`${CLIPS} ${where}`, args)).map(withTags); }
const cleanTag = (t) => String(t ?? '').trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 40);
/** The wall-clock date and time in the chosen time zone (or the server's). */
export function wallClock(date = new Date(), tz = '') {
  if (!tz) return date;
  try { return new Date(date.toLocaleString('en-US', { timeZone: tz })); } catch { return date; }
}
const hm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
/** Days (0 = Sunday) and a time window; a window that crosses midnight counts its early hours as the evening before. */
export function inSchedule(m, d) {
  const days = (m.days || []).map(Number);
  let day = d.getDay();
  if (m.timeFrom && m.timeTo) {
    const t = hm(d), overnight = m.timeFrom > m.timeTo;
    const inside = overnight ? t >= m.timeFrom || t < m.timeTo : t >= m.timeFrom && t < m.timeTo;
    if (!inside) return false;
    if (overnight && t < m.timeTo) day = (day + 6) % 7;
  }
  return !days.length || days.includes(day);
}

/** Why a rule does or doesn't apply to a title. Null means it applies. */
function mismatch(rule, target, date) {
  const m = rule.match || {};
  if (m.kinds?.length && !m.kinds.includes(target.kind)) return `only before ${m.kinds.map((k) => (k === 'movie' ? 'movies' : 'episodes')).join(' and ')}`;
  if (m.libraries?.length && !m.libraries.map(Number).includes(target.library_id)) return 'a different library';
  if (m.genres?.length && !lower(m.genres).some((g) => lower(target.genres).includes(g))) return `needs genre ${m.genres.join(' or ')}`;
  if (m.studios?.length && !lower(m.studios).some((g) => lower(target.studios).includes(g))) return `needs studio ${m.studios.join(' or ')}`;
  if (m.ratings?.length && !lower(m.ratings).includes(String(target.rating || '').toLowerCase())) return `needs rating ${m.ratings.join(' or ')}`;
  if (m.title?.trim() && !String(target.title || '').toLowerCase().includes(m.title.trim().toLowerCase()) && !String(target.show_title || '').toLowerCase().includes(m.title.trim().toLowerCase())) return `title must contain “${m.title}”`;
  if (m.from && m.to && !inRange(m.from, m.to, date)) return 'outside its dates';
  if (!inSchedule(m, date)) return 'outside its days or hours';
  return null;
}

/**
 * Choose pre-roll clips for a title. Pure, so the rules can be tested without a database.
 * `deck` (optional) holds each rule's shuffle round: every clip plays once before any repeats.
 * Returns copies of the clips with `_rule` set to the rule that chose them.
 */
export function pickPrerolls(rules, clips, target, opts = {}, date = new Date(), rnd = Math.random, deck = null, log = null) {
  if (opts.enabled === false) return [];
  const max = opts.max ?? 2;
  const out = [];
  const usable = clips.filter((c) => !c.extra?.off && !(opts.maxSeconds > 0 && (c.runtime_s || 0) > opts.maxSeconds));
  const sorted = [...rules].sort((x, y) => x.position - y.position || x.id - y.id);
  for (const rule of sorted) {
    if (out.length >= max) { log?.push({ rule: rule.name, note: 'skipped: the clip limit was already reached' }); continue; }
    if (!rule.enabled) { log?.push({ rule: rule.name, note: 'off' }); continue; }
    const why = mismatch(rule, target, date);
    if (why) { log?.push({ rule: rule.name, note: `doesn't apply: ${why}` }); continue; }
    const sel = rule.clips || { mode: 'all' };
    const want = new Set([
      ...(sel.mode === 'match' ? [...((sel.on || ['genres']).includes('genres') ? lower(target.genres) : []), ...((sel.on || []).includes('studios') ? lower(target.studios) : []), ...((sel.on || []).includes('ratings') && target.rating ? [String(target.rating).toLowerCase()] : [])] : []),
    ]);
    let pool = usable.filter((cl) => !out.some((o) => o.id === cl.id) && (
      sel.mode === 'pick' ? (sel.ids || []).map(Number).includes(cl.id)
        : sel.mode === 'tag' ? lower(cl.tags).includes(String(sel.tag || '').toLowerCase())
          : sel.mode === 'match' ? lower(cl.tags).some((t) => want.has(t))
            : !(sel.untaggedOnly && cl.tags?.length)));
    if (!pool.length) { log?.push({ rule: rule.name, note: sel.mode === 'match' ? 'no clip is tagged with this title’s genre' : 'no usable clips for it' }); continue; }
    const before = out.length;
    for (let n = 0; n < (rule.count || 1) && pool.length && out.length < max; n++) {
      const pick = draw(pool, `rule:${rule.id}`, opts.order, rnd, deck);
      out.push({ ...pick, _rule: rule.name });
      pool = pool.filter((x) => x.id !== pick.id);
    }
    log?.push({ rule: rule.name, note: `plays ${out.slice(before).map((c) => c.title).join(', ')}` });
    if ((rule.stop || rule.match?.stop) && out.length > before) { for (const r of sorted.slice(sorted.indexOf(rule) + 1)) log?.push({ rule: r.name, note: `skipped: “${rule.name}” replaces the rules below it` }); break; }
  }
  return out;
}
/** Shuffle like a deck of cards: each clip once per round, and the last one played never opens the next round. */
function draw(pool, key, order, rnd, deck) {
  if (!deck || order === 'random') return pool[Math.floor(rnd() * pool.length)];
  const d = (deck[key] ||= { played: [], last: null });
  const ids = new Set(pool.map((c) => c.id));
  d.played = d.played.filter((id) => ids.has(id));
  let fresh = pool.filter((c) => !d.played.includes(c.id));
  if (!fresh.length) { d.played = []; fresh = pool.filter((c) => c.id !== d.last); if (!fresh.length) fresh = pool; }
  const pick = fresh[Math.floor(rnd() * fresh.length)];
  d.played.push(pick.id); d.last = pick.id; d.size = pool.length;
  return pick;
}

/** The clips to queue before `item` for `profile`, recorded as played. Called by /api/play. */
export async function forPlay(profile, item, resumeAt, { record = true, at = new Date(), log = null } = {}) {
  const s = await settings();
  const note = (t) => { log?.push({ note: t }); return []; };
  if (s.enabled === false) return note('Pre-rolls are switched off');
  if (item.kind === 'clip') return [];
  if (resumeAt >= 60 && !s.onResume) return note('Resuming part-way, and pre-rolls only play from the start');
  if (profile && (s.skipProfiles || []).map(Number).includes(profile.id)) return note(`${profile.name} is set to skip pre-rolls`);
  if (profile && s.everyMinutes > 0) {
    const last = await q1(`select played_at from preroll_plays where profile_id=$1 and played_at > $2 order by played_at desc limit 1`, [profile.id, new Date(at - s.everyMinutes * 60e3)]);
    if (last) return note(`${profile.name} saw a pre-roll ${Math.max(1, Math.round((at - new Date(last.played_at)) / 60e3))} min ago; the limit is one every ${s.everyMinutes} min`);
  }
  const rules = await q('select * from preroll_rules order by position, id');
  if (!rules.length) return note('There are no pre-roll rules yet');
  const clips = await loadClips('order by i.id');
  const target = { kind: item.kind, library_id: item.library_id, title: item.title, show_title: item.show_title,
    genres: item.genres?.length ? item.genres : item.show_genres, studios: item.studios?.length ? item.studios : item.show_studios, rating: item.rating || item.show_rating };
  const deck = (await getSetting('prerollDecks', {})) || {};
  const picked = pickPrerolls(rules, clips, target, s, wallClock(at, s.tz), Math.random, record ? deck : structuredClone(deck), log);
  if (s.evenVolume && picked.length) {
    const f = await loudness.featureLevel(item);
    log?.push({ note: `Even volume: ${item.kind === 'episode' ? 'the episode' : 'the movie'} is ${f.measured ? `about ${f.lufs} LUFS` : `not measured yet, so the usual level for films (${f.lufs} LUFS) is used`}` });
    for (const c of picked) {
      c._lufs = await loudness.known(c.path);
      if (c._lufs == null) loudness.want(c.path);
      c._gain = loudness.gainFor(c._lufs, f.lufs, s.volumeOffset);
    }
  }
  if (record && picked.length) {
    await setSetting('prerollDecks', deck);
    for (const c of picked) await q('insert into preroll_plays (profile_id, clip_id, item_id, rule) values ($1,$2,$3,$4)', [profile?.id || null, c.id, item.id, c._rule]);
    await q(`delete from preroll_plays where played_at < now() - interval '180 days'`);
  }
  return picked;
}

/** The volume (0.05 to 1) for another file played before `item`, such as the uploaded ident; null when not evening out. */
export async function volumeFor(file, item) {
  const s = await settings();
  if (!s.evenVolume || !file) return null;
  const lufs = await loudness.known(file);
  if (lufs == null) { loudness.want(file); return null; }
  return loudness.gainFor(lufs, (await loudness.featureLevel(item)).lufs, s.volumeOffset);
}
const identFiles = async () => {
  const id = (await currentLook()).theme?.ident || {};
  return [...new Set([...(Array.isArray(id.videos) ? id.videos.map((v) => (typeof v === 'string' ? v : v?.url)) : []), id.video])]
    .filter((u) => typeof u === 'string' && /^\/uploads\/[\w.-]+\.(mp4|webm)$/.test(u)).map((u) => path.join(cfg.dataDir, 'uploads', u.slice(9)));
};
/** Measure every clip and ident that hasn't been measured (or has changed), in the background. */
export async function sweepLevels() {
  if (!(await settings()).evenVolume) return;
  const done = new Map((await q('select path, mtime from loudness')).map((x) => [x.path, +x.mtime]));
  for (const c of await q(`select path, mtime from items where kind = 'clip' and path is not null`)) if (done.get(c.path) !== +c.mtime) loudness.want(c.path);
  for (const f of await identFiles()) loudness.want(f);
}

// ---------- Studio ----------
const PRESETS = {
  halloween: { name: 'Halloween', tag: 'halloween', match: { from: '10-01', to: '10-31' } },
  thanksgiving: { name: 'Thanksgiving', tag: 'thanksgiving', match: { from: '11-20', to: '11-30' } },
  christmas: { name: 'Christmas', tag: 'christmas', match: { from: '12-01', to: '12-26' } },
  newyear: { name: 'New Year', tag: 'newyear', match: { from: '12-30', to: '01-02' } },
  valentines: { name: "Valentine's Day", tag: 'valentines', match: { from: '02-07', to: '02-14' } },
  july4: { name: 'Fourth of July', tag: 'july4', match: { from: '07-01', to: '07-05' } },
  weekend: { name: 'Weekend nights', tag: 'weekendnight', match: { days: [5, 6], timeFrom: '18:00', timeTo: '02:00' } },
  latenight: { name: 'Late night', tag: 'latenight', match: { timeFrom: '22:00', timeTo: '04:00' } },
};

async function overview() {
  const s = await settings();
  const rules = await q('select * from preroll_rules order by position, id');
  const plays = new Map((await q(`select clip_id, count(*)::int as plays, max(played_at) as last_played from preroll_plays group by clip_id`)).map((x) => [x.clip_id, x]));
  const clips = (await loadClips('order by i.sort_title')).map((c) => ({ id: c.id, title: c.title, tags: c.tags, folderTags: c.folderTags, ownTags: c.ownTags, runtime_s: c.runtime_s,
    library_id: c.library_id, extra: c.extra, path: c.path, plays: plays.get(c.id)?.plays || 0, last_played: plays.get(c.id)?.last_played || null }));
  const deck = (await getSetting('prerollDecks', {})) || {};
  const levels = new Map((await q('select l.path, l.lufs from loudness l join items i on i.path = l.path and i.mtime = l.mtime where i.kind = \'clip\'')).map((x) => [x.path, x.lufs]));
  return { settings: s, rules, clips: clips.map((c) => ({ ...c, lufs: levels.get(c.path) ?? null, off: !!c.extra?.off, extra: undefined, path: undefined, folder: c.path ? path.basename(path.dirname(c.path)) : '' })), deck, presets: PRESETS };
}

export async function health() {
  const { settings: s, rules, clips } = await overview();
  const out = [];
  const add = (level, text, fix) => out.push({ level, text, fix });
  const libs = await q('select id, name, kind from libraries');
  if (!libs.some((l) => l.kind === 'prerolls')) add('bad', 'There is no pre-roll library yet, so nothing can play.', 'libraries');
  else if (!clips.length) add('bad', 'The pre-roll library is empty. Put some short videos in its folder and scan it.', 'libraries');
  if (s.enabled === false) add('warn', 'Pre-rolls are switched off in General.');
  if (clips.length && !rules.length) add('warn', 'There are clips but no rules, so nothing plays yet. Add a rule or start from a preset.');
  const tags = new Set(clips.flatMap((c) => lower(c.tags)));
  const genres = new Set(lower((await q(`select distinct g from items, unnest(genres) g`)).map((x) => x.g)));
  for (const r of rules.filter((x) => x.enabled)) {
    if (r.clips?.mode === 'tag' && !tags.has(String(r.clips.tag || '').toLowerCase())) add('warn', `“${r.name}” plays clips tagged “${r.clips.tag}”, but no clip has that tag.`);
    if (r.clips?.mode === 'pick' && !(r.clips.ids || []).some((id) => clips.some((c) => c.id === +id && !c.off))) add('warn', `“${r.name}” picks clips that are switched off or gone.`);
    for (const lid of r.match?.libraries || []) if (!libs.some((l) => l.id === +lid)) add('warn', `“${r.name}” points at a library that was removed.`);
    for (const g of r.match?.genres || []) if (!genres.has(String(g).toLowerCase())) add('warn', `“${r.name}” needs the genre “${g}”, which no title has.`);
  }
  if (rules.some((r) => r.enabled && r.clips?.mode === 'match') && ![...tags].some((t) => genres.has(t))) add('warn', 'A rule plays clips matched by genre, but no clip tag is a genre name (for example a clip tagged “horror” for horror films).');
  for (const t of tags) {
    const near = [...genres].find((g) => g !== t && g.length > 3 && (g.startsWith(t.slice(0, -1)) || t.startsWith(g.slice(0, -1))) && Math.abs(g.length - t.length) <= 2);
    if (near && !genres.has(t)) add('warn', `Clip tag “${t}” looks like the genre “${near}”. Rename the tag if it should match.`);
  }
  const long = clips.filter((c) => (c.runtime_s || 0) > Math.max(180, s.maxSeconds || 0));
  if (long.length) add('warn', `${long.length} clip${long.length > 1 ? 's are' : ' is'} over ${Math.max(3, Math.round((s.maxSeconds || 180) / 60))} minutes: ${long.slice(0, 3).map((c) => c.title).join(', ')}${long.length > 3 ? '…' : ''}.`);
  const off = clips.filter((c) => c.off).length;
  if (off) add('info', `${off} clip${off > 1 ? 's are' : ' is'} switched off.`);
  if (s.evenVolume && clips.length) {
    const left = clips.filter((c) => c.lufs == null).length;
    if (left) add('info', `Even volume: ${left} clip${left > 1 ? 's are' : ' is'} still being measured. Until then ${left > 1 ? 'they play' : 'it plays'} at normal volume.`);
    const quiet = clips.filter((c) => c.lufs != null && c.lufs < loudness.TYPICAL + (+s.volumeOffset || 0) - 3);
    if (quiet.length) add('info', `${quiet.length} clip${quiet.length > 1 ? 's are' : ' is'} quieter than a typical movie, so ${quiet.length > 1 ? 'they play' : 'it plays'} at full volume: ${quiet.slice(0, 3).map((c) => c.title).join(', ')}${quiet.length > 3 ? '…' : ''}.`);
  }
  if (s.skipProfiles?.length) add('info', `${s.skipProfiles.length} profile${s.skipProfiles.length > 1 ? 's skip' : ' skips'} pre-rolls.`);
  if (!out.some((x) => x.level !== 'info')) add('ok', 'Everything looks right.');
  return out;
}

export function routes(r) {
  // Keep loudness measurements up to date: shortly after start, then every six hours (new clips, a new ident).
  setTimeout(() => sweepLevels().catch(() => {}), 90e3).unref?.();
  setInterval(() => sweepLevels().catch(() => {}), 6 * 3600e3).unref?.();
  r.get('/api/studio/prerolls', async () => {
    const o = await overview();
    return {
      ...o,
      libraries: await q(`select id, name, kind from libraries order by position, id`),
      profiles: await q('select id, name from profiles order by id'),
      genres: (await q(`select distinct g from items i, unnest(i.genres) g order by g`)).map((x) => x.g),
      studios: (await q(`select distinct g from items i, unnest(i.studios) g where i.kind in ('movie','show') order by g`)).map((x) => x.g),
      ratings: (await q(`select distinct rating from items where rating is not null and rating <> '' order by rating`)).map((x) => x.rating),
      health: await health(),
      decks: Object.fromEntries(o.rules.map((x) => [x.id, o.deck[`rule:${x.id}`] ? { played: o.deck[`rule:${x.id}`].played.length, of: o.deck[`rule:${x.id}`].size || 0 } : null])),
    };
  }, admin);
  r.put('/api/studio/prerolls/settings', async ({ req }) => {
    const b = await readJson(req), cur = await settings();
    const next = { ...cur, ...b };
    next.max = Math.max(0, Math.min(6, +next.max || 0));
    next.everyMinutes = Math.max(0, Math.min(1440, +next.everyMinutes || 0));
    next.maxSeconds = Math.max(0, Math.min(3600, +next.maxSeconds || 0));
    next.order = next.order === 'random' ? 'random' : 'shuffle';
    next.skipProfiles = (next.skipProfiles || []).map(Number).filter(Boolean);
    next.tz = String(next.tz || '');
    next.evenVolume = !!next.evenVolume;
    next.volumeOffset = Math.max(-9, Math.min(9, Math.round(+next.volumeOffset || 0)));
    if (next.tz) { try { new Intl.DateTimeFormat('en-US', { timeZone: next.tz }); } catch { throw new HttpError(400, `“${next.tz}” is not a time zone`); } }
    await setSetting('prerolls', next);
    if (next.evenVolume) sweepLevels().catch(() => {});
    return { ok: true, settings: next };
  }, admin);
  r.post('/api/studio/prerolls/rules', async ({ req }) => {
    const b = await readJson(req);
    if (!b.name?.trim()) throw new HttpError(400, 'Give the rule a name');
    const match = b.match || {};
    for (const k of ['timeFrom', 'timeTo']) if (match[k] && !/^\d\d:\d\d$/.test(match[k])) throw new HttpError(400, 'Times look like 18:00');
    const vals = [b.name.trim(), b.enabled !== false, +b.position || 0, JSON.stringify({ ...(b.clips || { mode: 'all' }), stop: undefined }), JSON.stringify({ ...match, stop: !!b.stop }), Math.max(1, Math.min(6, +b.count || 1))];
    const row = b.id
      ? await q1('update preroll_rules set name=$1, enabled=$2, position=$3, clips=$4::jsonb, match=$5::jsonb, count=$6 where id=$7 returning *', [...vals, b.id])
      : await q1('insert into preroll_rules (name, enabled, position, clips, match, count) values ($1,$2,$3,$4::jsonb,$5::jsonb,$6) returning *', vals);
    return row;
  }, admin);
  r.delete('/api/studio/prerolls/rules/:id', async ({ params }) => { await q('delete from preroll_rules where id=$1', [params.id]); return { ok: true }; }, admin);
  // One-click starting points: a seasonal rule, or the cinema line-up (logo → matched clip → feature card).
  r.post('/api/studio/prerolls/presets', async ({ req }) => {
    const { preset } = await readJson(req);
    const first = (await q1('select coalesce(min(position), 1) as p from preroll_rules')).p;
    if (preset === 'cinema') {
      const add = (name, pos, clips) => q1('insert into preroll_rules (name, enabled, position, clips, match, count) values ($1,true,$2,$3::jsonb,$4::jsonb,1) returning *', [name, pos, JSON.stringify(clips), '{}']);
      const top = first - 3;
      await add('Studio logo', top, { mode: 'tag', tag: 'logo' });
      await add('A clip that fits the title', top + 1, { mode: 'match', on: ['genres'] });
      await add('Feature presentation', top + 2, { mode: 'tag', tag: 'feature' });
      return { ok: true, created: 3, tags: ['logo', 'feature'] };
    }
    const p = PRESETS[preset];
    if (!p) throw new HttpError(400, 'Unknown preset');
    // Seasonal clips play first and replace the everyday ones while they're in season.
    const row = await q1('insert into preroll_rules (name, enabled, position, clips, match, count) values ($1,true,$2,$3::jsonb,$4::jsonb,1) returning *',
      [p.name, first - 1, JSON.stringify({ mode: 'tag', tag: p.tag }), JSON.stringify({ ...p.match, stop: true })]);
    return { ok: true, created: 1, rule: row, tags: [p.tag] };
  }, admin);
  // A clip's pre-roll tags and on/off switch. `tags` is the full list shown on the clip: its folder tags can't be
  // removed here (they come from where the file sits), the rest are stored as the clip's own pre-roll tags.
  r.put('/api/studio/prerolls/clips/:id', async ({ req, params }) => {
    const b = await readJson(req);
    const [c] = await loadClips('and i.id = $1', [params.id]);
    if (!c) throw new HttpError(404, 'Clip not found');
    if (b.tags) {
      const own = [...new Set(b.tags.map(cleanTag).filter((t) => t && !c.folderTags.includes(t)))];
      await q('delete from preroll_tags where clip_id = $1', [c.id]);
      if (own.length) await q('insert into preroll_tags (clip_id, tag) select $1, unnest($2::text[]) on conflict do nothing', [c.id, own]);
    }
    if (b.off !== undefined) {
      const extra = { ...(c.extra || {}), off: !!b.off }, edits = { ...(c.edits || {}), 'extra.off': !!b.off };
      await q('update items set extra=$1::jsonb, edits=$2::jsonb where id=$3', [JSON.stringify(extra), JSON.stringify(edits), c.id]);
    }
    const [now] = await loadClips('and i.id = $1', [c.id]);
    return { ok: true, tags: now.tags, folderTags: now.folderTags, off: !!now.extra?.off };
  }, admin);
  // Tags across clips: add a tag to several clips, take it off them, rename a tag everywhere (rules follow), or delete it.
  r.post('/api/studio/prerolls/tags', async ({ req }) => {
    const b = await readJson(req);
    const tag = cleanTag(b.tag), ids = (b.clips || []).map(Number).filter(Boolean);
    if (!tag) throw new HttpError(400, 'Which tag?');
    if (b.action === 'add') {
      if (!ids.length) throw new HttpError(400, 'Pick some clips first');
      await q(`insert into preroll_tags (clip_id, tag) select id, $2 from items where id = any($1) and kind = 'clip' on conflict do nothing`, [ids, tag]);
      return { ok: true, clips: ids.length };
    }
    if (b.action === 'remove') {
      await q('delete from preroll_tags where tag = $2 and clip_id = any($1)', [ids, tag]);
      return { ok: true };
    }
    if (b.action === 'rename' || b.action === 'delete') {
      const to = b.action === 'rename' ? cleanTag(b.to) : null;
      if (b.action === 'rename' && !to) throw new HttpError(400, 'Give the new name');
      if (to) await q(`insert into preroll_tags (clip_id, tag) select clip_id, $2 from preroll_tags where tag = $1 on conflict do nothing`, [tag, to]);
      await q('delete from preroll_tags where tag = $1', [tag]);
      // Rules that played this tag follow the rename; a deleted tag leaves them for the health check to point out.
      if (to) await q(`update preroll_rules set clips = jsonb_set(clips, '{tag}', to_jsonb($2::text)) where lower(clips->>'tag') = $1`, [tag, to]);
      const folder = (await loadClips()).filter((c) => c.folderTags.includes(tag)).length;
      return { ok: true, folder };
    }
    throw new HttpError(400, 'Unknown action');
  }, admin);
  // A still frame for each clip, made once.
  r.get('/api/studio/prerolls/clips/:id/still.jpg', async ({ req, res, params }) => {
    const c = await q1(`select id, path, mtime, runtime_s from items where id=$1 and kind='clip'`, [params.id]);
    if (!c) throw new HttpError(404, 'Not found');
    const file = path.join(cfg.dataDir, 'cache', 'stills', `${c.id}-${c.mtime}.jpg`);
    if (!fs.existsSync(file)) {
      await fs.promises.mkdir(path.dirname(file), { recursive: true });
      try { await exec(cfg.ffmpeg, ['-v', 'error', '-y', '-ss', String(Math.min(2, (c.runtime_s || 2) / 3)), '-i', c.path, '-frames:v', '1', '-vf', 'scale=320:-2', file], { timeout: 30e3 }); }
      catch { throw new HttpError(404, 'No picture'); }
    }
    await sendFile(req, res, file, { cache: 'public, max-age=86400' });
  }, admin);
  // "What would play before this, for this person, at this time?"
  r.post('/api/studio/prerolls/test', async ({ req }) => {
    const b = await readJson(req);
    const item = await q1(`select i.*, s.title as show_title, s.genres as show_genres, s.studios as show_studios, s.rating as show_rating from items i left join items s on s.id = i.show_id where i.id=$1`, [b.itemId]);
    if (!item || !['movie', 'episode'].includes(item.kind)) throw new HttpError(400, 'Choose a movie or an episode');
    const profile = b.profileId ? await q1('select * from profiles where id=$1', [b.profileId]) : null;
    const at = b.at ? new Date(b.at) : new Date();
    if (Number.isNaN(+at)) throw new HttpError(400, 'That date and time is not valid');
    const log = [];
    const picked = await forPlay(profile, item, b.resume ? 300 : 0, { record: false, at, log });
    return {
      title: item.kind === 'episode' ? `${item.show_title} · S${item.season_no} E${item.episode_no} · ${item.title}` : `${item.title}${item.year ? ` (${item.year})` : ''}`,
      facts: { genres: item.genres?.length ? item.genres : item.show_genres || [], studios: item.studios?.length ? item.studios : item.show_studios || [], rating: item.rating || item.show_rating || null },
      clips: picked.map((c) => ({ id: c.id, title: c.title, rule: c._rule, seconds: c.runtime_s, lufs: c._lufs ?? null, volume: c._gain ?? null })), log,
    };
  }, admin);
  r.get('/api/studio/prerolls/find', async ({ query }) => {
    // A suggestion's own label also finds it: "Title (2020)" → "Title", "Show · S1 E2 · Episode" → "Episode".
    let text = String(query.q || '').trim();
    const ep = text.split(' · '); if (ep.length === 3) text = ep[2];
    text = text.replace(/\s\((\d{4})\)$/, '');
    const like = `%${text.replace(/[%_\\]/g, '\\$&')}%`;
    return (await q(`select i.id, i.kind, i.title, i.year, i.season_no, i.episode_no, s.title as show_title from items i left join items s on s.id = i.show_id
      where i.kind in ('movie','episode') and (i.title ilike $1 or s.title ilike $1) order by (i.kind='movie') desc, coalesce(s.sort_title, i.sort_title), i.season_no, i.episode_no limit 25`, [like]))
      .map((x) => ({ id: x.id, label: x.kind === 'episode' ? `${x.show_title} · S${x.season_no} E${x.episode_no} · ${x.title}` : `${x.title}${x.year ? ` (${x.year})` : ''}` }));
  }, admin);
  r.get('/api/studio/prerolls/health', async () => health(), admin);
  r.get('/api/studio/prerolls/activity', async () => q(`select p.played_at, p.rule, c.title as clip, coalesce(s.title || ' · ' || i.title, i.title) as item, pr.name as profile
    from preroll_plays p left join items c on c.id = p.clip_id left join items i on i.id = p.item_id left join items s on s.id = i.show_id left join profiles pr on pr.id = p.profile_id
    order by p.played_at desc limit 100`), admin);
  r.post('/api/studio/prerolls/decks/reset', async () => { await setSetting('prerollDecks', {}); return { ok: true }; }, admin);
  // Backup: settings and rules as a file. Libraries are matched by name when restoring on another server.
  r.get('/api/studio/prerolls/backup', async ({ res }) => {
    const libs = await q('select id, name from libraries');
    const rules = (await q('select * from preroll_rules order by position, id')).map((x) => ({ ...x, id: undefined, match: { ...x.match, libraries: (x.match?.libraries || []).map((id) => libs.find((l) => l.id === +id)?.name).filter(Boolean) } }));
    const s = await settings();
    const profiles = await q('select id, name from profiles');
    // Typed pre-roll tags, by clip file name (folder tags come back on their own from where the files sit).
    const tags = {};
    for (const c of await loadClips()) if (c.ownTags.length) tags[path.basename(c.path)] = c.ownTags;
    const body = Buffer.from(JSON.stringify({ hallflix: 'prerolls', version: 2, saved: new Date().toISOString(), settings: { ...s, skipProfiles: (s.skipProfiles || []).map((id) => profiles.find((p) => p.id === id)?.name).filter(Boolean) }, rules, tags }, null, 2));
    res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="hallflix-prerolls-${new Date().toISOString().slice(0, 10)}.json"`, 'Content-Length': body.length });
    res.end(body);
  }, admin);
  r.post('/api/studio/prerolls/backup', async ({ req }) => {
    const b = await readJson(req);
    if (b.hallflix !== 'prerolls' || !Array.isArray(b.rules)) throw new HttpError(400, 'That is not a HallFlix pre-roll backup');
    const libs = await q('select id, name from libraries');
    const profiles = await q('select id, name from profiles');
    await q('delete from preroll_rules');
    for (const x of b.rules) {
      const match = { ...(x.match || {}), libraries: (x.match?.libraries || []).map((n) => libs.find((l) => l.name === n)?.id).filter(Boolean) };
      await q('insert into preroll_rules (name, enabled, position, clips, match, count) values ($1,$2,$3,$4::jsonb,$5::jsonb,$6)', [x.name, x.enabled !== false, x.position || 0, JSON.stringify(x.clips || { mode: 'all' }), JSON.stringify(match), x.count || 1]);
    }
    if (b.settings) await setSetting('prerolls', { ...DEFAULTS, ...b.settings, skipProfiles: (b.settings.skipProfiles || []).map((n) => profiles.find((p) => p.name === n)?.id).filter(Boolean) });
    let tagged = 0;
    if (b.tags && typeof b.tags === 'object') {
      const byFile = new Map((await loadClips()).map((c) => [path.basename(c.path), c]));
      for (const [file, list] of Object.entries(b.tags)) {
        const c = byFile.get(file); if (!c || !Array.isArray(list)) continue;
        const own = [...new Set(list.map(cleanTag).filter((t) => t && !c.folderTags.includes(t)))];
        await q('delete from preroll_tags where clip_id = $1', [c.id]);
        if (own.length) await q('insert into preroll_tags (clip_id, tag) select $1, unnest($2::text[]) on conflict do nothing', [c.id, own]);
        tagged++;
      }
    }
    return { ok: true, rules: b.rules.length, tagged };
  }, admin);
}
