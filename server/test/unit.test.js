import test from 'node:test';
import assert from 'node:assert/strict';
import * as names from '../src/names.js';
import { decide, pickPrerolls } from '../src/playback.js';
import { buildArgs } from '../src/transcoder.js';
import * as look from '../src/look.js';

test('movie names', () => {
  const m = (f) => names.parseMovie(`/media/Movies/${f}`, '/media/Movies');
  assert.deepEqual(m('Night Drive (2019)/Night Drive (2019).mp4'), { title: 'Night Drive', year: 2019, tmdbId: null });
  assert.deepEqual(m('The.Long.Signal.2021.1080p.BluRay.x264-GRP.mkv'), { title: 'The Long Signal', year: 2021, tmdbId: null });
  assert.deepEqual(m('Deep Field (2020) [tmdbid-777]/deep.field.mkv'), { title: 'Deep Field', year: 2020, tmdbId: 777 });
  assert.deepEqual(m('2001 A Space Odyssey (1968).mkv'), { title: '2001 A Space Odyssey', year: 1968, tmdbId: null });
  assert.deepEqual(m('Blade.Runner.2049.2017.2160p.UHD.mkv'), { title: 'Blade Runner 2049', year: 2017, tmdbId: null });
  assert.deepEqual(m('1917 (2019)/1917.mkv'), { title: '1917', year: 2019, tmdbId: null });
  assert.equal(m('Some Home Video.mp4').title, 'Some Home Video');
  assert.equal(m('Heat.1080p.BluRay.mkv').title, 'Heat');
  assert.equal(m('Spider-Man - Into the Spider-Verse (2018).mkv').title, 'Spider-Man - Into the Spider-Verse');
});

test('episode names', () => {
  const e = (f) => names.parseEpisode(`/media/Shows/Harbor Lights/${f}`);
  assert.deepEqual(e('Season 01/Harbor.Lights.S01E02.720p.WEB.mkv'), { season: 1, episode: 2, title: null });
  assert.deepEqual(e('Season 2/Harbor Lights - S02E05 - The Storm.mkv'), { season: 2, episode: 5, title: 'The Storm' });
  assert.deepEqual(e('Season 3/harbor lights 3x07.avi'), { season: 3, episode: 7, title: null });
  assert.deepEqual(e('Season 4/Episode 12.mkv'), { season: 4, episode: 12, title: null });
  assert.deepEqual(e('Specials/E01 - Reunion.mkv'), { season: 0, episode: 1, title: null });
  assert.equal(e('Season 1/s01e01e02.mkv').episode, 1);
  assert.equal(e('random clip.mkv'), null);
  assert.ok(names.skipFile('Movie-trailer.mp4') && names.skipFile('sample.mkv') && !names.skipFile('Sample Size (2020).mkv'));
  assert.equal(names.sortTitle('The Matrix'), 'matrix');
});

const V = (codec, extra = {}) => ({ type: 'video', codec, height: 1080, width: 1920, bitDepth: 8, ...extra });
const A = (codec, extra = {}) => ({ type: 'audio', codec, channels: 2, ...extra });
const browser = { containers: ['mp4', 'webm'], video: ['h264', 'vp9'], audio: ['aac', 'mp3', 'opus'] };
const fireTv = { containers: ['mp4', 'mkv', 'webm', 'ts'], video: ['h264', 'hevc', 'vp9'], video10: ['hevc'], audio: ['aac', 'mp3', 'ac3', 'eac3', 'opus'], hlsHevc: true, audioSwitch: true };

