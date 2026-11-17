// How HallFlix feels: colour drawn from the artwork in focus, depth on posters, the living spotlight,
// navigation sounds, and the open animation. Everything here is optional polish: it switches itself off on
// TVs and for people who ask for reduced motion, and never runs during playback.
import { $, state, themeNow, applyLook, on } from './core.js';
import { playSound, preload } from './sounds.js';

const tv = () => document.body.classList.contains('tv');
const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const theme = () => themeNow() || {};

// ---------- colour from artwork ----------
const seen = new Map();
const canvas = document.createElement('canvas');
canvas.width = canvas.height = 16;
function hsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}
function rgbOf(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [r, g, b].map((v) => Math.round((v + m) * 255));
}
/** The most vivid colour in a picture, lifted so it reads on the theme's background. Returns [r,g,b] or null. */
function vivid(img) {
  try {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, 16, 16);
    const px = ctx.getImageData(0, 0, 16, 16).data;
    const bins = new Array(12).fill(0).map(() => [0, 0, 0, 0]); // weight, r, g, b per 30° of hue
    for (let i = 0; i < px.length; i += 4) {
      const [h, s, l] = hsl(px[i], px[i + 1], px[i + 2]);
      const w = s * s * (1 - Math.abs(l - 0.5) * 1.6);
      if (w <= 0.02) continue;
      const bin = bins[Math.floor(h / 30) % 12];
      bin[0] += w; bin[1] += px[i] * w; bin[2] += px[i + 1] * w; bin[3] += px[i + 2] * w;
    }
    const best = bins.sort((a, b) => b[0] - a[0])[0];
    if (best[0] < 1.2) return null; // a grey picture: keep the theme's own accent
    const [h, s] = hsl(best[1] / best[0], best[2] / best[0], best[3] / best[0]);
    const dark = (theme().colors?.bg || '#000').match(/[0-9a-f]{2}/gi)?.reduce((a, x) => a + parseInt(x, 16), 0) < 384;
    return rgbOf(h, Math.min(0.9, Math.max(0.55, s)), dark ? 0.62 : 0.42);
  } catch { return null; }
}
export function colourOf(url) {
  if (!url) return Promise.resolve(null);
  if (seen.has(url)) return Promise.resolve(seen.get(url));
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => { const c = vivid(img); seen.set(url, c); resolve(c); };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}
/** Tint one element (a card, the spotlight, a title page) with its own artwork's colour. */
export async function tint(el, url) {
  if (!el || theme().artColor === false) return;
  const c = await colourOf(url);
  if (!el.isConnected) return;
  if (!c) { el.style.removeProperty('--accent'); el.style.removeProperty('--accent-rgb'); return; }
  el.style.setProperty('--accent', `rgb(${c.join(',')})`);
  el.style.setProperty('--accent-rgb', c.join(', '));
}
/** Wash the page background with the colour of what is in focus. */
export async function wash(url) {
  const root = document.documentElement.style;
  const c = theme().artColor === false ? null : await colourOf(url);
  if (c) root.setProperty('--mood-rgb', c.join(', ')); else root.removeProperty('--mood-rgb');
}

// ---------- the living spotlight ----------
let trailerTimer = 0;
export function stopTrailer(hero = $('.hero')) {
  clearTimeout(trailerTimer);
  const f = hero?.querySelector('.trailer');
  if (f) { hero.classList.remove('playing'); f.remove(); }
}
/** A few seconds after a spotlight title settles, its trailer fades in behind the text, muted. */
export function queueTrailer(hero, item) {
  stopTrailer(hero);
  if (!item?.trailer || theme().heroMotion !== 'trailer' || tv() || calm() || state.preview || innerWidth < 900 || navigator.connection?.saveData) return;
  if (!/^[\w-]{6,20}$/.test(item.trailer)) return;
  trailerTimer = setTimeout(() => {
    if (!hero.isConnected || document.hidden || $('#overlay').childElementCount || !$('#player').hidden || scrollY > innerHeight * 0.5) return;
    const id = item.trailer;
    const box = document.createElement('div');
    box.className = 'trailer';
    box.innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${id}?autoplay=1&mute=1&controls=0&loop=1&playlist=${id}&playsinline=1&rel=0&iv_load_policy=3&disablekb=1&start=6" allow="autoplay; encrypted-media" tabindex="-1" aria-hidden="true" title=""></iframe>`;
    hero.querySelector('.content').before(box);
    setTimeout(() => { if (box.isConnected) hero.classList.add('playing'); }, 2600); // hide the player's loading frame
  }, 3800);
}
export const trailerPlaying = () => !!$('.hero .trailer');
addEventListener('scroll', () => { if (scrollY > innerHeight * 0.6) stopTrailer(); }, { passive: true });
document.addEventListener('visibilitychange', () => { if (document.hidden) stopTrailer(); });

