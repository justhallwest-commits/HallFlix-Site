// Dev preview: a full HallFlix with a sample library on http://127.0.0.1:8790 (used for screenshots).
//   DATABASE_URL=postgres://… node test/dev.js
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { boot, makeMedia, media, zip } from './helpers.js';

makeMedia();
const src = path.join(media, 'Movies', 'Night Drive (2019)', 'Night Drive (2019).mp4');
const extra = ['Paper Lanterns (2017)', 'Static Bloom (2022)', 'The Ninth Harbor (2019)', 'Copper Sky (2021)', 'Low Tide Radio (2016)', 'Glass Orchard (2023)', 'Wolves of Marrow Lane (2018)',
  'Kite Season (2020)', 'After the Parade (2015)', 'Ember & Ash (2024)', 'Last Train to Elsewhere (2019)', 'Moonlit Arcade (2021)', 'The Quiet Engine (2017)', 'Salt and Neon (2022)', 'Hollow Crown Hotel (2016)', 'Velvet Static (2023)'];
for (const t of extra) fs.linkSync(src, path.join(media, 'Movies', `${t}.mp4`));
const ep = path.join(media, 'Shows', 'Harbor Lights (2018)', 'Season 01', 'Harbor.Lights.S01E01.720p.WEB.mkv');
for (const [show, n] of [['Signal Fires (2020)', 4], ['The Long Way Down (2022)', 3]]) for (let i = 1; i <= n; i++) {
  const f = path.join(media, 'Shows', show, 'Season 01', `S01E0${i}.mkv`); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.linkSync(ep, f);
}
// Books, comics and music for the reader and the player.
const mk = (...p) => { const f = path.join(media, ...p); fs.mkdirSync(path.dirname(f), { recursive: true }); return f; };
const pic = (seed, size = '600x900', label = '') => {
  const f = path.join(os.tmpdir(), `hfdev-${seed}-${size}.jpg`);
  if (!fs.existsSync(f)) {
    const hues = ['0x35d0d0', '0xb344d6', '0xff7a3d', '0x2a6df4', '0xe8b84a', '0x1ce783', '0xff4d7e', '0x8a2be2'];
    const c0 = hues[seed % hues.length], c1 = hues[(seed * 3 + 1) % hues.length];
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `gradients=s=${size}:c0=${c0}:c1=${c1}:x0=0:y0=0:x1=${size.split('x')[0]}:y1=${size.split('x')[1]}:d=1`, '-frames:v', '1', f]);
  }
  return fs.readFileSync(f);
};
const para = ['The lamp at the end of the pier had not been lit in eleven years, and Mara had stopped expecting it to be. ', 'She kept the logbook anyway, one line a night, the weather and the boats and whatever the sea gave back. ',
  'On the night the storm came in from the west, the lamp flickered once, then held, and every dog in the village began to bark. ', 'Nobody in town would say who had climbed the tower, or how they had carried oil up a stair that had fallen in. '];
