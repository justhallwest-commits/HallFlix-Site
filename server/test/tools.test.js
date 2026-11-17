// The Studio tools: Content Guard, the metadata editor, Artwork Studio and the pre-roll tools.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { boot, makeMedia, media, tinyJpeg } from './helpers.js';
// The server modules read their settings when first loaded, so they are imported after boot() sets the test folders.
let compile, scrub, wild, runOp, tokens, recase, parseCsv, plan, pickPrerolls, inSchedule, shareLink;

let hf, lib = {}, it = {}, adminCookie, kid, kidCookie;
const browser = { containers: ['mp4', 'webm'], video: ['h264', 'vp9'], audio: ['aac', 'mp3', 'opus'] };

before(async () => {
  makeMedia();
  hf = await boot();
  ({ compile, scrub, wild } = await import('../src/guard.js'));
  ({ runOp, tokens, recase, parseCsv, plan } = await import('../src/meta.js'));
  ({ pickPrerolls, inSchedule } = await import('../src/prerolls.js'));
  ({ shareLink } = await import('../src/art.js'));
  await hf.api('POST', '/api/setup', { name: 'Jus', password: 'reel-2026', tmdbKey: 'test-key' });
  for (const [name, kind] of [['Movies', 'movies'], ['Shows', 'shows'], ['Prerolls', 'prerolls']]) { lib[kind] = await hf.api('POST', '/api/studio/libraries', { name, kind, path: path.join(media, name) }); if (!lib[kind].id) throw new Error(JSON.stringify(lib[kind])); }
  await hf.scan.idle();
  for (const m of (await hf.api('GET', `/api/library/${lib.movies.id}`)).items) it[m.title] = m;
  const show = (await hf.api('GET', `/api/library/${lib.shows.id}`)).items[0];
  it.show = await hf.api('GET', `/api/items/${show.id}`);
  it.ep = it.show.seasons[0].episodes[0];
  adminCookie = hf.getCookie();
  kid = await hf.api('POST', '/api/studio/profiles', { name: 'Kid', password: '1234' });
  hf.setCookie(''); await hf.api('POST', '/api/login', { profileId: kid.id, password: '1234' }); kidCookie = hf.getCookie();
  hf.setCookie(adminCookie);
}, { timeout: 180e3 });
after(async () => { await hf?.close(); });
const as = async (cookie, fn) => { const keep = hf.getCookie(); hf.setCookie(cookie); try { return await fn(); } finally { hf.setCookie(keep); } };

test('guard rules: wildcards, inheritance-ready facts, allow-only and scrubbing', () => {
  assert.ok(wild('Horror*')('horror comedy')); assert.ok(!wild('Horror')('Horror Comedy')); assert.ok(wild('tv-ma')('TV-MA'));
  const t = compile({ name: 'Kids', blockTags: ['Scary*'], blockGenres: ['Horror'], blockRatings: ['R', 'TV-MA'], hideUnrated: true });
  assert.match(t({ kind: 'movie', tags: [], genres: ['Horror'], rating: 'PG' }), /genre/);
  assert.match(t({ kind: 'episode', tags: ['scary stuff'], genres: [], rating: 'TV-14' }), /tag/);
  assert.match(t({ kind: 'movie', tags: [], genres: [], rating: 'r' }), /rated/);
  assert.match(t({ kind: 'movie', tags: [], genres: [], rating: null }), /no rating/);
  assert.equal(t({ kind: 'book', tags: [], genres: [], rating: null }), null, 'books are never hidden just for having no rating');
  assert.equal(t({ kind: 'movie', tags: [], genres: ['Comedy'], rating: 'PG' }), null);
  const only = compile({ allowTags: ['kids'] });
  assert.match(only({ kind: 'movie', tags: [], genres: [], rating: 'G' }), /allow-only/); assert.equal(only({ kind: 'movie', tags: ['Kids'], genres: [], rating: 'G' }), null);
  const hidden = new Map([[2, 'x'], [5, 'y']]);
  const out = scrub({ rows: [{ id: 'a', title: 'Row', items: [{ id: 2, kind: 'movie' }] }, { id: 'b', items: [{ id: 3, kind: 'movie' }, { id: 5, kind: 'show' }] }], library: { id: 2, kind: 'movies' }, next: { id: 5, kind: 'episode' } }, hidden);
  assert.deepEqual(out.rows.map((r) => [r.id, r.items.map((x) => x.id)]), [['b', [3]]], 'a row left empty disappears');
  assert.equal(out.library.id, 2, 'libraries are not titles'); assert.equal(out.next, null);
});