// ---------- depth: posters lean toward the pointer ----------
let leaning = null, slab = null;
const tileStyle = () => theme().tiles3d?.style || 'layered';
function lean(e) {
  if (tv() || calm() || e.pointerType === 'touch') return;
  // Layered tiles: the slab around the tile takes the pointer's place, and the CSS moves each layer by its own depth.
  const s = tileStyle() === 'layered' ? e.target.closest?.('.tile-slab') : null;
  if (slab && slab !== s) { slab.style.removeProperty('--tx'); slab.style.removeProperty('--ty'); slab = null; }
  if (s) {
    const r = s.getBoundingClientRect();
    s.style.setProperty('--tx', ((e.clientX - r.left) / r.width - 0.5).toFixed(3));
    s.style.setProperty('--ty', ((e.clientY - r.top) / r.height - 0.5).toFixed(3));
    slab = s;
  }
  if (theme().depth === false) return;
  const card = e.target.closest?.(s || tileStyle() === 'flat' ? '.card, .coll-card' : '.card, .lib-tile, .coll-card');
  if (leaning && leaning !== card) { leaning.style.removeProperty('--rx'); leaning.style.removeProperty('--ry'); leaning = null; }
  if (!card) return;
  const r = card.getBoundingClientRect();
  const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
  const max = card.classList.contains('card') ? 9 : 4;
  card.style.setProperty('--ry', `${(x * max * 2).toFixed(2)}deg`);
  card.style.setProperty('--rx', `${(-y * max * 2).toFixed(2)}deg`);
  leaning = card;
}

// ---------- light that follows the pointer across the background ----------
let lightQueued = false, lightAt = [0, 0];
function moveLight(e) {
  if (theme().pointerLight !== true || tv() || e.pointerType === 'touch') return;
  lightAt = [e.clientX, e.clientY];
  if (lightQueued) return;
  lightQueued = true;
  requestAnimationFrame(() => {
    lightQueued = false;
    const el = $('#atmos');
    if (el) { el.style.setProperty('--px', `${lightAt[0]}px`); el.style.setProperty('--py', `${lightAt[1]}px`); }
  });
}

// ---------- library tiles: a video plays on the tile while it is pointed at or in focus ----------
function tileVideo(tile, play) {
  const url = tile?.dataset.video;
  if (!url || theme().tiles3d?.video === false || calm() || navigator.connection?.saveData) return;
  const art = tile.querySelector('.tile-art');
  let v = art?.querySelector('video');
  if (play) {
    if (!v) {
      v = Object.assign(document.createElement('video'), { muted: true, loop: true, playsInline: true, preload: 'auto' });
      v.setAttribute('aria-hidden', 'true');
      v.src = url;
      v.addEventListener('playing', () => tile.classList.add('video-on'));
      art.prepend(v);
    }
    clearTimeout(v._stop);
    v.play().catch(() => {});
  } else if (v) {
    tile.classList.remove('video-on');
    v._stop = setTimeout(() => { v.pause(); }, 500);
  }
}

