// The look system: a base theme, per-library looks, and seasons that switch on by date.
import { q, getSetting } from './db.js';

export const DEFAULT_THEME = {
  preset: 'neon-marquee',
  interface: 'futuristic', // futuristic | classic: the shape language of every screen (apps read this too)
  siteName: 'HallFlix',
  colors: { bg: '#0a0814', surface: '#16122b', text: '#f4f2ff', muted: '#a8a3c7', accent: '#35d0d0', accent2: '#b344d6' },
  fonts: { display: 'Outfit', body: 'Inter' },
  radius: 10, // card corner, px
  glow: 0.7, // 0 = flat, 1 = full neon
  glowStyle: 'natural', // neon | natural | ambient: a sharp neon halo, soft light that falls off and is cast downward, or light that only spills underneath
  focusRing: 'glow', // glow | line | aurora: how a card in focus is outlined
  atmosphere: 'none', // none | aurora | leak | both: a slow living light behind the whole app
  pointerLight: false, // a soft light follows the pointer across the background
  // Library tiles on Home: flat, tilting, or layered 3D (picture, covers and name at different depths, a sheen and a thick edge).
  tiles3d: { style: 'layered', depth: 0.6, thickness: 6, shine: true, video: true, sway: true },
  texture: 'none', // none | grain | scanlines | grid | vignette
  cardShape: 'poster', // poster | wide
  heroHeight: 80, // % of the screen height
  background: { image: '', dim: 0.6, blur: 0 },
  // The sign-in page: background, where the box sits, the logo above it, and what makes the box stand out.
  login: { image: '', dim: 0.45, blur: 0, logo: '', logoPlace: 'above', logoSize: 150, x: 'center', y: 'middle', panel: 'none', panelOpacity: 0.72, panelBlur: 18,
    darkWhere: 'none', dark: 0.5, blurWhere: 'all', focusBlur: 0, title: '',
    // Layout: a floating box, or a full-height side panel with the picture beside it.
    layout: 'floating', side: 'left', sideWidth: 33, sideColor: '', sideOpacity: 0.96, divider: true, sidePicture: 'beside', sideBlur: 0, sideEdge: '', fadeWidth: 18,
    // Profile tiles, the other ways to sign in, and a note at the bottom.
    // Music on the sign-in page: uploaded songs, played in order or shuffled, faded in, with a button to pause.
    music: { enabled: false, tracks: [], volume: 0.5, shuffle: false, fade: 3, button: 'corner', showTitle: true },
    tileShape: 'theme', tileMotion: true, tileSize: 132, tileColumns: 0, buttons: 'links', manualButton: true, manualLabel: '', phoneLabel: '', footer: '', footerLink: '' },
  logo: { image: '', height: 46, favicon: '' },
  effect: 'none', // none | snow | snowflakes | embers | hearts | leaves | petals | clovers | eggs | fireflies | fireworks | confetti | stars | bats
  effectDensity: 'normal', // light | normal | heavy
  // Custom CSS laid over everything (the way Jellyfin themes work). A season adds its own after it. Studio lists the
  // variables (--accent, --bg, --radius…) so a few lines go a long way.
  css: '',
  artColor: true, // the accent follows the artwork in focus
  heroMotion: 'clip', // none | pan | clip | trailer: what the spotlight does after a moment (clip = a piece of the film itself; trailer = YouTube)
  // Spotlight clips: cut from a random moment between `start` and `end` seconds into the film, `length` seconds long.
  heroClips: { start: 60, end: 600, length: 30, sound: false, tv: false },
  // TVs (the Fire TV and Android TV apps): how big everything is (the page is laid out this many pixels wide: 1600 looks
  // like a computer, 960 is the big old TV layout), and the extras that cost a Fire TV Stick the most, off unless switched on.
  tv: { width: 1600, focus: 'white', stills: false, effects: false, textures: false, glow: false, wash: false, tileVideos: false, rowItems: 12, rows: 6 },
  depth: true, // posters tilt toward the pointer
  sounds: 'off', // off | soft | arcade | cinema | glass | scifi | custom: the navigation sound pack ("custom" = only uploaded sounds)
  // Each sound can be swapped for an uploaded file, given its own volume, or switched off.
  soundFx: { volume: 0.8, events: {} },
  previews: true, // a card held in focus opens a larger preview
  glass: true, // translucent controls that pick up the picture behind them
  screensaver: 'tv', // off | tv | all: drifting backdrops after a few idle minutes
  profileColors: true, // each profile's colour tints its own session
  // The ident before a feature. `videos` are uploaded idents ({ url, name }), played shuffled or in turn; `builtIn` keeps the
  // built-in animation in the mix (website only). `video` is the older single-video setting, still honoured.
  ident: { enabled: true, video: '', videos: [], order: 'shuffle', builtIn: false, when: 'first' }, // when: 'first' (before any pre-rolls) or 'last' (right before the feature)
  night: { enabled: false, from: '20:00', to: '06:00', theme: {} }, // a second look for the evening, by the viewer's clock
  // Looks for one kind of device, laid over the everyday look: `phone` for the HallFlix app on Android phones and
  // tablets (and phone web browsers when `phoneBrowsers` is on), `tv` for the Fire TV / Android TV apps, Roku and TV
  // browsers. Each holds only what differs; seasons still apply on top, so holiday looks reach every device.
  devices: { phone: {}, tv: {}, phoneBrowsers: false },
  // Rows on Home and in every library (a library can override any of it): how many titles each row shows (0 = all),
  // how many rows show before "Show more rows" (0 = all), arrows or a visible scroll bar under each row, and whether the
  // rows sit in their own scrolling panel so the background stays in view.
  rows: { items: 15, sections: 8, scroll: 'arrows', panel: false, panelHeight: 60 },
  // The library tiles on Home: how wide each may get before another fits in a row (pixels), how tall for their width (%), and
  // how bright the picture behind them is (%; a library can set its own). And the film's logo on the Home banner (% of usual).
  // Library tiles on Home. width: before another fits in a row; height: % of the width (the tile's shape); columns: tiles
  // side by side (0 = as many as fit at `width`); fit: 'fill' crops the picture to the tile, 'whole' shows all of it over a
  // blurred copy; shade: the darkening behind the name (%); gap: space between tiles in px (0 = automatic); layout: 'grid'
  // wraps onto as many rows as needed, 'row' is one row you scroll sideways (columns is then how many show at once).
  homeTiles: { width: 320, height: 44, brightness: 100, columns: 0, fit: 'fill', shade: 100, gap: 0, layout: 'grid' },
  bannerLogo: 100,
  // The logo (or name) on each library's Home tile: where it sits, how big (% of the usual size), a nudge from there,
  // and whether the title count shows under it. A library can override any of it.
  tileLogo: { place: 'bl', size: 100, x: 0, y: 0, count: 'yes' },
  // How tall a library's logo is at the top of its own page, in pixels (0 = automatic). A library can set its own.
  libLogoSize: 0,
  // Where the logo (or name) sits at the top of each library's page: left, center or right of the bar, 'name' (the name
  // instead of the logo) or 'hidden'; x/y nudge it in pixels (it may overlap the banner). A library can set its own.
  libPage: { place: 'left', x: 0, y: 0 },
  // The numbers in the Top rated row: style (outline | solid | glow | badge | hidden), where (behind the poster, in front of it, or beside it),
  // size (% of usual), font ('theme' = the display font), colour (text | accent | gradient), strength (%), and whether the
  // row shows the scroll bar when the other rows do.
  // The loading screen (shown while the app opens, including just after signing in): its picture (blank = the HallFlix
  // logo set above), size (%), motion (pulse | breathe | glow | still) and background colour (blank = the theme's). And a
  // welcome ident: a short video that plays after signing in ('signin') or each time the app opens ('open'), or never.
  splash: { image: '', size: 100, motion: 'pulse', background: '', video: '', when: 'signin', sound: true, audio: '' },
  ranked: { style: 'outline', place: 'behind', size: 100, font: 'theme', color: 'text', strength: 62, scrollbar: false },
  // The covers on each library's Home tile: where they sit, how big, how many and how they stand. A library can override any of it.
  tileCovers: { show: 'yes', place: 'br', size: 56, count: 3, style: 'angled', x: 0, y: 0 },
  // The Fire TV / Android TV app's own screens (Studio → Fire TV app). Sizes are in dp on a 960×540 TV screen.
  tvApp: {
    hero: { show: true, height: 56, width: 72, follow: true, rotate: 12, logos: true, overview: true, brightness: 100 },
    nav: { show: true, libraries: true, search: true, myList: true, align: 'left', logoHeight: 30 },
    tiles: { show: true, title: 'Libraries', width: 224, height: 126, art: 'library', names: true, counts: true, brightness: 100 },
    rows: { titleSize: 17, gap: 18, posterWidth: 122, wideWidth: 224, captions: 'auto', progress: true },
    cards: { radius: 8, focus: 'theme', scale: 108, ring: 3 },
    background: { use: 'color', dim: 70 },
    details: { backdrop: true, brightness: 100, overview: 4, similar: true, episodes: 'stills' },
    library: { columns: 0, background: true, names: false },
  },
};