test('playback decisions pick the cheapest path that works', () => {
  assert.equal(decide({ container: 'mp4', streams: [V('h264'), A('aac')] }, browser).mode, 'direct');
  const mkv = decide({ container: 'mkv', streams: [V('h264'), A('aac')] }, browser);
  assert.deepEqual([mkv.mode, mkv.video, mkv.audio, mkv.seg], ['remux', 'copy', 'copy', 'ts']);
  const ac3 = decide({ container: 'mkv', streams: [V('h264'), A('ac3')] }, browser);
  assert.deepEqual([ac3.mode, ac3.video, ac3.audio], ['remux', 'copy', 'aac']);
  const hevc = decide({ container: 'mkv', streams: [V('hevc', { bitDepth: 10 }), A('aac')] }, browser);
  assert.deepEqual([hevc.mode, hevc.video, hevc.height], ['transcode', 'h264', 1080]);
  assert.equal(decide({ container: 'mkv', streams: [V('hevc', { bitDepth: 10 }), A('eac3')] }, fireTv).mode, 'direct');
  assert.equal(decide({ container: 'mp4', streams: [V('h264', { bitDepth: 10 }), A('aac')] }, browser).mode, 'transcode');
  // A second audio track: browsers cannot switch tracks inside a file, so the chosen one is repackaged.
  const two = { container: 'mp4', streams: [V('h264'), A('aac', { default: true }), A('aac')] };
  assert.equal(decide(two, browser).mode, 'direct');
  assert.deepEqual([decide(two, browser, { audio: 1 }).mode, decide(two, browser, { audio: 1 }).audioIndex], ['remux', 1]);
  assert.equal(decide(two, fireTv, { audio: 1 }).mode, 'direct');
  // A quality cap forces a resize.
  const capped = decide({ container: 'mp4', streams: [V('h264', { height: 2160 }), A('aac')] }, browser, { quality: '720' });
  assert.deepEqual([capped.mode, capped.height], ['transcode', 720]);
  assert.equal(decide({ container: 'mp4', streams: [V('h264'), A('aac')] }, browser, { quality: '1080' }).mode, 'direct');
  assert.equal(decide({ container: 'mp4', streams: [V('h264')] }, browser).mode, 'direct');
  assert.throws(() => decide({ container: 'mp3', streams: [A('mp3')] }, browser));
});

test('ffmpeg arguments', () => {
  const copy = buildArgs({ input: '/m/a.mkv', start: 16, video: 'copy', audio: 'aac', audioIndex: 1, seg: 'ts' }, '/t/x').join(' ');
  assert.match(copy, /^-hide_banner -loglevel error -nostdin -ss 16\.000 -i \/m\/a\.mkv -map 0:v:0 -map 0:a:1/);
  assert.match(copy, /-c:v copy -c:a aac -ac 2/);
  assert.ok(!copy.includes('libx264'));
  const sw = buildArgs({ input: '/m/a.mkv', start: 0, video: 'h264', audio: 'aac', height: 720, srcHeight: 1080, seg: 'ts' }, '/t/x').join(' ');
  assert.match(sw, /-vf scale=-2:720,format=yuv420p -c:v libx264/);
  assert.ok(!sw.includes('-ss'));
  const hw = buildArgs({ input: '/m/a.mkv', start: 0, video: 'h264', audio: 'none', height: 1080, srcHeight: 2160, seg: 'ts' }, '/t/x', { type: 'vaapi', device: '/dev/dri/renderD128' }).join(' ');
  assert.match(hw, /-hwaccel vaapi -hwaccel_device \/dev\/dri\/renderD128 -hwaccel_output_format vaapi -i/);
  assert.match(hw, /scale_vaapi=w=-2:h=1080:format=nv12 -c:v h264_vaapi/);
  assert.ok(!hw.includes('0:a:'));
  const hevc = buildArgs({ input: '/m/a.mkv', start: 0, video: 'copy', audio: 'copy', seg: 'fmp4' }, '/t/x').join(' ');
  assert.match(hevc, /-tag:v hvc1/); assert.match(hevc, /-hls_segment_type fmp4/);
});

test('plain-language search understands moods, decades, length and what is unwatched', async () => {
  const { understand } = await import('../src/more.js');
  const u = (t) => { const f = understand(t, ['Comedy', 'Mystery', 'Science Fiction', 'Western']); return f && { ...f, genreSets: f.genreSets.map((g) => g[0]) }; };
  assert.equal(understand('the long signal', []) !== null, true); // "long" reads as a length; the caller checks titles first
  assert.equal(understand('harbor lights', []), null);
  let f = u('show me a short funny movie from the 90s');
  assert.deepEqual([f.kind, f.maxMin, f.from, f.to, f.genreSets, f.rest], ['movie', 100, 1990, 1999, ['Comedy'], '']);
  f = u('westerns under 2 hours I haven\'t seen');
  assert.deepEqual([f.maxMin, f.unwatched, f.genreSets, f.labels], [120, true, ['Western'], ['Not watched yet', 'Under 2 hours', 'Western']]);
  f = u('best mysteries since 2015 with tom hanks');
  assert.deepEqual([f.best, f.from, f.genreSets, f.rest], [true, 2015, ['Mystery'], 'tom hanks']);
  assert.deepEqual([u('something from the 2010s').from, u('80s action').from, u("early '00s shows").from], [2010, 1980, 2000]);
});

