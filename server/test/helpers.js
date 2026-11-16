// Test rig: sample media made with ffmpeg, a stand-in TMDb, and a real server + transcoder + Postgres.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';

export const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hallflix-test-'));
export const media = path.join(root, 'media');
const ff = (args) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: ['ignore', 'ignore', 'inherit'] });
const src = (dur, hz = 440, size = '640x360') => ['-f', 'lavfi', '-i', `testsrc2=size=${size}:rate=24:duration=${dur}`, '-f', 'lavfi', '-i', `sine=frequency=${hz}:duration=${dur}`];
const H264 = ['-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-g', '48', '-keyint_min', '48', '-sc_threshold', '0'];

export function makeMedia() {
  const mk = (...p) => { const f = path.join(media, ...p); fs.mkdirSync(path.dirname(f), { recursive: true }); return f; };
  // 1. An MP4 any browser plays as-is.
  ff([...src(30), ...H264, '-c:a', 'aac', '-movflags', '+faststart', mk('Movies', 'Night Drive (2019)', 'Night Drive (2019).mp4')]);
  fs.writeFileSync(mk('Movies', 'Night Drive (2019)', 'poster.jpg'), tinyJpeg());
  // 2. H.264 in MKV with AC-3 and a second audio track plus subtitles: video can be copied, audio must be converted.
  const srt = path.join(root, 'subs.srt');
  fs.writeFileSync(srt, '1\n00:00:01,000 --> 00:00:04,000\nThe signal is getting stronger.\n\n2\n00:00:18,000 --> 00:00:20,000\nHold the line.\n');
  ff([...src(40), '-f', 'lavfi', '-i', 'sine=frequency=880:duration=40', '-i', srt, '-map', '0:v', '-map', '1:a', '-map', '2:a', '-map', '3:s',
    '-c:v', 'libx264', '-preset', 'veryfast', '-bf', '2', '-pix_fmt', 'yuv420p', '-g', '48', '-keyint_min', '48', '-sc_threshold', '0', '-c:a:0', 'ac3', '-c:a:1', 'aac', '-c:s', 'srt', '-metadata:s:a:0', 'language=eng', '-metadata:s:a:1', 'language=spa',
    '-metadata:s:s:0', 'language=eng', '-disposition:a:0', 'default', '-disposition:a:1', '0', mk('Movies', 'The.Long.Signal.2021.1080p.BluRay.x264-GRP.mkv')]);
  fs.writeFileSync(mk('Movies', 'The.Long.Signal.2021.1080p.BluRay.x264-GRP.es.srt'), '1\n00:00:01,000 --> 00:00:04,000\nLa señal es más fuerte.\n');
  // 3. A codec no browser plays: must be converted.
  ff([...src(20), '-c:v', 'mpeg2video', '-q:v', '5', '-c:a', 'mp2', mk('Movies', 'Deep Field (2020) [tmdbid-777]', 'deep.field.mkv')]);
  // 4. 10-bit HEVC: copied for devices that say they can play it, converted for the rest.
  ff([...src(12), '-c:v', 'libx265', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p10le', '-x265-params', 'log-level=error:keyint=48:min-keyint=48', '-tag:v', 'hvc1', '-c:a', 'aac', mk('Movies', 'Quiet Orbit (2022).mkv')]);
  // 5. A show with two seasons.
  for (const [s, e] of [[1, 1], [1, 2], [2, 1]]) {
    ff([...src(10, 300 + e * 100), ...H264, '-c:a', 'aac', mk('Shows', 'Harbor Lights (2018)', `Season ${String(s).padStart(2, '0')}`, `Harbor.Lights.S0${s}E0${e}.720p.WEB.mkv`)]);
  }
  ff([...src(8), ...H264, '-c:a', 'aac', mk('Shows', 'Harbor Lights (2018)', 'Extras', 'Behind the scenes.mkv')]);
  // 6. Pre-roll clips; the sub-folder name becomes a tag.
  ff([...src(4, 660, '320x180'), ...H264, '-c:a', 'aac', mk('Prerolls', 'hallflix-ident.mp4')]);
  ff([...src(4, 220, '320x180'), ...H264, '-c:a', 'aac', mk('Prerolls', 'halloween', 'spooky_bump.mp4')]);
}

export function tinyJpeg() {
  const f = path.join(root, 'tiny.jpg');
  if (!fs.existsSync(f)) ff(['-f', 'lavfi', '-i', 'color=c=purple:s=32x48', '-frames:v', '1', f]);
  return fs.readFileSync(f);
}

/** A stand-in for TMDb that answers the same paths with the same shapes. */
export function fakeTmdb() {
  const calls = [];
  const movies = {
    101: { id: 101, title: 'Night Drive', release_date: '2019-03-08', overview: 'A courier takes one last job.', tagline: 'Keep driving.', runtime: 98, vote_average: 7.4,
      genres: [{ name: 'Thriller' }, { name: 'Crime' }], production_companies: [{ name: 'Lantern Pictures' }], poster_path: '/nd-poster.jpg', backdrop_path: '/nd-back.jpg',
      credits: { cast: [{ name: 'Ada Reyes', character: 'Mara', profile_path: '/ada.jpg' }] }, images: { logos: [{ file_path: '/nd-logo.png', iso_639_1: 'en' }] },
      release_dates: { results: [{ iso_3166_1: 'US', release_dates: [{ certification: '' }, { certification: 'R' }] }] }, videos: { results: [{ site: 'YouTube', type: 'Trailer', key: 'abc123', official: true }] } },
    102: { id: 102, title: 'The Long Signal', release_date: '2021-10-01', overview: 'A radio operator hears something.', runtime: 110, vote_average: 8.1,
      genres: [{ name: 'Science Fiction' }, { name: 'Thriller' }], poster_path: '/ls-poster.jpg', backdrop_path: '/ls-back.jpg', credits: { cast: [] }, images: { logos: [] }, release_dates: { results: [] }, videos: { results: [] } },
    777: { id: 777, title: 'Deep Field', release_date: '2020-06-12', overview: 'Looking further than ever.', runtime: 91, vote_average: 6.9,
      genres: [{ name: 'Documentary' }], poster_path: '/df-poster.jpg', backdrop_path: '/df-back.jpg', credits: { cast: [] }, images: { logos: [] },
      release_dates: { results: [{ iso_3166_1: 'US', release_dates: [{ certification: 'PG' }] }] }, videos: { results: [] } },
  };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    calls.push(url.pathname + url.search);
    const send = (obj, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (url.pathname.startsWith('/img/')) { res.writeHead(200, { 'Content-Type': 'image/jpeg' }); return res.end(tinyJpeg()); }
    if (url.searchParams.get('api_key') !== 'test-key' && req.headers.authorization !== 'Bearer eyJtest') return send({ status_message: 'Invalid API key' }, 401);
    const p = url.pathname;
    if (p === '/3/configuration') return send({ images: {} });
    if (p === '/3/search/movie') {
      const qy = url.searchParams.get('query').toLowerCase();
      const hit = Object.values(movies).filter((m) => m.title.toLowerCase() === qy);
      return send({ results: [{ id: 999, title: `${qy} returns`, release_date: '1999-01-01' }, ...hit.map((m) => ({ id: m.id, title: m.title, release_date: m.release_date }))] });
    }
    let m = /^\/3\/movie\/(\d+)$/.exec(p);
    if (m) return movies[m[1]] ? send(movies[m[1]]) : send({}, 404);
    if (p === '/3/search/tv') return send({ results: url.searchParams.get('query') === 'Harbor Lights' ? [{ id: 55, name: 'Harbor Lights', first_air_date: '2018-09-01' }] : [] });
    if (p === '/3/tv/55') return send({ id: 55, name: 'Harbor Lights', first_air_date: '2018-09-01', overview: 'A town by the sea.', vote_average: 8.4, genres: [{ name: 'Drama' }],
      networks: [{ name: 'Northlight' }], poster_path: '/hl-poster.jpg', backdrop_path: '/hl-back.jpg', content_ratings: { results: [{ iso_3166_1: 'US', rating: 'TV-14' }] },
      credits: { cast: [] }, images: { logos: [] }, videos: { results: [] }, seasons: [{ season_number: 1, name: 'Season 1', poster_path: '/hl-s1.jpg' }, { season_number: 2, name: 'The Storm', poster_path: null }] });
    m = /^\/3\/tv\/55\/season\/(\d+)$/.exec(p);
    if (m) return send({ episodes: [1, 2].map((n) => ({ episode_number: n, name: `Chapter ${m[1]}.${n}`, overview: `What happened in ${m[1]}.${n}`, still_path: `/hl-${m[1]}-${n}.jpg`, air_date: `2018-09-0${n}`, vote_average: 8 })) });
    send({}, 404);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, calls, url: `http://127.0.0.1:${server.address().port}` })));
}