test('metadata edits: every operation, tokens, capitalization and CSV', () => {
  const item = { title: 'the long signal', year: 2021, kind: 'movie', library_name: 'Movies', path: '/m/The Long Signal (2021)/x.mkv', season_no: 2, episode_no: 3, show_title: 'Harbor' };
  const cur = { title: 'the long signal', genres: ['Sci-Fi', 'Thriller', 'thriller '], tags: ['A'], overview: '  two  spaces ', rating: null, year: 2021, score: null, studios: [], sort_title: null, tagline: null, premiered: null, author: null, tmdb_id: null };
  assert.equal(runOp({ op: 'case', field: 'title' }, item, cur), 'The Long Signal');
  assert.equal(recase('a tale OF two cities', 'sentence'), 'A tale of two cities');
  assert.deepEqual(runOp({ op: 'replace', field: 'genres', find: 'Sci-Fi', replace: 'Science Fiction' }, item, cur), ['Science Fiction', 'Thriller', 'thriller']);
  assert.equal(runOp({ op: 'replace', field: 'title', find: '^the (.*)$', replace: '$1, The', regex: true }, item, cur), 'long signal, The');
  assert.deepEqual(runOp({ op: 'trim', field: 'genres' }, item, cur), ['Sci-Fi', 'Thriller']);
  assert.deepEqual(runOp({ op: 'add', field: 'tags', value: '4K | a | HDR' }, item, cur), ['A', '4K', 'HDR']);
  assert.deepEqual(runOp({ op: 'remove', field: 'genres', value: 'thriller' }, item, cur), ['Sci-Fi']);
  assert.equal(runOp({ op: 'set', field: 'tagline', value: '{Name} ({Year}) S{SeasonNumber:00}E{EpisodeNumber:00} in {Library} from {Folder}' }, item, cur), 'the long signal (2021) S02E03 in Movies from The Long Signal (2021)');
  assert.equal(runOp({ op: 'append', field: 'title', value: " (Director's Cut)" }, item, cur), "the long signal (Director's Cut)");
  assert.equal(runOp({ op: 'trim', field: 'overview' }, item, cur), 'two spaces');
  assert.equal(runOp({ op: 'copy', field: 'tagline', from: 'genres' }, item, cur), 'Sci-Fi | Thriller | thriller ');
  assert.throws(() => runOp({ op: 'set', field: 'score', value: '11' }, item, cur), /score/);
  assert.throws(() => runOp({ op: 'add', field: 'title', value: 'x' }, item, cur), /lists/);
  assert.equal(tokens('{Type}: {Show}', { kind: 'episode', show_title: 'Harbor' }), 'Episodes: Harbor');
  // only-empty and planning
  const p = plan([{ id: 1, ...item, ...cur, locked: {} }], [{ op: 'set', field: 'rating', value: 'PG' }, { op: 'set', field: 'year', value: '1999' }], { onlyEmpty: true });
  assert.deepEqual(p[0].changes.map((c) => [c.field, c.after]), [['rating', 'PG']]);
  assert.deepEqual(parseCsv('id,title\r\n1,"Hello, ""world"""\n2,Plain\n'), [['id', 'title'], ['1', 'Hello, "world"'], ['2', 'Plain']]);
});

