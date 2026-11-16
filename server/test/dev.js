// Dev preview: a full HallFlix with a sample library on http://127.0.0.1:8790 (used for screenshots).
//   DATABASE_URL=postgres://… node test/dev.js
import fs from 'node:fs';
import path from 'node:path';
import { boot, makeMedia, media } from './helpers.js';

makeMedia();
const src = path.join(media, 'Movies', 'Night Drive (2019)', 'Night Drive (2019).mp4');
const extra = ['Paper Lanterns (2017)', 'Static Bloom (2022)', 'The Ninth Harbor (2019)', 'Copper Sky (2021)', 'Low Tide Radio (2016)', 'Glass Orchard (2023)', 'Wolves of Marrow Lane (2018)',
  'Kite Season (2020)', 'After the Parade (2015)', 'Ember & Ash (2024)', 'Last Train to Elsewhere (2019)', 'Moonlit Arcade (2021)', 'The Quiet Engine (2017)', 'Salt and Neon (2022)', 'Hollow Crown Hotel (2016)', 'Velvet Static (2023)'];
for (const t of extra) fs.linkSync(src, path.join(media, 'Movies', `${t}.mp4`));
const ep = path.join(media, 'Shows', 'Harbor Lights (2018)', 'Season 01', 'Harbor.Lights.S01E01.720p.WEB.mkv');
for (const [show, n] of [['Signal Fires (2020)', 4], ['The Long Way Down (2022)', 3]]) for (let i = 1; i <= n; i++) {
  const f = path.join(media, 'Shows', show, 'Season 01', `S01E0${i}.mkv`); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.linkSync(ep, f);
}
const hf = await boot({ generic: true, art: true, port: 8790 });
await hf.api('POST', '/api/setup', { name: 'Jus', password: 'reel-2026', tmdbKey: 'test-key' });
for (const [name, kind] of [['Movies', 'movies'], ['Shows', 'shows'], ['Prerolls', 'prerolls']]) await hf.api('POST', '/api/studio/libraries', { name, kind, path: path.join(media, name) });
await hf.scan.idle();
await hf.api('POST', '/api/studio/profiles', { name: 'Guest', password: '4321' });
await hf.api('POST', '/api/studio/prerolls/rules', { name: 'HallFlix ident', clips: { mode: 'all' } });
console.log(`READY ${hf.base}  errors=${JSON.stringify(hf.scan.status.errors)}`);