const P = (name, description, patch) => ({ id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), name, description, theme: patch });
export const PRESETS = [
  P('Neon Marquee', 'Cyan and violet neon on deep indigo, drawn from the HallFlix logo', {}),
  P('Midnight Cinema', 'Navy and warm gold, like a late showing', {
    colors: { bg: '#070b16', surface: '#111a2e', text: '#f5efe0', muted: '#9aa3b8', accent: '#e8b84a', accent2: '#c7772e' },
    fonts: { display: 'Bebas Neue', body: 'Inter' }, glow: 0.25, radius: 6, texture: 'vignette', glowStyle: 'ambient' }),
  P('Classic Red', 'Black with a bold red accent', {
    colors: { bg: '#0b0b0b', surface: '#181818', text: '#ffffff', muted: '#b3b3b3', accent: '#e50914', accent2: '#b20710' },
    fonts: { display: 'Bebas Neue', body: 'Inter' }, glow: 0, radius: 4 }),
  P('Streamline', 'Dark slate with fresh green', {
    colors: { bg: '#0b0e11', surface: '#151b22', text: '#f2f6f8', muted: '#9fb0bd', accent: '#1ce783', accent2: '#12b8a6' },
    fonts: { display: 'Outfit', body: 'Inter' }, glow: 0.15, radius: 12, cardShape: 'wide' }),
  P('Sunset VHS', 'Purple dusk, orange glow and scanlines', {
    colors: { bg: '#140a1f', surface: '#22123a', text: '#fff1e6', muted: '#c9a9c8', accent: '#ff7a3d', accent2: '#ff3d8b' },
    fonts: { display: 'Audiowide', body: 'Inter' }, glow: 0.9, glowStyle: 'neon', radius: 2, texture: 'scanlines', atmosphere: 'leak' }),
  P('Daylight', 'A light, airy look', {
    colors: { bg: '#f4f5f8', surface: '#ffffff', text: '#14151a', muted: '#5d6272', accent: '#2a6df4', accent2: '#7a3df4' },
    fonts: { display: 'Outfit', body: 'Inter' }, glow: 0, radius: 14 }),
  P('Halloween', 'Pumpkin orange and witching purple with drifting embers', {
    colors: { bg: '#0d0710', surface: '#1c0f22', text: '#ffeeda', muted: '#b9a2b4', accent: '#ff7518', accent2: '#8a2be2' },
    fonts: { display: 'Bebas Neue', body: 'Inter' }, glow: 0.8, texture: 'grain', effect: 'bats' }),
  P('Winter Holiday', 'Deep pine, berry red and falling snow', {
    colors: { bg: '#07130f', surface: '#0f2019', text: '#f6fbf8', muted: '#a5bdb3', accent: '#e23b3b', accent2: '#3fb27f' },
    fonts: { display: 'Outfit', body: 'Inter' }, glow: 0.5, effect: 'snow' }),
  P('Valentine', 'Rose and blush with floating hearts', {
    colors: { bg: '#170810', surface: '#280f1c', text: '#fff0f4', muted: '#d1a5b5', accent: '#ff4d7e', accent2: '#ff9fbd' },
    glow: 0.6, effect: 'hearts' }),
  P('Autumn', 'Burnt orange and maple with falling leaves', {
    colors: { bg: '#120c07', surface: '#21160d', text: '#fbf1e4', muted: '#c2ab93', accent: '#e07b2a', accent2: '#b5432a' },
    glow: 0.3, effect: 'leaves', texture: 'grain' }),
  // Looks in the spirit of popular Jellyfin themes, rebuilt from HallFlix's own settings (colours, glow, glass, shape).
  P('Glass Chrome', 'Frosted glass panels and a soft accent glow, in the spirit of Ultrachromic', {
    colors: { bg: '#0c0f17', surface: '#1a2030', text: '#eef2fb', muted: '#9aa6bf', accent: '#6aa8ff', accent2: '#a78bfa' },
    fonts: { display: 'Outfit', body: 'Inter' }, glow: 0.45, glowStyle: 'ambient', radius: 16, glass: true, atmosphere: 'aurora', focusRing: 'aurora' }),
  P('OLED Black', 'Pure black and white with a single quiet accent, in the spirit of Monochromic', {
    colors: { bg: '#000000', surface: '#0d0d0d', text: '#ffffff', muted: '#8c8c8c', accent: '#ffffff', accent2: '#7a7a7a' },
    fonts: { display: 'Inter', body: 'Inter' }, glow: 0, radius: 8, focusRing: 'line', glass: false, interface: 'classic' }),
  P('Elegant Slate', 'Refined slate and soft violet with gentle rounded cards, in the spirit of ElegantFin', {
    colors: { bg: '#111318', surface: '#1c2029', text: '#e9e7f2', muted: '#a09cb3', accent: '#9d8cff', accent2: '#5f9df7' },
    fonts: { display: 'Outfit', body: 'Inter' }, glow: 0.2, glowStyle: 'natural', radius: 14, focusRing: 'line', interface: 'classic' }),
  P('Neutral Grey', 'Black and graphite, nothing competing with the artwork, in the spirit of NeutralFin', {
    colors: { bg: '#0e0e0f', surface: '#1b1b1d', text: '#f2f2f2', muted: '#9c9ca1', accent: '#d4d4d8', accent2: '#71717a' },
    fonts: { display: 'Inter', body: 'Inter' }, glow: 0, radius: 10, focusRing: 'line', interface: 'classic' }),
  P('Pastel Mocha', 'Soft pastels on warm dark mocha (the Catppuccin Mocha palette)', {
    colors: { bg: '#1e1e2e', surface: '#313244', text: '#cdd6f4', muted: '#a6adc8', accent: '#cba6f7', accent2: '#f5c2e7' },
    fonts: { display: 'Outfit', body: 'Inter' }, glow: 0.3, glowStyle: 'natural', radius: 14 }),
  P('Dracula', 'Purple, pink and green on charcoal (the Dracula palette)', {
    colors: { bg: '#21222c', surface: '#282a36', text: '#f8f8f2', muted: '#a9abc3', accent: '#bd93f9', accent2: '#ff79c6' },
    fonts: { display: 'Outfit', body: 'Inter' }, glow: 0.5, radius: 10 }),
  P('Tokyo Night', 'Midnight blue with neon city blues and magentas', {
    colors: { bg: '#1a1b26', surface: '#24283b', text: '#c0caf5', muted: '#9aa5ce', accent: '#7aa2f7', accent2: '#bb9af7' },
    fonts: { display: 'Audiowide', body: 'Inter' }, glow: 0.6, glowStyle: 'neon', radius: 8, texture: 'grid' }),
  P('Retro Gruvbox', 'Warm retro browns, mustard and orange', {
    colors: { bg: '#1d2021', surface: '#282828', text: '#ebdbb2', muted: '#a89984', accent: '#fabd2f', accent2: '#fe8019' },
    fonts: { display: 'Bebas Neue', body: 'Inter' }, glow: 0.15, radius: 4, texture: 'grain' }),
  // Holidays and seasons (each pairs with a Seasons quick start).
  P('New Year', 'Black and champagne gold with fireworks', {
    colors: { bg: '#07070b', surface: '#15141c', text: '#fff8e6', muted: '#b8b09a', accent: '#f3c969', accent2: '#c0c0d8' },
    fonts: { display: 'Bebas Neue', body: 'Inter' }, glow: 0.7, glowStyle: 'neon', effect: 'fireworks' }),
  P('St Patrick', 'Emerald and gold with falling clovers', {
    colors: { bg: '#06120b', surface: '#0e2216', text: '#f1fbf4', muted: '#9dbfa8', accent: '#2ecc71', accent2: '#e8c547' },
    glow: 0.45, effect: 'clovers' }),
  P('Spring', 'Pastel blossom and fresh mint with drifting petals', {
    colors: { bg: '#12101a', surface: '#1f1a2b', text: '#fdf6fb', muted: '#c4b6cc', accent: '#ff9ccf', accent2: '#8fe3c4' },
    fonts: { display: 'Outfit', body: 'Inter' }, glow: 0.35, radius: 16, effect: 'petals' }),
  P('Easter', 'Soft pastels with floating painted eggs', {
    colors: { bg: '#141221', surface: '#221f36', text: '#fbf8ff', muted: '#bfb8d6', accent: '#b9a3ff', accent2: '#ffd36e' },
    fonts: { display: 'Outfit', body: 'Inter' }, glow: 0.3, radius: 18, effect: 'eggs' }),
  P('Independence Day', 'Navy, red and white with fireworks', {
    colors: { bg: '#060b1a', surface: '#0f1a33', text: '#ffffff', muted: '#a8b4cf', accent: '#e63946', accent2: '#4d7cff' },
    fonts: { display: 'Bebas Neue', body: 'Inter' }, glow: 0.55, effect: 'fireworks' }),
  P('Summer Nights', 'Warm dusk teal and coral with fireflies', {
    colors: { bg: '#081416', surface: '#112326', text: '#f2fbf9', muted: '#9fbfba', accent: '#ff8a5c', accent2: '#2ec4b6' },
    fonts: { display: 'Outfit', body: 'Inter' }, glow: 0.4, glowStyle: 'natural', effect: 'fireflies', atmosphere: 'leak' }),
  P('Thanksgiving', 'Harvest gold, cranberry and pumpkin with falling leaves', {
    colors: { bg: '#130d08', surface: '#24180f', text: '#fdf3e3', muted: '#c9b296', accent: '#d9822b', accent2: '#9e2a2b' },
    fonts: { display: 'Bebas Neue', body: 'Inter' }, glow: 0.3, effect: 'leaves', texture: 'grain' }),
  P('Hanukkah', 'Deep blue and silver with twinkling stars', {
    colors: { bg: '#060b1c', surface: '#0f1833', text: '#f4f7ff', muted: '#a7b3d4', accent: '#4f8cff', accent2: '#d6dbe8' },
    glow: 0.55, effect: 'stars' }),
  P('Winter Frost', 'Icy blue and white with large drifting snowflakes', {
    colors: { bg: '#070d17', surface: '#101b2b', text: '#f3f8ff', muted: '#a5b6cc', accent: '#8fd3ff', accent2: '#d9ecff' },
    fonts: { display: 'Outfit', body: 'Inter' }, glow: 0.45, glowStyle: 'natural', effect: 'snowflakes', atmosphere: 'aurora' }),
];