test('pre-roll engine: schedules, shuffle deck, matching by genre and replacing rules', () => {
  const sat1am = new Date(2026, 10, 14, 1, 0), fri8pm = new Date(2026, 10, 13, 20, 0), tue8pm = new Date(2026, 10, 10, 20, 0);
  const weekend = { days: [5, 6], timeFrom: '18:00', timeTo: '02:00' };
  assert.ok(inSchedule(weekend, fri8pm)); assert.ok(inSchedule(weekend, sat1am), 'early Saturday counts as Friday night'); assert.ok(!inSchedule(weekend, tue8pm));
  const clips = [1, 2, 3].map((id) => ({ id, title: `c${id}`, tags: [], runtime_s: 5 }));
  const rule = { id: 9, name: 'All', enabled: true, position: 0, count: 1, clips: { mode: 'all' }, match: {} };
  const deck = {};
  const seen = [];
  for (let i = 0; i < 3; i++) seen.push(pickPrerolls([rule], clips, { kind: 'movie' }, { max: 1 }, new Date(), Math.random, deck)[0].id);
  assert.deepEqual([...seen].sort(), [1, 2, 3], 'every clip once per round');
  const fourth = pickPrerolls([rule], clips, { kind: 'movie' }, { max: 1 }, new Date(), Math.random, deck)[0].id;
  assert.notEqual(fourth, seen[2], 'the last clip never opens the next round');
  const tagged = [{ id: 1, title: 'scary', tags: ['horror'] }, { id: 2, title: 'plain', tags: [] }, { id: 3, title: 'off', tags: ['horror'], extra: { off: true } }];
  const match = { id: 1, name: 'Fits', enabled: true, position: 0, count: 2, clips: { mode: 'match', on: ['genres'] }, match: {} };
  assert.deepEqual(pickPrerolls([match], tagged, { kind: 'movie', genres: ['Horror'] }, { max: 2 }).map((c) => c.id), [1], 'switched-off clips never play');
  const seasonal = { id: 1, name: 'Halloween', enabled: true, position: 0, count: 1, clips: { mode: 'tag', tag: 'horror' }, match: { from: '10-01', to: '10-31', stop: true } };
  const general = { id: 2, name: 'General', enabled: true, position: 1, count: 1, clips: { mode: 'all', untaggedOnly: true }, match: {} };
  const log = [];
  assert.deepEqual(pickPrerolls([seasonal, general], tagged, { kind: 'movie' }, { max: 2 }, new Date(2026, 9, 5), () => 0, null, log).map((c) => c.id), [1]);
  assert.match(log.at(-1).note, /replaces/);
  assert.deepEqual(pickPrerolls([seasonal, general], tagged, { kind: 'movie' }, { max: 2 }, new Date(2026, 5, 5), () => 0).map((c) => c.id), [2], 'out of season: the general clip, untagged only');
  assert.equal(pickPrerolls([general], [{ id: 4, title: 'long', tags: [], runtime_s: 400 }], { kind: 'movie' }, { max: 1, maxSeconds: 120 }).length, 0);
  assert.equal(shareLink('https://drive.google.com/file/d/1AbCdEfGhIjKlMn/view?usp=sharing'), 'https://drive.google.com/uc?export=download&id=1AbCdEfGhIjKlMn');
  assert.equal(shareLink('https://www.dropbox.com/s/xyz/pic.jpg?dl=0'), 'https://www.dropbox.com/s/xyz/pic.jpg?raw=1');
  assert.equal(shareLink('https://imgur.com/AbC123x'), 'https://i.imgur.com/AbC123x.jpg');
});