test('pre-roll rules', () => {
  const clips = [{ id: 1, tags: [] }, { id: 2, tags: ['halloween'] }, { id: 3, tags: ['kids'] }];
  const movie = { kind: 'movie', library_id: 1, genres: ['Horror', 'Thriller'], rating: 'R' };
  const first = () => 0;
  const rule = (o) => ({ id: 1, enabled: true, position: 0, count: 1, clips: { mode: 'all' }, match: {}, ...o });
  assert.deepEqual(pickPrerolls([rule()], clips, movie, {}, new Date(), first).map((c) => c.id), [1]);
  assert.deepEqual(pickPrerolls([rule({ clips: { mode: 'tag', tag: 'Halloween' } })], clips, movie, {}, new Date(), first).map((c) => c.id), [2]);
  assert.deepEqual(pickPrerolls([rule({ clips: { mode: 'pick', ids: [3] }, match: { genres: ['horror'] } })], clips, movie).map((c) => c.id), [3]);
  assert.deepEqual(pickPrerolls([rule({ match: { genres: ['Comedy'] } })], clips, movie), []);
  assert.deepEqual(pickPrerolls([rule({ match: { kinds: ['episode'] } })], clips, movie), []);
  assert.deepEqual(pickPrerolls([rule({ match: { libraries: [2] } })], clips, movie), []);
  assert.deepEqual(pickPrerolls([rule({ match: { ratings: ['r'] } })], clips, movie, {}, new Date(), first).length, 1);
  assert.deepEqual(pickPrerolls([rule({ enabled: false })], clips, movie), []);
  assert.deepEqual(pickPrerolls([rule()], clips, movie, { enabled: false }), []);
  // dated rules only apply inside their window
  const oct = new Date(2026, 9, 20), dec = new Date(2026, 11, 20);
  const dated = rule({ match: { from: '10-01', to: '10-31' }, clips: { mode: 'tag', tag: 'halloween' } });
  assert.equal(pickPrerolls([dated], clips, movie, {}, oct).length, 1);
  assert.equal(pickPrerolls([dated], clips, movie, {}, dec).length, 0);
  // several rules stack in order, never repeat a clip, and respect the cap
  const stack = [rule({ id: 1, position: 1, count: 3 }), rule({ id: 2, position: 0, clips: { mode: 'tag', tag: 'halloween' } })];
  const got = pickPrerolls(stack, clips, movie, { max: 3 }, new Date(), first).map((c) => c.id);
  assert.deepEqual(got, [2, 1, 3]);
  assert.equal(pickPrerolls(stack, clips, movie, { max: 2 }).length, 2);
});

test('looks: seasons switch on by date and only override what they set', () => {
  assert.ok(look.inRange('10-01', '10-31', new Date(2026, 9, 31)));
  assert.ok(!look.inRange('10-01', '10-31', new Date(2026, 10, 1)));
  assert.ok(look.inRange('12-15', '01-02', new Date(2026, 11, 25)) && look.inRange('12-15', '01-02', new Date(2027, 0, 1)));
  assert.ok(!look.inRange('12-15', '01-02', new Date(2026, 5, 1)));
  const libraries = [{ id: 1, look: { background: '/uploads/movies.jpg', accent: '#ff0000' } }, { id: 2, look: {} }];
  const seasons = [{ id: 7, name: 'Halloween', starts: '10-01', ends: '10-31', enabled: true,
    look: { theme: { colors: { accent: '#ff7518' }, effect: 'bats', logo: { image: '' } }, libraries: { 1: { background: '/uploads/spooky.jpg', accent: '' } } } }];
  const theme = { colors: { accent: '#00ffff' }, logo: { image: '/uploads/logo.png' } };
  const off = look.resolve({ theme, libraries, seasons, date: new Date(2026, 6, 4) });
  assert.equal(off.theme.colors.accent, '#00ffff'); assert.equal(off.theme.colors.bg, look.DEFAULT_THEME.colors.bg);
  assert.equal(off.season, null); assert.equal(off.libraries[1].background, '/uploads/movies.jpg');
  const on = look.resolve({ theme, libraries, seasons, date: new Date(2026, 9, 31) });
  assert.equal(on.theme.colors.accent, '#ff7518'); assert.equal(on.theme.effect, 'bats'); assert.equal(on.season, 'Halloween');
  assert.equal(on.theme.logo.image, '/uploads/logo.png', 'an empty value in a season keeps the everyday one');
  assert.equal(on.libraries[1].background, '/uploads/spooky.jpg'); assert.equal(on.libraries[1].accent, '#ff0000');
  assert.equal(look.resolve({ theme, libraries, seasons: [{ ...seasons[0], enabled: false }], date: new Date(2026, 9, 31) }).season, null);
  assert.equal(look.resolve({ theme, libraries, seasons, date: new Date(2026, 6, 4), forceSeason: 7 }).season, 'Halloween');
  for (const p of look.PRESETS) assert.ok(look.merge(look.DEFAULT_THEME, p.theme).colors.accent);
});

