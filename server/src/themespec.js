// The theme contract. DEFAULT_THEME (look.js) says which keys a theme has and what type each is; RULES below add the
// allowed choices and ranges (the same ones Studio offers). Everything that brings a theme in (plugins, theme files,
// Studio, seasons) goes through checkTheme, so the web app, Android and Roku only ever see values they can draw.
// docs/theme.schema.json is generated from here (themeFileSchema) so editors can autocomplete and check theme files.
import { DEFAULT_THEME, OPTIONS } from './look.js';

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const EFFECT_ID = /^[a-z0-9][a-z0-9-]{0,39}$/; // built-in effects, or one a plugin registers with HallFlix.registerEffect
const one = (...lists) => [...new Set(lists.flat())];

// Choices and ranges per key path. Paths not listed take their type from DEFAULT_THEME with no further limits.
const RULES = {
  interface: { enum: OPTIONS.interfaces },
  'fonts.display': { enum: OPTIONS.fonts },
  'fonts.body': { enum: OPTIONS.fonts },
  radius: { min: 0, max: 28 },
  glow: { min: 0, max: 1 },
  glowStyle: { enum: OPTIONS.glowStyles },
  focusRing: { enum: OPTIONS.focusRings },
  atmosphere: { enum: OPTIONS.atmospheres },
  'tiles3d.style': { enum: OPTIONS.tileStyles },
  'tiles3d.depth': { min: 0, max: 1 },
  'tiles3d.thickness': { min: 0, max: 16 },
  texture: { enum: OPTIONS.textures },
  cardShape: { enum: OPTIONS.cardShapes },
  heroHeight: { min: 40, max: 100 },
  'background.dim': { min: 0, max: 0.95 },
  'background.blur': { min: 0, max: 30 },
  'login.dim': { min: 0, max: 0.95 },
  'login.blur': { min: 0, max: 30 },
  'login.logoSize': { min: 40, max: 340 },
  'login.y': { enum: ['top', 'middle', 'bottom'] },
  'login.panelOpacity': { min: 0.1, max: 1 },
  'login.panelBlur': { min: 0, max: 40 },
  'login.dark': { min: 0, max: 1 },
  'login.focusBlur': { min: 0, max: 40 },
  'login.layout': { enum: ['floating', 'split'] },
  'login.side': { enum: ['left', 'right'] },
  'login.sideWidth': { min: 20, max: 70 },
  'login.sideColor': { color: true },
  'login.sideOpacity': { min: 0, max: 1 },
  'login.sidePicture': { enum: ['beside', 'behind'] },
  'login.sideBlur': { min: 0, max: 40 },
  'login.sideEdge': { enum: ['', 'line', 'none', 'fade'] },
  'login.fadeWidth': { min: 4, max: 45 },
  'login.music.volume': { min: 0, max: 1 },
  'login.music.fade': { min: 0, max: 10 },
  'login.music.button': { enum: ['corner', 'hidden'] },
  'login.tileSize': { min: 56, max: 220 },
  'login.tileColumns': { min: 0, max: 8 },
  'login.buttons': { enum: ['links', 'outlined', 'filled'] },
  'logo.height': { min: 20, max: 120 },
  effect: { pattern: EFFECT_ID, enum: OPTIONS.effects, open: true },
  effectDensity: { enum: OPTIONS.densities },
  heroMotion: { enum: OPTIONS.heroMotions },
  'heroClips.start': { min: 0, max: 600 },
  'heroClips.end': { min: 60, max: 1800 },
  'heroClips.length': { min: 10, max: 60 },
  'tv.width': { min: 960, max: 1920 },
  'tv.focus': { enum: ['white', 'accent'] },
  'tv.rowItems': { min: 6, max: 40 },
  'tv.rows': { min: 2, max: 20 },
  sounds: { enum: OPTIONS.sounds },
  'soundFx.volume': { min: 0, max: 1 },
  screensaver: { enum: OPTIONS.screensavers },
  'ident.order': { enum: ['shuffle', 'order'] },
  'ident.when': { enum: ['first', 'last'] },
  'night.from': { pattern: /^\d\d:\d\d$/ },
  'night.to': { pattern: /^\d\d:\d\d$/ },
  'rows.items': { min: 0, max: 200 },
  'rows.sections': { min: 0, max: 100 },
  'rows.panelHeight': { min: 30, max: 90 },
  'homeTiles.width': { min: 120, max: 900 },
  'homeTiles.height': { min: 20, max: 100 },
  'homeTiles.fit': { enum: ['fill', 'whole'] },
  'homeTiles.layout': { enum: ['grid', 'row'] },
  'homeTiles.shade': { min: 0, max: 100 },
  'homeTiles.gap': { min: 0, max: 60 },
  'homeTiles.brightness': { min: 20, max: 160 },
  'homeTiles.columns': { min: 0, max: 4 },
  bannerLogo: { min: 30, max: 250 },
  'tileLogo.size': { min: 30, max: 300 },
  'tileLogo.x': { min: -45, max: 45 },
  'tileLogo.y': { min: -45, max: 45 },
  libLogoSize: { min: 0, max: 260 },
  'libPage.x': { min: -400, max: 400 },
  'libPage.y': { min: -300, max: 300 },
  'splash.size': { min: 30, max: 250 },
  'splash.motion': { enum: ['pulse', 'breathe', 'glow', 'still'] },
  'splash.background': { color: true },
  'splash.when': { enum: ['signin', 'open', 'never'] },
  'splash.audio': { enum: ['', 'own', 'music', 'silent'] },
  'ranked.style': { enum: ['outline', 'solid', 'glow', 'badge', 'hidden'] },
  'ranked.place': { enum: ['behind', 'front', 'beside'] },
  'ranked.size': { min: 40, max: 160 },
  'ranked.font': { enum: one('theme', OPTIONS.fonts) },
  'ranked.color': { enum: ['text', 'accent', 'gradient'] },
  'ranked.strength': { min: 15, max: 100 },
  'tileCovers.size': { min: 20, max: 100 },
  'tileCovers.count': { min: 0, max: 6 },
  'tileCovers.x': { min: -40, max: 40 },
  'tileCovers.y': { min: -40, max: 40 },
  'tvApp.hero.height': { min: 30, max: 80 },
  'tvApp.hero.width': { min: 40, max: 100 },
  'tvApp.hero.rotate': { min: 0, max: 60 },
  'tvApp.hero.brightness': { min: 30, max: 130 },
  'tvApp.nav.align': { enum: ['left', 'center'] },
  'tvApp.nav.logoHeight': { min: 16, max: 60 },
  'tvApp.tiles.title': { maxLength: 40 },
  'tvApp.tiles.width': { min: 120, max: 400 },
  'tvApp.tiles.height': { min: 60, max: 240 },
  'tvApp.tiles.art': { enum: ['library', 'newest'] },
  'tvApp.tiles.brightness': { min: 30, max: 130 },
  'tvApp.rows.titleSize': { min: 12, max: 28 },
  'tvApp.rows.gap': { min: 4, max: 48 },
  'tvApp.rows.posterWidth': { min: 80, max: 200 },
  'tvApp.rows.wideWidth': { min: 140, max: 360 },
  'tvApp.rows.captions': { enum: ['auto', 'always', 'never'] },
  'tvApp.cards.radius': { min: 0, max: 24 },
  'tvApp.cards.focus': { enum: ['theme', 'white', 'accent', 'none'] },
  'tvApp.cards.scale': { min: 100, max: 125 },
  'tvApp.cards.ring': { min: 0, max: 8 },
  'tvApp.background.use': { enum: ['color', 'image'] },
  'tvApp.background.dim': { min: 0, max: 95 },
  'tvApp.details.brightness': { min: 30, max: 130 },
  'tvApp.details.overview': { min: 0, max: 8 },
  'tvApp.details.episodes': { enum: ['stills', 'list'] },
  'tvApp.library.columns': { min: 0, max: 10 },
  css: { maxLength: 200000 },
  siteName: { maxLength: 60 },
};
// Keys whose value is free-form: a map Studio fills in, or a list of uploads.
const FREE = new Set(['soundFx.events', 'login.music.tracks', 'ident.videos']);
// The evening look and each device's look are themselves (partial) themes.
const NESTED_THEMES = new Set(['night.theme', 'devices.phone', 'devices.tv']);