test('Content Guard hides titles everywhere for chosen profiles, and episodes follow their show', async () => {
  // Tag the show (not its episodes) and block that tag for Kid.
  await hf.api('POST', '/api/studio/meta/apply', { ids: [it.show.id], ops: [{ op: 'add', field: 'tags', value: 'Grown-up' }] });
  const saved = await hf.api('PUT', '/api/studio/guard', { rules: [{ name: 'Kids', profiles: [kid.id], blockTags: 'grown*', blockRatings: ['R'] }] });
  assert.equal(saved.rules[0].blockTags[0], 'grown*');
  const prev = await hf.api('POST', '/api/studio/guard/preview', { rule: saved.rules[0] });
  assert.deepEqual(prev.items.map((x) => x.title).sort(), ['Harbor Lights', 'Night Drive']);
  assert.equal(prev.counts.episode, 3);
  const tst = await hf.api('GET', `/api/studio/guard/test?profile=${kid.id}&q=chapter`);
  assert.ok(tst.items.every((x) => !x.visible && /grown-up/i.test(x.why)), 'episodes are hidden because of the show tag');
  await as(kidCookie, async () => {
    const cards = (v, out = []) => { if (Array.isArray(v)) v.forEach((x) => cards(x, out)); else if (v && typeof v === 'object') { if (typeof v.id === 'number' && /^(movie|show|episode)$/.test(v.kind)) out.push(v.id); Object.values(v).forEach((x) => cards(x, out)); } return out; };
    const shown = cards(await hf.api('GET', '/api/home'));
    assert.ok(shown.length && !shown.includes(it['Night Drive'].id) && !shown.includes(it.show.id) && !shown.includes(it.ep.id), 'home never lists a hidden title');
    assert.equal((await hf.api('GET', `/api/library/${lib.movies.id}`)).total, 3, 'grids page and count without them');
    assert.equal((await hf.api('GET', `/api/library/${lib.shows.id}`)).total, 0);
    assert.equal((await hf.api('GET', `/api/items/${it.show.id}`)).$status, 404);
    assert.equal((await hf.api('GET', `/api/items/${it.ep.id}`)).$status, 404);
    assert.equal((await hf.api('POST', '/api/play', { itemId: it.ep.id, caps: browser })).$status, 404);
    assert.equal((await hf.api('GET', `/api/file/${it['Night Drive'].id}`, null, { raw: true })).status, 404);
    assert.equal((await hf.api('GET', '/api/search?q=night')).items.length, 0);
    assert.equal((await hf.api('GET', `/api/items/${it['Deep Field'].id}`)).title, 'Deep Field');
  });
  // The admin is untouched, and switching the rule off lifts it at once.
  assert.equal((await hf.api('GET', `/api/items/${it.show.id}`)).title, 'Harbor Lights');
  await hf.api('PUT', '/api/studio/guard', { rules: [{ ...saved.rules[0], enabled: false }] });
  await as(kidCookie, async () => assert.equal((await hf.api('GET', `/api/items/${it.show.id}`)).title, 'Harbor Lights'));
  await hf.api('PUT', '/api/studio/guard', { rules: [] });
});