test('archives: image sizes from the first bytes, literal names for bsdtar', async () => {
  const { imageSize, literal } = await import('../src/archive.js');
  const png = Buffer.alloc(32); png.write('\x89PNG\r\n\x1a\n', 0, 'latin1'); png.writeUInt32BE(13, 8); png.write('IHDR', 12); png.writeUInt32BE(640, 16); png.writeUInt32BE(480, 20);
  assert.deepEqual(imageSize(png), [640, 480]);
  const gif = Buffer.from('GIF89a\x20\x03\x58\x02' + '\0'.repeat(20), 'latin1');
  assert.deepEqual(imageSize(gif), [800, 600]);
  // A JPEG with an APP0 block before its frame header.
  const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, ...Array(14).fill(0), 0xff, 0xc0, 0x00, 0x11, 0x08, 0x05, 0xdc, 0x03, 0xe8, 0x03, ...Array(12).fill(0)]);
  assert.deepEqual(imageSize(jpg), [1000, 1500]);
  assert.equal(imageSize(Buffer.from('hello there, not an image at all')), null);
  assert.equal(literal('Page [01]*?.jpg'), 'Page \\[01\\]\\*\\?.jpg');
});

test('lyrics: LRC with offsets, repeated stamps and word timing', async () => {
  const { parseLrc } = await import('../src/lyrics.js');
  const out = parseLrc('[ti:Song]\n[offset:+500]\n[00:01.00]Hello there\n[00:03.50]<00:03.50>Word <00:04.00>by <00:04.50>word\n[00:05.00][00:09.00]Chorus\nno stamp here');
  assert.deepEqual(out.map((l) => [l.t, l.text]), [[0.5, 'Hello there'], [3, 'Word by word'], [4.5, 'Chorus'], [8.5, 'Chorus']]);
  assert.deepEqual(out[1].words.map((w) => [w.t, w.text]), [[3, 'Word '], [3.5, 'by '], [4, 'word']]);
  assert.deepEqual(parseLrc('[01:02.5]x').map((l) => l.t), [62.5]);
});

test('looks: tile covers default to the bottom right, and a library can change only what it sets', () => {
  const out = look.resolve({ theme: { tileCovers: { size: 48 } }, libraries: [{ id: 3, look: { tileCovers: { place: 'tr', style: '', x: '' } } }], seasons: [] });
  assert.deepEqual(out.theme.tileCovers, { show: 'yes', place: 'br', size: 48, count: 3, style: 'angled', x: 0, y: 0 });
  assert.deepEqual(out.libraries[3].tileCovers, { place: 'tr' }, 'empty choices mean "same as the whole app"');
});

test('ratings: reading scores from services', async () => {
  const { parseValue, display, sourceKey } = await import('../src/ratings.js');
  assert.deepEqual(parseValue('7.7/10'), { value: 7.7, max: 10 });
  assert.deepEqual(parseValue('83%'), { value: 83, max: 100 });
  assert.deepEqual(parseValue('67/100'), { value: 67, max: 100 });
  assert.deepEqual(parseValue('1,234', 100), { value: 1234, max: 100 });
  assert.equal(parseValue('N/A'), null);
  assert.equal(parseValue(''), null);
  assert.equal(display('rt', 83, 100), '83%');
  assert.equal(display('metacritic', 67, 100), '67');
  assert.equal(display('imdb', 7, 10), '7.0');
  assert.equal(display('rogerebert', 3.5, 4), '3.5/4');
  assert.equal(sourceKey('Internet Movie Database'), 'imdb');
  assert.equal(sourceKey('Rotten Tomatoes'), 'rt');
  assert.equal(sourceKey('popcorn'), 'rtAudience');
  assert.equal(sourceKey('Douban'), null);
});

test('subtitles: encodings, season zips and language codes', async () => {
  const { decode, pickFile, lang2, langName } = await import('../src/subtitles.js');
  const { zip } = await import('./helpers.js');
  assert.equal(decode(Buffer.from('Caf\xe9', 'latin1')), 'Café');
  assert.equal(decode(Buffer.from('﻿Hi', 'utf8')), 'Hi');
  assert.equal(decode(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('Olá', 'utf16le')])), 'Olá');
  assert.equal(decode(Buffer.from('Ünïcödé', 'utf8')), 'Ünïcödé');
  const season = zip({ 'Show.S02E09.srt': 'nine', 'Show.S02E10.srt': 'ten', 'Show.S02E10.ass': 'ten-ass', 'readme.txt': 'x' });
  assert.equal(pickFile(season, { ep: true, season_no: 2, episode_no: 10 }).data.toString(), 'ten', '.srt preferred, and E10 is not E1');
  assert.equal(pickFile(season, { ep: true, season_no: 2, episode_no: 9 }).data.toString(), 'nine');
  assert.throws(() => pickFile(season, { ep: true, season_no: 2, episode_no: 3 }), /whole season/);
  assert.equal(pickFile(zip({ 'Movie.srt': 'm' }), { ep: false }).data.toString(), 'm');
  assert.equal(pickFile(Buffer.from('1\n00:00:01,000 --> 00:00:02,000\nx'), {}).name, 'subtitle.srt');
  assert.equal(lang2('eng'), 'en'); assert.equal(lang2('pt_BR'), 'pt-br'); assert.equal(langName('ger'), 'German');
});