/** What kind of value a path holds, from its default and its rule. */
function kindOf(path, def) {
  const rule = RULES[path] || {};
  if (FREE.has(path)) return Array.isArray(def) ? 'list' : 'map';
  if (NESTED_THEMES.has(path)) return 'theme';
  if (rule.color || path.startsWith('colors.')) return 'color';
  if (rule.enum || rule.pattern) return 'choice';
  if (typeof def === 'boolean') return 'boolean';
  if (typeof def === 'number') return 'number';
  if (Array.isArray(def)) return 'list';
  if (def && typeof def === 'object') return 'object';
  return 'string';
}

const fail = (problems, path, why) => problems.push(`${path}: ${why}`);

function checkValue(path, value, def, problems, opts) {
  const rule = RULES[path] || {};
  const kind = kindOf(path, def);
  // An empty string means "not set" in seasons and library looks: it is kept and falls back to the base value.
  if (value === '' && kind !== 'object' && kind !== 'theme') return { ok: true, value };
  switch (kind) {
    case 'color': {
      if (typeof value !== 'string' || !HEX.test(value.trim())) return fail(problems, path, `"${value}" is not a colour; use #rrggbb`), { ok: false };
      let h = value.trim().toLowerCase();
      if (h.length === 4) h = '#' + [...h.slice(1)].map((c) => c + c).join('');
      return { ok: true, value: h };
    }
    case 'choice': {
      if (typeof value === 'number' && rule.enum?.includes(value)) return { ok: true, value };
      if (typeof value !== 'string') return fail(problems, path, `expected text, got ${typeof value}`), { ok: false };
      if (rule.enum && rule.enum.includes(value)) return { ok: true, value };
      if (rule.pattern && rule.pattern.test(value) && (!rule.enum || rule.open)) return { ok: true, value };
      const allowed = rule.enum ? `one of ${rule.enum.filter(Boolean).join(', ')}${rule.open ? ', or a plugin effect id' : ''}` : `in the form ${rule.pattern}`;
      return fail(problems, path, `"${value}" is not allowed; use ${allowed}`), { ok: false };
    }
    case 'boolean':
      if (typeof value === 'boolean') return { ok: true, value };
      if (value === 'true' || value === 'false') return { ok: true, value: value === 'true' };
      return fail(problems, path, `expected true or false, got ${JSON.stringify(value)}`), { ok: false };
    case 'number': {
      const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
      if (typeof n !== 'number' || !Number.isFinite(n)) return fail(problems, path, `expected a number, got ${JSON.stringify(value)}`), { ok: false };
      if ('min' in rule && n < rule.min) return fail(problems, path, `${n} is below ${rule.min}, set to ${rule.min}`), { ok: true, value: rule.min };
      if ('max' in rule && n > rule.max) return fail(problems, path, `${n} is above ${rule.max}, set to ${rule.max}`), { ok: true, value: rule.max };
      return { ok: true, value: n };
    }
    case 'string':
      if (typeof value !== 'string') return fail(problems, path, `expected text, got ${typeof value}`), { ok: false };
      if (rule.maxLength && value.length > rule.maxLength) return fail(problems, path, `longer than ${rule.maxLength} characters, cut short`), { ok: true, value: value.slice(0, rule.maxLength) };
      return { ok: true, value };
    case 'list':
      if (!Array.isArray(value)) return fail(problems, path, 'expected a list'), { ok: false };
      return { ok: true, value: value.slice(0, 500) };
    case 'map':
      if (!value || typeof value !== 'object' || Array.isArray(value)) return fail(problems, path, 'expected an object'), { ok: false };
      return { ok: true, value };
    case 'theme': {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return fail(problems, path, 'expected a theme object'), { ok: false };
      // A nested look can't hold its own device looks (a phone look inside the phone look).
      const { devices, ...rest } = value;
      if (devices !== undefined) fail(problems, `${path}.devices`, 'a nested look cannot have device looks, ignored');
      return { ok: true, value: walk(rest, DEFAULT_THEME, '', problems, { ...opts, unknown: opts.unknown === 'keep' ? 'keep' : 'drop' }, path + '.') };
    }
    case 'object':
      if (!value || typeof value !== 'object' || Array.isArray(value)) return fail(problems, path, 'expected an object'), { ok: false };
      return { ok: true, value: walk(value, def, path + '.', problems, opts) };
  }
  return { ok: false };
}