/** Boot a whole HallFlix (server + transcoder) against a clean database. */
export async function boot() {
  if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL to a test database');
  const tm = await fakeTmdb();
  Object.assign(process.env, {
    DATA_DIR: path.join(root, 'data'), MEDIA_ROOT: media, TRANSCODE_DIR: path.join(root, 'transcode'),
    TMDB_BASE: `${tm.url}/3`, TMDB_IMG: `${tm.url}/img`, HALLFLIX_HW: 'off', PORT: '0', TRANSCODER_PORT: '0',
  });
  const { cfg } = await import('../src/config.js');
  const dbm = await import('../src/db.js');
  await dbm.q('drop schema public cascade; create schema public;');
  const { startTranscoder } = await import('../src/transcoder.js');
  const tc = await startTranscoder(0);
  cfg.transcoderUrl = `http://127.0.0.1:${tc.server.address().port}`;
  const { startServer } = await import('../src/server.js');
  const app = await startServer(0);
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const scan = await import('../src/scan.js');
  let cookie = '';
  const api = async (method, p, body, { raw = false, headers = {} } = {}) => {
    const res = await fetch(base + p, { method, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body && !Buffer.isBuffer(body) ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body ? (Buffer.isBuffer(body) ? body : JSON.stringify(body)) : undefined });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    if (raw) return res;
    const out = await res.json();
    return Object.assign(out, { $status: res.status });
  };
  return { base, api, tm, scan, cfg, setCookie: (c) => { cookie = c; }, getCookie: () => cookie,
    close: async () => { await app.close(); await tc.close(); await dbm.closeDb(); tm.server.close(); fs.rmSync(root, { recursive: true, force: true }); } };
}

/** Build a small zip (stored or deflated) for plugin tests. */
export function zip(files, { deflate = true } = {}) {
  const locals = [], central = [];
  let offset = 0;
  const crc32 = (buf) => zlib.crc32 ? zlib.crc32(buf) : 0;
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.from(content), nameB = Buffer.from(name);
    const comp = deflate ? zlib.deflateRawSync(data) : data;
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(deflate ? 8 : 0, 8); h.writeUInt32LE(crc32(data), 14);
    h.writeUInt32LE(comp.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(nameB.length, 26);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(deflate ? 8 : 0, 10); c.writeUInt32LE(crc32(data), 16);
    c.writeUInt32LE(comp.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(nameB.length, 28); c.writeUInt32LE(offset, 42);
    locals.push(h, nameB, comp); central.push(c, nameB);
    offset += 30 + nameB.length + comp.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

export function ffprobe(file) {
  return JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file]).toString());
}
