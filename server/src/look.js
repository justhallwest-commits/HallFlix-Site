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
  logo: { image: '', height: 46 },
  effect: 'none', // none | snow | embers | hearts | leaves | confetti | stars | bats
  artColor: true, // the accent follows the artwork in focus
  heroMotion: 'clip', // none | pan | clip | trailer: what the spotlight does after a moment (clip = a piece of the film itself; trailer = YouTube)
  // Spotlight clips: cut from a random moment between `start` and `end` seconds into the film, `length` seconds long.
  heroClips: { start: 60, end: 600, length: 30, sound: false, tv: true },
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
  ident: { enabled: true, video: '', videos: [], order: 'shuffle', builtIn: false },
  night: { enabled: false, from: '20:00', to: '06:00', theme: {} }, // a second look for the evening, by the viewer's clock
  // Rows on Home and in every library (a library can override any of it): how many titles each row shows (0 = all),
  // how many rows show before "Show more rows" (0 = all), arrows or a visible scroll bar under each row, and whether the
  // rows sit in their own scrolling panel so the background stays in view.
  rows: { items: 15, sections: 8, scroll: 'arrows', panel: false, panelHeight: 60 },
  // The library tiles on Home: how wide each may get before another fits in a row (pixels), how tall for their width (%), and
  // how bright the picture behind them is (%; a library can set its own). And the film's logo on the Home banner (% of usual).
  homeTiles: { width: 320, height: 44, brightness: 100 },
  bannerLogo: 100,
  // The logo (or name) on each library's Home tile: where it sits, how big (% of the usual size), a nudge from there,
  // and whether the title count shows under it. A library can override any of it.
  tileLogo: { place: 'bl', size: 100, x: 0, y: 0, count: 'yes' },
  // How tall a library's logo is at the top of its own page, in pixels (0 = automatic). A library can set its own.
  libLogoSize: 0,
  // Where the logo (or name) sits at the top of each library's page: left, center or right of the bar, 'name' (the name
  // instead of the logo) or 'hidden'; x/y nudge it in pixels (it may overlap the banner). A library can set its own.
  libPage: { place: 'left', x: 0, y: 0 },
  // The numbers in the Top rated row: style (outline | solid | glow | badge | hidden), where (behind the poster or beside it),
  // size (% of usual), font ('theme' = the display font), colour (text | accent | gradient), strength (%), and whether the
  // row shows the scroll bar when the other rows do.
  // The loading screen (shown while the app opens, including just after signing in): its picture (blank = the HallFlix
  // logo set above), size (%), motion (pulse | breathe | glow | still) and background colour (blank = the theme's). And a
  // welcome ident: a short video that plays after signing in ('signin') or each time the app opens ('open'), or never.
  splash: { image: '', size: 100, motion: 'pulse', background: '', video: '', when: 'signin', sound: true },
  ranked: { style: 'outline', place: 'behind', size: 100, font: 'theme', color: 'text', strength: 62, scrollbar: false },
  // The covers on each library's Home tile: where they sit, how big, how many and how they stand. A library can override any of it.
  tileCovers: { show: 'yes', place: 'br', size: 56, count: 3, style: 'angled', x: 0, y: 0 },
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
];

export const OPTIONS = {
  fonts: ['Outfit', 'Inter', 'Bebas Neue', 'Audiowide', 'Georgia', 'System'],
  textures: ['none', 'grain', 'scanlines', 'grid', 'vignette'],
  effects: ['none', 'snow', 'embers', 'hearts', 'leaves', 'confetti', 'stars', 'bats'],
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
/** "MM-DD" ranges, inclusive; a range may wrap the new year (12-20 → 01-02). */
export function inRange(starts, ends, date = new Date()) {
  const d = md(date);
  if (!/^\d\d-\d\d$/.test(starts || '') || !/^\d\d-\d\d$/.test(ends || '')) return false;
  return starts <= ends ? d >= starts && d <= ends : d >= starts || d <= ends;
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

export function resolve({ theme, libraries, seasons, date = new Date(), forceSeason = null }) {
  let out = merge(DEFAULT_THEME, theme || {});
  const active = seasons.filter((s) => (forceSeason != null ? s.id === forceSeason : s.enabled && inRange(s.starts, s.ends, date)));
  for (const s of active) out = merge(out, prune(s.look?.theme || {}));
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
