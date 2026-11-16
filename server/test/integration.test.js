// End-to-end: scan real files, then play them through every path and check what comes out with ffprobe.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { boot, makeMedia, media, root, zip, ffprobe, tinyJpeg } from './helpers.js';

const browser = { containers: ['mp4', 'webm'], video: ['h264', 'vp9'], audio: ['aac', 'mp3', 'opus'] };
const hevcTv = { containers: ['mp4', 'mkv', 'webm'], video: ['h264', 'hevc'], video10: ['hevc'], audio: ['aac', 'mp3', 'ac3', 'eac3'], hlsHevc: true, audioSwitch: true };
let hf, lib = {}, items = {};

before(async () => { makeMedia(); hf = await boot(); }, { timeout: 180e3 });
after(async () => { await hf?.close(); });

const playlist = async (url) => (await (await fetch(hf.base + url)).text());
async function segment(url, name) {
  const res = await fetch(hf.base + url);
  assert.equal(res.status, 200, `segment ${url}`);
  const file = path.join(root, name);
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  return ffprobe(file);
}
const segs = (m3u8) => m3u8.split('\n').filter((l) => l && !l.startsWith('#'));
const total = (m3u8) => [...m3u8.matchAll(/#EXTINF:([\d.]+)/g)].reduce((n, m) => n + +m[1], 0);
async function finished(url) {
  for (let i = 0; i < 300; i++) { const t = await playlist(url); if (t.includes('#EXT-X-ENDLIST')) return t; await new Promise((r) => setTimeout(r, 100)); }
  throw new Error('stream never finished');
}

test('first run: setup, then sign-in is required', async () => {
  let b = await hf.api('GET', '/api/boot');
  assert.equal(b.setup, true);
  assert.equal(b.look.theme.colors.accent, '#35d0d0');
  assert.equal((await hf.api('GET', '/api/home')).$status, 401);
  assert.equal((await hf.api('POST', '/api/setup', { name: 'Jus', password: '12' })).$status, 400);
  const s = await hf.api('POST', '/api/setup', { name: 'Jus', password: 'reel-2026', tmdbKey: 'test-key' });
  assert.equal(s.profile.admin, true); assert.equal(s.tmdbOk, true);
  assert.equal((await hf.api('POST', '/api/setup', { name: 'Eve', password: 'hunter22' })).$status, 403);
  b = await hf.api('GET', '/api/boot');
  assert.equal(b.setup, false); assert.equal(b.profile.name, 'Jus');
});

test('libraries scan into movies, shows, episodes and clips', async () => {
  assert.equal((await hf.api('POST', '/api/studio/libraries', { name: 'X', kind: 'movies', path: '/etc' })).$status, 400);
  const fsList = await hf.api('GET', '/api/studio/fs');
  assert.deepEqual(fsList.entries.map((e) => e.name), ['Movies', 'Prerolls', 'Shows']);
  // A linked folder (how some NAS shares appear) and a folder name with a space both show up.
  fs.mkdirSync(path.join(os.tmpdir(), 'hf-linked/Film Hall'), { recursive: true });
  fs.symlinkSync(path.join(os.tmpdir(), 'hf-linked/Film Hall'), path.join(media, 'Film Hall'));
  assert.deepEqual((await hf.api('GET', '/api/studio/fs')).entries.map((e) => [e.name, e.dir]), [['Film Hall', true], ['Movies', true], ['Prerolls', true], ['Shows', true]]);
  const inside = await hf.api('GET', `/api/studio/fs?path=${encodeURIComponent(path.join(media, 'Film Hall'))}`);
  assert.equal(inside.note, 'This folder is empty.');
  fs.unlinkSync(path.join(media, 'Film Hall'));
  assert.ok((await hf.api('GET', `/api/studio/fs?path=${encodeURIComponent(path.join(media, 'Movies'))}`)).entries.length);
  for (const [name, kind] of [['Movies', 'movies'], ['Shows', 'shows'], ['Prerolls', 'prerolls']]) {
    lib[kind] = await hf.api('POST', '/api/studio/libraries', { name, kind, path: path.join(media, name) });
    assert.ok(lib[kind].id);
  }
  await hf.scan.idle();
  assert.deepEqual(hf.scan.status.errors, []);
  const ov = await hf.api('GET', '/api/studio/overview');
  assert.deepEqual(ov.libraries.map((l) => [l.kind, l.titles, l.episodes]), [['movies', 4, 0], ['shows', 1, 3], ['prerolls', 2, 0]]);
  const movies = await hf.api('GET', `/api/library/${lib.movies.id}?sort=title`);
  assert.deepEqual(movies.items.map((m) => [m.title, m.year]), [['Deep Field', 2020], ['The Long Signal', 2021], ['Night Drive', 2019], ['Quiet Orbit', 2022]]);
  for (const m of movies.items) items[m.title] = m;
  // TMDb details arrived; the tmdbid hint beat the title search; unknown titles stay usable.
  assert.equal(items['Night Drive'].rating, 'R'); assert.deepEqual(items['Night Drive'].genres, ['Thriller', 'Crime']);
  assert.match(items['Night Drive'].poster, /^\/img\/l\//, 'a poster.jpg beside the file wins over TMDb');
  assert.equal(items['Night Drive'].backdrop, '/img/t/w780/nd-back.jpg');
  assert.equal(items['Deep Field'].rating, 'PG');
  assert.equal(items['Quiet Orbit'].poster, null);
  assert.equal(ov.libraries[0].unmatched, 1);
  assert.equal((await hf.api('GET', `/api/library/${lib.movies.id}?genre=Thriller`)).total, 2);
  // artwork is fetched once, then served from disk
  const before = hf.tm.calls.length;
  for (let i = 0; i < 2; i++) assert.equal((await hf.api('GET', items['Night Drive'].backdrop, null, { raw: true })).status, 200);
  assert.equal(hf.tm.calls.length - before, 1);
  assert.equal((await hf.api('GET', items['Night Drive'].poster, null, { raw: true })).status, 200);
  const shows = await hf.api('GET', `/api/library/${lib.shows.id}`);
  const show = await hf.api('GET', `/api/items/${shows.items[0].id}`);
  assert.equal(show.title, 'Harbor Lights'); assert.equal(show.rating, 'TV-14');
  assert.deepEqual(show.seasons.map((s) => [s.title, s.episodes.map((e) => e.title)]), [['Season 1', ['Chapter 1.1', 'Chapter 1.2']], ['The Storm', ['Chapter 2.1']]]);
  assert.equal(show.playLabel, 'S1 E1');
  items.show = show; items.eps = show.seasons.flatMap((s) => s.episodes);
  // a second scan changes nothing and asks TMDb only about the one unmatched movie
  const calls = hf.tm.calls.length;
  await hf.api('POST', '/api/studio/scan', {}); await hf.scan.idle();
  assert.ok(hf.tm.calls.length - calls <= 2, `rescan made ${hf.tm.calls.length - calls} TMDb calls`);
  assert.equal((await hf.api('GET', `/api/library/${lib.movies.id}`)).total, 4);
});

test('home, title pages and search', async () => {
  const home = await hf.api('GET', '/api/home');
  assert.ok(home.spotlight.length >= 3 && home.spotlight.every((s) => s.backdrop));
  assert.deepEqual(home.rows.map((r) => r.id).slice(0, 2), [`recent-${lib.movies.id}`, `recent-${lib.shows.id}`]);
  assert.deepEqual(home.libraries.map((l) => [l.name, l.kind, l.count]), [['Movies', 'movies', 4], ['Shows', 'shows', 1]]);
  assert.ok(home.libraries[0].backdrop && home.libraries[0].posters.length === 3 && home.libraries[0].fresh === 4);
  const d = await hf.api('GET', `/api/items/${items['Night Drive'].id}`);
  assert.equal(d.tagline, 'Keep driving.'); assert.equal(d.people[0].name, 'Ada Reyes'); assert.equal(d.media.quality, 'SD');
  assert.deepEqual(d.similar.map((s) => s.title), ['The Long Signal']);
  assert.deepEqual((await hf.api('GET', '/api/search?q=signal')).items.map((i) => i.title), ['The Long Signal']);
  assert.deepEqual((await hf.api('GET', '/api/search?q=ada%20reyes')).items.map((i) => i.title), ['Night Drive']);
  assert.equal((await hf.api('GET', '/api/search?q=drama')).items[0].title, 'Harbor Lights');
  await hf.api('POST', '/api/mylist', { itemId: d.id, on: true });
  assert.equal((await hf.api('GET', `/api/items/${d.id}`)).inList, true);
  assert.equal((await hf.api('GET', '/api/home')).rows[0].id, 'mylist');
});

test('direct play: the original file, with byte ranges', async () => {
  const { queue } = await hf.api('POST', '/api/play', { itemId: items['Night Drive'].id, caps: browser });
  assert.equal(queue.length, 1);
  assert.deepEqual([queue[0].mode, queue[0].url], ['direct', `/api/file/${items['Night Drive'].id}`]);
  const file = path.join(media, 'Movies', 'Night Drive (2019)', 'Night Drive (2019).mp4');
  const res = await hf.api('GET', queue[0].url, null, { raw: true, headers: { Range: 'bytes=1000-1999' } });
  assert.equal(res.status, 206);
  assert.equal(res.headers.get('content-range'), `bytes 1000-1999/${fs.statSync(file).size}`);
  assert.deepEqual(Buffer.from(await res.arrayBuffer()), fs.readFileSync(file).subarray(1000, 2000));
  const tail = await hf.api('GET', queue[0].url, null, { raw: true, headers: { Range: 'bytes=-500' } });
  assert.equal((await tail.arrayBuffer()).byteLength, 500);
  assert.equal((await fetch(hf.base + queue[0].url)).status, 401, 'files need a signed-in profile');
});

test('remux: video copied untouched, audio converted, seeking lands on a keyframe', async () => {
  const id = items['The Long Signal'].id;
  const { queue } = await hf.api('POST', '/api/play', { itemId: id, caps: browser });
  const main = queue[0];
  assert.equal(main.mode, 'remux'); assert.equal(main.url, null);
  assert.deepEqual(main.audio.map((a) => a.label), ['English', 'Spanish']);
  assert.deepEqual(main.subs.map((s) => s.label), ['English', 'Spanish']);
  const s = await hf.api('POST', '/api/play/session', { itemId: id, caps: browser, start: 0 });
  assert.equal(s.start, 0);
  const done = await finished(s.url);
  assert.ok(Math.abs(total(done) - 40) < 1, `whole film is there (${total(done)}s)`);
  const p = await segment(`/hls/${s.sid}/${segs(done)[0]}`, 'remux0.ts');
  const v = p.streams.find((x) => x.codec_type === 'video'), a = p.streams.find((x) => x.codec_type === 'audio');
  assert.deepEqual([v.codec_name, v.width, a.codec_name, a.channels], ['h264', 640, 'aac', 2]);
  // seek: 17s is mid-GOP, so the stream starts at the keyframe before it (16s) and says so
  const s2 = await hf.api('POST', '/api/play/session', { itemId: id, caps: browser, start: 17, replace: s.sid });
  assert.equal(s2.start, 16);
  const t2 = total(await finished(s2.url));
  assert.ok(Math.abs(t2 - 24) < 1, `after seeking, ${t2}s remain`);
  // the other audio track
  const s3 = await hf.api('POST', '/api/play/session', { itemId: id, caps: browser, start: 0, audio: 1 });
  await finished(s3.url);
  assert.equal((await fetch(`${hf.base}/hls/${s.sid}/index.m3u8`)).status, 404, 'the replaced session is gone');
  await hf.api('DELETE', `/api/play/session/${s3.sid}`);
  assert.equal((await fetch(`${hf.base}/hls/${s3.sid}/index.m3u8`)).status, 404);
});

test('transcode: unsupported video becomes H.264, and can start mid-film', async () => {
  const id = items['Deep Field'].id;
  const { queue } = await hf.api('POST', '/api/play', { itemId: id, caps: browser });
  assert.equal(queue[0].mode, 'transcode');
  const s = await hf.api('POST', '/api/play/session', { itemId: id, caps: browser, start: 7.5 });
  assert.equal(s.start, 7.5); assert.equal(s.hw, false);
  const done = await finished(s.url);
  assert.ok(Math.abs(total(done) - 12.5) < 0.6, `${total(done)}s`);
  const p = await segment(`/hls/${s.sid}/${segs(done)[0]}`, 'tc0.ts');
  assert.deepEqual(p.streams.map((x) => x.codec_name).sort(), ['aac', 'h264']);
  // quality cap
  const small = await hf.api('POST', '/api/play/session', { itemId: items['Night Drive'].id, caps: browser, quality: '240' });
  assert.equal(small.mode, 'transcode');
  const sp = await segment(`/hls/${small.sid}/${segs(await finished(small.url))[0]}`, 'small.ts');
  assert.equal(sp.streams.find((x) => x.codec_type === 'video').height, 240);
});

test('10-bit HEVC: copied for a TV that plays it, converted for a browser', async () => {
  const id = items['Quiet Orbit'].id;
  assert.equal((await hf.api('POST', '/api/play', { itemId: id, caps: hevcTv })).queue[0].mode, 'direct');
  const mkvOnly = { ...hevcTv, containers: ['mp4'] };
  const s = await hf.api('POST', '/api/play/session', { itemId: id, caps: mkvOnly });
  assert.equal(s.mode, 'remux');
  const done = await finished(s.url);
  assert.match(done, /#EXT-X-MAP:URI="init\.mp4"/);
  const init = Buffer.from(await (await fetch(`${hf.base}/hls/${s.sid}/init.mp4`)).arrayBuffer());
  const seg = Buffer.from(await (await fetch(`${hf.base}/hls/${s.sid}/${segs(done)[0]}`)).arrayBuffer());
  fs.writeFileSync(path.join(root, 'hevc.mp4'), Buffer.concat([init, seg]));
  const v = ffprobe(path.join(root, 'hevc.mp4')).streams.find((x) => x.codec_type === 'video');
  assert.deepEqual([v.codec_name, v.pix_fmt, v.codec_tag_string], ['hevc', 'yuv420p10le', 'hvc1']);
  const b = await hf.api('POST', '/api/play/session', { itemId: id, caps: browser });
  assert.equal(b.mode, 'transcode');
  const bp = await segment(`/hls/${b.sid}/${segs(await finished(b.url))[0]}`, 'hevc-tc.ts');
  assert.deepEqual([bp.streams.find((x) => x.codec_type === 'video').codec_name, bp.streams.find((x) => x.codec_type === 'video').pix_fmt], ['h264', 'yuv420p']);
});

test('subtitles come out as WebVTT, embedded and sidecar', async () => {
  const id = items['The Long Signal'].id;
  const e = await (await hf.api('GET', `/api/subs/${id}/e0`, null, { raw: true })).text();
  assert.match(e, /^WEBVTT/); assert.match(e, /00:01\.0\d\d --> 00:04\.0\d\d\nThe signal is getting stronger\./); assert.match(e, /Hold the line\./);
  const x = await (await hf.api('GET', `/api/subs/${id}/x0`, null, { raw: true })).text();
  assert.match(x, /La señal es más fuerte\./);
  assert.equal((await hf.api('GET', `/api/subs/${id}/e9`, null, { raw: true })).status, 404);
});

test('pre-rolls play first, follow their rules, and are skipped on resume', async () => {
  const pr = await hf.api('GET', '/api/studio/prerolls');
  assert.deepEqual(pr.clips.map((c) => [c.title, c.tags]), [['hallflix ident', []], ['spooky bump', ['halloween']]]);
  const ident = pr.clips[0].id, spooky = pr.clips[1].id;
  await hf.api('POST', '/api/studio/prerolls/rules', { name: 'Ident before everything', clips: { mode: 'pick', ids: [ident] }, position: 1 });
  const rule = await hf.api('POST', '/api/studio/prerolls/rules', { name: 'Spooky before thrillers', clips: { mode: 'tag', tag: 'halloween' }, match: { genres: ['Thriller'], kinds: ['movie'] }, position: 0 });
  let { queue } = await hf.api('POST', '/api/play', { itemId: items['Night Drive'].id, caps: browser });
  assert.deepEqual(queue.map((e) => [e.kind, e.itemId, e.mode]), [['preroll', spooky, 'direct'], ['preroll', ident, 'direct'], ['main', items['Night Drive'].id, 'direct']]);
  assert.equal((await hf.api('GET', queue[0].url, null, { raw: true })).status, 200);
  ({ queue } = await hf.api('POST', '/api/play', { itemId: items.eps[0].id, caps: browser }));
  assert.deepEqual(queue.map((e) => e.kind), ['preroll', 'main']);
  assert.equal(queue[1].next.title, 'Chapter 1.2'); assert.equal(queue[1].subtitle, 'Harbor Lights · S1 E1');
  await hf.api('PUT', '/api/studio/settings', { prerolls: { enabled: true, max: 1 } });
  assert.equal((await hf.api('POST', '/api/play', { itemId: items['Night Drive'].id, caps: browser })).queue.length, 2);
  await hf.api('POST', '/api/progress', { itemId: items['Night Drive'].id, position: 300, duration: 5880 });
  ({ queue } = await hf.api('POST', '/api/play', { itemId: items['Night Drive'].id, caps: browser }));
  assert.deepEqual([queue.length, queue[0].resumeAt], [1, 300]);
  await hf.api('PUT', '/api/studio/settings', { prerolls: { enabled: false, max: 2 } });
  assert.equal((await hf.api('POST', '/api/play', { itemId: items.eps[0].id, caps: browser })).queue.length, 1);
  await hf.api('DELETE', `/api/studio/prerolls/rules/${rule.id}`);
  assert.equal((await hf.api('GET', '/api/studio/prerolls')).rules.length, 1);
});

test('progress: continue watching, finishing, and what is up next', async () => {
  let home = await hf.api('GET', '/api/home');
  assert.equal(home.rows[0].id, 'continue'); assert.equal(home.rows[0].items[0].title, 'Night Drive');
  assert.equal(home.rows[0].items[0].progress.position, 300);
  assert.equal((await hf.api('POST', '/api/progress', { itemId: items['Night Drive'].id, position: 5700, duration: 5880 })).watched, true);
  await hf.api('POST', '/api/progress', { itemId: items.eps[0].id, position: 9.9, duration: 10 });
  home = await hf.api('GET', '/api/home');
  assert.deepEqual(home.rows[0].items.map((i) => [i.title, i.show?.episode]), [['Chapter 1.2', 2]], 'the next episode is offered once one is finished');
  const show = await hf.api('GET', `/api/items/${items.show.id}`);
  assert.equal(show.playLabel, 'S1 E2');
  assert.equal(show.seasons[0].episodes[0].progress.watched, true);
  await hf.api('POST', '/api/watched', { itemId: items.show.id, watched: true });
  assert.ok((await hf.api('GET', `/api/items/${items.show.id}`)).seasons.every((s) => s.episodes.every((e) => e.progress.watched)));
  await hf.api('POST', '/api/watched', { itemId: items.show.id, watched: false });
  assert.equal((await hf.api('GET', `/api/items/${items.show.id}`)).playLabel, 'S1 E1');
});

test('looks: theme, library looks, seasons, uploads', async () => {
  const up = await hf.api('POST', '/api/studio/upload?name=back.jpg', tinyJpeg());
  assert.match(up.url, /^\/uploads\/[a-f0-9]{16}\.jpg$/);
  assert.equal((await fetch(hf.base + up.url)).status, 200);
  assert.equal((await hf.api('POST', '/api/studio/upload?name=evil.html', Buffer.from('<script>'))).$status, 400);
  await hf.api('PUT', '/api/studio/theme', { theme: { colors: { accent: '#ff00aa' }, radius: 4 } });
  await hf.api('PUT', `/api/studio/libraries/${lib.movies.id}`, { look: { background: up.url, accent: '#00ff00' } });
  let b = await hf.api('GET', '/api/boot');
  assert.deepEqual([b.look.theme.colors.accent, b.look.theme.radius, b.look.theme.colors.bg], ['#ff00aa', 4, '#0a0814']);
  assert.equal(b.look.libraries[lib.movies.id].background, up.url);
  const now = new Date(), md = (d) => `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const season = { name: 'Today Only', starts: md(now), ends: md(now), look: { theme: { colors: { accent: '#ff7518' }, effect: 'bats' }, libraries: { [lib.movies.id]: { accent: '#8a2be2' } } } };
  const pv = await hf.api('POST', '/api/studio/look/preview', { season });
  assert.deepEqual([pv.theme.colors.accent, pv.season], ['#ff7518', 'Today Only']);
  assert.equal((await hf.api('GET', '/api/boot')).look.season, null, 'a preview saves nothing');
  const saved = await hf.api('POST', '/api/studio/seasons', season);
  b = await hf.api('GET', '/api/boot');
  assert.deepEqual([b.look.season, b.look.theme.colors.accent, b.look.theme.effect, b.look.theme.radius], ['Today Only', '#ff7518', 'bats', 4]);
  assert.deepEqual(b.look.libraries[lib.movies.id], { background: up.url, accent: '#8a2be2' });
  await hf.api('POST', '/api/studio/seasons', { ...saved, enabled: false });
  assert.equal((await hf.api('GET', '/api/boot')).look.theme.colors.accent, '#ff00aa');
  const picked = await hf.api('POST', '/api/studio/pick', { path: path.join(media, 'Movies', 'Night Drive (2019)', 'poster.jpg') });
  assert.equal((await fetch(hf.base + picked.url)).status, 200);
  assert.equal((await hf.api('POST', '/api/studio/pick', { path: '/etc/passwd' })).$status, 400);
});

test('plugins install from a zip and reach the apps', async () => {
  const pkg = zip({
    'retro-pack/plugin.json': JSON.stringify({ id: 'retro-pack', name: 'Retro Pack', version: '1.2.0', contributes: { css: ['retro.css'], js: ['retro.js', '../../etc/passwd'], themes: [{ name: 'Arcade', theme: { colors: { accent: '#39ff14' } } }] } }),
    'retro-pack/retro.css': '.card{outline:1px solid lime}', 'retro-pack/retro.js': 'HallFlix.on("ready",()=>{})',
  });
  assert.equal((await hf.api('POST', '/api/studio/plugins', pkg)).id, 'retro-pack');
  let b = await hf.api('GET', '/api/boot');
  assert.deepEqual(b.plugins, [{ id: 'retro-pack', name: 'Retro Pack', version: '1.2.0', css: ['/plugins/retro-pack/retro.css?v=1.2.0'], js: ['/plugins/retro-pack/retro.js?v=1.2.0'] }]);
  assert.equal(await (await fetch(hf.base + b.plugins[0].css[0])).text(), '.card{outline:1px solid lime}');
  assert.ok((await hf.api('GET', '/api/studio/look')).presets.some((p) => p.id === 'retro-pack:arcade'));
  await hf.api('PUT', '/api/studio/plugins/retro-pack', { enabled: false });
  assert.deepEqual((await hf.api('GET', '/api/boot')).plugins, []);
  assert.equal((await hf.api('POST', '/api/studio/plugins', zip({ '../evil.txt': 'x', 'plugin.json': '{"id":"evil-one"}' }))).$status, 400);
  assert.ok(!fs.existsSync(path.join(root, 'data', 'evil.txt')));
  await hf.api('DELETE', '/api/studio/plugins/retro-pack');
  assert.deepEqual(await hf.api('GET', '/api/studio/plugins').then((l) => [...l].filter((p) => p.id === 'retro-pack')), []);
});

test('profiles: separate history, no Studio access, and guessing is slowed down', async () => {
  const kid = await hf.api('POST', '/api/studio/profiles', { name: 'Guest', password: '4321' });
  assert.equal(kid.admin, false);
  assert.equal((await hf.api('POST', '/api/studio/profiles', { name: 'Guest', password: '9999' })).$status, 400);
  const adminCookie = hf.getCookie();
  hf.setCookie('');
  const b = await hf.api('GET', '/api/boot');
  assert.deepEqual(b.profiles.map((p) => p.name), ['Jus', 'Guest']); assert.equal(b.profile, null); assert.equal(b.libraries, undefined);
  assert.equal((await hf.api('POST', '/api/login', { profileId: kid.id, password: 'nope' })).$status, 401);
  const ok = await hf.api('POST', '/api/login', { profileId: kid.id, password: '4321' });
  assert.equal(ok.profile.name, 'Guest');
  assert.equal((await hf.api('GET', '/api/studio/overview')).$status, 403);
  assert.ok(!(await hf.api('GET', '/api/home')).rows.some((r) => r.id === 'continue' || r.id === 'mylist'));
  // a token also works as a header or query value, for the TV apps
  assert.equal((await fetch(`${hf.base}/api/home`, { headers: { Authorization: `Bearer ${ok.token}` } })).status, 200);
  assert.equal((await fetch(`${hf.base}/api/file/${items['Night Drive'].id}?t=${ok.token}`, { headers: { Range: 'bytes=0-9' } })).status, 206);
  await hf.api('POST', '/api/logout');
  assert.equal((await fetch(`${hf.base}/api/home`, { headers: { Authorization: `Bearer ${ok.token}` } })).status, 401);
  hf.setCookie('');
  let last;
  for (let i = 0; i < 9; i++) last = await hf.api('POST', '/api/login', { name: 'Jus', password: `guess${i}` });
  assert.equal(last.$status, 429);
  assert.equal((await hf.api('POST', '/api/login', { name: 'Jus', password: 'reel-2026' })).$status, 429);
  hf.setCookie(adminCookie);
  assert.equal((await hf.api('GET', '/api/studio/overview')).$status, 200);
});

test('files that disappear are removed; a missing folder does not wipe a library', async () => {
  fs.rmSync(path.join(media, 'Movies', 'Quiet Orbit (2022).mkv'));
  fs.renameSync(path.join(media, 'Shows'), path.join(media, 'Shows-offline'));
  await hf.api('POST', '/api/studio/scan', {}); await hf.scan.idle();
  const ov = await hf.api('GET', '/api/studio/overview');
  assert.deepEqual(ov.libraries.map((l) => [l.kind, l.titles, l.episodes]), [['movies', 3, 0], ['shows', 1, 3], ['prerolls', 2, 0]]);
  assert.match(ov.scan.errors.join(' '), /Folder not found/);
  fs.renameSync(path.join(media, 'Shows-offline'), path.join(media, 'Shows'));
});

test('admins remove titles from HallFlix, delete files from the NAS, and bring titles back', async () => {
  await hf.api('POST', '/api/studio/scan', {}); await hf.scan.idle();
  const find = async (q) => (await hf.api('GET', `/api/search?q=${encodeURIComponent(q)}`)).items[0];
  const movieDir = path.join(media, 'Movies');

  // A movie in its own folder is removed folder and all; a loose file takes only its own subtitles with it.
  const night = await find('night drive');
  let p = await hf.api('GET', `/api/studio/items/${night.id}/remove`);
  assert.deepEqual(p.targets, [{ path: path.join(movieDir, 'Night Drive (2019)'), folder: true }]);
  assert.equal(p.files, 2); assert.equal(p.canDelete, true);
  const signal = await find('signal');
  p = await hf.api('GET', `/api/studio/items/${signal.id}/remove`);
  assert.deepEqual(p.targets.map((t) => [path.basename(t.path), t.folder]),
    [['The.Long.Signal.2021.1080p.BluRay.x264-GRP.mkv', false], ['The.Long.Signal.2021.1080p.BluRay.x264-GRP.es.srt', false]]);

  // Remove from HallFlix: gone from the app, still on disk, and a rescan does not bring it back.
  assert.equal((await hf.api('POST', `/api/studio/items/${night.id}/hide`, {})).title, 'Night Drive');
  assert.equal((await hf.api('GET', `/api/items/${night.id}`)).$status, 404);
  await hf.api('POST', '/api/studio/scan', {}); await hf.scan.idle();
  assert.equal(await find('night drive'), undefined);
  assert.ok(fs.existsSync(path.join(movieDir, 'Night Drive (2019)', 'Night Drive (2019).mp4')));
  let hidden = await hf.api('GET', '/api/studio/hidden');
  assert.deepEqual(hidden.map((h) => [h.title, h.library]), [['Night Drive', 'Movies']]);
  await hf.api('DELETE', `/api/studio/hidden/${hidden[0].id}`); await hf.scan.idle();
  assert.equal((await find('night drive')).title, 'Night Drive');

  // A season can be removed and brought back on its own.
  const harbor = await find('harbor');
  let show = await hf.api('GET', `/api/items/${harbor.id}`);
  const s1 = show.seasons.find((s) => s.number === 1 || /1$/.test(s.title));
  await hf.api('POST', `/api/studio/items/${s1.id}/hide`, {});
  await hf.api('POST', '/api/studio/scan', {}); await hf.scan.idle();
  show = await hf.api('GET', `/api/items/${harbor.id}`);
  assert.deepEqual(show.seasons.map((s) => s.episodes.length), [1]);
  hidden = await hf.api('GET', '/api/studio/hidden');
  assert.equal(hidden.length, 2);
  await hf.api('DELETE', `/api/studio/hidden/${hidden[0].id}`); await hf.scan.idle();
  assert.equal((await hf.api('GET', '/api/studio/hidden')).length, 0, 'bringing back a season restores all its episodes');
  show = await hf.api('GET', `/api/items/${harbor.id}`);
  assert.deepEqual(show.seasons.map((s) => s.episodes.length), [2, 1]);

  // Delete from the NAS: the files go, and so does the title. An emptied show disappears with its last episode.
  const ep = show.seasons[1].episodes[0];
  const epFile = path.join(media, 'Shows', 'Harbor Lights (2018)', 'Season 02', 'Harbor.Lights.S02E01.720p.WEB.mkv');
  assert.ok(fs.existsSync(epFile));
  await hf.api('POST', `/api/studio/items/${ep.id}/delete`, {});
  assert.ok(!fs.existsSync(epFile));
  assert.deepEqual((await hf.api('GET', `/api/items/${harbor.id}`)).seasons.map((s) => s.episodes.length), [2]);
  const r = await hf.api('POST', `/api/studio/items/${signal.id}/delete`, {});
  assert.equal(r.files, 2);
  assert.ok(!fs.readdirSync(movieDir).some((f) => f.startsWith('The.Long.Signal')));
  assert.equal(await find('signal'), undefined);
  assert.ok(fs.existsSync(path.join(movieDir, 'Deep Field (2020) [tmdbid-777]')), 'other movies are untouched');

  // Nothing outside a library can be targeted, and viewers cannot use any of this.
  assert.equal((await hf.api('GET', '/api/studio/items/999999/remove')).$status, 404);
});

test('app download links point at the latest builds', async () => {
  const r = await fetch(`${hf.base}/get/android`, { redirect: 'manual' });
  assert.equal(r.status, 302);
  assert.match(r.headers.get('location'), /releases\/download\/apps\/hallflix\.apk$/);
  assert.match((await fetch(`${hf.base}/get/roku`, { redirect: 'manual' })).headers.get('location'), /hallflix-roku\.zip$/);
  assert.equal((await fetch(`${hf.base}/get/windows`, { redirect: 'manual' })).status, 404);
});

test('the web app and Studio pages are served', async () => {
  for (const p of ['/', '/studio', '/js/app.js', '/app.css', '/vendor/hls.min.js', '/assets/logo.png', '/manifest.webmanifest']) {
    assert.equal((await fetch(hf.base + p)).status, 200, p);
  }
  assert.ok([400, 404].includes((await fetch(`${hf.base}/..%2f..%2fetc/passwd`)).status), "path traversal is refused");
  assert.equal((await fetch(`${hf.base}/api/nope`)).status, 404);
});