function walk(obj, defaults, prefix, problems, opts, label = prefix) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix + k;
    const shown = label + k;
    if (k === '$schema' && !prefix) continue;
    if (!(k in defaults)) {
      if (opts.unknown === 'keep') { out[k] = v; continue; }
      fail(problems, shown, 'not a theme setting, ignored');
      continue;
    }
    const before = problems.length;
    const r = checkValue(path, v, defaults[k], problems, opts);
    // Re-label problems from a nested theme (night.theme.colors.bg) so they point at the right place.
    if (label !== prefix) for (let i = before; i < problems.length; i++) if (!problems[i].startsWith(label)) problems[i] = label + problems[i];
    if (r.ok) out[k] = r.value;
  }
  return out;
}

/**
 * Check a (partial) theme. Returns { theme, problems }: `theme` keeps every valid value (numbers out of range are
 * clamped, #abc colours widened to #aabbcc) and leaves out invalid ones; `problems` says what was changed and why.
 * unknown: 'drop' (theme files and plugins) leaves out keys HallFlix doesn't know; 'keep' (Studio) passes them through.
 */
export function checkTheme(theme, { unknown = 'drop' } = {}) {
  const problems = [];
  if (!theme || typeof theme !== 'object' || Array.isArray(theme)) return { theme: {}, problems: ['theme: expected an object'] };
  return { theme: walk(theme, DEFAULT_THEME, '', problems, { unknown }), problems };
}