test('metadata editor: search, preview, apply with locks that survive rescans, values, CSV and undo', async () => {
  const s = await hf.api('POST', '/api/studio/meta/search', { kinds: 'movie', missing: 'poster' });
  assert.deepEqual(s.items.map((x) => x.title), ['Quiet Orbit']);
  const all = await hf.api('POST', '/api/studio/meta/search', { kinds: 'movie', idsOnly: true });
  assert.equal(all.ids.length, 4);
  const ops = [{ op: 'replace', field: 'genres', find: 'Science Fiction', replace: 'Sci-Fi' }, { op: 'set', field: 'tagline', value: '{Name} ({Year})' }];
  const pv = await hf.api('POST', '/api/studio/meta/preview', { ids: all.ids, ops });
  assert.equal(pv.items, 4);
  const signal = pv.planned.find((p) => p.title === 'The Long Signal');
  assert.deepEqual(signal.changes.find((c) => c.field === 'genres').after, ['Sci-Fi', 'Thriller']);
  const ap = await hf.api('POST', '/api/studio/meta/apply', { ids: all.ids, ops });
  assert.equal(ap.saved.items, 4);
  // A rescan that re-reads TMDb keeps the hand edits because they are locked.
  await hf.api('POST', '/api/studio/scan', { libraryId: lib.movies.id, fresh: true }); await hf.scan.idle();
  let ls = await hf.api('GET', `/api/items/${it['The Long Signal'].id}`);
  assert.deepEqual(ls.genres, ['Sci-Fi', 'Thriller']); assert.equal(ls.tagline, 'The Long Signal (2021)');
  // Genre manager: merge two genres into one, everywhere.
  const vals = await hf.api('GET', '/api/studio/meta/values?field=genres');
  assert.ok(vals.find((v) => v.value === 'Sci-Fi').n >= 1);
  const merged = await hf.api('POST', '/api/studio/meta/values', { field: 'genres', action: 'merge', from: ['Sci-Fi', 'Documentary'], to: 'Science & Nature' });
  assert.equal(merged.items, 2);
  assert.ok((await hf.api('GET', `/api/items/${it['Deep Field'].id}`)).genres.includes('Science & Nature'));
  // Spreadsheet round trip.
  const csv = await (await hf.api('POST', '/api/studio/meta/export', { ids: [it['Quiet Orbit'].id], columns: ['title', 'year', 'rating', 'genres'] }, { raw: true })).text();
  assert.match(csv, /^﻿?id,title,genres,rating,year/);
  const edited = csv.replace(/Quiet Orbit,,,2022/, 'Quiet Orbit (Remastered),,PG-13,2022');
  const ipv = await hf.api('POST', '/api/studio/meta/import', Buffer.from(edited), { headers: { 'Content-Type': 'text/csv' } });
  assert.deepEqual(ipv.planned[0].changes.map((c) => c.field).sort(), ['rating', 'title']);
  await hf.api('POST', '/api/studio/meta/import?apply=1', Buffer.from(edited), { headers: { 'Content-Type': 'text/csv' } });
  assert.equal((await hf.api('GET', `/api/items/${it['Quiet Orbit'].id}`)).title, 'Quiet Orbit (Remastered)');
  // History: undo the import, then undo the undo.
  const hist = await hf.api('GET', '/api/studio/meta/history');
  assert.match(hist[0].label, /Imported/);
  await hf.api('POST', `/api/studio/meta/history/${hist[0].id}/undo`);
  assert.equal((await hf.api('GET', `/api/items/${it['Quiet Orbit'].id}`)).title, 'Quiet Orbit');
  const h2 = await hf.api('GET', '/api/studio/meta/history');
  assert.match(h2[0].label, /^Undo/); assert.equal(h2[1].undone, true);
  await hf.api('POST', `/api/studio/meta/history/${h2[0].id}/undo`);
  assert.equal((await hf.api('GET', `/api/items/${it['Quiet Orbit'].id}`)).title, 'Quiet Orbit (Remastered)');
  // Unlocking hands a field back to the scanner.
  await hf.api('POST', '/api/studio/meta/apply', { ids: [it['The Long Signal'].id], ops: [{ op: 'unlock', field: 'all' }] });
  await hf.api('POST', '/api/studio/scan', { libraryId: lib.movies.id, fresh: true }); await hf.scan.idle();
  ls = await hf.api('GET', `/api/items/${it['The Long Signal'].id}`);
  assert.deepEqual(ls.genres, ['Science Fiction', 'Thriller']);
});

