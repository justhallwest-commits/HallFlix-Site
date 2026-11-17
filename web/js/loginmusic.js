// Music on the sign-in page: the songs uploaded in Studio → Look and feel → Sign-in page → Music.
// They fade in, play in order or shuffled, and fade out as someone signs in. Browsers may block sound until the first
// tap or key press; then the music starts on that first touch, and the button says "Play music" until it does.
// Each viewer's pause is remembered on their device.
import { $, esc, on, state, themeNow } from './core.js';

const KEY = 'hf_login_music';
let audio = null, order = [], at = 0, conf = null, ramp = 0, waiting = null, playlistKey = '';
const paused = () => { try { return localStorage.getItem(KEY) === '0'; } catch { return false; } };
const remember = (on) => { try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* private mode */ } };
const target = () => Math.max(0, Math.min(1, conf?.volume ?? 0.5));

/** The track list from a look: [{ url, name }]. Plain links are accepted too. */
export function tracksOf(music) {
  return (Array.isArray(music?.tracks) ? music.tracks : [])
    .map((t) => (typeof t === 'string' ? { url: t, name: '' } : t))
    .filter((t) => t && typeof t.url === 'string' && t.url.trim())
    .map((t) => ({ url: t.url.trim(), name: String(t.name || '').trim() || decodeURIComponent(t.url.split('/').pop().replace(/\.[^.]+$/, '')) }));
}

function shuffle(n) {
  const a = [...Array(n).keys()];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/** Move the volume to `to` over `ms`, then call `done`. */
function fade(to, ms, done) {
  cancelAnimationFrame(ramp);
  if (!audio) { done?.(); return; }
  const from = audio.volume, start = performance.now();
  const step = (now) => {
    const k = ms ? Math.min(1, (now - start) / ms) : 1;
    try { audio.volume = from + (to - from) * k; } catch { /* some TVs fix the volume */ }
    if (k < 1) ramp = requestAnimationFrame(step); else done?.();
  };
  ramp = requestAnimationFrame(step);
}

function button() {
  const page = $('.login.signin');
  if (!page || conf?.button === 'hidden') return null;
  let b = $('.music-btn', page);
  if (!b) {
    page.insertAdjacentHTML('beforeend', '<button class="music-btn" type="button"><span class="eq" aria-hidden="true"><i></i><i></i><i></i></span><span class="mt"></span></button>');
    b = $('.music-btn', page);
    b.onclick = (e) => { e.stopPropagation(); toggle(); };
  }
  return b;
}
/** Show what is happening on the button: playing (with the song's name), paused, or waiting for a first touch. */
function paint() {
  const b = button();
  if (!b) return;
  const t = order.length ? conf.list[order[at]] : null;
  const playing = !!audio && !audio.paused;
  b.dataset.state = playing ? 'playing' : waiting ? 'waiting' : 'paused';
  b.setAttribute('aria-label', playing ? 'Pause the music' : 'Play the music');
  b.title = playing ? 'Pause the music' : 'Play the music';
  const label = playing ? (conf.showTitle !== false && t ? t.name : 'Music on') : 'Play music';
  $('.mt', b).innerHTML = esc(label);
}

function load(i) {
  at = (i + order.length) % order.length;
  const t = conf.list[order[at]];
  audio.src = t.url;
  audio.loop = order.length === 1;
}

function next() {
  if (order.length <= 1) return;
  if (at === order.length - 1 && conf.shuffle) order = shuffle(order.length); // a fresh shuffle for the next lap
  load(at + 1);
  audio.play().then(paint).catch(paint);
}

function begin() {
  if (!audio) return;
  try { audio.volume = 0; } catch { /* fixed volume */ }
  audio.play().then(() => {
    disarm();
    fade(target(), Math.max(0, +conf.fade || 0) * 1000);
    paint();
  }).catch(() => { arm(); paint(); });
}

/** The browser wants a tap first: start on the first tap or key press anywhere on the page. */
function arm() {
  if (waiting) return;
  waiting = (e) => { if (e.target.closest?.('.music-btn')) return; disarm(); if (!paused()) begin(); };
  addEventListener('pointerdown', waiting, true);
  addEventListener('keydown', waiting, true);
}
function disarm() {
  if (!waiting) return;
  removeEventListener('pointerdown', waiting, true);
  removeEventListener('keydown', waiting, true);
  waiting = null;
}

function toggle() {
  if (!audio) return;
  if (audio.paused) { remember(true); begin(); }
  else { remember(false); disarm(); fade(0, 400, () => { audio.pause(); paint(); }); }
}

const onHidden = () => {
  if (!audio) return;
  if (document.hidden) { audio._was = !audio.paused; audio.pause(); } else if (audio._was) audio.play().catch(() => {});
};

/**
 * Start (or keep) the sign-in music for this look. In the Studio's preview it never starts by itself:
 * the button is there to try it.
 */
export function startLoginMusic(theme, { preview = false } = {}) {
  const m = theme?.login?.music || {};
  const list = tracksOf(m);
  if (!m.enabled || !list.length) { stopLoginMusic(); return; }
  conf = { ...m, list };
  const key = list.map((t) => t.url).join('|') + (m.shuffle ? '~' : '');
  if (audio && key === playlistKey) { if (!audio.paused) fade(target(), 300); paint(); return; }
  stopLoginMusic(true);
  playlistKey = key;
  order = m.shuffle ? shuffle(list.length) : list.map((_, i) => i);
  audio = new Audio();
  audio.preload = 'auto';
  audio.addEventListener('ended', next);
  audio.addEventListener('error', () => { if (order.length > 1) next(); else paint(); });
  audio.addEventListener('play', paint);
  audio.addEventListener('pause', paint);
  document.addEventListener('visibilitychange', onHidden);
  load(0);
  if (preview || paused()) { paint(); return; }
  begin();
}

/** Fade the music out (when someone signs in). Resolves when it is quiet. */
export function fadeOutLoginMusic(ms = 700) {
  return new Promise((resolve) => {
    if (!audio || audio.paused) { resolve(); return; }
    fade(0, ms, () => { audio?.pause(); resolve(); });
  });
}

export function stopLoginMusic(keepButton = false) {
  disarm();
  cancelAnimationFrame(ramp);
  document.removeEventListener('visibilitychange', onHidden);
  if (audio) { audio.pause(); audio.removeAttribute('src'); audio.load(); }
  audio = null; playlistKey = ''; order = [];
  if (!keepButton) $('.login.signin .music-btn')?.remove();
}

// A new look (the Studio's live preview, or a season starting) can change the songs or switch the music off.
on('look', () => { if ($('.login.signin')) startLoginMusic(themeNow(), { preview: !!state.signinPreview }); });