test('loudness: pre-roll volume against the feature, and a real measurement', async () => {
  const L = await import('../src/loudness.js');
  assert.equal(L.gainFor(-14, -24), 0.32); // a punchy trailer before a film: turned down 10 dB
  assert.equal(L.gainFor(-30, -24), 1); // quieter than the film: full volume (players can't boost)
  assert.equal(L.gainFor(-24, -24, -6), 0.5); // "quieter than the movie"
  assert.equal(L.gainFor(5, -60), 0.05); // never silenced completely
  assert.equal(L.gainFor(null, -24), null);
  assert.equal(L.combine([-20, -20, -70]), -20); // silent samples are left out
  assert.ok(L.plausible(-23) && !L.plausible(0) && !L.plausible(-70) && !L.plausible(null)); // a 0 LUFS misreading is ignored
  assert.equal(L.combine([0, -20]), -20);
  assert.equal(L.combine([-20, -30]), -22.6);
  const { execFileSync } = await import('node:child_process');
  const os = await import('node:os'), path = await import('node:path');
  const f = path.join(os.tmpdir(), `hf-loud-${process.pid}.wav`);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=f=1000:d=4', '-af', 'volume=-10dB', f]);
  const lufs = await L.meter(f);
  assert.ok(lufs < -25 && lufs > -38, `measured ${lufs}`);
  assert.equal(await L.meter('/nope/missing.mp4'), null);
});

test('pre-roll reach: which titles each tag group and rule can play before, and coverage', async () => {
  const { reachOf } = await import('../src/prerolls.js');
  const clips = [{ id: 1, tags: ['halloween'] }, { id: 2, tags: ['horror'] }, { id: 3, tags: [] }, { id: 4, tags: ['comedy'], extra: { off: true } }];
  const titles = [
    { id: 10, kind: 'movie', title: 'Fright', genres: ['Horror'], library_id: 1 },
    { id: 11, kind: 'movie', title: 'Laughs', genres: ['Comedy'], library_id: 1 },
    { id: 12, kind: 'show', title: 'Harbor', genres: ['Drama'], library_id: 2 },
  ];
  const rules = [
    { id: 1, name: 'Halloween', enabled: true, position: 0, clips: { mode: 'tag', tag: 'halloween' }, match: { kinds: ['movie'], from: '10-01', to: '10-31' } },
    { id: 2, name: 'Fits the title', enabled: true, position: 1, clips: { mode: 'match', on: ['genres'] }, match: {} },
    { id: 3, name: 'Everyday', enabled: true, position: 2, clips: { mode: 'all', untaggedOnly: true }, match: { kinds: ['movie'] } },
    { id: 4, name: 'Off', enabled: false, position: 3, clips: { mode: 'all' }, match: {} },
  ];
  const r = reachOf(rules, clips, titles);
  const g = Object.fromEntries(r.groups.map((x) => [x.tag, x]));
  assert.deepEqual(g.halloween.titles, [10, 11]); // movies only, both
  assert.deepEqual(g.halloween.when, [['10-01', '10-31']]);
  assert.deepEqual(g.horror.titles, [10]); // matched by genre
  assert.equal(g.comedy, undefined); // the comedy clip is switched off
  assert.deepEqual(r.rules, { 1: [10, 11], 2: [10], 3: [10, 11] });
  assert.deepEqual(r.classes, { matched: [10, 11], general: [], none: [12] });
  assert.deepEqual(r.gaps, [{ genre: 'Drama', count: 1 }]);
  // Without the tagged rules, "everyday clips before movies" is general, not chosen for them.
  assert.deepEqual(reachOf([rules[2]], clips, titles).classes, { matched: [], general: [10, 11], none: [12] });
});