const chapter = (n, t) => `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>${t}</title></head><body><h1>${n}. ${t}</h1>${Array.from({ length: 34 }, (_, i) => `<p>${para[i % 4]}${para[(i + 1) % 4]}</p>`).join('')}</body></html>`;
const books = [['Ursula Vance', 'The Quiet Sea', 2017, 'Fantasy'], ['Hal Ortiz', 'Field Notes from the Dark', 2009, 'Science'], ['Ines Calder', 'Lantern Season', 2021, 'Mystery'], ['Ursula Vance', 'Salt Roads', 2020, 'Fantasy'], ['Theo Mbeki', 'The Long Signal', 2015, 'Science Fiction']];
books.forEach(([author, title, year, genre], i) => {
  const chapters = ['Low Tide', 'The Logbook', 'Weather', 'The Storm', 'The Tower', 'Morning'];
  fs.writeFileSync(mk('Books', author, `${title}.epub`), zip({
    mimetype: 'application/epub+zip',
    'META-INF/container.xml': '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    'OEBPS/content.opf': `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${title}</dc:title><dc:creator>${author}</dc:creator><dc:date>${year}</dc:date><dc:subject>${genre}</dc:subject>
      <dc:description>A lighthouse keeper, a logbook, and the night the lamp came back on by itself.</dc:description></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
      ${chapters.map((_, k) => `<item id="c${k}" href="c${k}.xhtml" media-type="application/xhtml+xml"/>`).join('')}<item id="cov" href="cover.jpg" media-type="image/jpeg" properties="cover-image"/></manifest>
      <spine>${chapters.map((_, k) => `<itemref idref="c${k}"/>`).join('')}</spine></package>`,
    'OEBPS/nav.xhtml': `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol>${chapters.map((c, k) => `<li><a href="c${k}.xhtml">${c}</a></li>`).join('')}</ol></nav></body></html>`,
    ...Object.fromEntries(chapters.map((c, k) => [`OEBPS/c${k}.xhtml`, chapter(k + 1, c)])),
    'OEBPS/cover.jpg': pic(i + 2),
  }));
});
[['Starfall', 4], ['Neon Ronin', 3]].forEach(([series, n], si) => {
  for (let k = 1; k <= n; k++) fs.writeFileSync(mk('Comics', series, `${series} ${String(k).padStart(3, '0')} (2023).cbz`), zip({
    'ComicInfo.xml': `<ComicInfo><Series>${series}</Series><Number>${k}</Number><Title>Part ${k}</Title><Writer>Kai Moreno</Writer><Year>2023</Year><Summary>A courier crosses a city that rebuilds itself every night.</Summary><Genre>Science Fiction</Genre>${series === 'Neon Ronin' ? '<Manga>Yes</Manga>' : ''}</ComicInfo>`,
    ...Object.fromEntries(Array.from({ length: 8 }, (_, p) => [`page${String(p + 1).padStart(2, '0')}.jpg`, pic(si * 10 + k * 3 + p, '1000x1500')])),
  }, { deflate: false }));
});
// A CBR (really 7z, as many are) with bracketed page names, panel layouts and a double-page spread; and a webtoon with very tall pages.
const panelPage = (seed, layout) => {
  const f = path.join(os.tmpdir(), `hfdev-panels-${seed}-${layout}.jpg`);
  if (!fs.existsSync(f)) {
    const hues = ['0x35d0d0', '0xb344d6', '0xff7a3d', '0x2a6df4', '0xe8b84a', '0x1ce783'];
    const boxes = layout === 0 ? [[40, 40, 920, 430], [40, 500, 445, 480], [515, 500, 445, 480], [40, 1050, 920, 410]]
      : [[40, 40, 445, 700], [515, 40, 445, 700], [40, 810, 600, 650], [710, 810, 250, 650]];
    const draw = boxes.map(([x, y, w, h], k) => `drawbox=x=${x}:y=${y}:w=${w}:h=${h}:color=${hues[(seed + k) % hues.length]}@1:t=fill,drawbox=x=${x}:y=${y}:w=${w}:h=${h}:color=black:t=6`).join(',');
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=white:s=1000x1500', '-vf', draw, '-frames:v', '1', f]);
  }
  return fs.readFileSync(f);
};
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hfdev-cbr-'));
  fs.writeFileSync(path.join(dir, 'Gutter Kings [00] cover.jpg'), pic(31, '1000x1500'));
  for (let p = 1; p <= 6; p++) fs.writeFileSync(path.join(dir, `Gutter Kings [${String(p).padStart(2, '0')}].jpg`), p === 4 ? pic(40, '2000x1500') : panelPage(p, p % 2));
  fs.writeFileSync(path.join(dir, 'ComicInfo.xml'), '<ComicInfo><Series>Gutter Kings</Series><Number>1</Number><Title>The Long Panel</Title><Writer>Ana Ruiz</Writer><Publisher>Hall Press</Publisher><Year>2024</Year><Summary>Four friends draw a comic that starts drawing them back.</Summary><Genre>Adventure</Genre></ComicInfo>');
  fs.mkdirSync(path.join(media, 'Comics', 'Gutter Kings'), { recursive: true });
  execFileSync('bsdtar', ['--format', '7zip', '-cf', path.join(media, 'Comics', 'Gutter Kings', 'Gutter Kings 001 (2024).cbr'), '-C', dir, ...fs.readdirSync(dir)]);
  for (let k = 1; k <= 3; k++) fs.writeFileSync(mk('Comics', 'Tower of Lanterns', `Tower of Lanterns Ep. ${k}.cbz`), zip({
    'ComicInfo.xml': `<ComicInfo><Series>Tower of Lanterns</Series><Number>${k}</Number><Title>Episode ${k}</Title><Writer>Min Seo</Writer><Publisher>Lantern Webtoons</Publisher><Year>2025</Year><Genre>Fantasy</Genre></ComicInfo>`,
    ...Object.fromEntries(Array.from({ length: 5 }, (_, p) => [`${String(p + 1).padStart(3, '0')}.jpg`, pic(k * 7 + p, '800x2600')])),
  }, { deflate: false }));
}
const albums = [['Nova Lines', 'Night Drive', 2020, 'Synthwave', ['Neon Rain', 'Afterglow', 'Overpass', 'Taillights', 'Last Exit']], ['Quartet Nine', 'Strings at Dusk', 1999, 'Classical', ['Allegro', 'Largo', 'Minuet']], ['The Harbor Club', 'Low Tide Radio', 2016, 'Indie', ['Static', 'Lighthouse', 'Paper Boats', 'Signal']]];
albums.forEach(([artist, album, year, genre, songs], ai) => {
  const art = path.join(os.tmpdir(), `hfdev-art-${ai}.jpg`); fs.writeFileSync(art, pic(ai + 20, '600x600'));
  songs.forEach((t, k) => execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `sine=f=${220 * (1 + k * 0.25)}:d=40,volume=0.25`, '-f', 'lavfi', '-i', `sine=f=${330 + ai * 50}:d=40,volume=0.15`, '-i', art,
    '-filter_complex', '[0:a][1:a]amix=inputs=2[a]', '-map', '[a]', '-map', '2:v', '-c:v', 'mjpeg', '-disposition:v', 'attached_pic', '-id3v2_version', '3',
    ...Object.entries({ title: t, artist, album, album_artist: artist, track: `${k + 1}`, date: String(year), genre }).flatMap(([a, b]) => ['-metadata', `${a}=${b}`]), mk('Music', artist, album, `${k + 1} ${t}.mp3`)]));
  // Timed lyrics beside the first song of each album.
  fs.writeFileSync(mk('Music', artist, album, `1 ${songs[0]}.lrc`), ['[00:00.50]City lights are bleeding through the rain', '[00:04.00]Every window holds a different name', '[00:08.00]We keep driving till the signs run out',
    '[00:12.00]Radio is all we talk about', '[00:16.00]Neon on the glass, neon in your eyes', '[00:20.00]Nothing in the mirror but the night', '[00:26.00]Hold on, hold on', '[00:32.00]The morning is a long way off'].join('\n'));
});

const hf = await boot({ generic: true, art: true, port: 8790 });
await hf.api('POST', '/api/setup', { name: 'Jus', password: 'reel-2026', tmdbKey: 'test-key' });
for (const [name, kind] of [['Movies', 'movies'], ['Shows', 'shows'], ['Books', 'books'], ['Comics', 'comics'], ['Music', 'music'], ['Prerolls', 'prerolls']]) await hf.api('POST', '/api/studio/libraries', { name, kind, path: path.join(media, name) });
await hf.scan.idle();
await hf.api('POST', '/api/studio/profiles', { name: 'Guest', password: '4321' });
await hf.api('POST', '/api/studio/prerolls/rules', { name: 'HallFlix ident', clips: { mode: 'all' } });
// Stand-ins for MDBList and OpenSubtitles, so the preview shows ratings from several sources and online subtitles.
const http = await import('node:http');
const svc = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const send = (body, type = 'application/json') => { res.writeHead(200, { 'Content-Type': type }); res.end(typeof body === 'string' ? body : JSON.stringify(body)); };
  const m = /^\/mdb\/tmdb\/(movie|show)\/(\d+)$/.exec(u.pathname);
  if (m) { const n = +m[2]; return send({ ids: { imdb: `tt${String(n).padStart(7, '0')}` }, ratings: [{ source: 'imdb', value: 5.8 + (n % 35) / 10, votes: 1000 * (n % 900) }, { source: 'tomatoes', value: 40 + (n * 7) % 60 },
    { source: 'popcorn', value: 50 + (n * 3) % 50 }, { source: 'metacritic', value: 35 + (n * 5) % 60 }, { source: 'letterboxd', value: 2.6 + (n % 22) / 10 }, { source: 'trakt', value: 55 + (n % 40) }] }); }
  if (u.pathname === '/os/subtitles') return send({ data: ['en', 'en', 'es', 'fr'].map((l, i) => ({ attributes: { language: l, release: ['Web.1080p.NTb', 'BluRay.720p.GRP', 'WEB-DL.SPANISH', 'FRENCH.HDTV'][i], download_count: [4200, 950, 300, 120][i], hearing_impaired: i === 1, files: [{ file_id: i + 1 }] } })) });
  if (u.pathname === '/os/download') return send({ link: `http://127.0.0.1:${svc.address().port}/os/file.srt` });
  if (u.pathname === '/os/file.srt') return send('1\n00:00:01,000 --> 00:00:06,000\nThe signal is getting stronger.\n\n2\n00:00:07,000 --> 00:00:12,000\nHold the line.\n', 'text/plain');
  res.writeHead(404); res.end('{}');
});
await new Promise((ok) => svc.listen(0, '127.0.0.1', ok));
Object.assign(hf.cfg, { mdblistBase: `http://127.0.0.1:${svc.address().port}/mdb`, opensubsBase: `http://127.0.0.1:${svc.address().port}/os`, ratingsDelayMs: 30 });
await hf.api('PUT', '/api/studio/ratings', { providers: [{ id: 'tmdb' }, { id: 'omdb' }, { id: 'mdblist', apiKey: 'dev' }], autoFetch: true, badge: 'auto' });
await hf.api('PUT', '/api/studio/subtitles', { providers: [{ id: 'opensubtitles', apiKey: 'dev' }, { id: 'subdl' }], languages: ['en', 'es'] });
await hf.api('POST', '/api/studio/ratings/refresh', {});
console.log(`READY ${hf.base}  errors=${JSON.stringify(hf.scan.status.errors)}`);