/** Relative paths in a plugin's theme ("assets/bg.jpg", "./logo.png") point into that plugin's folder. */
export function pluginAssetUrls(theme, pluginId) {
  const fix = (v) => {
    if (typeof v === 'string') return /^(\.\/)?[\w-][\w./-]*\.(png|jpe?g|webp|gif|svg|avif|mp4|webm|m4v|mov|mp3|m4a|ogg|wav|ttf|otf|woff2?)$/i.test(v) && !v.includes('..') && !v.startsWith('/')
      ? `/plugins/${pluginId}/${v.replace(/^\.\//, '')}` : v;
    if (Array.isArray(v)) return v.map(fix);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, k === 'css' ? x : fix(x)]));
    return v;
  };
  return fix(theme);
}

// ---------- JSON Schema (docs/theme.schema.json) ----------
function schemaFor(path, def) {
  const rule = RULES[path] || {};
  const kind = kindOf(path, def);
  const d = def === undefined || (typeof def === 'object' && def !== null) ? {} : { default: def };
  switch (kind) {
    case 'color': return { type: 'string', pattern: '^(#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}))?$', ...d };
    case 'choice': {
      if (rule.enum && !rule.open) return { enum: one(rule.enum, typeof def === 'string' ? [def, ''] : []), ...d };
      if (rule.enum) return { anyOf: [{ enum: rule.enum }, { type: 'string', pattern: rule.pattern.source }], ...d };
      return { type: 'string', pattern: `^(${rule.pattern.source.replace(/^\^|\$$/g, '')})?$`, ...d };
    }
    case 'boolean': return { type: 'boolean', ...d };
    case 'number': return { type: 'number', ...('min' in rule ? { minimum: rule.min } : {}), ...('max' in rule ? { maximum: rule.max } : {}), ...d };
    case 'string': return { type: 'string', ...(rule.maxLength ? { maxLength: rule.maxLength } : {}), ...d };
    case 'list': return { type: 'array' };
    case 'map': return { type: 'object' };
    case 'theme': return { $ref: '#/$defs/theme' };
    case 'object': return {
      type: 'object', additionalProperties: false,
      properties: Object.fromEntries(Object.entries(def).map(([k, v]) => [k, schemaFor(path ? `${path}.${k}` : k, v)])),
    };
  }
  return {};
}

/** The schema of a theme file: { name, description, theme }. Generated; see test "theme schema is up to date". */
export function themeFileSchema() {
  const theme = schemaFor('', DEFAULT_THEME);
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://hallflix.net/theme.schema.json',
    title: 'HallFlix theme file',
    description: 'A theme for a HallFlix plugin. List only what the theme changes; everything else comes from the default look. Generated from server/src/themespec.js: do not edit by hand.',
    type: 'object',
    required: ['name', 'theme'],
    additionalProperties: false,
    properties: {
      $schema: { type: 'string' },
      name: { type: 'string', maxLength: 60 },
      description: { type: 'string', maxLength: 200 },
      theme: { $ref: '#/$defs/theme' },
    },
    $defs: { theme: { ...theme, properties: { $schema: { type: 'string' }, ...theme.properties } } },
  };
}