test('Artwork Studio: slots, every source, backdrop order, fill from online, bulk and the screensaver', async () => {
  const qo = it['Quiet Orbit'].id;
  const list = await hf.api('GET', `/api/studio/art/items?library=${lib.movies.id}&missing=poster`);
  assert.deepEqual(list.items.map((x) => x.title), ['Quiet Orbit (Remastered)']);
  let ed = await hf.api('GET', `/api/studio/art/item/${qo}`);
  assert.deepEqual(ed.slots.map((s) => s.key), ['poster', 'backdrops', 'logo', 'thumb']);
  // Upload, then NAS link and NAS copy.
  const up = await hf.api('POST', '/api/studio/upload?name=p.jpg', tinyJpeg());
  await hf.api('POST', `/api/studio/art/item/${qo}/set`, { slot: 'poster', source: { type: 'ref', ref: up.url } });
  const nas = path.join(media, 'Movies', 'Night Drive (2019)', 'poster.jpg');
  const browse = await hf.api('GET', `/api/studio/art/browse?path=${encodeURIComponent(path.dirname(nas))}`);
  assert.deepEqual(browse.images.map((x) => x.name), ['poster.jpg']);
  assert.equal((await hf.api('GET', `/api/studio/art/search?q=poster`)).images.length, 1);
  await hf.api('POST', `/api/studio/art/item/${qo}/set`, { slot: 'backdrops', source: { type: 'nas', path: nas, mode: 'link' } });
  await hf.api('POST', `/api/studio/art/item/${qo}/set`, { slot: 'backdrops', source: { type: 'nas', path: nas, mode: 'copy' } });
  await hf.api('POST', `/api/studio/art/item/${qo}/set`, { slot: 'thumb', source: { type: 'ref', ref: up.url } });
  assert.equal((await hf.api('POST', `/api/studio/art/item/${qo}/set`, { slot: 'poster', source: { type: 'nas', path: '/etc/passwd' } })).$status, 400);
  ed = await hf.api('GET', `/api/studio/art/item/${qo}`);
  const bd = ed.slots.find((s) => s.key === 'backdrops');
  assert.deepEqual(bd.images.map((x) => x.source), ['NAS', 'Saved in HallFlix']);
  await hf.api('POST', `/api/studio/art/item/${qo}/order`, { order: [1, 0] });
  ed = await hf.api('GET', `/api/studio/art/item/${qo}`);
  assert.equal(ed.slots.find((s) => s.key === 'backdrops').images[0].source, 'Saved in HallFlix');
  assert.ok((await hf.api('GET', `/api/library/${lib.movies.id}`)).items.find((x) => x.id === qo).thumb, 'cards get the thumb');
  // The pictures survive a rescan.
  await hf.api('POST', '/api/studio/scan', { libraryId: lib.movies.id }); await hf.scan.idle();
  assert.equal((await hf.api('GET', `/api/studio/art/item/${qo}`)).slots[0].images[0].ref, up.url);
  // Online: sorted by rating, and Fill missing takes the best.
  const nd = it['Night Drive'].id;
  const online = await hf.api('GET', `/api/studio/art/item/${nd}/online?slot=poster`);
  assert.deepEqual(online.map((x) => x.path), ['/alt-poster-b.jpg', '/alt-poster-a.jpg']);
  await hf.api('POST', `/api/studio/art/item/${nd}/remove`, { slot: 'logo' });
  const fill = await hf.api('POST', '/api/studio/art/fill', { ids: [nd], slots: ['logo'] });
  assert.equal(fill.filled, 1);
  assert.equal((await hf.api('GET', `/api/studio/art/item/${nd}`)).slots.find((s) => s.key === 'logo').images[0].ref, 'tmdb:/alt-logo.png');
  const bulk = await hf.api('POST', '/api/studio/art/bulk', { ids: [nd, it['Deep Field'].id, qo], slot: 'thumb', source: { type: 'ref', ref: up.url }, skipExisting: true });
  assert.deepEqual([bulk.done, bulk.skipped], [2, 1]);
  // Screensaver gallery: only my pictures.
  await hf.api('POST', '/api/studio/art/screensaver', { sources: [{ type: 'ref', ref: up.url }], caption: 'Family trip' });
  await hf.api('PUT', '/api/studio/art/screensaver', { mode: 'mine', share: 100 });
  const saver = await hf.api('GET', '/api/screensaver');
  assert.deepEqual(saver.map((x) => x.title), ['Family trip']);
  await hf.api('PUT', '/api/studio/art/screensaver', { mode: 'mixed', share: 20 });
  assert.ok((await hf.api('GET', '/api/screensaver')).length > 1);
});