test('shared tags: the most specific shared tag wins', () => {
  const clips = [{ id: 1, title: 'Swim bump', tags: ['hfswimbump'] }, { id: 2, title: 'Arcane', tags: ['hfarcane'] }, { id: 3, title: 'Everyday', tags: [] }];
  const rule = { id: 'tags', name: 'Shared tags', builtIn: true, enabled: true, position: -1, count: 1, clips: { mode: 'match', on: ['tags'] }, match: { stop: true } };
  const target = { kind: 'episode', tags: ['HFArcane', 'HFSwimBump', 'steampunk'], tagCounts: { hfarcane: 1, hfswimbump: 40 } };
  for (let i = 0; i < 10; i++) {
    const log = [];
    const out = pickPrerolls([rule], clips, target, { max: 2 }, new Date(), Math.random, {}, log);
    assert.deepEqual(out.map((c) => c.id), [2]);
    assert.ok(log.some((x) => /“hfarcane” is on 1 title, “hfswimbump” is on 40 titles/.test(x.note)));
  }
  // Two matching clips with count 2: the specific one first, then the next.
  const two = pickPrerolls([{ ...rule, count: 2 }], clips, target, { max: 2 }, new Date(), Math.random, {});
  assert.deepEqual(two.map((c) => c.id), [2, 1]);
});

test('seasons: holidays that move each year, and custom CSS that seasons add to', async () => {
  const L = await import('../src/look.js');
  assert.deepEqual([2025, 2026, 2027].map((y) => L.dayOf('easter', y)), ['04-20', '04-05', '03-28']);
  assert.deepEqual([2025, 2026].map((y) => L.dayOf('11/4thu', y)), ['11-27', '11-26']);
  assert.equal(L.dayOf('05/lastmon', 2026), '05-25');
  assert.equal(L.dayOf('easter-7', 2026), '03-29');
  assert.equal(L.dayOf('11/4thu+1', 2026), '11-27');
  assert.equal(L.dayOf('02/5mon', 2026), null); // no 5th Monday in February 2026
  assert.ok(L.validDate('12-25') && L.validDate('easter+1') && !L.validDate('13/1mon') && !L.validDate('xmas'));
  assert.ok(L.inRange('11/4thu-6', '11/4thu+1', new Date(2026, 10, 21)) && !L.inRange('11/4thu-6', '11/4thu+1', new Date(2026, 10, 19)));
  assert.ok(L.inRange('12-31', '01-02', new Date(2027, 0, 1)));
  const seasons = [{ id: 1, name: 'Easter', enabled: true, starts: 'easter-7', ends: 'easter+1', look: { theme: { effect: 'eggs', effectDensity: 'heavy', css: '.row h2 { color: pink; }' } } }];
  const r = L.resolve({ theme: { css: '.nav { opacity: .9; }' }, libraries: [], seasons, date: new Date(2026, 3, 1) });
  assert.equal(r.season, 'Easter');
  assert.equal(r.theme.effect, 'eggs');
  assert.equal(r.theme.css, '.nav { opacity: .9; }\n\n.row h2 { color: pink; }');
  assert.equal(L.resolve({ theme: {}, libraries: [], seasons, date: new Date(2026, 5, 1) }).theme.css, '');
  // Every preset uses only effects the app draws, and the holiday presets are there.
  for (const p of L.PRESETS) assert.ok(!p.theme.effect || L.OPTIONS.effects.includes(p.theme.effect), p.name);
  for (const id of ['new-year', 'st-patrick', 'easter', 'independence-day', 'thanksgiving', 'winter-frost', 'glass-chrome', 'oled-black']) assert.ok(L.PRESETS.some((p) => p.id === id), id);
});

test('theme contract: bad values are fixed or left out, and every built-in look already passes', async () => {
  const { checkTheme, pluginAssetUrls } = await import('../src/themespec.js');
  const { theme, problems } = checkTheme({
    colors: { accent: '#ABC', bg: 'rgba(0,0,0,1)' }, fonts: { display: 'Comic Sans', body: 'Inter' }, radius: 99, glow: '0.5',
    effect: 'pixels', texture: 'lava', heroMotion: '', tv: { width: 4000, stills: 'true' }, night: { theme: { colors: { text: 'red' } } }, bogus: 1,
  });
  assert.deepEqual(theme.colors, { accent: '#aabbcc' });
  assert.deepEqual(theme.fonts, { body: 'Inter' });
  assert.equal(theme.radius, 28); assert.equal(theme.glow, 0.5); assert.equal(theme.effect, 'pixels'); // a plugin's own effect is allowed
  assert.equal(theme.heroMotion, ''); // empty means "not set" and is kept
  assert.deepEqual(theme.tv, { width: 1920, stills: true });
  assert.ok(!('texture' in theme) && !('bogus' in theme));
  for (const want of ['colors.bg', 'fonts.display', 'radius', 'texture', 'tv.width', 'night.theme.colors.text', 'bogus']) {
    assert.ok(problems.some((p) => p.startsWith(want + ':')), `a problem for ${want}`);
  }
  // Studio keeps settings the contract doesn't know yet, but still fixes the ones it does.
  assert.deepEqual(checkTheme({ newThing: 1, radius: -5 }, { unknown: 'keep' }).theme, { newThing: 1, radius: 0 });
  assert.deepEqual(checkTheme(look.DEFAULT_THEME).problems, []);
  for (const p of look.PRESETS) assert.deepEqual(checkTheme(p.theme).problems, [], p.name);
  // A plugin's own pictures point into its folder; web links, uploads and CSS are left alone.
  assert.deepEqual(pluginAssetUrls({ background: { image: 'assets/bg.jpg' }, logo: { image: './logo.png' }, login: { image: 'https://x.test/a.jpg' }, splash: { image: '/uploads/s.png' }, css: 'a{background:url(assets/x.png)}' }, 'neon'),
    { background: { image: '/plugins/neon/assets/bg.jpg' }, logo: { image: '/plugins/neon/logo.png' }, login: { image: 'https://x.test/a.jpg' }, splash: { image: '/uploads/s.png' }, css: 'a{background:url(assets/x.png)}' });
});

