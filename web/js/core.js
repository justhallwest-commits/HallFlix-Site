// Shared building blocks: templating, the API client, app state, events and the look engine.
import { startEffect } from './effects.js';

export const $ = (sel, el = document) => el.querySelector(sel);
export const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
export const raw = (s) => new Raw(String(s ?? ''));
const render = (v) => (v == null || v === false ? '' : v instanceof Raw ? v.s : Array.isArray(v) ? v.map(render).join('') : esc(v));
/** html`<b>${text}</b>` escapes every value unless it is itself html`…` or raw(). */
export function html(strings, ...vals) {
  let out = '';
  strings.forEach((s, i) => { out += s; if (i < vals.length) out += render(vals[i]); });
  return new Raw(out);
}

export const state = { boot: null, profile: null, libraries: [], look: null, preview: false };

const listeners = {};
export function on(name, fn) { (listeners[name] ||= []).push(fn); return () => { listeners[name] = listeners[name].filter((f) => f !== fn); }; }
export function emit(name, data) { for (const fn of listeners[name] || []) { try { fn(data); } catch (e) { console.error(`[plugin] ${name}`, e); } } }

export async function api(method, path, body) {
  const res = await fetch(path, {
    method, credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try { data = await res.json(); } catch { /* empty body */ }
  if (res.status === 401 && state.profile && !path.startsWith('/api/login')) { state.profile = null; emit('signedout'); }
  if (!res.ok) { const err = new Error(data.error || `Request failed (${res.status})`); err.status = res.status; throw err; }
  return data;
}

export function toast(text, ms = 3200) {
  const el = document.createElement('div');
  el.className = 'toast'; el.textContent = text;
  $('#toasts').append(el);
  emit('toast', text);
  setTimeout(() => el.remove(), ms);
}

export function fmtTime(s) {
  s = Math.max(0, Math.floor(s || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`;
}
export function fmtRuntime(s) {
  if (!s) return '';
  const m = Math.round(s / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${Math.max(1, m)}m`;
}

const I = (d, extra = '') => raw(`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ${extra}>${d}</svg>`);
export const icons = {
  // Sidebar icons (TV): one per kind of page.
  home: I('<path d="M4 11 12 4l8 7"/><path d="M6 10v9h12v-9"/>'), film: I('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 9h18M3 15h18M8 5v14M16 5v14"/>'),
  tv: I('<rect x="3" y="6" width="18" height="12" rx="2"/><path d="m9 2 3 4 3-4"/>'), comic: I('<path d="M4 5h11l5 5v9H4z"/><path d="M8 10h6M8 14h8"/>'),
  music: I('<path d="M9 18V5l11-2v13"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>'), clock: I('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  user: I('<circle cx="12" cy="8" r="4"/><path d="M4 20c1.5-4 4.5-6 8-6s6.5 2 8 6"/>'), search: I('<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>'),
  play: raw('<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5z"/></svg>'),
  pause: raw('<svg viewBox="0 0 24 24" fill="currentColor"><rect x="5.5" y="4" width="4.5" height="16" rx="1"/><rect x="14" y="4" width="4.5" height="16" rx="1"/></svg>'),
  plus: I('<path d="M12 5v14M5 12h14"/>'), check: I('<path d="m5 12.5 4.5 4.5L19 7.5"/>'), info: I('<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>'),
  back: I('<path d="M15 5l-7 7 7 7"/>'), x: I('<path d="M6 6l12 12M18 6 6 18"/>'), eye: I('<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
  vol: I('<path d="M4 9.5v5h3.5L12 19V5L7.5 9.5H4z" fill="currentColor"/><path d="M16 8.5a5 5 0 0 1 0 7M18.8 5.5a9 9 0 0 1 0 13"/>'),
  mute: I('<path d="M4 9.5v5h3.5L12 19V5L7.5 9.5H4z" fill="currentColor"/><path d="m16.5 9.5 5 5M21.5 9.5l-5 5"/>'),
  full: I('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'), next: raw('<svg viewBox="0 0 24 24" fill="currentColor"><path d="M5 5v14l10-7L5 5z"/><rect x="16.5" y="5" width="2.6" height="14" rx="1"/></svg>'),
  cc: I('<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M10.5 10.2a2.2 2.2 0 1 0 0 3.6M17 10.2a2.2 2.2 0 1 0 0 3.6"/>'),
  audio: I('<path d="M4 10v4M8 6v12M12 9v6M16 4v16M20 10v4"/>'), gear: I('<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.2 5.2l2.1 2.1M16.7 16.7l2.1 2.1M5.2 18.8l2.1-2.1M16.7 7.3l2.1-2.1"/>'),
  dice: I('<rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="9" cy="9" r="1.2" fill="currentColor"/><circle cx="15" cy="15" r="1.2" fill="currentColor"/><circle cx="15" cy="9" r="1.2" fill="currentColor"/><circle cx="9" cy="15" r="1.2" fill="currentColor"/>'),
  mic: I('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>'),
  people: I('<circle cx="9" cy="8" r="3.2"/><path d="M3 20a6 6 0 0 1 12 0M16 5.2a3.2 3.2 0 0 1 0 5.6M17.5 14.3A6 6 0 0 1 21 20"/>'),
  shuffle: I('<path d="M3 7h3.5c2.5 0 3.6 1.3 5.5 5s3 5 5.5 5H21M3 17h3.5c1.3 0 2.2-.4 3-1.2M14.5 8.2c.8-.8 1.7-1.2 3-1.2H21M18 4l3 3-3 3M18 14l3 3-3 3"/>'),
  repeat: I('<path d="M4 11V9a3 3 0 0 1 3-3h12M16 3l3 3-3 3M20 13v2a3 3 0 0 1-3 3H5M8 21l-3-3 3-3"/>'),
  book: I('<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5v-16z"/><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>'),
  list: I('<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>'),
  type: I('<path d="M4 7V5h16v2M9 19h6M12 5v14"/>'),
  rew: I('<path d="M11 6 5 12l6 6M19 6l-6 6 6 6"/>'), fwd: I('<path d="m13 6 6 6-6 6M5 6l6 6-6 6"/>'), trailer: I('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m10 9 5 3-5 3V9z" fill="currentColor"/>'),
};

// ---------- look engine: turns the Studio's theme into CSS variables ----------
const FONT = {
  Outfit: "'Outfit', system-ui, sans-serif", Inter: "'Inter', system-ui, sans-serif", 'Bebas Neue': "'Bebas Neue', Impact, sans-serif",
  Audiowide: "'Audiowide', system-ui, sans-serif", Georgia: "Georgia, 'Times New Roman', serif", System: 'system-ui, -apple-system, Segoe UI, sans-serif',
};
export function rgb(hex) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return null;
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).join(', ');
}
const isMoving = (u) => /\.(mp4|webm|m4v|mov|gif)(\?|$)/i.test(u || '');
const isVideo = (u) => !/^\/api\/fit\?/.test(u || '') && /\.(mp4|webm)(\?|$)/i.test(u || ''); // a TV still made from a video is a picture
let currentLibrary = null;

const mins = (hm) => +hm.slice(0, 2) * 60 + +hm.slice(3);
/** Is the evening look due right now, by this device's clock? */
export function isNight(look = state.look, d = new Date()) {
  const n = look?.night;
  if (!n) return false;
  const now = d.getHours() * 60 + d.getMinutes(), a = mins(n.from), z = mins(n.to);
  return a <= z ? now >= a && now < z : now >= a || now < z;
}
/** The theme in force: the evening look when it is due, otherwise the everyday (or seasonal) one. */
export const themeNow = (look = state.look) => (isNight(look) ? look.night.theme : look?.theme);

/** Apply the look. `libraryId` adds that library's own background, accent and logo on top. */
export function applyLook(look = state.look, libraryId = currentLibrary) {
  if (!look) return;
  state.look = look; currentLibrary = libraryId;
  state.night = isNight(look);
  const t = themeNow(look), lib = (libraryId != null && look.libraries?.[libraryId]) || {};
  tabIcon(t);
  const root = document.documentElement.style;
  const colors = { ...t.colors };
  if (lib.accent) colors.accent = lib.accent;
  if (lib.accent2) colors.accent2 = lib.accent2;
  else if (t.profileColors !== false && /^#[0-9a-f]{6}$/i.test(state.profile?.color || '')) colors.accent2 = state.profile.color;
  for (const [k, v] of Object.entries(colors)) { root.setProperty(`--${k}`, v); const c = rgb(v); if (c) root.setProperty(`--${k}-rgb`, c); }
  root.setProperty('--radius', `${+t.radius || 0}px`);
  root.setProperty('--glow', String(Math.max(0, Math.min(1, +t.glow || 0))));
  root.setProperty('--hero-h', `${Math.max(40, Math.min(100, +t.heroHeight || 80))}vh`);
  root.setProperty('--logo-h', `${Math.max(20, Math.min(120, +t.logo?.height || 46))}px`);
  // The library's logo at the top of its own page: the library's size, else the whole app's, else automatic.
  const ll = +(lib.logoSize || t.libLogoSize || 0);
  if (ll > 0) { const h = Math.max(30, Math.min(260, ll)); root.setProperty('--lib-logo-h', `${h}px`); root.setProperty('--lib-logo-w', `min(85vw, ${h * 4}px)`); }
  else { root.removeProperty('--lib-logo-h'); root.removeProperty('--lib-logo-w'); }
  root.setProperty('--font-display', FONT[t.fonts?.display] || FONT.Outfit);
  // The Top rated numbers.
  const RK = t.ranked || {};
  const bd = document.body;
  bd.className = bd.className.replace(/\brank-\S+/g, '').trim();
  bd.classList.add(`rank-${['outline', 'solid', 'glow', 'badge', 'hidden'].includes(RK.style) ? RK.style : 'outline'}`,
    `rank-at-${['beside', 'front'].includes(RK.place) ? RK.place : 'behind'}`, `rank-c-${['accent', 'gradient'].includes(RK.color) ? RK.color : 'text'}`);
  bd.classList.toggle('rank-bar', RK.scrollbar === true);
  root.setProperty('--rank-k', String(Math.max(40, Math.min(160, +RK.size || 100)) / 100));
  root.setProperty('--rank-a', String(Math.max(15, Math.min(100, +RK.strength || 62)) / 100));
  root.setProperty('--rank-font', RK.font && RK.font !== 'theme' && FONT[RK.font] ? FONT[RK.font] : 'var(--font-display)');
  root.setProperty('--font-body', FONT[t.fonts?.body] || FONT.Inter);
  const body = document.body;
  body.className = body.className.replace(/\btex-\S+/g, '').trim();
  if (t.texture && t.texture !== 'none') body.classList.add(`tex-${t.texture}`);
  body.classList.toggle('wide-cards', t.cardShape === 'wide');
  body.classList.toggle('ui-hud', (t.interface || 'futuristic') === 'futuristic');
  body.classList.toggle('hero-pan', (t.heroMotion || 'trailer') !== 'none');
  body.classList.toggle('depth', t.depth !== false);
  body.classList.toggle('glass', t.glass !== false);
  // Light: how glow falls, how focus is outlined, the living light behind the app, and the pointer's light.
  const one = (v, ok, d) => (ok.includes(v) ? v : d);
  body.className = body.className.replace(/\b(glow|ring|atm|tiles)-\S+/g, '').trim();
  body.classList.add(`glow-${one(t.glowStyle, ['neon', 'natural', 'ambient'], 'natural')}`, `ring-${one(t.focusRing, ['glow', 'line', 'aurora'], 'glow')}`);
  const atm = one(t.atmosphere, ['none', 'aurora', 'leak', 'both'], 'none');
  if (atm !== 'none') body.classList.add(`atm-${atm}`);
  body.classList.toggle('plight', t.pointerLight === true);
  // Library tiles on Home: flat, tilting, or layered 3D with a sheen and a thick edge.
  const T = t.tiles3d || {};
  body.classList.add(`tiles-${one(T.style, ['flat', 'tilt', 'layered'], 'layered')}`);
  body.classList.toggle('tiles-shine', T.shine !== false);
  body.classList.toggle('tiles-sway', T.sway !== false);
  root.setProperty('--tile-depth', String(Math.max(0, Math.min(1, T.depth ?? 0.6))));
  root.setProperty('--tile-thick', `${Math.max(0, Math.min(16, T.thickness ?? 6))}px`);
  // Library tiles on Home: width before another fits in a row, height for their width, picture brightness; and the banner logo.
  const H = t.homeTiles || {};
  root.setProperty('--libs-min', `${Math.max(180, Math.min(900, +H.width || 320))}px`);
  root.setProperty('--libs-ratio', String(Math.max(20, Math.min(80, +H.height || 44)) / 100));
  root.setProperty('--tile-bright', String(Math.max(20, Math.min(160, +H.brightness || 100)) / 100));
  // Remember the loading screen's look on this device for the next time the app opens (see splash.js).
  try {
    const S = t.splash || {};
    localStorage.setItem('hf_splash', JSON.stringify({ img: S.image || t.logo?.image || '', size: Math.max(30, Math.min(250, +S.size || 100)) / 100,
      motion: ['pulse', 'breathe', 'glow', 'still'].includes(S.motion) ? S.motion : 'pulse', bg: /^#[0-9a-f]{6}$/i.test(S.background || '') ? S.background : '' }));
  } catch { /* private mode */ }
  root.setProperty('--banner-logo-k', String(Math.max(30, Math.min(250, +t.bannerLogo || 100)) / 100));
  const signedOut = !state.profile || !!state.signinPreview;
  // TVs: lay the page out at the chosen width, and keep the extras that cost a Fire TV Stick the most off unless asked for.
  const TV = t.tv || {};
  if (isTV()) {
    const w = Math.max(960, Math.min(1920, +TV.width || 1600));
    try { localStorage.setItem('hf_tvw', String(w)); } catch { /* private mode */ }
    $('meta[name=viewport]')?.setAttribute('content', `width=${w}, viewport-fit=cover`);
    document.body.classList.toggle('tv-notex', TV.textures !== true);
    document.body.classList.toggle('tv-noglow', TV.glow !== true); document.body.classList.toggle('tv-focus-accent', TV.focus === 'accent');
  }
  let bg = signedOut ? (t.login?.image || t.background?.image) : (lib.background || t.background?.image);
  // On a TV a picture comes TV-sized (a huge upload is slow on a Fire TV Stick). Videos and GIFs keep moving
  // unless Studio → TVs asks for still pictures.
  if (bg && isTV() && (TV.stills === true || !isMoving(bg))) bg = tvPic(bg, Math.min(1920, (+TV.width || 1600) * 1.2));
  const dim = signedOut ? (t.login?.dim ?? 0.45) : (lib.dim ?? t.background?.dim ?? 0.6);
  const layer = $('#backdrop');
  layer.classList.toggle('has-image', !!bg);
  root.setProperty('--bg-dim', String(dim));
  root.setProperty('--bg-blur', `${+(signedOut ? t.login?.blur : lib.blur ?? t.background?.blur) || 0}px`);
  // How the darkening is laid on (even, fading down, spotlight, accent tint) and which part of the picture stays in view.
  const shade = signedOut ? 'even' : lib.shade || t.background?.shade || 'even';
  layer.dataset.shade = ['even', 'fade', 'spot', 'tint'].includes(shade) ? shade : 'even';
  root.setProperty('--bg-pos', { top: 'center top', bottom: 'center bottom' }[signedOut ? '' : lib.position || t.background?.position] || 'center');
  const vid = $('video', layer);
  if (bg && isVideo(bg)) {
    root.setProperty('--bg-image', 'none');
    if (!vid || vid.dataset.src !== bg) { vid?.remove(); layer.insertAdjacentHTML('afterbegin', `<video data-src="${esc(bg)}" src="${esc(bg)}" autoplay muted loop playsinline></video>`); }
  } else { vid?.remove(); root.setProperty('--bg-image', bg ? `url("${String(bg).replace(/"/g, '%22')}")` : 'none'); }
  $('meta[name=theme-color]')?.setAttribute('content', colors.bg);
  document.title = t.siteName || 'HallFlix';
  for (const img of $$('img[data-site-logo]')) img.src = logoUrl();
  startEffect(isTV() && TV.effects !== true ? 'none' : t.effect || 'none', t.effectDensity);
  // Custom CSS from Studio (the everyday look plus any running season's), laid over everything else.
  let css = document.getElementById('theme-css');
  if (!css) { css = document.createElement('style'); css.id = 'theme-css'; document.head.appendChild(css); }
  if (css.textContent !== (t.css || '')) css.textContent = t.css || '';
  styleLogin(t);
  emit('look', look);
}

/** Lay out the sign-in page from the look: where the box sits, the logo, the panel, and darkening or blur to set the box off. */
/** A TV (the Fire TV and Android TV apps, smart TVs, or ?tv). */
// ---------- Right-sized pictures (like Plex: a 250 px slot gets a ~250 px picture, not the 2000 px original) ----------
const TMDB = /^\/img\/t\/(w\d+|original)(\/.+)$/;
const LOCAL = /^\/img\/l\/[\w-]+$/;
const FAMILY = { poster: [185, 342, 500, 780], wide: [300, 500, 780, 1280], backdrop: [300, 780, 1280] };
const LOCAL_W = { poster: [240, 360, 480, 720], wide: [360, 480, 720, 1080], backdrop: [720, 1080, 1280, 1920] };
const FALLBACK = { poster: '220px', wide: '420px', backdrop: '100vw' };
/**
 * srcset + sizes for an <img>, so the browser fetches the copy that fits the slot it lays the picture out in
 * (sizes="auto" where supported, a sensible width otherwise). '' for pictures that can't be resized.
 */
export function pic(url, kind = 'poster') {
  if (!url) return '';
  const t = TMDB.exec(url);
  const set = t ? FAMILY[kind].map((w) => `/img/t/w${w}${t[2]} ${w}w`) : LOCAL.test(url) ? LOCAL_W[kind].map((w) => `${url}?w=${w} ${w}w`) : null;
  return raw(set ? ` srcset="${set.map((x) => x.replace(/&/g, '&amp;').replace(/"/g, '&quot;')).join(', ')}" sizes="auto, ${FALLBACK[kind]}"` : '');
}
/** One URL for a picture shown across the screen (a CSS background): screen-wide, never the full original on a TV. */
export function wide(url) {
  if (!url) return url;
  const need = Math.min(2560, Math.round(screen.width * Math.min(2, devicePixelRatio || 1)));
  const t = TMDB.exec(url);
  if (t) return `/img/t/${need > 1600 && !isTV() ? 'original' : need > 800 ? 'w1280' : 'w780'}${t[2]}`;
  if (LOCAL.test(url)) return `${url}?w=${isTV() ? Math.min(need, 1920) : need}`;
  return url;
}

export const isTV = () => /AFT|Android TV|GoogleTV|BRAVIA|SmartTV|Tizen|Web0S/i.test(navigator.userAgent) || new URLSearchParams(location.search).has('tv');
/** On a TV, a picture comes as a still JPEG no wider than needed (see server/src/fit.js); elsewhere, as it is. */
export function tvPic(url, w = 1920) {
  if (!url || !isTV() || /^data:/.test(url) || /^\/img\/t\//.test(url)) return url; // TMDB pictures are already sized
  return `/api/fit?w=${Math.round(w)}&src=${encodeURIComponent(url)}`;
}

export function styleLogin(t = themeNow()) {
  const el = $('.login.signin');
  const root = document.documentElement;
  if (!el || !t) { root.classList.remove('signin-split-left', 'signin-split-right'); return; }
  const L = t.login || {};
  const pick = (v, ok, d) => (ok.includes(v) ? v : d);
  const split = L.layout === 'split', side = pick(L.side, ['left', 'right'], 'left');
  // In the side-panel layout the box fills a full-height panel, so it sits on the panel's side.
  const x = split ? side : pick(L.x, ['left', 'center', 'right'], 'center'), y = pick(L.y, ['top', 'middle', 'bottom'], 'middle');
  Object.assign(el.dataset, { x, y, layout: split ? 'split' : 'floating', logo: pick(L.logoPlace, ['above', 'inside', 'corner', 'hidden'], 'above'), panel: split ? 'none' : pick(L.panel, ['none', 'glass', 'solid'], 'none'),
    tiles: pick(L.tileShape, ['theme', 'rounded', 'circle', 'square'], 'theme'), buttons: pick(L.buttons, ['links', 'outlined', 'filled'], 'links'),
    // The panel's edge: a line, nothing, or a soft fade into the picture. (Older looks only had the line on or off.)
    edge: pick(L.sideEdge, ['line', 'none', 'fade'], L.divider === false ? 'none' : 'line'), motion: L.tileMotion === false ? 'still' : 'tilt' });
  const s = el.style;
  const w = Math.max(20, Math.min(70, +L.sideWidth || 33));
  s.setProperty('--side-w', `${w}vw`);
  const sc = /^#[0-9a-f]{6}$/i.test(L.sideColor || '') ? rgb(L.sideColor) : null;
  s.setProperty('--side-rgb', sc || 'var(--bg-rgb)');
  s.setProperty('--side-op', String(Math.max(0, Math.min(1, L.sideOpacity ?? 0.96))));
  s.setProperty('--side-blur', `${Math.max(0, Math.min(40, +L.sideBlur || 0))}px`);
  s.setProperty('--fade-w', `${Math.max(4, Math.min(45, +L.fadeWidth || 18))}vw`);
  s.setProperty('--tile-size', `${Math.max(56, Math.min(220, +L.tileSize || 132))}px`);
  s.setProperty('--tile-cols', +L.tileColumns > 0 ? `repeat(${Math.min(8, +L.tileColumns)}, var(--tile-size))` : '');
  el.classList.toggle('fixed-cols', +L.tileColumns > 0);
  // The background picture moves into the space beside the panel, so the panel doesn't hide it.
  // The picture sits beside the panel, or fills the screen behind it (for a see-through or frosted panel).
  const beside = split && L.sidePicture !== 'behind';
  root.classList.toggle('signin-split-left', beside && side === 'left');
  root.classList.toggle('signin-split-right', beside && side === 'right');
  root.style.setProperty('--side-w', `${w}vw`);
  s.setProperty('--logo-size', `${Math.max(30, Math.min(360, +L.logoSize || 150))}px`);
  s.setProperty('--lp-op', String(Math.max(0, Math.min(1, L.panelOpacity ?? 0.72))));
  s.setProperty('--lp-blur', `${Math.max(0, Math.min(40, +L.panelBlur || 0))}px`);
  // Shapes for darkening and blurring: everywhere, behind the box, away from the box (a spotlight), or the box's side.
  const px = { left: '22%', center: '50%', right: '78%' }[x], py = { top: '26%', middle: '50%', bottom: '74%' }[y];
  const shape = (where, c) => {
    if (where === 'behind') return `radial-gradient(ellipse 46% 68% at ${px} ${py}, ${c} 0%, ${c} 42%, transparent 100%)`;
    if (where === 'away') return `radial-gradient(ellipse 46% 68% at ${px} ${py}, transparent 0%, transparent 32%, ${c} 100%)`;
    if (where === 'side') {
      if (x !== 'center') return `linear-gradient(to ${x === 'left' ? 'right' : 'left'}, ${c} 0%, ${c} 36%, transparent 78%)`;
      if (y !== 'middle') return `linear-gradient(to ${y === 'top' ? 'bottom' : 'top'}, ${c} 0%, ${c} 36%, transparent 80%)`;
      return `linear-gradient(to right, transparent 8%, ${c} 30%, ${c} 70%, transparent 92%)`;
    }
    return `linear-gradient(${c}, ${c})`;
  };
  const dark = Math.max(0, Math.min(1, L.dark ?? 0.5));
  const dw = pick(L.darkWhere, ['none', 'all', 'behind', 'away', 'side'], 'none');
  s.setProperty('--lf-bg', dw === 'none' || !dark ? 'none' : shape(dw, `rgba(0,0,0,${dark})`));
  const fb = Math.max(0, Math.min(40, +L.focusBlur || 0));
  const bw = pick(L.blurWhere, ['all', 'behind', 'away', 'side'], 'all');
  s.setProperty('--lf-blur', `${fb}px`);
  s.setProperty('--lf-mask', !fb || bw === 'all' ? 'none' : shape(bw, '#000'));
  el.classList.toggle('lf-blurred', fb > 0);
  const img = $('.brand', el);
  if (img) img.src = L.logo || logoUrl();
  const h = $('[data-login-title]', el);
  if (h) h.textContent = String(L.title || '').trim() || "Who's watching?";
  const m = $('[data-manual]', el);
  if (m) { m.hidden = L.manualButton === false; m.textContent = String(L.manualLabel || '').trim() || 'Sign in with name and password'; }
  for (const b of $$('[data-pair]', el)) b.textContent = String(L.phoneLabel || '').trim() || b.dataset.default;
  const f = $('.signin-foot', el);
  if (f) {
    const txt = String(L.footer || '').trim(), link = /^https?:\/\//i.test(L.footerLink || '') ? L.footerLink : '';
    f.hidden = !txt;
    f.innerHTML = !txt ? '' : link ? `<a href="${esc(link)}" target="_blank" rel="noopener">${esc(txt)}</a>` : esc(txt);
  }
}
/** The browser tab icon: Studio → Look and feel → Logo → Browser tab icon, or the HallFlix crown. */
function tabIcon(t) {
  const el = document.querySelector('link[data-tab-icon]');
  if (!el) return;
  const want = t?.logo?.favicon || '/assets/favicon-32.png';
  if (el.getAttribute('href') !== want) el.setAttribute('href', want);
}
export const logoUrl = () => themeNow()?.logo?.image || '/assets/logo.png';
export const libraryLook = (id) => state.look?.libraries?.[id] || {};

export function avatarStyle(p) {
  let h = 0;
  for (const c of String(p.name || '')) h = (h * 31 + c.charCodeAt(0)) % 360;
  const a = p.color || `hsl(${h} 70% 52%)`;
  return `--a1:${a};--a2:hsl(${(h + 60) % 360} 70% 42%)`;
}

/**
 * The logo (or name) at the top of a library's page, placed as set in Studio → Look and feel: left (usual), centre or
 * right of the bar, the name instead of the logo, or hidden; nudged from there (it may overlap the banner below).
 * The library's own setting wins over the whole app's.
 */
export function libTitle(lib, lk = {}) {
  const c = { place: 'left', x: 0, y: 0, ...(themeNow()?.libPage || {}), ...(lk.libPage || {}) };
  const place = ['left', 'center', 'right', 'name', 'hidden'].includes(c.place) ? c.place : 'left';
  const name = lib?.name || 'Library';
  const x = Math.max(-400, Math.min(400, +c.x || 0)), y = Math.max(-300, Math.min(300, +c.y || 0));
  const inner = place === 'hidden' ? html`<h1 class="sr-only">${name}</h1>`
    : lk.logo && place !== 'name' ? html`<img class="lib-logo" src="${lk.logo}" alt="${name}">` : html`<h1>${name}</h1>`;
  return html`<span class="lib-title" data-place="${place}" data-lib="${lib?.id ?? ''}" data-name="${name}" style="--lt-x:${x}px;--lt-y:${y}px">${inner}</span>`;
}
// A new look (the Studio's live preview) moves or hides the logo on the page that is already showing.
on('look', () => {
  for (const el of $$('.lib-title[data-lib]')) {
    const id = el.dataset.lib;
    if (id) el.outerHTML = String(libTitle({ id: +id, name: el.dataset.name }, libraryLook(+id)));
  }
});
