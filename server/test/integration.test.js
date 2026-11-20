import { spawn, execFileSync } from 'node:child_process';
const ffprobeJson = (buf) => new Promise((resolve, reject) => {
  const c = spawn('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', '-i', 'pipe:0']);
  let out = ''; c.stdout.on('data', (d) => { out += d; }); c.on('close', () => resolve(out)); c.on('error', reject); c.stdin.end(buf);
});
/** A small PDF: one coloured rectangle per page. */
function makePdf(pages) {
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', ''];
  const kids = [];
  for (let i = 0; i < pages; i++) {
    const content = `${(i * 0.3) % 1} 0.4 0.7 rg 40 40 520 760 re f`;
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 840] /Contents ${objs.length + 2} 0 R >>`);
    kids.push(`${objs.length} 0 R`);
    objs.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  }
  objs[1] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pages} >>`;
  let out = '%PDF-1.4\n';
  const at = [];
  objs.forEach((o, i) => { at.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${at.map((n) => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
// End-to-end: scan real files, then play them through every path and check what comes out with ffprobe.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { boot, makeMedia, media, root, zip, ffprobe, tinyJpeg } from './helpers.js';
import { imageSize } from '../src/archive.js';

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
  // Banner clips come from the film itself: the first ask says "not yet" and starts one; then a short MP4 is served.
  const night = home.spotlight.find((x) => x.title === 'Night Drive') || home.spotlight.find((x) => x.kind === 'movie');
  let clip = await hf.api('GET', `/api/clips/${night.id}`);
  for (let i = 0; i < 60 && !clip.url; i++) { await new Promise((r) => setTimeout(r, 500)); clip = await hf.api('GET', `/api/clips/${night.id}`); }
  assert.match(clip.url || '', new RegExp(`^/api/clips/${night.id}/file/\\d$`), 'a clip was made from the file');
  const cr = await fetch(hf.base + clip.url, { headers: { Cookie: hf.getCookie(), Range: 'bytes=0-99' } });
  assert.deepEqual([cr.status, cr.headers.get('content-type')], [206, 'video/mp4']);
  assert.equal((await fetch(hf.base + clip.url)).status, 401, 'clips need a signed-in profile');
  // A show's clip comes from one of its episodes.
  const show = home.spotlight.find((x) => x.kind === 'show');
  if (show) { let sc = await hf.api('GET', `/api/clips/${show.id}`); for (let i = 0; i < 60 && !sc.url; i++) { await new Promise((r) => setTimeout(r, 500)); sc = await hf.api('GET', `/api/clips/${show.id}`); } assert.ok(sc.url); }
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

test('even volume: pre-rolls come turned down to the level of the title after them', async () => {
  await hf.api('PUT', '/api/studio/prerolls/settings', { enabled: true, max: 2, evenVolume: true, volumeOffset: -6 });
  let queue = [];
  for (let i = 0; i < 60; i++) { // clips and the movie are measured in the background
    ({ queue } = await hf.api('POST', '/api/play', { itemId: items['Night Drive'].id, caps: browser, start: 0 }));
    if (queue.filter((e) => e.kind === 'preroll').every((e) => e.gain != null)) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  const pre = queue.filter((e) => e.kind === 'preroll');
  assert.ok(pre.length);
  // The sample clips and the movie share a test tone, so "6 dB quieter than the movie" comes out near half volume.
  for (const e of pre) assert.ok(e.gain > 0.35 && e.gain < 0.7, `gain ${e.gain}`);
  assert.equal(queue.at(-1).gain, undefined);
  const pr = await hf.api('GET', '/api/studio/prerolls');
  assert.ok(pr.clips.every((c) => typeof c.lufs === 'number'));
  const t = await hf.api('POST', '/api/studio/prerolls/test', { itemId: items['Night Drive'].id });
  assert.ok(t.clips.every((c) => c.volume > 0.35 && c.volume < 0.7));
  assert.ok(t.log.some((x) => /Even volume: the movie is about -?\d/.test(x.note)));
  await hf.api('PUT', '/api/studio/prerolls/settings', { enabled: false, evenVolume: false, volumeOffset: 0 });
  assert.equal((await hf.api('GET', '/api/studio/prerolls')).settings.evenVolume, false);
});

test('pre-roll reach: tag groups list the titles they play before, and coverage', async () => {
  const pr = await hf.api('GET', '/api/studio/prerolls');
  const spooky = pr.clips.find((c) => c.tags.includes('halloween'));
  const rule = await hf.api('POST', '/api/studio/prerolls/rules', { name: 'Spooky thrillers', clips: { mode: 'tag', tag: 'halloween' }, match: { genres: ['Thriller'] }, position: 0 });
  const r = await hf.api('GET', '/api/studio/prerolls/reach?limit=1');
  const g = r.groups.find((x) => x.tag === 'halloween');
  assert.ok(g.count >= 1 && g.titles.length === 1 && g.titles[0].title);
  assert.deepEqual(g.rules, ['Spooky thrillers']);
  assert.equal(r.rules[rule.id], g.count);
  assert.equal(r.classes.matched.count + r.classes.general.count + r.classes.none.count, r.total);
  const all = await hf.api('GET', '/api/studio/prerolls/reach?list=tag:halloween');
  assert.equal(all.titles.length, g.count);
  assert.ok(all.titles.some((t) => t.title === 'Night Drive'));
  assert.equal((await hf.api('GET', `/api/studio/prerolls/reach?list=rule:${rule.id}`)).titles.length, g.count);
  assert.equal((await hf.api('GET', '/api/file/' + spooky.id, null, { raw: true })).status, 200); // previews play the clip file
  await hf.api('DELETE', `/api/studio/prerolls/rules/${rule.id}`);
});

test('pre-rolls matched to the title’s own tags: a “birthday” clip before titles tagged “birthday”', async () => {
  const pr = await hf.api('GET', '/api/studio/prerolls');
  const spooky = pr.clips.find((c) => c.title === 'spooky bump');
  const others = pr.rules.map((r) => r.id);
  for (const id of others) await hf.api('DELETE', `/api/studio/prerolls/rules/${id}`);
  await hf.api('PUT', `/api/studio/prerolls/clips/${spooky.id}`, { tags: ['halloween', 'Birthday'] });
  await hf.api('POST', `/api/studio/meta/item/${items['Night Drive'].id}`, { values: { tags: ['Birthday'] } });
  const lib = pr.libraries.find((l) => l.kind === 'movies');
  const rule = await hf.api('POST', '/api/studio/prerolls/rules', { name: 'Tag match', clips: { mode: 'match', on: ['tags'] }, match: { libraries: [lib.id] }, position: 0 });
  await hf.api('PUT', '/api/studio/prerolls/settings', { enabled: true, max: 2 });
  const pre = async (id) => (await hf.api('POST', '/api/play', { itemId: id, caps: browser, start: 0 })).queue.filter((e) => e.kind === 'preroll').map((e) => e.itemId);
  assert.deepEqual(await pre(items['Night Drive'].id), [spooky.id]);
  const other = Object.values(items).find((x) => x?.id && x.id !== items['Night Drive'].id && x.kind === 'movie') || items['Signal Fires'];
  if (other) assert.deepEqual(await pre(other.id), []);
  const t = await hf.api('POST', '/api/studio/prerolls/test', { itemId: items['Night Drive'].id });
  assert.deepEqual(t.facts.tags, ['Birthday']);
  const reach = await hf.api('GET', '/api/studio/prerolls/reach');
  assert.deepEqual(reach.groups.find((g) => g.tag === 'birthday').titles.map((x) => x.title), ['Night Drive']);
  const h = await hf.api('GET', '/api/studio/prerolls/health');
  assert.ok(!h.some((x) => /no clip tag is used on any movie/.test(x.text)));
  await hf.api('DELETE', `/api/studio/prerolls/rules/${rule.id}`);
  await hf.api('PUT', `/api/studio/prerolls/clips/${spooky.id}`, { tags: ['halloween'] });
  await hf.api('POST', `/api/studio/meta/item/${items['Night Drive'].id}`, { values: { tags: [] } });
  await hf.api('PUT', '/api/studio/prerolls/settings', { enabled: false, max: 2 });
  for (const r of pr.rules) await hf.api('POST', '/api/studio/prerolls/rules', { ...r, id: undefined, stop: r.match?.stop });
});

test('shared tags: with no rules at all, a clip plays before titles that share a tag with it, tagged anywhere', async () => {
  const pr = await hf.api('GET', '/api/studio/prerolls');
  const spooky = pr.clips.find((c) => c.title === 'spooky bump'), ident = pr.clips.find((c) => c.title === 'hallflix ident');
  for (const r of pr.rules) await hf.api('DELETE', `/api/studio/prerolls/rules/${r.id}`);
  await hf.api('PUT', '/api/studio/prerolls/settings', { enabled: true, max: 2 });
  const pre = async (id) => (await hf.api('POST', '/api/play', { itemId: id, caps: browser, start: 0 })).queue.filter((e) => e.kind === 'preroll').map((e) => e.itemId);
  assert.deepEqual(await pre(items['Night Drive'].id), []); // nothing shares a tag yet
  // The clip and the movie are both tagged in Metadata, the same tool.
  await hf.api('POST', `/api/studio/meta/item/${ident.id}`, { values: { tags: ['Anniversary'] } });
  await hf.api('POST', `/api/studio/meta/item/${items['Night Drive'].id}`, { values: { tags: ['anniversary'] } });
  assert.deepEqual(await pre(items['Night Drive'].id), [ident.id]);
  const clips = (await hf.api('GET', '/api/studio/prerolls')).clips;
  assert.deepEqual(clips.find((c) => c.id === ident.id).metaTags, ['anniversary']);
  // A tag typed on the Clips tab works the same; "only matching clips" keeps the everyday clip out.
  await hf.api('PUT', `/api/studio/prerolls/clips/${spooky.id}`, { tags: ['halloween', 'anniversary'] });
  const everyday = await hf.api('POST', '/api/studio/prerolls/rules', { name: 'Everyday', clips: { mode: 'all' }, position: 1 });
  await hf.api('PUT', '/api/studio/prerolls/settings', { tagMatchCount: 2 });
  assert.deepEqual((await pre(items['Night Drive'].id)).sort(), [ident.id, spooky.id].sort());
  await hf.api('PUT', '/api/studio/prerolls/settings', { tagMatchCount: 1 });
  assert.equal((await pre(items['Night Drive'].id)).length, 1);
  await hf.api('PUT', '/api/studio/prerolls/settings', { tagMatchOnly: false });
  assert.equal((await pre(items['Night Drive'].id)).length, 2); // the matching clip, then the everyday rule
  const t = await hf.api('POST', '/api/studio/prerolls/test', { itemId: items['Night Drive'].id });
  assert.equal(t.clips[0].rule, 'Shared tags');
  const reach = await hf.api('GET', '/api/studio/prerolls/reach');
  assert.ok(reach.rules.tags >= 1 && reach.clips[ident.id] >= 1);
  assert.ok((await hf.api('GET', '/api/studio/prerolls/health')).some((h) => /Shared tags: 1 tag link/.test(h.text)));
  // Switched off, it's gone.
  await hf.api('PUT', '/api/studio/prerolls/settings', { tagMatch: false });
  assert.ok(!(await hf.api('POST', '/api/studio/prerolls/test', { itemId: items['Night Drive'].id })).clips.some((c) => c.rule === 'Shared tags'));
  await hf.api('DELETE', `/api/studio/prerolls/rules/${everyday.id}`);
  await hf.api('PUT', `/api/studio/prerolls/clips/${spooky.id}`, { tags: ['halloween'] });
  await hf.api('POST', `/api/studio/meta/item/${ident.id}`, { values: { tags: [] } });
  await hf.api('POST', `/api/studio/meta/item/${items['Night Drive'].id}`, { values: { tags: [] } });
  await hf.api('PUT', '/api/studio/prerolls/settings', { enabled: false, max: 2, tagMatch: true, tagMatchOnly: true, tagMatchCount: 1 });
  for (const r of pr.rules) await hf.api('POST', '/api/studio/prerolls/rules', { ...r, id: undefined, stop: r.match?.stop });
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
  // TVs get uploads as plain JPEG stills at a TV-friendly size, cached; anything the look doesn't use is refused.
  const still = await fetch(`${hf.base}/api/fit?w=640&src=${encodeURIComponent(up.url)}`);
  assert.equal(still.status, 200);
  assert.match(still.headers.get('content-type'), /image\/jpeg/);
  const sb = Buffer.from(await still.arrayBuffer());
  assert.deepEqual([sb[0], sb[1]], [0xff, 0xd8]);
  assert.equal((await fetch(`${hf.base}/api/fit?src=${encodeURIComponent('https://example.com/x.jpg')}`)).status, 404);
  assert.equal((await fetch(`${hf.base}/api/fit?src=${encodeURIComponent('/uploads/../config.json')}`)).status, 404);
  const tvd = (await hf.api('GET', '/api/boot')).look.theme;
  assert.deepEqual([tvd.tv.width, tvd.tv.stills, tvd.tv.effects, tvd.tv.rowItems, tvd.heroClips.tv], [1600, false, false, 12, false], 'TVs start light; videos keep playing');
  // TVs get the page laid out at a computer-like width from the first paint; other devices keep device-width.
  const tvHtml = await (await fetch(hf.base + '/', { headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 9; AFTKA) HallFlixApp/1 Android TV' } })).text();
  assert.match(tvHtml, /<meta name="viewport" content="width=1600, viewport-fit=cover">/);
  assert.match(await (await fetch(hf.base + '/')).text(), /width=device-width/);
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
  // Sounds and sign-in music: audio uploads are served as audio, and the new look settings come with sensible defaults.
  const snd = await hf.api('POST', '/api/studio/upload?name=whoosh.mp3', Buffer.from('ID3fake-mp3-bytes'));
  assert.match(snd.url, /^\/uploads\/[a-f0-9]{16}\.mp3$/);
  assert.equal((await fetch(hf.base + snd.url)).headers.get('content-type'), 'audio/mpeg');
  const d = (await hf.api('GET', '/api/studio/look')).defaults;
  assert.deepEqual([d.glowStyle, d.focusRing, d.atmosphere, d.tiles3d.style, d.soundFx.volume, d.login.music.enabled], ['natural', 'glow', 'none', 'layered', 0.8, false]);
  assert.deepEqual(d.rows, { items: 15, sections: 8, scroll: 'arrows', panel: false, panelHeight: 60 });
  assert.deepEqual([d.tileLogo, d.libLogoSize], [{ place: 'bl', size: 100, x: 0, y: 0, count: 'yes' }, 0]);
  assert.deepEqual([d.homeTiles, d.bannerLogo, d.ident.order], [{ width: 320, height: 44, brightness: 100 }, 100, 'shuffle']);
  assert.deepEqual(d.libPage, { place: 'left', x: 0, y: 0 });
  assert.deepEqual(d.splash, { image: '', size: 100, motion: 'pulse', background: '', video: '', when: 'signin', sound: true, audio: '' });
  assert.equal((await fetch(`${hf.base}/js/splash.js`)).status, 200, 'the loading screen script is served');
  // Pages carry versioned module addresses (cached for good) and everything text-based is gzipped.
  const pageHtml = await (await fetch(`${hf.base}/`)).text();
  const coreV = /"\/js\/core\.js":"(\/js\/core\.js\?v=[0-9a-f]{10})"/.exec(pageHtml)?.[1];
  assert.ok(coreV && pageHtml.includes('rel="modulepreload"'), 'an import map and preload links');
  const cv = await fetch(hf.base + coreV, { headers: { 'Accept-Encoding': 'gzip' } });
  assert.deepEqual([cv.headers.get('cache-control'), cv.headers.get('content-encoding')], ['public, max-age=31536000, immutable', 'gzip']);
  assert.equal((await fetch(`${hf.base}/api/home`, { headers: { Cookie: hf.getCookie(), 'Accept-Encoding': 'gzip' } })).headers.get('content-encoding'), 'gzip');
  assert.deepEqual(d.ranked, { style: 'outline', place: 'behind', size: 100, font: 'theme', color: 'text', strength: 62, scrollbar: false });
  // Each library comes with a recent picture for the Studio's mini tiles, and keeps its own dragged logo spot.
  assert.ok((await hf.api('GET', '/api/studio/look')).libraries.find((l) => l.id === lib.movies.id).art);
  await hf.api('PUT', `/api/studio/libraries/${lib.movies.id}`, { look: { tileLogo: { place: 'free', fx: 95, fy: 8, size: 140 } } });
  assert.deepEqual((await hf.api('GET', '/api/boot')).look.libraries[lib.movies.id].tileLogo, { place: 'free', fx: 95, fy: 8, size: 140 });
  // The tile's background is its own, separate from the library page's background.
  await hf.api('PUT', `/api/studio/libraries/${lib.movies.id}`, { look: { background: '/uploads/page.jpg', tileBackground: '/uploads/tile.jpg', tilePos: 'top' } });
  const both = (await hf.api('GET', '/api/boot')).look.libraries[lib.movies.id];
  assert.deepEqual([both.background, both.tileBackground, both.tilePos], ['/uploads/page.jpg', '/uploads/tile.jpg', 'top']);
  await hf.api('PUT', `/api/studio/libraries/${lib.movies.id}`, { look: {} });
  // A library's own row limits ride along with its look; empty choices mean "same as the whole app".
  await hf.api('PUT', `/api/studio/libraries/${lib.movies.id}`, { look: { rows: { items: '6', sections: '', panel: 'yes' } } });
  assert.deepEqual((await hf.api('GET', '/api/boot')).look.libraries[lib.movies.id].rows, { items: '6', panel: 'yes' });
  await hf.api('PUT', `/api/studio/libraries/${lib.movies.id}`, { look: {} });
  const cur = (await hf.api('GET', '/api/studio/look')).theme;
  await hf.api('PUT', '/api/studio/theme', { theme: { ...cur, sounds: 'glass', soundFx: { volume: 0.5, events: { select: { url: snd.url, volume: 1.2 } } },
    login: { ...(cur.login || {}), music: { enabled: true, tracks: [{ url: snd.url, name: 'Theme' }], volume: 0.4 } } } });
  b = await hf.api('GET', '/api/boot');
  assert.deepEqual([b.look.theme.sounds, b.look.theme.soundFx.events.select.url, b.look.theme.login.music.tracks[0].name, b.look.theme.login.music.shuffle], ['glass', snd.url, 'Theme', false]);
  const signedOut = await (await fetch(`${hf.base}/api/boot`)).json();
  assert.equal(signedOut.look.theme.login.music.tracks[0].url, snd.url, 'the sign-in page gets its music before anyone signs in');
  assert.equal((await fetch(hf.base + snd.url)).status, 200, 'and can play it without a session');
  await hf.api('PUT', '/api/studio/theme', { theme: cur });
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

test('moods, Surprise Me, timeline, collections and the Home layout', async () => {
  const find = async (q) => (await hf.api('GET', `/api/search?q=${encodeURIComponent(q)}`)).items[0];
  const [night, signal, deep, harbor] = [await find('night drive'), await find('signal'), await find('deep field'), await find('harbor')];
  let home = await hf.api('GET', '/api/home');
  assert.ok(home.moods.some((m) => m.id === 'intense') && home.moods.some((m) => m.id === 'true'));
  assert.equal(home.layout.tilesAt, 0);
  const intense = await hf.api('GET', '/api/mood/intense');
  assert.ok(intense.rows[0].items.some((i) => i.title === 'Night Drive') && !intense.rows[0].items.some((i) => i.title === 'Deep Field'));
  assert.equal((await hf.api('GET', '/api/mood/nope')).$status, 404);

  const any = await hf.api('GET', '/api/surprise');
  assert.ok(any.items.length >= 4 && any.items[0].poster);
  assert.ok((await hf.api('GET', '/api/surprise?kind=show')).items.every((i) => i.kind === 'show'));
  assert.deepEqual((await hf.api('GET', '/api/surprise?mood=true&kind=movie')).items.map((i) => i.title), ['Deep Field']);

  const tl = await hf.api('GET', '/api/timeline');
  assert.ok(tl.decades.some((d) => d.decade === 2010 && d.count >= 2) && tl.decades.some((d) => d.decade === 2020));
  const tens = await hf.api('GET', '/api/timeline/2010');
  assert.ok(tens.items.every((i) => i.year >= 2010 && i.year <= 2019) && tens.items.some((i) => i.title === 'Night Drive'));

  // A collection keeps its viewing order, and only an admin can make one.
  const c = await hf.api('POST', '/api/studio/collections', { name: 'Late Shift', description: 'After dark.', items: [signal.id, night.id, 999999] });
  assert.deepEqual((await hf.api('GET', `/api/collections/${c.id}`)).items.map((i) => i.title), ['The Long Signal', 'Night Drive']);
  await hf.api('POST', '/api/studio/collections', { id: c.id, name: 'Late Shift', items: [night.id, signal.id, deep.id] });
  assert.deepEqual((await hf.api('GET', `/api/collections/${c.id}`)).items.map((i) => i.title), ['Night Drive', 'The Long Signal', 'Deep Field']);
  home = await hf.api('GET', '/api/home');
  assert.deepEqual(home.collections.map((x) => [x.name, x.count]), [['Late Shift', 3]]);
  assert.ok(home.collections[0].backdrop && home.layout.collectionsAt >= 0);

  // Home layout: order, hidden sections, a pinned spotlight and an announcement.
  await hf.api('PUT', '/api/studio/home', { order: ['top', 'recent', 'libraries'], hidden: ['genres', 'collections'], spotlight: [harbor.id, deep.id], announcement: { text: 'New this week', link: '#/timeline' } });
  home = await hf.api('GET', '/api/home');
  assert.deepEqual(home.spotlight.map((x) => x.title), ['Harbor Lights', 'Deep Field'], 'only the picked titles, in order');
  // With "only these" off, shuffled titles follow the picks.
  await hf.api('PUT', '/api/studio/home', { order: ['top', 'recent', 'libraries'], hidden: ['genres', 'collections'], spotlight: [harbor.id, deep.id], announcement: { text: 'New this week', link: '#/timeline' }, banner: { pickedOnly: false, shuffle: 'visit', count: 4 } });
  const mixed = (await hf.api('GET', '/api/home')).spotlight;
  assert.ok(mixed.length > 2 && mixed.length <= 4 && mixed[0].title === 'Harbor Lights' && mixed[1].title === 'Deep Field');
  assert.deepEqual((await hf.api('GET', '/api/studio/home')).banner, { shuffle: 'visit', pickedOnly: false, favourNew: true, count: 4 });
  await hf.api('PUT', '/api/studio/home', { order: ['top', 'recent', 'libraries'], hidden: ['genres', 'collections'], spotlight: [harbor.id, deep.id], announcement: { text: 'New this week', link: '#/timeline' } });
  home = await hf.api('GET', '/api/home');
  assert.ok(!home.rows.some((r) => r.id.startsWith('genre-')) && !home.collections.length);
  assert.equal(home.layout.tilesAt, home.rows.findIndex((r) => r.id.startsWith('recent-')) + 2);
  assert.deepEqual(home.announcement, { text: 'New this week', link: '#/timeline' });
  await hf.api('PUT', '/api/studio/home', {});
  assert.equal((await hf.api('GET', '/api/home')).layout.tilesAt, 0);
  await hf.api('DELETE', `/api/studio/collections/${c.id}`);
});

test('skip marks, scrub previews, the ident, evening look, year in review and watch parties', async () => {
  const find = async (q) => (await hf.api('GET', `/api/search?q=${encodeURIComponent(q)}`)).items[0];
  const show = await hf.api('GET', `/api/items/${(await find('harbor')).id}`);
  const [e1, e2] = show.seasons[0].episodes;
  let r = await hf.api('POST', `/api/studio/items/${e1.id}/marks`, { introStart: 1, introEnd: 4.26, season: true });
  assert.deepEqual([r.marks, r.season], [{ introStart: 1, introEnd: 4.3 }, 1]);
  const play = async (id, extra = {}) => (await hf.api('POST', '/api/play', { itemId: id, caps: { containers: ['mp4', 'mkv'], video: ['h264'], audio: ['aac'] }, ...extra })).queue;
  assert.deepEqual((await play(e2.id)).at(-1).marks, { introStart: 1, introEnd: 4.3 }, 'copied to the rest of the season');
  r = await hf.api('POST', `/api/studio/items/${e1.id}/marks`, { introStart: null, introEnd: null });
  assert.deepEqual(r.marks, {});

  // Previews are made in the background the first time they are asked for.
  const signal = await find('signal');
  let th = await hf.api('GET', `/api/thumbs/${signal.id}`);
  assert.equal(th.ready, false);
  for (let i = 0; i < 60 && !th.ready; i++) { await new Promise((ok) => setTimeout(ok, 250)); th = await hf.api('GET', `/api/thumbs/${signal.id}`); }
  assert.ok(th.ready && th.count >= 5 && th.cols === 10);
  const sheet = await fetch(hf.base + th.url, { headers: { Cookie: hf.getCookie() } });
  assert.equal(sheet.headers.get('content-type'), 'image/jpeg');
  const meta = JSON.parse(await ffprobeJson(Buffer.from(await sheet.arrayBuffer())));
  assert.deepEqual([meta.streams[0].width, meta.streams[0].height], [th.cols * th.w, th.rows * th.h]);

  // An uploaded ident plays last before the feature, and not when resuming or auto-playing the next episode.
  const up = await hf.api('POST', '/api/studio/upload?name=ident.mp4', fs.readFileSync(path.join(media, 'Prerolls', 'hallflix-ident.mp4')));
  const theme = (await hf.api('GET', '/api/studio/look')).theme;
  await hf.api('PUT', '/api/studio/theme', { theme: { ...theme, ident: { enabled: true, video: up.url }, night: { enabled: true, from: '00:00', to: '23:59', theme: { colors: { accent: '#e8b84a' } } } } });
  let q = await play(signal.id);
  assert.deepEqual(q.slice(-2).map((x) => [x.kind, x.mode]), [['ident', 'direct'], ['main', q.at(-1).mode]]);
  assert.equal(q.at(-2).url, up.url);
  assert.ok(!(await play(signal.id, { prerolls: false })).some((x) => x.kind === 'ident'));
  assert.ok(!(await play(signal.id, { start: 90 })).some((x) => x.kind === 'ident'));

  // Several idents: shuffled never plays the same one twice in a row, "in turn" rotates through them, and the built-in
  // animation can join the mix (no ident in the queue: the website draws its own).
  const raw = fs.readFileSync(path.join(media, 'Prerolls', 'hallflix-ident.mp4'));
  const up2 = await hf.api('POST', '/api/studio/upload?name=ident2.mp4', Buffer.concat([raw, Buffer.from('2')]));
  const up3 = await hf.api('POST', '/api/studio/upload?name=ident3.mp4', Buffer.concat([raw, Buffer.from('3')]));
  const idents = [up.url, up2.url, up3.url].map((url) => ({ url, name: 'x' }));
  const identOf = async () => (await play(signal.id)).find((x) => x.kind === 'ident')?.url || 'built-in';
  await hf.api('PUT', '/api/studio/theme', { theme: { ...theme, ident: { enabled: true, videos: idents, order: 'shuffle' } } });
  const shuffled = []; for (let i = 0; i < 8; i++) shuffled.push(await identOf());
  assert.ok(shuffled.every((u, i) => i === 0 || u !== shuffled[i - 1]), 'never the same ident twice in a row');
  assert.ok(new Set(shuffled).size >= 2 && shuffled.every((u) => idents.some((v) => v.url === u)));
  await hf.api('PUT', '/api/studio/theme', { theme: { ...theme, ident: { enabled: true, videos: idents, order: 'order' } } });
  const turns = []; for (let i = 0; i < 6; i++) turns.push(await identOf());
  assert.deepEqual(turns.slice(0, 3).map((u) => idents.findIndex((v) => v.url === u)).sort(), [0, 1, 2]);
  assert.deepEqual(turns.slice(3), turns.slice(0, 3), 'in turn: the same order each lap');
  await hf.api('PUT', '/api/studio/theme', { theme: { ...theme, ident: { enabled: true, videos: idents.slice(0, 1), order: 'order', builtIn: true } } });
  const mixed = [await identOf(), await identOf(), await identOf(), await identOf()];
  assert.deepEqual([...new Set(mixed)].sort(), ['built-in', up.url].sort());
  assert.ok(mixed.every((u, i) => i === 0 || u !== mixed[i - 1]), 'the uploaded ident and the built-in one take turns');
  await hf.api('PUT', '/api/studio/theme', { theme: { ...theme, ident: { enabled: true, video: up.url }, night: { enabled: true, from: '00:00', to: '23:59', theme: { colors: { accent: '#e8b84a' } } } } });

  // The evening look rides along for each device to apply by its own clock; a season switches it off.
  let b = await hf.api('GET', '/api/boot');
  assert.deepEqual([b.look.night.from, b.look.night.theme.colors.accent, b.look.theme.colors.accent, b.look.night.theme.colors.bg], ['00:00', '#e8b84a', theme.colors.accent, '#0a0814']);
  await hf.api('PUT', '/api/studio/theme', { theme });
  b = await hf.api('GET', '/api/boot');
  assert.equal(b.look.night, null);
  assert.equal(b.look.theme.ident.enabled, true);

  // Year in review counts what this profile finished.
  await hf.api('POST', '/api/progress', { itemId: signal.id, position: 10, duration: 10, ended: true });
  await hf.api('POST', '/api/progress', { itemId: e1.id, position: 5, duration: 5, ended: true });
  const w = await hf.api('GET', '/api/wrapped');
  assert.ok(w.movies >= 1 && w.episodes >= 1 && w.genres.some((g) => g.name === 'Thriller') && w.shows[0].title === 'Harbor Lights');
  assert.equal(w.months.reduce((a, n) => a + n, 0) >= 2, true);
  assert.equal((await hf.api('GET', '/api/wrapped?year=1999')).movies, 0);

  // A watch party relays play, pause and seek to everyone else in the room.
  const { code } = await hf.api('POST', '/api/party', { itemId: signal.id });
  assert.match(code, /^[0-9A-F]{6}$/);
  assert.equal((await hf.api('GET', `/api/party/${code.toLowerCase()}`)).itemId, signal.id);
  const listen = async () => {
    const res = await fetch(`${hf.base}/api/party/${code}/events`, { headers: { Cookie: hf.getCookie() } });
    const reader = res.body.getReader(), seen = [];
    let buf = '';
    const next = async (type) => {
      for (;;) {
        const i = seen.findIndex((m) => m.type === type);
        if (i >= 0) return seen.splice(i, 1)[0];
        const { value, done } = await reader.read();
        if (done) throw new Error('stream closed');
        buf += Buffer.from(value).toString();
        for (let k; (k = buf.indexOf('\n\n')) >= 0; buf = buf.slice(k + 2)) { const line = buf.slice(0, k); if (line.startsWith('data: ')) seen.push(JSON.parse(line.slice(6))); }
      }
    };
    return { next, close: () => reader.cancel() };
  };
  const a = await listen(), helloA = await a.next('hello');
  const g = await listen(), helloG = await g.next('hello');
  assert.deepEqual([helloA.people.length, helloG.people.length], [1, 2]);
  assert.equal((await a.next('people')).people.length, 2);
  await hf.api('POST', `/api/party/${code}/send`, { type: 'play', you: helloA.you, position: 42 });
  assert.deepEqual(await g.next('play'), { type: 'play', position: 42, by: (await hf.api('GET', '/api/boot')).profile.name });
  await hf.api('POST', `/api/party/${code}/send`, { type: 'react', you: helloG.you, emoji: '👏' });
  assert.equal((await a.next('react')).emoji, '👏');
  assert.equal((await hf.api('POST', `/api/party/${code}/send`, { type: 'shout' })).$status, 400);
  a.close(); g.close();
  assert.equal((await hf.api('GET', '/api/party/ZZZZZZ')).$status, 404);
});

test('plain-language search, Top 10, the hub, cast pages, TV sign-in by phone and the phone remote', async () => {
  const search = (q) => hf.api('GET', `/api/search?q=${encodeURIComponent(q)}`);
  let r = await search('a dark thriller from the 2010s');
  assert.deepEqual([r.items.map((i) => i.title), r.understood], [['Night Drive'], ['2010s', 'Dark', 'Thriller']]);
  r = await search('documentaries I haven\'t seen');
  assert.deepEqual([r.items.map((i) => i.title), r.understood], [['Deep Field'], ['Not watched yet', 'Documentary']]);
  assert.deepEqual((await search('best sci-fi movies')).understood, ['Movies', 'Top rated', 'Science fiction']);
  assert.equal((await search('night')).understood, undefined, 'a title match stays an ordinary search');
  assert.deepEqual((await search('zzzz qqqq')).items, []);

  // Everyone's last 30 days make the Top 10; a finished title seeds "Because you watched".
  const all = (await hf.api('GET', '/api/home')).rows.filter((x) => x.id.startsWith('recent-')).flatMap((x) => x.items);
  assert.ok(all.length >= 4);
  for (const it of all) {
    const id = it.kind === 'show' ? (await hf.api('GET', `/api/items/${it.id}`)).playId : it.id;
    await hf.api('POST', '/api/progress', { itemId: id, position: 9, duration: 10, ended: it.title !== 'Quiet Orbit' });
  }
  const home = await hf.api('GET', '/api/home');
  const top = home.rows.find((x) => x.id === 'top10');
  assert.deepEqual([top.shape, top.items.length], ['ranked', all.length]);
  assert.ok((await hf.api('GET', '/api/home?lite=1')).rows.every((x) => x.items.length <= 14));
  const me = await hf.api('GET', '/api/me');
  assert.ok(me.totals.movies >= 3 && me.rows.some((x) => x.id === 'finished'));
  const night = (await search('night drive')).items[0];
  const q0 = (await hf.api('POST', '/api/play', { itemId: night.id, caps: {}, cinema: true })).queue;
  assert.deepEqual([q0.at(-1).resumeAt, q0.at(-1).file.container], [0, 'mp4']);
  assert.deepEqual((await hf.api('GET', `/api/chapters/${night.id}`)).chapters, []);
  await hf.api('POST', '/api/watched', { itemId: night.id, watched: false });

  const d = await hf.api('GET', `/api/items/${night.id}`);
  if (d.people.length) {
    const p = await hf.api('GET', `/api/person?name=${encodeURIComponent(d.people[0].name.toUpperCase())}`);
    assert.ok(p.items.some((i) => i.title === 'Night Drive') && p.items[0].role !== undefined);
  }
  assert.equal((await hf.api('GET', '/api/person?name=Nobody%20Here')).$status, 404);

  // A TV asks for a code; a signed-in phone approves it; the TV collects its sign-in once.
  const anon = (p, init) => fetch(hf.base + p, init);
  const pair = await (await anon('/api/pair', { method: 'POST' })).json();
  assert.match(pair.code, /^[A-Z2-9]{6}$/);
  assert.equal((await (await anon(`/api/pair/${pair.code}?secret=${pair.secret}`)).json()).status, 'waiting');
  assert.equal((await anon(`/api/pair/${pair.code}?secret=wrong`)).status, 404);
  assert.equal((await anon(`/api/pair/${pair.code}/approve`, { method: 'POST' })).status, 401, 'approving needs a signed-in profile');
  assert.ok((await hf.api('GET', `/api/pair/${pair.code.toLowerCase()}/info`)).device);
  await hf.api('POST', `/api/pair/${pair.code}/approve`);
  const done = await anon(`/api/pair/${pair.code}?secret=${pair.secret}`);
  const got = await done.json();
  assert.deepEqual([got.status, got.profile.name, /hf_token=/.test(done.headers.get('set-cookie'))], ['approved', me.name, true]);
  assert.equal((await (await anon('/api/boot', { headers: { Authorization: `Bearer ${got.token}` } })).json()).profile.name, me.name);
  assert.equal((await anon(`/api/pair/${pair.code}?secret=${pair.secret}`)).status, 404, 'a code works once');

  // The phone remote: the playing screen reports in and picks up commands sent to it.
  assert.deepEqual((await hf.api('POST', '/api/remote/state', { device: 'tv1', name: 'Living room', itemId: night.id, title: 'Night Drive', position: 12, duration: 30, paused: true })).commands, []);
  const list = await hf.api('GET', '/api/remote/devices');
  assert.deepEqual(list.map((x) => [x.id, x.name, x.title, x.position, x.paused]), [['tv1', 'Living room', 'Night Drive', 12, true]]);
  await hf.api('POST', '/api/remote/command', { device: 'tv1', cmd: 'play' });
  await hf.api('POST', '/api/remote/command', { device: 'tv1', cmd: 'seek', value: 20 });
  assert.equal((await hf.api('POST', '/api/remote/command', { device: 'tv1', cmd: 'explode' })).$status, 400);
  assert.deepEqual((await hf.api('POST', '/api/remote/state', { device: 'tv1', name: 'Living room', position: 12, duration: 30 })).commands, [{ cmd: 'play', value: 0 }, { cmd: 'seek', value: 20 }]);
  await hf.api('POST', '/api/remote/state', { device: 'tv1', closed: true });
  assert.equal((await hf.api('GET', '/api/remote/devices')).length, 0);
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

test('books, comics and music: scanning, reading and listening', async () => {
  const mk = (...p) => { const f = path.join(media, ...p); fs.mkdirSync(path.dirname(f), { recursive: true }); return f; };
  const img = (color, size = '600x900') => { const f = path.join(os.tmpdir(), `hf-${color}-${size}.jpg`); if (!fs.existsSync(f)) execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `color=c=${color}:s=${size}`, '-frames:v', '1', f]); return fs.readFileSync(f); };
  // An EPUB 3 with a cover, two chapters and a nav document.
  const page = (t, body) => `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>${t}</title><link rel="stylesheet" href="../style.css"/></head><body>${body}</body></html>`;
  fs.writeFileSync(mk('Books', 'Ursula Vance', 'The Quiet Sea.epub'), zip({
    mimetype: 'application/epub+zip',
    'META-INF/container.xml': '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    'OEBPS/content.opf': `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
      <dc:title>The Quiet Sea</dc:title><dc:creator>Ursula Vance</dc:creator><dc:date>2017-04-01</dc:date><dc:subject>Fantasy</dc:subject><dc:description>&lt;p&gt;A lighthouse keeper &amp;amp; the tide.&lt;/p&gt;</dc:description></metadata>
      <manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="c1" href="text/one.xhtml" media-type="application/xhtml+xml"/>
      <item id="c2" href="text/two.xhtml" media-type="application/xhtml+xml"/><item id="css" href="style.css" media-type="text/css"/><item id="cov" href="images/cover.jpg" media-type="image/jpeg" properties="cover-image"/></manifest>
      <spine><itemref idref="c1"/><itemref idref="c2"/></spine></package>`,
    'OEBPS/nav.xhtml': page('Contents', '<nav epub:type="toc" xmlns:epub="http://www.idpf.org/2007/ops"><ol><li><a href="text/one.xhtml">Low Tide</a></li><li><a href="text/two.xhtml#storm">The Storm</a></li></ol></nav>'),
    'OEBPS/text/one.xhtml': page('One', `<h1>Low Tide</h1>${'<p>The water drew back from the rocks and the keeper climbed down to count the boats. </p>'.repeat(60)}<script>alert(1)</script>`),
    'OEBPS/text/two.xhtml': page('Two', `<h1 id="storm">The Storm</h1>${'<p>By evening the wind had turned and the lamp swung on its chain. </p>'.repeat(60)}`),
    'OEBPS/style.css': 'h1 { color: #333 }', 'OEBPS/images/cover.jpg': img('navy'),
  }));
  // A Calibre-style folder: metadata.opf and cover.jpg beside a PDF; and the same book as EPUB and PDF (only the EPUB counts).
  fs.writeFileSync(mk('Books', 'Hal Ortiz', 'Field Notes (12)', 'Field Notes - Hal Ortiz.pdf'), makePdf(3));
  fs.writeFileSync(mk('Books', 'Hal Ortiz', 'Field Notes (12)', 'metadata.opf'), '<package><metadata xmlns:dc="x"><dc:title>Field Notes</dc:title><dc:creator>Hal Ortiz</dc:creator><dc:date>2009</dc:date></metadata></package>');
  fs.writeFileSync(mk('Books', 'Hal Ortiz', 'Field Notes (12)', 'cover.jpg'), img('olive'));
  fs.copyFileSync(path.join(media, 'Books', 'Ursula Vance', 'The Quiet Sea.epub'), mk('Books', 'Twins', 'Same Book.epub'));
  fs.writeFileSync(mk('Books', 'Twins', 'Same Book.pdf'), makePdf(1));
  // Comics: a CBZ series with ComicInfo, a loose issue, a tar-packed issue (read through bsdtar, like CBR) and a PDF.
  for (const n of [1, 2]) {
    fs.writeFileSync(mk('Comics', 'Saga (2012)', `Saga 00${n} (2012).cbz`), zip({
      'ComicInfo.xml': `<ComicInfo><Series>Saga</Series><Number>${n}</Number><Title>Chapter ${n}</Title><Writer>Brian K. Vaughan</Writer><Year>2012</Year><Summary>Issue ${n}.</Summary><Genre>Science Fiction, Fantasy</Genre></ComicInfo>`,
      'p10.jpg': img('red'), 'p2.jpg': img('green'), 'p1.jpg': img('blue'), '__MACOSX/._p1.jpg': 'junk',
    }, { deflate: false }));
  }
  fs.writeFileSync(mk('Comics', 'Moonrise #7.cbz'), zip({ 'a.jpg': img('white'), 'b.png': img('black', '64x64') }));
  const tarDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-cbt-'));
  fs.writeFileSync(path.join(tarDir, '001.jpg'), img('yellow')); fs.writeFileSync(path.join(tarDir, '002.jpg'), img('purple'));
  execFileSync('tar', ['-cf', mk('Comics', 'Hellboy', 'Hellboy v02.cbt'), '-C', tarDir, '001.jpg', '002.jpg']);
  fs.writeFileSync(mk('Comics', 'Hellboy', 'Hellboy v01.pdf'), makePdf(4));
  // A "CBR" that is really 7-Zip (as many are), with bracketed page names (bsdtar reads those as patterns) and a
  // double-page spread; and a "CBR" that is really a zip.
  const rarDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-cbr-'));
  fs.writeFileSync(path.join(rarDir, 'GK [01].jpg'), img('orange')); fs.writeFileSync(path.join(rarDir, 'GK [02]*.jpg'), img('teal', '1200x600')); fs.writeFileSync(path.join(rarDir, 'GK [03].jpg'), img('pink'));
  execFileSync('bsdtar', ['--format', '7zip', '-cf', mk('Comics', 'Gutter Kings', 'Gutter Kings 001.cbr'), '-C', rarDir, 'GK [01].jpg', 'GK [02]*.jpg', 'GK [03].jpg']);
  fs.writeFileSync(mk('Comics', 'Moonrise #8.cbr'), zip({ 'p1.jpg': img('white'), 'p2.jpg': img('gray') }));
  // Music: tagged MP3s with embedded art, a FLAC album with a folder cover across two discs, and an untagged file.
  const tone = (out, meta, extra = []) => execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=f=440:d=3', ...extra, ...Object.entries(meta).flatMap(([k, v]) => ['-metadata', `${k}=${v}`]), out]);
  const art = path.join(os.tmpdir(), 'hf-art.jpg'); fs.writeFileSync(art, img('teal', '300x300'));
  for (const [n, t] of [[1, 'Neon Rain'], [2, 'Afterglow']]) {
    tone(mk('Music', 'Nova Lines', 'Night Drive (2020)', `0${n} ${t}.mp3`), { title: t, artist: 'Nova Lines', album: 'Night Drive', album_artist: 'Nova Lines', track: `${n}/2`, date: '2020', genre: 'Synthwave' },
      ['-i', art, '-map', '0:a', '-map', '1:v', '-c:v', 'mjpeg', '-id3v2_version', '3', '-disposition:v', 'attached_pic']);
  }
  tone(mk('Music', 'Quartet', 'Strings', 'Disc 1', 'a.flac'), { title: 'Allegro', artist: 'Quartet', album: 'Strings', track: '1', disc: '1', date: '1999' });
  tone(mk('Music', 'Quartet', 'Strings', 'Disc 2', 'b.flac'), { title: 'Largo', artist: 'Quartet', album: 'Strings', track: '1', disc: '2', date: '1999' });
  fs.writeFileSync(mk('Music', 'Quartet', 'Strings', 'folder.jpg'), img('maroon', '300x300'));
  tone(mk('Music', 'Loose', 'Field Recording.m4a'), {}, ['-c:a', 'alac']);

  const libs = {};
  for (const [name, kind] of [['Books', 'books'], ['Comics', 'comics'], ['Music', 'music']]) libs[kind] = await hf.api('POST', '/api/studio/libraries', { name, kind, path: path.join(media, name) });
  await hf.scan.idle();
  assert.deepEqual(hf.scan.status.errors, []);

  // ----- books -----
  let l = await hf.api('GET', `/api/library/${libs.books.id}?sort=author`);
  assert.deepEqual(l.items.map((b) => [b.title, b.author, b.year]), [['Field Notes', 'Hal Ortiz', 2009], ['The Quiet Sea', 'Ursula Vance', 2017], ['The Quiet Sea', 'Ursula Vance', 2017]]);
  assert.equal(l.total, 3, 'the PDF twin of an EPUB is not listed twice');
  const sea = l.items.find((b) => b.author === 'Ursula Vance' && b.title === 'The Quiet Sea');
  const notes = l.items.find((b) => b.title === 'Field Notes');
  assert.match(notes.poster, /^\/img\/l\//, 'Calibre cover used');
  assert.equal(sea.poster, `/api/cover/${sea.id}`);
  const cover = await fetch(hf.base + sea.poster, { headers: { Cookie: hf.getCookie() } });
  assert.deepEqual([cover.status, cover.headers.get('content-type')], [200, 'image/jpeg']);
  let d = await hf.api('GET', `/api/items/${sea.id}`);
  assert.deepEqual([d.kind, d.format, d.overview, d.genres], ['book', 'epub', 'A lighthouse keeper & the tide.', ['Fantasy']]);
  let rd = await hf.api('GET', `/api/read/${sea.id}`);
  assert.deepEqual([rd.mode, rd.spine, rd.toc.map((t) => t.label), rd.toc[1].href], ['epub', ['OEBPS/text/one.xhtml', 'OEBPS/text/two.xhtml'], ['Low Tide', 'The Storm'], 'OEBPS/text/two.xhtml#storm']);
  const ch = await fetch(`${hf.base}${rd.base}${rd.spine[0]}`, { headers: { Cookie: hf.getCookie() } });
  assert.equal(ch.headers.get('content-type'), 'application/xhtml+xml; charset=utf-8');
  assert.match(ch.headers.get('content-security-policy'), /script-src 'none'/);
  assert.match(await ch.text(), /Low Tide/);
  assert.equal((await fetch(`${hf.base}${rd.base}../../../etc/passwd`, { headers: { Cookie: hf.getCookie() } })).status, 404);
  rd = await hf.api('GET', `/api/read/${notes.id}`);
  assert.deepEqual([rd.mode, rd.pages], ['pages', 3]);
  const pg = await fetch(`${hf.base}/api/read/${notes.id}/page/2`, { headers: { Cookie: hf.getCookie() } });
  assert.deepEqual([pg.status, pg.headers.get('content-type')], [200, 'image/jpeg']);
  assert.equal((await fetch(`${hf.base}/api/read/${notes.id}/page/9`, { headers: { Cookie: hf.getCookie() } })).status, 404);
  // Reading progress: halfway through chapter two, then Continue reading on Home.
  await hf.api('POST', '/api/progress', { itemId: sea.id, position: 1.5, duration: 2 });
  assert.deepEqual((await hf.api('GET', `/api/read/${sea.id}`)).progress, { position: 1.5, duration: 2, finished: false });
  let home = await hf.api('GET', '/api/home');
  assert.deepEqual(home.rows.find((r) => r.id === 'reading').items.map((x) => x.title), ['The Quiet Sea']);
  assert.ok(home.libraries.some((t) => t.kind === 'books' && t.count === 3));

  // ----- comics -----
  l = await hf.api('GET', `/api/library/${libs.comics.id}`);
  assert.deepEqual(l.items.map((x) => [x.title, x.count]), [['Gutter Kings', 1], ['Hellboy', 2], ['Moonrise', 2], ['Saga', 2]]);
  const saga = l.items.find((x) => x.title === 'Saga');
  d = await hf.api('GET', `/api/items/${saga.id}`);
  assert.deepEqual(d.issues.map((x) => [x.title, x.number, x.pages, x.author]), [['Chapter 1', 1, 3, 'Brian K. Vaughan'], ['Chapter 2', 2, 3, 'Brian K. Vaughan']]);
  assert.deepEqual([d.author, d.year, d.genres], ['Brian K. Vaughan', 2012, ['Science Fiction', 'Fantasy']]);
  rd = await hf.api('GET', `/api/read/${d.issues[0].id}`);
  assert.deepEqual([rd.mode, rd.pages, rd.next.title, rd.series.title], ['pages', 3, 'Chapter 2', 'Saga']);
  const order = [];
  for (const n of [1, 2, 3]) { const res = await fetch(`${hf.base}/api/read/${d.issues[0].id}/page/${n}`, { headers: { Cookie: hf.getCookie() } }); order.push((await res.arrayBuffer()).byteLength); }
  assert.ok(order.every((n) => n > 100), 'pages come out of the zip');
  const hb = await hf.api('GET', `/api/items/${l.items.find((x) => x.title === 'Hellboy').id}`);
  assert.deepEqual(hb.issues.map((x) => [x.number, x.pages]), [[1, 4], [2, 2]]);
  const tarPage = await fetch(`${hf.base}/api/read/${hb.issues[1].id}/page/1`, { headers: { Cookie: hf.getCookie() } });
  assert.deepEqual([tarPage.status, tarPage.headers.get('content-type')], [200, 'image/jpeg']);
  await hf.api('POST', '/api/progress', { itemId: d.issues[0].id, position: 3, duration: 3 });
  assert.equal((await hf.api('GET', `/api/items/${saga.id}`)).next, d.issues[1].id, 'a finished issue moves Read on to the next');
  const get = (u) => fetch(hf.base + u, { headers: { Cookie: hf.getCookie() } });

  // The 7-Zip "CBR": pages come out of the page cache in order, bracketed names and all; sizes are known up front;
  // smaller copies are made on request; and the cover comes out too.
  const gk = (await hf.api('GET', `/api/items/${l.items.find((x) => x.title === 'Gutter Kings').id}`)).issues[0];
  assert.equal(gk.pages, 3);
  assert.deepEqual((await hf.api('GET', `/api/read/${gk.id}/pages`)).sizes, [[600, 900], [1200, 600], [600, 900]]);
  for (const n of [3, 1, 2]) { const res = await get(`/api/read/${gk.id}/page/${n}`); assert.deepEqual([res.status, res.headers.get('content-type')], [200, 'image/jpeg'], `page ${n}`); }
  const small = Buffer.from(await (await get(`/api/read/${gk.id}/page/2?w=480`)).arrayBuffer());
  assert.deepEqual(imageSize(small), [480, 240], 'a smaller copy for a phone');
  const thumb = Buffer.from(await (await get(`/api/read/${gk.id}/page/1?w=1440`)).arrayBuffer());
  assert.deepEqual(imageSize(thumb), [600, 900], 'never made bigger than the original');
  assert.equal((await get(`/api/cover/${gk.id}`)).status, 200);
  const moon = (await hf.api('GET', `/api/items/${l.items.find((x) => x.title === 'Moonrise').id}`)).issues;
  assert.deepEqual(moon.map((x) => [x.number, x.pages]), [[7, 2], [8, 2]]);
  assert.equal((await get(`/api/read/${moon[1].id}/page/2`)).status, 200, 'a zip called .cbr reads like a CBZ');

  // The comics front page: Up next is the issue after the one just finished; read status filters the series.
  const front = await hf.api('GET', `/api/comics/${libs.comics.id}`);
  assert.deepEqual([front.totals.series, front.totals.issues, front.totals.read], [4, 7, 1]);
  assert.deepEqual(front.upNext.map((x) => [x.seriesTitle, x.number]), [['Saga', 2]]);
  assert.equal(front.recent.length, 7);
  const status = async (st) => (await hf.api('GET', `/api/library/${libs.comics.id}?status=${st}`)).items.map((x) => x.title);
  assert.deepEqual(await status('reading'), ['Saga']);
  assert.deepEqual(await status('unread'), ['Gutter Kings', 'Hellboy', 'Moonrise']);
  assert.deepEqual((await hf.api('GET', `/api/library/${libs.comics.id}`)).items.find((x) => x.title === 'Saga').read, 1);
  // Mark read up to here: several issues at once.
  await hf.api('POST', '/api/watched', { itemIds: hb.issues.map((x) => x.id), watched: true });
  assert.deepEqual(await status('read'), ['Hellboy']);
  await hf.api('POST', '/api/watched', { itemIds: [hb.issues[1].id], watched: false });
  assert.deepEqual(await status('reading'), ['Hellboy', 'Saga']);

  // ----- music -----
  l = await hf.api('GET', `/api/library/${libs.music.id}`);
  assert.deepEqual(l.items.map((a) => [a.title, a.author, a.year]), [['Loose', 'Unknown artist', null], ['Night Drive', 'Nova Lines', 2020], ['Strings', 'Quartet', 1999]]);
  const nd = l.items.find((a) => a.title === 'Night Drive'), strings = l.items.find((a) => a.title === 'Strings');
  assert.equal(nd.poster, `/api/cover/${nd.id}`, 'embedded art');
  assert.match(strings.poster, /^\/img\/l\//, 'folder.jpg');
  const art2 = await fetch(hf.base + nd.poster, { headers: { Cookie: hf.getCookie() } });
  assert.deepEqual([art2.status, art2.headers.get('content-type')], [200, 'image/jpeg']);
  d = await hf.api('GET', `/api/items/${strings.id}`);
  assert.deepEqual(d.tracks.map((t) => [t.title, t.disc, t.track, t.codec]), [['Allegro', 1, 1, 'flac'], ['Largo', 2, 1, 'flac']]);
  assert.equal(d.discs, 2);
  assert.ok(Math.abs(d.runtime - 6) < 0.5);
  const artists = await hf.api('GET', `/api/library/${libs.music.id}?view=artists`);
  assert.deepEqual(artists.items.map((a) => [a.title, a.count]), [['Nova Lines', 1], ['Quartet', 1], ['Unknown artist', 1]]);
  const nova = await hf.api('GET', `/api/items/${artists.items[0].id}`);
  assert.deepEqual([nova.albums.map((a) => a.title), nova.tracks.map((t) => t.title)], [['Night Drive'], ['Neon Rain', 'Afterglow']]);
  // Songs from the library can become sign-in music: found by artist, then copied beside the uploads.
  const libSongs = (await hf.api('GET', '/api/studio/songs?q=nova')).songs;
  assert.deepEqual(libSongs.map((x) => [x.title, x.artist, x.album]).sort(), [['Afterglow', 'Nova Lines', 'Night Drive'], ['Neon Rain', 'Nova Lines', 'Night Drive']]);
  const used = await hf.api('POST', `/api/studio/songs/${libSongs[0].id}/use`);
  assert.match(used.url, /^\/uploads\/song-[a-f0-9]{16}\.mp3$/);
  assert.equal(used.name, `Nova Lines – ${libSongs[0].title}`);
  assert.equal((await fetch(hf.base + used.url)).headers.get('content-type'), 'audio/mpeg');
  const flac = (await hf.api('GET', '/api/studio/songs?q=allegro')).songs[0];
  assert.match((await hf.api('POST', `/api/studio/songs/${flac.id}/use`)).url, /\.flac$/);
  assert.equal((await hf.api('POST', '/api/studio/songs/999999/use')).$status, 404);
  const songs = await hf.api('GET', `/api/library/${libs.music.id}?view=songs`);
  assert.equal(songs.total, 5);
  const alac = songs.items.find((t) => t.codec === 'alac');
  assert.equal(alac.title, 'Field Recording');
  const mp3 = await fetch(`${hf.base}/api/audio/${alac.id}?at=1`, { headers: { Cookie: hf.getCookie() } });
  const bytes = Buffer.from(await mp3.arrayBuffer());
  assert.equal(mp3.headers.get('content-type'), 'audio/mpeg');
  assert.ok(bytes.length > 4000 && (bytes[0] === 0xff || bytes.toString('latin1', 0, 3) === 'ID3'));
  assert.equal((await fetch(`${hf.base}/api/file/${nova.tracks[0].id}`, { headers: { Cookie: hf.getCookie(), Range: 'bytes=0-9' } })).status, 206);
  const found = await hf.api('GET', '/api/search?q=nova');
  assert.deepEqual(found.items.map((x) => x.kind).sort(), ['album', 'artist']);
  home = await hf.api('GET', '/api/home');
  assert.equal(home.rows.find((r) => r.id === `recent-${libs.music.id}`).shape, 'square');

  // Lyrics beside a song, playlists, Recently played, and bookmarks in a book.
  const neon = nova.tracks[0];
  fs.writeFileSync(path.join(media, 'Music', 'Nova Lines', 'Night Drive (2020)', '01 Neon Rain.lrc'), '[ar:Nova Lines]\n[00:01.50]Rain on the glass\n[00:02.75]Lights going past\n[00:00.20]Intro');
  assert.deepEqual((await hf.api('GET', `/api/lyrics/${neon.id}`)).synced, [{ t: 0.2, text: 'Intro' }, { t: 1.5, text: 'Rain on the glass' }, { t: 2.75, text: 'Lights going past' }]);
  const none = await hf.api('GET', `/api/lyrics/${nova.tracks[1].id}`);
  assert.ok(!none.synced && !none.plain);
  const pl = await hf.api('POST', '/api/playlists', { name: 'Late drive' });
  assert.equal((await hf.api('POST', `/api/playlists/${pl.id}/tracks`, { add: [nova.tracks[1].id, neon.id, sea.id] })).count, 2, 'only songs go in');
  assert.deepEqual((await hf.api('GET', `/api/playlists/${pl.id}`)).tracks.map((t) => t.title), ['Afterglow', 'Neon Rain']);
  await hf.api('POST', `/api/playlists/${pl.id}/tracks`, { remove: [neon.id] });
  assert.deepEqual((await hf.api('GET', '/api/playlists')).map((p) => [p.name, p.count]), [['Late drive', 1]]);
  await hf.api('POST', '/api/progress', { itemId: neon.id });
  const hub = await hf.api('GET', '/api/me');
  assert.deepEqual([hub.rows.find((x) => x.id === 'played').items.map((a) => a.title), hub.playlists.length], [['Night Drive'], 1]);
  const bm = await hf.api('POST', `/api/bookmarks/${sea.id}`, { position: 1.25, label: 'The Storm' });
  assert.deepEqual((await hf.api('GET', `/api/bookmarks/${sea.id}`)).map((b) => [b.position, b.label]), [[1.25, 'The Storm']]);
  await hf.api('DELETE', `/api/bookmarks/${sea.id}/${bm.id}`);
  assert.equal((await hf.api('GET', `/api/bookmarks/${sea.id}`)).length, 0);
  await hf.api('DELETE', `/api/playlists/${pl.id}`);

  // A file that disappears takes its album and artist with it.
  fs.rmSync(path.join(media, 'Music', 'Loose'), { recursive: true });
  await hf.api('POST', '/api/studio/scan', { libraryId: libs.music.id }); await hf.scan.idle();
  assert.deepEqual((await hf.api('GET', `/api/library/${libs.music.id}?view=artists`)).items.map((a) => a.title), ['Nova Lines', 'Quartet']);
  for (const lb of Object.values(libs)) await hf.api('DELETE', `/api/studio/libraries/${lb.id}`);
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

test('profiles: pictures, editing your own, and the admin tools', async () => {
  const admin = hf.getCookie();
  const me = (await hf.api('GET', '/api/boot')).profile;
  const kid = await hf.api('POST', '/api/studio/profiles', { name: 'Pic Kid', password: '2468' });
  const picFile = path.join(root, 'face.png');
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=orange:s=300x200', '-frames:v', '1', picFile]);
  const pic = fs.readFileSync(picFile);
  const up = (id, body, cookie = hf.getCookie()) => fetch(`${hf.base}/api/profiles/${id}/avatar`, { method: 'POST', headers: { Cookie: cookie }, body });
  // An admin can set anyone's picture; it is kept as a 512 × 512 JPEG.
  const res = await up(kid.id, pic);
  const p = await res.json();
  assert.equal(res.status, 200);
  assert.match(p.avatar, /^\/uploads\/avatars\/.+\.jpg$/);
  assert.deepEqual(imageSize(Buffer.from(await (await fetch(hf.base + p.avatar)).arrayBuffer())), [512, 512]);
  assert.equal((await up(kid.id, Buffer.from('not a picture at all, just words'))).status, 400);
  assert.equal((await hf.api('GET', '/api/boot')).profile.avatar, me.avatar, 'only that profile changed');
  // The picture gallery: added once by an admin, given to anyone.
  const g1 = await (await fetch(`${hf.base}/api/studio/avatars`, { method: 'POST', headers: { Cookie: admin }, body: pic })).json();
  assert.match(g1.name, /^g-[0-9a-f]{12}\.jpg$/);
  assert.deepEqual(imageSize(Buffer.from(await (await fetch(hf.base + g1.url)).arrayBuffer())), [512, 512]);
  assert.deepEqual((await hf.api('GET', '/api/avatars')).map((g) => g.name), [g1.name]);
  const given = await hf.api('POST', `/api/profiles/${me.id}/avatar/gallery`, { name: g1.name });
  assert.match(given.avatar, new RegExp(`^/uploads/avatars/${me.id}-`), 'a copy, not the gallery file');
  assert.equal((await hf.api('POST', `/api/profiles/${me.id}/avatar/gallery`, { name: '../../etc/passwd' })).$status, 404);
  // Signed in as the kid: their own picture, name and colour, but nobody else's, and no Studio.
  // (A session made directly: an earlier test has already tripped the sign-in limiter for this address.)
  const { q: sql } = await import('../src/db.js');
  const token = `kid-${Date.now()}`;
  await sql('insert into sessions (token, profile_id, device) values ($1, $2, $3)', [token, kid.id, 'test']);
  const kidCookie = `hf_token=${token}`;
  hf.setCookie(kidCookie);
  assert.equal((await up(me.id, pic, kidCookie)).status, 403);
  assert.equal((await hf.api('GET', '/api/avatars')).length, 1, 'everyone can see the gallery');
  assert.equal((await hf.api('POST', `/api/profiles/${me.id}/avatar/gallery`, { name: g1.name })).$status, 403, "but not change someone else's picture");
  assert.match((await hf.api('POST', `/api/profiles/${kid.id}/avatar/gallery`, { name: g1.name })).avatar, /^\/uploads\/avatars\//);
  assert.equal((await fetch(`${hf.base}/api/studio/avatars`, { method: 'POST', headers: { Cookie: kidCookie }, body: pic })).status, 403, 'only admins add to the gallery');
  assert.deepEqual(await hf.api('PUT', '/api/profiles/me', { name: 'Pic Kid 2', color: '#ff4d7e' }).then((x) => [x.name, x.color]), ['Pic Kid 2', '#ff4d7e']);
  assert.equal((await hf.api('PUT', '/api/profiles/me', { name: me.name })).$status, 400, 'names stay unique');
  assert.equal((await hf.api('DELETE', `/api/profiles/${kid.id}/avatar`)).avatar, null);
  assert.equal(fs.existsSync(path.join(hf.cfg.dataDir, 'uploads', 'avatars', path.basename(p.avatar))), false, 'the old picture is cleaned up');
  hf.setCookie(admin);
  await hf.api('DELETE', `/api/studio/avatars/${g1.name}`);
  assert.deepEqual(await hf.api('GET', '/api/avatars').then((x) => Array.from(x)), []);
  assert.equal((await fetch(hf.base + (await hf.api('GET', '/api/boot')).profile.avatar)).status, 200, 'a profile keeps a picture removed from the gallery');
  hf.setCookie(kidCookie);
  assert.equal((await hf.api('GET', '/api/studio/profiles')).$status, 403);
  // Back as the admin: when each profile was active and on how many devices; sign the kid out everywhere; clear history.
  hf.setCookie(admin);
  const row = (await hf.api('GET', '/api/studio/profiles')).find((x) => x.id === kid.id);
  assert.deepEqual([row.name, row.color, row.devices, row.admin], ['Pic Kid 2', '#ff4d7e', 1, false]);
  await hf.api('POST', `/api/studio/profiles/${kid.id}/signout`);
  assert.equal((await fetch(`${hf.base}/api/home`, { headers: { Cookie: kidCookie } })).status, 401);
  assert.equal((await hf.api('POST', `/api/studio/profiles/${kid.id}/clear`)).ok, true);
  assert.equal((await hf.api('GET', '/api/home')).$status, 200, 'the admin stays signed in');
  await hf.api('DELETE', `/api/studio/profiles/${kid.id}`);
});

test('music: lyrics from files and services, search, timing, the front page, radio and likes', async () => {
  const http = await import('node:http');
  const mk = (...p) => { const f = path.join(media, ...p); fs.mkdirSync(path.dirname(f), { recursive: true }); return f; };
  const tone = (out, meta) => execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=f=330:d=3', ...Object.entries(meta).flatMap(([k, v]) => ['-metadata', `${k}=${v}`]), out]);
  tone(mk('Tunes', 'Alba', 'First Light', '01 Song One.mp3'), { title: 'Song One', artist: 'Alba', album: 'First Light', track: '1', genre: 'Pop' });
  fs.writeFileSync(mk('Tunes', 'Alba', 'First Light', '01 Song One.lrc'), '[ar:Alba]\n[00:00.50]One a\n[00:01.00]One b\n[00:01.50]One c\n');
  tone(mk('Tunes', 'Alba', 'First Light', '02 Song Two.mp3'), { title: 'Song Two', artist: 'Alba', album: 'First Light', track: '2', genre: 'Pop' });
  tone(mk('Tunes', 'Alba', 'First Light', '03 Song Three.mp3'), { title: 'Song Three', artist: 'Alba', album: 'First Light', track: '3', genre: 'Pop' });
  tone(mk('Tunes', 'Bex', 'Blue Hours', '01 Song Four.mp3'), { title: 'Song Four', artist: 'Bex', album: 'Blue Hours', track: '1', genre: 'Jazz' });
  // A stand-in for LRCLIB, a "custom" JSON lyrics service and a plugin's service.
  const hits = { get: 0 };
  const stub = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x'), sp = u.searchParams;
    const send = (code, body, type = 'application/json') => { res.writeHead(code, { 'Content-Type': type }); res.end(typeof body === 'string' ? body : JSON.stringify(body)); };
    if (u.pathname === '/lrclib/api/get') {
      hits.get++;
      assert.match(req.headers['user-agent'], /^HallFlix\//, 'LRCLIB asks for a User-Agent');
      if (sp.get('track_name') === 'Song Two' && sp.get('artist_name') === 'Alba') return send(200, { trackName: 'Song Two', duration: 3, syncedLyrics: '[00:01.00]Two a\n[00:02.00]Two b\n[00:02.50]Two c', plainLyrics: 'Two a\nTwo b' });
      return send(404, { message: 'not found' });
    }
    if (u.pathname === '/lrclib/api/search') {
      if (/four/i.test(sp.get('q') || '')) return send(200, [{ trackName: 'Song Four', artistName: 'Bex', albumName: 'Blue Hours', duration: 3, syncedLyrics: '[00:00.50]Four a\n[00:01.00]Four b\n[00:01.50]Four c' }]);
      return send(200, []);
    }
    if (u.pathname === '/custom') return sp.get('title') === 'Song Three' ? send(200, { data: { text: 'Plain three\nsecond line' } }) : send(404, {});
    if (u.pathname.startsWith('/plugin/')) return decodeURIComponent(u.pathname).endsWith('/Plugin Song') ? send(200, '[00:01.00]P a\n[00:02.00]P b\n[00:03.00]P c', 'text/plain') : send(404, 'no');
    send(404, {});
  });
  await new Promise((r) => stub.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${stub.address().port}`;
  const keepBase = hf.cfg.lrclibBase;
  hf.cfg.lrclibBase = `${base}/lrclib`;
  const plugin = await hf.api('POST', '/api/studio/plugins', zip({ 'plugin.json': JSON.stringify({ id: 'test-lyrics', name: 'Test Lyrics', contributes: { lyrics: [{ name: 'Test Plugin Lyrics', url: `${base}/plugin/{artist}/{title}` }] } }) }));
  assert.equal(plugin.id, 'test-lyrics');
  try {
    const lib = await hf.api('POST', '/api/studio/libraries', { name: 'Tunes', kind: 'music', path: path.join(media, 'Tunes') });
    await hf.scan.idle();
    const songs = (await hf.api('GET', `/api/library/${lib.id}?view=songs&sort=title`)).items;
    const id = Object.fromEntries(songs.map((t) => [t.title, t.id]));
    assert.ok(songs.every((t) => t.artistId && t.albumId), 'songs know their artist and album');

    // From the NAS first; then LRCLIB, asked once and remembered.
    let l = await hf.api('GET', `/api/lyrics/${id['Song One']}`);
    assert.deepEqual([l.source, l.synced.map((x) => x.text)], ['A .lrc file on the NAS', ['One a', 'One b', 'One c']]);
    l = await hf.api('GET', `/api/lyrics/${id['Song Two']}`);
    assert.deepEqual([l.source, l.synced.length, l.synced[0]], ['LRCLIB', 3, { t: 1, text: 'Two a' }]);
    const before = hits.get;
    await hf.api('GET', `/api/lyrics/${id['Song Two']}`);
    assert.equal(hits.get, before, 'found lyrics are kept');
    // Nothing anywhere yet: remembered as missing, until a new service is added and the missing are looked at again.
    assert.equal((await hf.api('GET', `/api/lyrics/${id['Song Three']}`)).missing, true);
    let st = await hf.api('GET', '/api/studio/lyrics');
    assert.deepEqual(st.providers.map((p) => [p.name, p.kind, p.enabled]), [['LRCLIB', 'builtin', true], ['Test Plugin Lyrics', 'plugin', true]]);
    st = await hf.api('PUT', '/api/studio/lyrics', { autoFetch: true, providers: [...st.providers, { id: 'custom:mine', name: 'My Lyrics', url: `${base}/custom?artist={artist}&title={title}`, result: 'data', plain: 'text' }] });
    assert.deepEqual(st.providers.map((p) => p.name), ['LRCLIB', 'Test Plugin Lyrics', 'My Lyrics']);
    assert.equal((await hf.api('PUT', '/api/studio/lyrics', { providers: [{ id: 'custom:bad', name: 'Bad', url: 'ftp://nope' }] })).$status, 400);
    assert.equal((await hf.api('GET', `/api/lyrics/${id['Song Three']}`)).missing, true, 'still remembered as missing');
    await hf.api('DELETE', '/api/studio/lyrics/cache?missing=1');
    l = await hf.api('GET', `/api/lyrics/${id['Song Three']}`);
    assert.deepEqual([l.source, l.plain], ['My Lyrics', 'Plain three\nsecond line']);
    // The Studio's test asks one service with one song.
    const tried = await hf.api('POST', '/api/studio/lyrics/test', { artist: 'Anyone', title: 'Plugin Song', only: 'plugin:test-lyrics:test-plugin-lyrics' });
    assert.deepEqual(tried.results.map((x) => [x.name, x.found, x.synced, x.lines]), [['Test Plugin Lyrics', true, true, 3]]);

    // "Not right?": search, choose a result, nudge the timing, paste, and go back to automatic.
    assert.equal((await hf.api('GET', `/api/lyrics/${id['Song Four']}`)).missing, true);
    const found = await hf.api('GET', `/api/lyrics/${id['Song Four']}/search?q=bex four`);
    assert.deepEqual(found.results.map((x) => [x.provider, x.title, !!x.synced]), [['LRCLIB', 'Song Four', true]]);
    l = await hf.api('POST', `/api/lyrics/${id['Song Four']}`, { lrc: found.results[0].synced, source: 'LRCLIB' });
    assert.deepEqual([l.chosen, l.source, l.synced.map((x) => x.text)], [true, 'LRCLIB', ['Four a', 'Four b', 'Four c']]);
    assert.equal((await hf.api('PUT', `/api/lyrics/${id['Song Four']}/offset`, { offset: 1.54 })).offset, 1.5);
    assert.equal((await hf.api('GET', `/api/lyrics/${id['Song Four']}`)).offset, 1.5);
    l = await hf.api('POST', `/api/lyrics/${id['Song Four']}`, { plain: 'Typed by hand' });
    assert.deepEqual([l.plain, l.source, l.offset], ['Typed by hand', 'Added by hand', 1.5]);
    assert.equal((await hf.api('POST', `/api/lyrics/${id['Song Four']}`, { plain: '   ' })).$status, 400);
    assert.equal((await hf.api('DELETE', `/api/lyrics/${id['Song Four']}`)).missing, true);
    // A chosen song's lyrics win over a .lrc file; deleting the choice brings the file back.
    await hf.api('POST', `/api/lyrics/${id['Song One']}`, { plain: 'Mine instead' });
    assert.equal((await hf.api('GET', `/api/lyrics/${id['Song One']}`)).plain, 'Mine instead');
    assert.equal((await hf.api('DELETE', `/api/lyrics/${id['Song One']}`)).source, 'A .lrc file on the NAS');

    // The music front page, radio and likes.
    for (const t of ['Song One', 'Song Two', 'Song One']) { await hf.api('POST', '/api/progress', { itemId: id[t] }); }
    const sql = (await import('../src/db.js')).q;
    await sql(`update plays set played_at = played_at - interval '1 minute' * id`); // so the dedupe window doesn't merge them
    await hf.api('POST', '/api/progress', { itemId: id['Song One'] });
    const home = await hf.api('GET', `/api/music/${lib.id}`);
    assert.deepEqual([home.totals.albums, home.totals.artists, home.totals.songs], [2, 2, 4]);
    assert.deepEqual(home.top.map((t) => t.title), ['Song One', 'Song Two']);
    assert.deepEqual(home.jumpBack.map((a) => a.title), ['First Light']);
    assert.deepEqual(home.genres.map((g) => g.name).sort(), ['Jazz', 'Pop']);
    assert.deepEqual(home.something.map((a) => a.title), ['Blue Hours'], 'albums never played');
    const radio = await hf.api('GET', `/api/radio?seed=track:${id['Song Two']}`);
    assert.equal(radio.tracks[0].title, 'Song Two');
    assert.equal(new Set(radio.tracks.map((t) => t.id)).size, radio.tracks.length, 'no song twice');
    assert.deepEqual((await hf.api('GET', `/api/radio?seed=genre:Jazz&library=${lib.id}`)).tracks.map((t) => t.title), ['Song Four']);
    assert.equal((await hf.api('GET', `/api/radio?seed=artist:${songs.find((t) => t.title === 'Song Four').artistId}`)).title, 'Bex radio');
    await hf.api('POST', '/api/mylist', { itemId: id['Song Three'], on: true });
    assert.deepEqual(await hf.api('GET', '/api/music/liked/ids').then((x) => Array.from(x)), [id['Song Three']]);
    assert.deepEqual((await hf.api('GET', '/api/music/liked/songs')).tracks.map((t) => t.title), ['Song Three']);
    assert.ok(!((await hf.api('GET', '/api/home')).rows.find((r) => r.id === 'mylist')?.items || []).some((x) => x.kind === 'track'), 'liked songs stay off My List on Home');
    const pl = await hf.api('POST', '/api/music/queue-to-playlist', { name: 'From the queue', ids: [id['Song Two'], id['Song One']] });
    assert.deepEqual((await hf.api('GET', `/api/playlists/${pl.id}`)).tracks.map((t) => t.title), ['Song Two', 'Song One']);
    await hf.api('DELETE', `/api/playlists/${pl.id}`);
    await hf.api('DELETE', `/api/studio/libraries/${lib.id}`);
  } finally {
    hf.cfg.lrclibBase = keepBase;
    await hf.api('DELETE', '/api/studio/plugins/test-lyrics');
    await hf.api('PUT', '/api/studio/lyrics', { providers: [], autoFetch: true });
    stub.close();
  }
});

test('movies and shows: library front page, filters, ratings from services, and subtitles found online', async () => {
  const http = await import('node:http');
  const calls = [];
  const stub = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x'), sp = u.searchParams;
    calls.push(`${req.method} ${u.pathname}`);
    const send = (code, body, type = 'application/json') => { res.writeHead(code, { 'Content-Type': type }); res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)); };
    // OMDb: IMDb, Rotten Tomatoes and Metacritic for Night Drive (tt0000101).
    if (u.pathname === '/omdb/') {
      if (sp.get('apikey') !== 'omdb-key') return send(401, { Response: 'False', Error: 'Invalid API key!' });
      if (sp.get('i') === 'tt0000101') return send(200, { Response: 'True', imdbID: 'tt0000101', imdbRating: '7.7', imdbVotes: '416,247', Metascore: '67',
        Ratings: [{ Source: 'Internet Movie Database', Value: '7.7/10' }, { Source: 'Rotten Tomatoes', Value: '83%' }, { Source: 'Metacritic', Value: '67/100' }] });
      return send(200, { Response: 'False', Error: 'Movie not found!' });
    }
    // MDBList: adds Letterboxd and the Popcornmeter, and gives IMDb too (OMDb is asked first, so its IMDb wins).
    if (u.pathname === '/mdb/tmdb/movie/101') return sp.get('apikey') === 'mdb-key' ? send(200, { ids: { imdb: 'tt0000101' }, ratings: [
      { source: 'imdb', value: 7.9, score: 79, votes: 400000 }, { source: 'letterboxd', value: 3.6, score: 72 }, { source: 'popcorn', value: 88, score: 88 }, { source: 'tmdb', value: 74, score: 74 }, { source: 'metacriticuser', value: null }] }) : send(403, { error: 'Invalid API key' });
    if (u.pathname.startsWith('/mdb/')) return send(404, {});
    if (u.pathname === '/myratings/tt0000101') return send(200, { data: { score: '4.5' } });
    // OpenSubtitles: search by TMDb id, sign in, download.
    if (u.pathname === '/os/subtitles') {
      assert.equal(req.headers['api-key'], 'os-key');
      if (sp.get('tmdb_id') === '102') return send(200, { data: [
        { attributes: { language: 'en', release: 'The.Long.Signal.2021.720p.WEB.h264-OTHER', download_count: 900, hearing_impaired: false, files: [{ file_id: 11 }] } },
        { attributes: { language: 'en', release: 'The.Long.Signal.2021.1080p.BluRay.x264-GRP', download_count: 50, hearing_impaired: true, files: [{ file_id: 12 }] } },
        { attributes: { language: 'fr', release: 'The.Long.Signal.2021.FRENCH', download_count: 5000, files: [{ file_id: 13 }] } }] });
      if (sp.get('parent_tmdb_id') === '55') return send(200, { data: [{ attributes: { language: 'en', release: `Harbor.Lights.S0${sp.get('season_number')}E0${sp.get('episode_number')}`, download_count: 3, files: [{ file_id: 21 }] } }] });
      return send(200, { data: [] });
    }
    if (u.pathname === '/os/login') { const b = []; req.on('data', (c) => b.push(c)); req.on('end', () => { const j = JSON.parse(Buffer.concat(b)); send(j.password === 'pw' ? 200 : 401, j.password === 'pw' ? { token: 'tok123' } : { message: 'bad login' }); }); return; }
    if (u.pathname === '/os/download') {
      assert.equal(req.headers.authorization, 'Bearer tok123', 'downloads use the sign-in');
      const b = []; req.on('data', (c) => b.push(c));
      req.on('end', () => send(200, { link: `http://${req.headers.host}/files/${JSON.parse(Buffer.concat(b)).file_id}.srt`, remaining: 99 }));
      return;
    }
    // A Windows-1252 subtitle file, the way many old ones are.
    if (u.pathname === '/files/12.srt') return send(200, Buffer.from('1\r\n00:00:02,000 --> 00:00:05,000\r\nCaf\xe9 signal, loud and clear.\r\n', 'latin1'), 'application/x-subrip');
    if (u.pathname === '/files/21.srt') return send(200, '1\n00:00:01,000 --> 00:00:03,000\nThe harbor lights come on.\n', 'application/x-subrip');
    // SubDL: a zip with a whole season in it.
    if (u.pathname === '/subdl/subtitles') return send(200, sp.get('api_key') === 'subdl-key' && sp.get('tmdb_id') === '55'
      ? { status: true, subtitles: [{ release_name: 'Harbor.Lights.S01.WEB', lang: 'EN', url: '/subtitle/55-1.zip', hi: false, season: 1, full_season: true }] } : { status: true, subtitles: [] });
    if (u.pathname === '/subdlfiles/subtitle/55-1.zip') return send(200, zip({ 'Harbor.Lights.S01E01.srt': '1\n00:00:01,000 --> 00:00:02,000\nEpisode one\n', 'Harbor.Lights.S01E02.srt': '1\n00:00:01,000 --> 00:00:02,000\nEpisode two\n' }), 'application/zip');
    send(404, {});
  });
  await new Promise((r) => stub.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${stub.address().port}`;
  const keep = { ...hf.cfg };
  const created = [];
  Object.assign(hf.cfg, { omdbBase: `${base}/omdb`, mdblistBase: `${base}/mdb`, opensubsBase: `${base}/os`, subdlBase: `${base}/subdl`, subdlFiles: `${base}/subdlfiles`, ratingsDelayMs: 0 });
  try {
    // Its own small libraries, since earlier tests remove and delete some of the shared ones.
    const mk = (...p) => { const f = path.join(media, 'MT', ...p); fs.mkdirSync(path.dirname(f), { recursive: true }); return f; };
    const clip = mk('clip.mp4');
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=24:duration=2', '-f', 'lavfi', '-i', 'sine=d=2', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', clip]);
    for (const f of ['Movies/Night Drive (2019)/Night Drive (2019).mp4', 'Movies/The.Long.Signal.2021.1080p.BluRay.x264-GRP.mp4', 'Movies/Deep Field (2020) [tmdbid-777]/deep.field.mp4',
      'Shows/Harbor Lights (2018)/Season 01/Harbor.Lights.S01E01.mp4', 'Shows/Harbor Lights (2018)/Season 01/Harbor.Lights.S01E02.mp4', 'Shows/Harbor Lights (2018)/Season 02/Harbor.Lights.S02E01.mp4']) fs.linkSync(clip, mk(f));
    fs.rmSync(clip);
    const movies = await hf.api('POST', '/api/studio/libraries', { name: 'MT Movies', kind: 'movies', path: path.join(media, 'MT', 'Movies') });
    const showsLib = await hf.api('POST', '/api/studio/libraries', { name: 'MT Shows', kind: 'shows', path: path.join(media, 'MT', 'Shows') });
    created.push(movies.id, showsLib.id);
    await hf.scan.idle();
    const items = Object.fromEntries((await hf.api('GET', `/api/library/${movies.id}?sort=title`)).items.map((x) => [x.title, x]));
    const harbor = (await hf.api('GET', `/api/library/${showsLib.id}`)).items[0];
    items.eps = (await hf.api('GET', `/api/items/${harbor.id}`)).seasons.flatMap((x) => x.episodes);
    assert.equal(items.eps.length, 3);

    // ----- the library front page and Browse filters
    const front = await hf.api('GET', `/api/videos/${movies.id}`);
    assert.ok(front.total === 3 && front.spotlight.length >= 1);
    assert.ok(front.rows.some((r) => r.id === 'recent'), 'recently added row');
    const all = await hf.api('GET', `/api/library/${movies.id}?sort=title`);
    assert.ok(all.facets.decades.includes(2010) && all.facets.decades.includes(2020));
    assert.ok(all.facets.certs.includes('R') && all.facets.letters.includes('N'));
    assert.deepEqual((await hf.api('GET', `/api/library/${movies.id}?decade=2010`)).items.map((x) => x.title), ['Night Drive']);
    assert.deepEqual((await hf.api('GET', `/api/library/${movies.id}?cert=PG`)).items.map((x) => x.title), ['Deep Field']);
    assert.deepEqual((await hf.api('GET', `/api/library/${movies.id}?letter=N`)).items.map((x) => x.title), ['Night Drive']);
    const nd = items['Night Drive'].id;
    await hf.api('POST', '/api/watched', { itemId: nd, watched: true });
    assert.ok((await hf.api('GET', `/api/library/${movies.id}?status=watched`)).items.some((x) => x.id === nd));
    assert.ok(!(await hf.api('GET', `/api/library/${movies.id}?status=unwatched`)).items.some((x) => x.id === nd));
    const filtered = await hf.api('GET', `/api/library/${movies.id}?status=watched&decade=2010`);
    assert.equal(filtered.total, filtered.items.length, 'the count matches the filters');
    await hf.api('POST', '/api/watched', { itemId: nd, watched: false });
    assert.ok((await hf.api('GET', `/api/videos/${showsLib.id}`)).total >= 1);

    // ----- ratings: TMDb alone, then OMDb, MDBList and your own service
    let r = await hf.api('GET', `/api/ratings/${nd}`);
    assert.deepEqual(r.ratings.map((x) => [x.source, x.display]), [['tmdb', '7.4']], 'without keys, TMDb’s score');
    let st = await hf.api('GET', '/api/studio/ratings');
    assert.deepEqual(st.providers.map((p) => p.id), ['tmdb', 'omdb', 'mdblist']);
    st.providers.find((p) => p.id === 'omdb').apiKey = 'omdb-key';
    st.providers.find((p) => p.id === 'mdblist').apiKey = 'mdb-key';
    st.providers.push({ id: 'custom:mine', name: 'Douban', url: `${base}/myratings/{imdb}`, list: '', value: 'data.score', max: '5', label: 'Douban' });
    st = await hf.api('PUT', '/api/studio/ratings', { ...st, show: ['imdb', 'rt', 'rtAudience', 'metacritic', 'letterboxd', 'tmdb'] });
    assert.equal(st.providers.find((p) => p.id === 'omdb').apiKey, '', 'keys are never sent back');
    assert.equal(st.providers.find((p) => p.id === 'omdb').apiKeySet, true);
    await hf.api('PUT', '/api/studio/ratings', { ...st, providers: st.providers.map((p) => ({ ...p, apiKey: '' })) });
    assert.equal((await hf.api('GET', '/api/studio/ratings')).providers.find((p) => p.id === 'omdb').apiKeySet, true, 'a blank key keeps the saved one');
    const test1 = await hf.api('POST', '/api/studio/ratings/test', { title: 'Night Drive', year: 2019 });
    assert.equal(test1.results.find((x) => x.id === 'omdb').found, false, 'no TMDb id typed in, so OMDb looks up by title and finds nothing');
    await hf.api('DELETE', '/api/studio/ratings/cache');
    r = await hf.api('GET', `/api/ratings/${nd}`);
    assert.deepEqual(r.ratings.map((x) => [x.source, x.display, x.from]), [['imdb', '7.7', 'OMDb'], ['rt', '83%', 'OMDb'], ['rtAudience', '88%', 'MDBList'], ['metacritic', '67', 'OMDb'], ['letterboxd', '3.6', 'MDBList'], ['tmdb', '7.4', 'TMDb'], ['x-custom-mine', '4.5', 'Douban']], 'your own services come after the chosen ones');
    assert.equal(r.ratings.at(-1).label, 'Douban');
    assert.equal(r.ratings[0].votes, 416247);
    assert.equal(r.imdb, 'tt0000101');
    assert.equal(r.ratings[0].url, 'https://www.imdb.com/title/tt0000101/');
    const card = (await hf.api('GET', `/api/library/${movies.id}?letter=N`)).items[0];
    assert.deepEqual(card.ratings.imdb, [7.7, 10], 'cards carry a short copy for the badge');
    assert.deepEqual(card.ratings['x-custom-mine'], [4.5, 5]);
    const before = calls.filter((c) => c.startsWith('GET /omdb')).length;
    await hf.api('GET', `/api/ratings/${items.eps[0].id}`); // an episode asks for its show
    await hf.api('GET', `/api/ratings/${nd}`);
    assert.equal(calls.filter((c) => c.startsWith('GET /omdb')).length, before + 1, 'kept, so only the show was asked');
    const boot = await hf.api('GET', '/api/boot');
    assert.equal(boot.media.ratings.badge, 'auto');
    const job = await hf.api('POST', '/api/studio/ratings/refresh', {});
    assert.ok(job.job.total >= 0);
    for (let i = 0; i < 50 && (await hf.api('GET', '/api/studio/ratings')).job.running; i++) await new Promise((ok) => setTimeout(ok, 100));
    assert.ok((await hf.api('GET', '/api/studio/ratings')).counts.found >= 1);

    // ----- subtitles: OpenSubtitles (signed in) for a movie, SubDL's season zip for an episode
    let s = await hf.api('GET', '/api/studio/subtitles');
    assert.deepEqual(s.providers.map((p) => p.id), ['opensubtitles', 'subdl']);
    assert.equal((await hf.api('GET', '/api/boot')).media.subtitles.search, false, 'no keys: no online search');
    s.providers.find((p) => p.id === 'opensubtitles').apiKey = 'os-key';
    Object.assign(s.providers.find((p) => p.id === 'opensubtitles'), { username: 'jus', password: 'pw' });
    s.providers.find((p) => p.id === 'subdl').apiKey = 'subdl-key';
    s = await hf.api('PUT', '/api/studio/subtitles', { ...s, languages: ['en', 'fr'] });
    assert.equal(s.providers[0].password, '');
    assert.equal((await hf.api('GET', '/api/boot')).media.subtitles.search, true);
    const ls = items['The Long Signal'].id;
    const found = await hf.api('GET', `/api/subtitles/${ls}/search`);
    assert.deepEqual(found.results.map((x) => [x.lang, x.fits]), [['en', true], ['en', false], ['fr', false]], 'English first, the one for this exact release on top');
    assert.ok(found.results.every((x) => x.token && !x.ref && !x.url), 'the browser only gets tokens');
    assert.equal((await hf.api('POST', `/api/subtitles/${ls}/download`, { token: 'made-up' }, { raw: true })).status, 400);
    const { track } = await hf.api('POST', `/api/subtitles/${ls}/download`, { token: found.results[0].token });
    assert.match(track.id, /^d\d+$/);
    assert.equal(track.label, 'English (SDH) · OpenSubtitles');
    const vtt = await (await hf.api('GET', track.url, null, { raw: true })).text();
    assert.match(vtt, /^WEBVTT/); assert.match(vtt, /Café signal, loud and clear\./, 'old encodings come out right');
    const { queue } = await hf.api('POST', '/api/play', { itemId: ls, caps: browser });
    assert.ok(queue.at(-1).subs.some((x) => x.id === track.id), 'the new track plays like any other');
    assert.ok((await hf.api('GET', `/api/items/${ls}`)).media.found.length === 1);
    const ep = items.eps[0].id;
    const epFound = await hf.api('GET', `/api/subtitles/${ep}/search`);
    assert.deepEqual(epFound.results.map((x) => x.provider).sort(), ['OpenSubtitles', 'SubDL']);
    const fromZip = await hf.api('POST', `/api/subtitles/${ep}/download`, { token: epFound.results.find((x) => x.provider === 'SubDL').token });
    assert.match(await (await hf.api('GET', fromZip.track.url, null, { raw: true })).text(), /Episode one/, 'the right episode out of the season zip');
    const t = await hf.api('POST', '/api/studio/subtitles/test', { itemId: ls });
    assert.deepEqual(t.results.map((x) => [x.id, x.found]), [['opensubtitles', 3], ['subdl', 0]]);
    // Fetching by itself: off by default, and only when there's nothing in the first language.
    assert.equal((await hf.api('POST', `/api/subtitles/${items.eps[1].id}/auto`)).track, null);
    await hf.api('PUT', '/api/studio/subtitles', { ...s, autoFetch: true });
    assert.equal((await hf.api('POST', `/api/subtitles/${ls}/auto`)).have, true, 'The Long Signal already has English');
    const auto = await hf.api('POST', `/api/subtitles/${items.eps[1].id}/auto`);
    assert.ok(auto.track, 'found one for the second episode');
    await hf.api('DELETE', `/api/subtitles/${ls}/${track.id}`);
    assert.ok(!(await hf.api('POST', '/api/play', { itemId: ls, caps: browser })).queue.at(-1).subs.some((x) => x.id === track.id));
  } finally {
    Object.assign(hf.cfg, keep);
    for (const id of created) await hf.api('DELETE', `/api/studio/libraries/${id}`);
    await hf.api('PUT', '/api/studio/ratings', { providers: [], autoFetch: true });
    await hf.api('PUT', '/api/studio/subtitles', { providers: [], languages: ['en'] });
    stub.close();
  }
});

test('a library background: pick from its own backdrops, shade and position, seen by everyone', async () => {
  const list = await hf.api('GET', `/api/studio/libraries/${lib.movies.id}/backdrops`);
  assert.ok(Array.isArray(list) && list.length >= 1 && list.every((x) => x.url && x.thumb));
  const look = { background: list[0].url, dim: 0.35, blur: 4, shade: 'fade', position: 'top' };
  await hf.api('PUT', `/api/studio/libraries/${lib.movies.id}`, { look });
  const boot = await hf.api('GET', '/api/boot');
  assert.deepEqual(boot.look.libraries[lib.movies.id], look);
  await hf.api('PUT', `/api/studio/libraries/${lib.movies.id}`, { look: {} });
});
