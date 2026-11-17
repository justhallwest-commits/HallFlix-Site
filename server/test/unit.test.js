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