// ---------- seamless open: the title page grows out of the poster that was chosen ----------
let origin = null;
export function grow(sheet) {
  const from = origin; origin = null;
  if (!from || !sheet || tv() || calm() || !sheet.animate) return;
  const to = sheet.getBoundingClientRect();
  if (!to.width) return;
  const sx = from.width / to.width, sy = from.height / to.height;
  const dx = from.left + from.width / 2 - (to.left + to.width / 2), dy = from.top + from.height / 2 - (to.top + to.height / 2);
  sheet.animate([
    { transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`, opacity: 0.4, filter: 'brightness(1.6)' },
    { transform: 'none', opacity: 1, filter: 'none' },
  ], { duration: 380, easing: 'cubic-bezier(.2,.85,.25,1)' });
}

// ---------- sounds ----------
// The pack and any uploaded sounds come from the look (Studio → Look and feel → Sounds); each viewer can still mute them.
const muted = () => { try { return localStorage.getItem('hf_sounds') === '0'; } catch { return false; } };
export const soundsOn = () => (theme().sounds || 'off') !== 'off' && !muted();
export function setSounds(on) { try { localStorage.setItem('hf_sounds', on ? '1' : '0'); } catch { /* private mode */ } }
export const soundsAvailable = () => (theme().sounds || 'off') !== 'off';
export function sound(name) {
  if (!soundsOn() || (!$('#player').hidden && name !== 'ident')) return;
  playSound(name, theme());
}
/** The ident's sound: the built-in swell and chime, or the uploaded one. Plays whenever the ident shows, unless muted. */
export function identSound() {
  if (muted()) return;
  playSound('ident', theme());
}

// ---------- evening look ----------
function watchClock() {
  setInterval(() => {
    if (!state.look?.night || state.preview || !$('#player').hidden) return;
    const due = (() => { const n = state.look.night, d = new Date(), now = d.getHours() * 60 + d.getMinutes(), m = (s) => +s.slice(0, 2) * 60 + +s.slice(3); const a = m(n.from), z = m(n.to); return a <= z ? now >= a && now < z : now >= a || now < z; })();
    if (due !== state.night) applyLook();
  }, 60e3);
}

export function initFeel() {
  addEventListener('pointermove', lean, { passive: true });
  addEventListener('pointermove', moveLight, { passive: true });
  addEventListener('pointerover', (e) => {
    const t = e.target.closest?.('.lib-tile[data-video]'), from = e.relatedTarget?.closest?.('.lib-tile[data-video]');
    if (t !== from) { tileVideo(from, false); tileVideo(t, true); }
  }, { passive: true });
  addEventListener('focusin', (e) => tileVideo(e.target.closest?.('.lib-tile[data-video]'), true));
  addEventListener('focusout', (e) => { const t = e.target.closest?.('.lib-tile[data-video]'); if (t && !t.matches(':hover')) tileVideo(t, false); });
  on('toast', () => sound('toast'));
  on('look', () => { if (soundsOn() || theme().soundFx?.events?.ident?.url) preload(theme()); });
  addEventListener('pointerdown', (e) => {
    const c = e.target.closest?.('.card[href^="#/title/"], .similar .card');
    origin = c ? c.getBoundingClientRect() : null;
  }, true);
  addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { const c = document.activeElement?.closest?.('.card[href^="#/title/"]'); origin = c ? c.getBoundingClientRect() : null; }
  }, true);
  // Each card glows in its own artwork's colour while it is hovered or focused.
  const onCard = (e) => {
    const c = e.target.closest?.('.card');
    if (!c || c.dataset.tinted) return;
    c.dataset.tinted = '1';
    const img = c.querySelector('img');
    if (img) tint(c, img.currentSrc || img.src);
  };
  addEventListener('pointerover', onCard, { passive: true });
  addEventListener('focusin', (e) => { onCard(e); if (e.target.matches?.('a, button, [tabindex="0"]')) sound('move'); });
  addEventListener('click', (e) => { if (e.target.closest?.('a, button')) sound('select'); }, true);
  addEventListener('hashchange', (e) => { if (/#\/title\//.test(e.newURL)) sound('open'); else if (/#\/title\//.test(e.oldURL)) sound('back'); });
  watchClock();
}