test('pre-roll tools: clips, presets, test, frequency, skipped profiles, health, activity and backup', async () => {
  let pr = await hf.api('GET', '/api/studio/prerolls');
  const ident = pr.clips.find((c) => c.title === 'hallflix ident'), spooky = pr.clips.find((c) => c.title === 'spooky bump');
  assert.ok(pr.health.some((h) => /no rules/.test(h.text)));
  // Tag the ident as a logo, and use the cinema line-up.
  await hf.api('PUT', `/api/studio/prerolls/clips/${ident.id}`, { tags: ['Logo'] });
  await hf.api('PUT', `/api/studio/prerolls/clips/${spooky.id}`, { tags: ['thriller'] });
  const cinema = await hf.api('POST', '/api/studio/prerolls/presets', { preset: 'cinema' });
  assert.equal(cinema.created, 3);
  pr = await hf.api('GET', '/api/studio/prerolls');
  assert.ok(pr.health.some((h) => /feature/.test(h.text)), 'the missing “feature” tag is pointed out');
  const t1 = await hf.api('POST', '/api/studio/prerolls/test', { itemId: it['Night Drive'].id });
  assert.deepEqual(t1.clips.map((c) => [c.title, c.rule]), [['hallflix ident', 'Studio logo'], ['spooky bump', 'A clip that fits the title']]);
  // Tags typed in the Studio stick through a rescan.
  await hf.api('POST', '/api/studio/scan', { libraryId: lib.prerolls.id }); await hf.scan.idle();
  assert.deepEqual((await hf.api('GET', '/api/studio/prerolls')).clips.find((c) => c.id === ident.id).tags, ['logo']);
  // Seasonal preset: replaces everything below it in season.
  await hf.api('PUT', `/api/studio/prerolls/clips/${spooky.id}`, { tags: ['thriller', 'halloween'] });
  await hf.api('POST', '/api/studio/prerolls/presets', { preset: 'halloween' });
  const oct = await hf.api('POST', '/api/studio/prerolls/test', { itemId: it['Night Drive'].id, at: '2026-10-15T20:00:00' });
  assert.deepEqual(oct.clips.map((c) => c.rule), ['Halloween']);
  // Plays are recorded, and the frequency limit holds back the next one.
  await hf.api('PUT', '/api/studio/prerolls/settings', { everyMinutes: 30 });
  assert.equal((await hf.api('POST', '/api/play', { itemId: it['Deep Field'].id, caps: browser })).queue.filter((e) => e.kind === 'preroll').length, 1);
  assert.equal((await hf.api('POST', '/api/play', { itemId: it['Deep Field'].id, caps: browser })).queue.filter((e) => e.kind === 'preroll').length, 0);
  const why = await hf.api('POST', '/api/studio/prerolls/test', { itemId: it['Deep Field'].id, profileId: 1 });
  assert.match(why.log[0].note, /limit is one every 30 min/);
  await hf.api('PUT', '/api/studio/prerolls/settings', { everyMinutes: 0, skipProfiles: [kid.id] });
  assert.match((await hf.api('POST', '/api/studio/prerolls/test', { itemId: it['Deep Field'].id, profileId: kid.id })).log[0].note, /skip pre-rolls/);
  // A switched-off clip never plays.
  await hf.api('PUT', `/api/studio/prerolls/clips/${ident.id}`, { off: true });
  assert.ok(!(await hf.api('POST', '/api/studio/prerolls/test', { itemId: it['Deep Field'].id })).clips.some((c) => c.id === ident.id));
  const act = await hf.api('GET', '/api/studio/prerolls/activity');
  assert.ok(act.length >= 1 && act[0].profile === 'Jus');
  pr = await hf.api('GET', '/api/studio/prerolls');
  assert.equal(pr.clips.find((c) => c.id === spooky.id).plays >= 0, true);
  // Backup and restore.
  const backup = await (await hf.api('GET', '/api/studio/prerolls/backup', null, { raw: true })).json();
  assert.equal(backup.rules.length, 4); assert.deepEqual(backup.settings.skipProfiles, ['Kid']);
  await hf.api('DELETE', `/api/studio/prerolls/rules/${pr.rules[0].id}`);
  await hf.api('POST', '/api/studio/prerolls/backup', backup);
  pr = await hf.api('GET', '/api/studio/prerolls');
  assert.equal(pr.rules.length, 4); assert.deepEqual(pr.settings.skipProfiles, [kid.id]);
});