/**
 * Holidays that move each year, for season and pre-roll dates. A date is "MM-DD", or one of these names with an
 * optional offset in days ("easter-7" is a week before Easter), or "MM/Nddd" for the Nth weekday of a month ("11/4thu"
 * is the 4th Thursday of November; "05/lastmon" is the last Monday of May).
 */
export const DATE_RULES = [
  ['easter', 'Easter Sunday'], ['11/4thu', 'Thanksgiving (US, 4th Thursday of November)'], ['10/2mon', 'Thanksgiving (Canada, 2nd Monday of October)'],
  ['05/2sun', 'Mother’s Day (US, 2nd Sunday of May)'], ['06/3sun', 'Father’s Day (US, 3rd Sunday of June)'], ['05/lastmon', 'Memorial Day (last Monday of May)'],
  ['09/1mon', 'Labor Day (1st Monday of September)'], ['01/3mon', 'Martin Luther King Jr. Day (3rd Monday of January)'], ['11/4thu+1', 'Black Friday (day after US Thanksgiving)'],
];
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
function easter(y) { // Anonymous Gregorian algorithm
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  return new Date(y, Math.floor((h + l - 7 * m + 114) / 31) - 1, ((h + l - 7 * m + 114) % 31) + 1);
}
/** The "MM-DD" a date (fixed or moving) falls on in a given year, or null if it isn't a date. */
export function dayOf(token, year) {
  const t = String(token || '').trim().toLowerCase();
  if (/^\d\d-\d\d$/.test(t)) return t;
  const m = /^(easter|(\d\d)\/(last|[1-5])(sun|mon|tue|wed|thu|fri|sat))([+-]\d{1,3})?$/.exec(t);
  if (!m) return null;
  let d;
  if (m[1] === 'easter') d = easter(year);
  else {
    const month = +m[2] - 1, wd = DAYS.indexOf(m[4]);
    if (month < 0 || month > 11) return null;
    if (m[3] === 'last') { d = new Date(year, month + 1, 0); while (d.getDay() !== wd) d.setDate(d.getDate() - 1); }
    else { d = new Date(year, month, 1); while (d.getDay() !== wd) d.setDate(d.getDate() + 1); d.setDate(d.getDate() + 7 * (+m[3] - 1)); if (d.getMonth() !== month) return null; }
  }
  if (m[5]) d.setDate(d.getDate() + +m[5]);
  return md(d);
}
export const validDate = (token) => dayOf(token, 2026) != null;

