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
const isVideo = (u) => /\.(mp4|webm)(\?|$)/i.test(u || '');
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
  root.setProperty('--font-display', FONT[t.fonts?.display] || FONT.Outfit);
  root.setProperty('--font-body', FONT[t.fonts?.body] || FONT.Inter);
  const body = document.body;
  body.className = body.className.replace(/\btex-\S+/g, '').trim();
  if (t.texture && t.texture !== 'none') body.classList.add(`tex-${t.texture}`);
  body.classList.toggle('wide-cards', t.cardShape === 'wide');
  body.classList.toggle('ui-hud', (t.interface || 'futuristic') === 'futuristic');
  body.classList.toggle('hero-pan', (t.heroMotion || 'trailer') !== 'none');
  body.classList.toggle('depth', t.depth !== false);
  body.classList.toggle('glass', t.glass !== false);
  const signedOut = !state.profile;
  const bg = signedOut ? (t.login?.image || t.background?.image) : (lib.background || t.background?.image);
  const dim = signedOut ? (t.login?.dim ?? 0.45) : (lib.dim ?? t.background?.dim ?? 0.6);
  const layer = $('#backdrop');
  layer.classList.toggle('has-image', !!bg);
  root.setProperty('--bg-dim', String(dim));
  root.setProperty('--bg-blur', `${+(signedOut ? t.background?.blur : lib.blur ?? t.background?.blur) || 0}px`);
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
  startEffect(t.effect || 'none');
  emit('look', look);
}
export const logoUrl = () => themeNow()?.logo?.image || '/assets/logo.png';
export const libraryLook = (id) => state.look?.libraries?.[id] || {};

export function avatarStyle(p) {
  let h = 0;
  for (const c of String(p.name || '')) h = (h * 31 + c.charCodeAt(0)) % 360;
  const a = p.color || `hsl(${h} 70% 52%)`;
  return `--a1:${a};--a2:hsl(${(h + 60) % 360} 70% 42%)`;
}