test('theme contract: docs/theme.schema.json is up to date (regenerate with `node src/main.js theme-schema`)', async () => {
  const { themeFileSchema } = await import('../src/themespec.js');
  const fsm = await import('node:fs');
  const onDisk = JSON.parse(fsm.readFileSync(new URL('../../docs/theme.schema.json', import.meta.url), 'utf8'));
  assert.deepEqual(onDisk, themeFileSchema());
  // Every theme key HallFlix has is described, so editors can autocomplete all of it.
  assert.deepEqual(Object.keys(onDisk.$defs.theme.properties).filter((k) => k !== '$schema').sort(), Object.keys(look.DEFAULT_THEME).sort());
});

test('theme contract: every choice and slider Studio offers is allowed by the contract', async () => {
  const { checkTheme } = await import('../src/themespec.js');
  const fsm = await import('node:fs');
  const src = fsm.readFileSync(new URL('../../web/studio/studio.js', import.meta.url), 'utf8');
  const at = (o, p) => p.split('.').reduce((x, k) => x?.[k], o);
  const put = (p, v) => p.split('.').reduceRight((acc, k) => ({ [k]: acc }), v);
  let n = 0;
  for (const m of src.matchAll(/choose\(theme, '([\w.]+)', [^[]*?(\[\[.*?\]\])\)/g)) {
    if (at(look.DEFAULT_THEME, m[1]) === undefined) continue;
    for (const v of [...m[2].matchAll(/\['([^']*)',/g)].map((x) => x[1])) {
      const value = typeof at(look.DEFAULT_THEME, m[1]) === 'number' ? +v : v;
      assert.deepEqual(checkTheme(put(m[1], value)).problems, [], `Studio offers ${m[1]} = ${v}`); n++;
    }
  }
  for (const m of src.matchAll(/range\(theme, '([\w.]+)', (?:[^,]|,(?! -?\d))*?, (-?[\d.]+), (-?[\d.]+),/g)) {
    if (at(look.DEFAULT_THEME, m[1]) === undefined) continue;
    for (const v of [+m[2], +m[3]]) { assert.deepEqual(checkTheme(put(m[1], v)).problems, [], `Studio slider ${m[1]} = ${v}`); n++; }
  }
  assert.ok(n > 50, `checked ${n} Studio values`);
});

test('device looks: phones and TVs get their own settings over the everyday look, and seasons still reach them', () => {
  const theme = { heroHeight: 80, css: 'a{}', colors: { accent: '#ff0000' },
    devices: { phone: { heroHeight: 50, colors: { accent: '#00ff00' }, css: 'b{}', rows: { items: 10 }, logo: { image: '' } }, tv: {}, phoneBrowsers: true } };
  const season = { id: 1, enabled: true, starts: '01-01', ends: '12-31', look: { theme: { colors: { bg: '#123456' } } } };
  const r = look.resolve({ theme, libraries: [{ id: 1, look: {} }], seasons: [season] });
  assert.equal(r.theme.heroHeight, 80);
  assert.ok(!('devices' in r.theme), 'the everyday theme carries no device looks');
  const phone = r.devices.phone.theme;
  assert.equal(phone.heroHeight, 50);
  assert.equal(phone.colors.accent, '#00ff00');
  assert.equal(phone.colors.bg, '#123456'); // the running season applies on phones too
  assert.equal(phone.css, 'a{}\n\nb{}'); // phone CSS adds to the everyday CSS
  assert.equal(phone.rows.items, 10);
  assert.equal(phone.logo.image, look.DEFAULT_THEME.logo.image); // an empty setting follows the everyday look
  assert.ok(!('tv' in r.devices), 'no TV look when nothing is set for TVs');
  assert.equal(r.devices.phoneBrowsers, true);
  // No device settings at all: the apps get only the everyday look.
  assert.deepEqual(look.resolve({ theme: {}, libraries: [], seasons: [] }).devices, { phoneBrowsers: false });
});

test('device looks: checked like any theme, and a device look cannot nest another', async () => {
  const { checkTheme } = await import('../src/themespec.js');
  const { theme, problems } = checkTheme({ devices: { phone: { radius: 99, colors: { bg: 'blue', accent: '#0f0' }, devices: { tv: {} } }, phoneBrowsers: 'true', laptop: {} } });
  assert.deepEqual(theme, { devices: { phone: { radius: 28, colors: { accent: '#00ff00' } }, phoneBrowsers: true } });
  for (const want of ['devices.phone.devices', 'devices.phone.radius', 'devices.phone.colors.bg', 'devices.laptop']) assert.ok(problems.some((p) => p.startsWith(want + ':')), want);
});

test('"Fast on TVs": every setting is allowed by the theme contract, and it reaches TVs only', async () => {
  const { checkTheme } = await import('../src/themespec.js');
  assert.deepEqual(checkTheme(look.FAST_TV).problems, []);
  assert.deepEqual(checkTheme({ devices: { tv: look.FAST_TV } }).problems, []);
  const r = look.resolve({ theme: { glass: true, glow: 0.8, tiles3d: { style: 'layered' }, devices: { tv: look.FAST_TV } }, libraries: [], seasons: [] });
  const tv = r.devices.tv.theme;
  assert.deepEqual([tv.glass, tv.glow, tv.tiles3d.style, tv.tiles3d.sway, tv.heroMotion, tv.previews, tv.tv.stills], [false, 0, 'flat', false, 'none', false, true]);
  assert.equal(tv.tiles3d.depth, look.DEFAULT_THEME.tiles3d.depth, 'settings it does not mention are untouched');
  assert.deepEqual([r.theme.glass, r.theme.glow, r.theme.tiles3d.style], [true, 0.8, 'layered'], 'computers and phones keep the everyday look');
});

test('home address is tidied to an origin', async () => {
  const { directOrigin } = await import('../src/studio.js');
  assert.equal(directOrigin('100.117.23.98:8780'), 'http://100.117.23.98:8780');
  assert.equal(directOrigin(' http://100.117.23.98:8780/ '), 'http://100.117.23.98:8780');
  assert.equal(directOrigin('https://nas.example.ts.net:8780/home'), 'https://nas.example.ts.net:8780');
  assert.equal(directOrigin(''), '');
  assert.equal(directOrigin('http://a b'), null);
  assert.equal(directOrigin('http://me:pw@host'), null);
});

test('welcome idents are found anywhere in a look', async () => {
  const { identsIn, tvArgs } = await import('../src/ident.js');
  assert.deepEqual(identsIn({ splash: { video: '/uploads/a.mp4' }, devices: { tv: { splash: { video: '/uploads/b.webm' } } }, seasons: [{ theme: { splash: { video: '/uploads/a.mp4' } } }] }).sort(), ['/uploads/a.mp4', '/uploads/b.webm']);
  assert.deepEqual(identsIn({ splash: { video: '' } }), []);
  const a = tvArgs('in.webm', 'out.mp4');
  assert.ok(a.includes('libx264') && a.includes('aac') && a.includes('+faststart') && a.at(-1) === 'out.mp4');
});

test('Fire TV app settings: defaults, limits and choices are checked like the rest of the theme', async () => {
  const { checkTheme } = await import('../src/themespec.js');
  const { DEFAULT_THEME } = await import('../src/look.js');
  assert.equal(DEFAULT_THEME.tvApp.hero.height, 56);
  assert.equal(DEFAULT_THEME.tvApp.tiles.art, 'library');
  const r = checkTheme({ tvApp: { hero: { height: 10, follow: false }, tiles: { width: 260, art: 'spinning' }, cards: { focus: 'accent', scale: 300 }, details: { episodes: 'list' } } });
  assert.deepEqual(r.theme.tvApp, { hero: { height: 30, follow: false }, tiles: { width: 260 }, cards: { focus: 'accent', scale: 125 }, details: { episodes: 'list' } });
  assert.equal(r.problems.length, 3);
  // A TV look can carry its own Fire TV app settings too.
  assert.equal(checkTheme({ devices: { tv: { tvApp: { nav: { align: 'center' } } } } }).theme.devices.tv.tvApp.nav.align, 'center');
});