/**
 * "Fast on TVs" (Studio → Look and feel → 📺 TVs): the TV look settings that cost a Fire TV Stick the most, turned off.
 * Laid over the TV look with one click; each one can be put back on its own. Moving effects, textures, the full glow,
 * the colour wash and tile videos are already off on TVs unless switched on (tv.*), and stay off.
 */
export const FAST_TV = {
  glass: false, // translucent panels make the TV re-blur what's behind them every frame
  glow: 0, focusRing: 'line', atmosphere: 'none',
  tiles3d: { style: 'flat', sway: false, shine: false, video: false },
  heroMotion: 'none', heroClips: { tv: false },
  previews: false, // the larger preview that opens on a title held in focus
  artColor: false, // reading each picture's colours as focus moves
  background: { blur: 0 },
  login: { blur: 0, panelBlur: 0, focusBlur: 0, sideBlur: 0, tileMotion: false },
  splash: { motion: 'still' },
  tv: { effects: false, textures: false, glow: false, wash: false, tileVideos: false, stills: true },
};

export const OPTIONS = {
  fonts: ['Outfit', 'Inter', 'Bebas Neue', 'Audiowide', 'Georgia', 'System'],
  textures: ['none', 'grain', 'scanlines', 'grid', 'vignette'],
  effects: ['none', 'snow', 'snowflakes', 'embers', 'hearts', 'leaves', 'petals', 'clovers', 'eggs', 'fireflies', 'fireworks', 'confetti', 'stars', 'bats'],
  densities: ['light', 'normal', 'heavy'],
  cardShapes: ['poster', 'wide'],
  interfaces: ['futuristic', 'classic'],
  heroMotions: ['none', 'pan', 'clip', 'trailer'],
  sounds: ['off', 'soft', 'arcade', 'cinema', 'glass', 'scifi', 'custom'],
  glowStyles: ['neon', 'natural', 'ambient'],
  focusRings: ['glow', 'line', 'aurora'],
  atmospheres: ['none', 'aurora', 'leak', 'both'],
  tileStyles: ['flat', 'tilt', 'layered'],
  screensavers: ['off', 'tv', 'all'],
};

export function merge(base, patch) {
  if (patch === undefined || patch === null) return base;
  if (typeof base !== 'object' || base === null || Array.isArray(base) || typeof patch !== 'object' || Array.isArray(patch)) return patch;
  const out = { ...base };
  for (const [k, v] of Object.entries(patch)) out[k] = merge(base[k], v);
  return out;
}

const md = (date) => `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
/** Date ranges, inclusive; each end is "MM-DD" or a moving holiday (see dayOf). A range may wrap the new year (12-20 → 01-02). */
export function inRange(starts, ends, date = new Date()) {
  const d = md(date), y = date.getFullYear();
  const a = dayOf(starts, y), b = dayOf(ends, y);
  if (!a || !b) return false;
  return a <= b ? d >= a && d <= b : d >= a || d <= b;
}

/** Empty strings in a season or library look mean "not set" and must not blank out the base value. */
function prune(o) {
  if (typeof o !== 'object' || o === null) return o;
  const out = {};
  for (const [k, v] of Object.entries(o)) {
    if (v === '' || v === null || v === undefined) continue;
    const p = prune(v);
    if (typeof p === 'object' && !Array.isArray(p) && !Object.keys(p).length) continue;
    out[k] = p;
  }
  return out;
}

export const DEVICES = ['phone', 'tv'];

/**
 * The look as the apps get it. `theme` and `night` are the everyday look; `devices.phone` / `devices.tv` (only when
 * that device has settings of its own) are the same thing worked out for that device: its settings laid over the
 * everyday look first, then any running season, then its evening look. Each device picks its own (core.js lookFor).
 */
export function resolve({ theme, libraries, seasons, date = new Date(), forceSeason = null }) {
  const { devices, ...everyday } = theme || {};
  const base = resolveOne({ theme: everyday, libraries, seasons, date, forceSeason });
  const out = { ...base, devices: { phoneBrowsers: !!devices?.phoneBrowsers } };
  for (const d of DEVICES) {
    const patch = prune(devices?.[d] || {});
    if (!Object.keys(patch).length) continue;
    const own = merge(everyday, patch);
    // A device's own CSS adds to the everyday CSS rather than replacing it.
    own.css = [everyday.css, patch.css].filter((x) => typeof x === 'string' && x.trim()).join('\n\n');
    const r = resolveOne({ theme: own, libraries: [], seasons, date, forceSeason });
    out.devices[d] = { theme: r.theme, night: r.night };
  }
  return out;
}

function resolveOne({ theme, libraries, seasons, date, forceSeason }) {
  let out = merge(DEFAULT_THEME, theme || {});
  delete out.devices;
  const active = seasons.filter((s) => (forceSeason != null ? s.id === forceSeason : s.enabled && inRange(s.starts, s.ends, date)));
  for (const s of active) out = merge(out, prune(s.look?.theme || {}));
  // Custom CSS adds up: the everyday CSS, then each running season's.
  out.css = [theme?.css, ...active.map((s) => s.look?.theme?.css)].filter((x) => typeof x === 'string' && x.trim()).join('\n\n');
  const libs = {};
  for (const l of libraries) {
    let look = prune(l.look || {});
    for (const s of active) look = merge(look, prune(s.look?.libraries?.[l.id] || {}));
    libs[l.id] = look;
  }
  // The evening look is resolved here and chosen by each device from its own clock. A running season wins over it.
  let night = null;
  const n = out.night;
  if (n?.enabled && !active.length && /^\d\d:\d\d$/.test(n.from || '') && /^\d\d:\d\d$/.test(n.to || '')) {
    night = { from: n.from, to: n.to, theme: { ...merge(out, prune(n.theme || {})), night: undefined } };
  }
  return { theme: { ...out, night: { enabled: !!n?.enabled, from: n?.from, to: n?.to } }, libraries: libs, season: active.length ? active[active.length - 1].name : null, night };
}

export async function currentLook(opts = {}) {
  const [theme, libraries, seasons] = await Promise.all([
    getSetting('theme', {}),
    q('select id, look from libraries'),
    q('select * from seasons order by id'),
  ]);
  return resolve({ theme, libraries, seasons, ...opts });
}
