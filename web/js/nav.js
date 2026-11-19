// Arrow-key and TV-remote navigation: move focus to the nearest control in the pressed direction.
// On TVs (body.tv) it behaves like the big TV apps (Plex, Jellyfin, Emby):
// - a left sidebar: Left from the start of a row opens it, Right goes back to where you were;
// - rows remember where you were, and coming into a row lands on that spot (or its first visible title);
// - the page and each row scroll so the focused title stays at a steady place on screen;
// - every page starts with something focused, and going back puts focus where it was;
// - Back closes what is open, then goes to the previous page, then to the sidebar, then lets the app close;
// - holding a key moves steadily instead of piling up presses; Play/Pause on a title plays it, ⏪ ⏩ jump along a row.
import { openOptions, initTV } from './tv.js';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex="0"]';
const DIR = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
const tv = () => document.body.classList.contains('tv');

function scope() {
  const top = document.querySelector('.confirm, .surprise, .welcome, .menu:not([hidden]), #nowplaying:not([hidden]), #reader:not([hidden])'); // layers above everything else
  if (top) return top;
  const player = document.getElementById('player');
  if (player && !player.hidden) return player;
  const overlay = document.getElementById('overlay');
  if (overlay && overlay.childElementCount) return overlay;
  return document.getElementById('app');
}
// Cheap visibility test (no style lookups, which were the slow part on a Fire TV Stick).
const shown = (r) => r.width > 0 && r.height > 0;
const rail = () => document.querySelector('body.tv .nav');
const inRail = (el) => !!el && !!rail()?.contains(el);
const rowOf = (el) => el?.closest?.('.scroller, .libs, .moods, .tracks');

let lastContent = null; // where focus was before going into the sidebar
const rowMemory = new WeakMap(); // row → the item last focused in it

/** The item to land on when coming into a row from above or below: where you were, or its first title on screen. */
function entry(row, fallback) {
  const mem = rowMemory.get(row);
  if (mem?.isConnected && shown(mem.getBoundingClientRect())) {
    const r = mem.getBoundingClientRect();
    if (r.right > 0 && r.left < innerWidth) return mem;
  }
  const items = [...row.querySelectorAll(FOCUSABLE)].filter((el) => !el.closest('.cap-hide') && !el.matches('.arrow, .playdot'));
  const box = row.getBoundingClientRect();
  return items.find((el) => { const r = el.getBoundingClientRect(); return shown(r) && r.left >= box.left - 4; }) || fallback;
}

function candidates(root) {
  const bar = root.id === 'app' || root.id === 'overlay' ? [...document.querySelectorAll(`#nowbar:not([hidden]) :is(${FOCUSABLE})`)] : [];
  const out = [];
  for (const el of [...root.querySelectorAll(FOCUSABLE), ...bar]) {
    if (el.tabIndex < 0 || el.closest('.cap-hide, [hidden], [inert]')) continue;
    const r = el.getBoundingClientRect();
    if (shown(r)) out.push([el, r]);
  }
  return out;
}

function nearest(from, a, list, dx, dy) {
  const ax = a.left + a.width / 2, ay = a.top + a.height / 2;
  let best = null, bestScore = Infinity;
  for (const [el, b] of list) {
    if (el === from) continue;
    const bx = b.left + b.width / 2, by = b.top + b.height / 2;
    const along = dx ? (bx - ax) * dx : (by - ay) * dy;
    if (along < 4) continue;
    // Distance between edges on the travel axis, plus a penalty for drifting sideways.
    const gap = dx ? (dx > 0 ? b.left - a.right : a.left - b.right) : (dy > 0 ? b.top - a.bottom : a.top - b.bottom);
    const overlap = dx ? Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) : Math.min(a.right, b.right) - Math.max(a.left, b.left);
    const off = dx ? Math.abs(by - ay) : Math.abs(bx - ax);
    const score = Math.max(0, gap) + (overlap > 0 ? 0 : off * 2.2 + 40) + off * 0.15;
    if (score < bestScore) { best = el; bestScore = score; }
  }
  return best;
}

let held = false; // a key is being held: scroll instantly so the screen keeps up
/** Keep the focused control on screen: rows slide so it sits a little in from the left, and the page keeps it at a steady height. */
function reveal(el) {
  const behavior = 'auto'; // instant: smooth scrolling stutters on a Fire TV Stick, and an instant jump feels quicker
  if (!tv()) { el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' }); return; }
  if (inRail(el)) return;
  const sc = el.closest('.scroller, .moods, .tracks');
  if (sc && sc.scrollWidth > sc.clientWidth + 2) {
    const r = el.getBoundingClientRect(), box = sc.getBoundingClientRect();
    const pad = Math.min(box.width * 0.08, 60);
    if (r.left < box.left + pad || r.right > box.right - pad) sc.scrollTo({ left: Math.max(0, sc.scrollLeft + r.left - box.left - pad), behavior });
  }
  const scroller = el.closest('#overlay .sheet, #overlay') && document.getElementById('overlay');
  const view = scroller && scroller.scrollHeight > scroller.clientHeight ? scroller : null;
  const r = el.getBoundingClientRect();
  const vh = innerHeight, line = vh * 0.3;
  const top = el.closest('.hero, .vlib-bar, .lib-head') && !view;
  let by = 0;
  if (top) by = -(view ? view.scrollTop : scrollY);
  else if (r.top < vh * 0.14 || r.bottom > vh * 0.9) by = r.top - line;
  if (Math.abs(by) > 2) (view || window).scrollBy({ top: by, behavior });
}

function focusEl(el) {
  if (!el) return false;
  el.focus({ preventScroll: true });
  if (inRail(el)) el.scrollIntoView({ block: 'nearest' }); // a long sidebar scrolls to keep the item in view
  reveal(el);
  return true;
}

export function move(key) {
  const [dx, dy] = DIR[key];
  const root = scope();
  const from = document.activeElement && root.contains(document.activeElement) && document.activeElement !== document.body ? document.activeElement : null;
  if (!from) return focusPage(true);
  // In the sidebar: up and down move along it, right goes back to the page.
  if (tv() && inRail(from) && root.id === 'app') {
    if (dx > 0) return focusEl((lastContent?.isConnected && shown(lastContent.getBoundingClientRect()) && lastContent) || primary());
    if (dx < 0) return true;
    const items = candidates(rail()).sort((x, y) => x[1].top - y[1].top).map(([el]) => el); // top to bottom as shown
    const i = items.indexOf(from);
    return focusEl(items[Math.max(0, Math.min(items.length - 1, i + dy))]);
  }
  const a = from.getBoundingClientRect();
  const list = candidates(root).filter(([el]) => !(tv() && inRail(el)));
  let best = nearest(from, a, list, dx, dy);
  const fromRow = rowOf(from);
  if (tv()) {
    // Left at the start of a row (or with nothing to the left) opens the sidebar.
    if (dx < 0 && root.id === 'app' && (!best || (fromRow && rowOf(best) !== fromRow && !rowOf(best)?.contains(from)) || best.getBoundingClientRect().top > a.bottom || best.getBoundingClientRect().bottom < a.top)) {
      lastContent = from;
      return focusEl(document.querySelector('body.tv .nav .links a.on') || candidates(rail())[0]?.[0]);
    }
    // Right at the end of a line stays put rather than jumping to another row (TV apps never wrap sideways).
    if (dx > 0 && best) { const b = best.getBoundingClientRect(); if (b.top >= a.bottom - 2 || b.bottom <= a.top + 2) return true; }
    // Moving up into the banner lands on its Play button.
    if (dy < 0 && best?.closest('.hero') && !from.closest('.hero')) best = best.closest('.hero').querySelector('.btn.primary') || best;
    // Coming into a row from above or below lands where you were in it, or on its first title on screen.
    if (dy && best) { const row = rowOf(best); if (row && row !== fromRow && row.matches('.scroller, .libs')) best = entry(row, best); }
  }
  if (!best) return false;
  return focusEl(best);
}

/** The control a page starts on: its banner's Play, otherwise its first title. */
function primary() {
  const root = scope();
  const onScreen = (el) => { const r = el.getBoundingClientRect(); return shown(r) && r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth; };
  const named = root.querySelector('.hero .btn.primary, .sheet .actions .btn.primary, .who button, [autofocus]');
  if (named && shown(named.getBoundingClientRect())) return named;
  const content = candidates(root).filter(([el]) => !inRail(el) && !el.matches('.bg-edit, .arrow')).map(([el]) => el); // never start on an admin control
  // Something you can see: the first title on screen, else the first control on screen, else the first title at all.
  return content.find((el) => el.matches('.card, .lib-tile, .scroller > *') && onScreen(el)) || content.find(onScreen)
    || content.find((el) => el.matches('.card')) || content[0];
}

// Where focus was on each page, so going back puts it there again.
const pageMemory = new Map();
const keyOf = (el) => (el.getAttribute('href') ? `[href="${CSS.escape(el.getAttribute('href'))}"]` : el.dataset.nav ? `[data-nav="${el.dataset.nav}"]` : null);
function remember(hash) {
  const el = document.activeElement;
  if (!el || el === document.body || inRail(el)) return;
  const key = keyOf(el);
  if (key) pageMemory.set(hash, key);
}
/** Make sure something on the page has focus (on TVs a page with nothing focused does nothing when keys are pressed). */
export function focusPage(force = false) {
  const root = scope();
  const cur = document.activeElement;
  if (!force && cur && cur !== document.body && root.contains(cur) && shown(cur.getBoundingClientRect())) return true;
  const key = pageMemory.get(location.hash);
  const back = key && root.querySelector(key);
  const el = (back && shown(back.getBoundingClientRect()) && back) || primary();
  if (!el) return false;
  el.focus({ preventScroll: true });
  if (back) reveal(el);
  return true;
}

/**
 * Back (the remote's Back button, Escape or Backspace). Open layers handle it themselves first; then the previous page;
 * then the sidebar. Returns false when there is nothing left to go back to, so the TV app can offer to close.
 */
export function goBack() {
  const menu = document.querySelector('.nav .menu');
  if (menu) { menu.remove(); document.querySelector('.nav [data-menu]')?.focus(); return true; }
  let reached = false;
  const probe = () => { reached = true; };
  addEventListener('keydown', probe);
  const ev = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  (document.activeElement || document.body).dispatchEvent(ev);
  removeEventListener('keydown', probe);
  if (!reached || ev.defaultPrevented) return true; // something open (a menu, a title, the reader) closed itself
  const home = location.hash === '' || location.hash === '#/' || location.hash === '#';
  if (!home) { history.back(); return true; }
  if (tv() && !inRail(document.activeElement)) {
    lastContent = document.activeElement;
    scrollTo({ top: 0, behavior: 'smooth' });
    return focusEl(document.querySelector('body.tv .nav .links a.on') || candidates(rail())[0]?.[0]);
  }
  return false;
}

/** Media keys on a title: Play/Pause plays it, ⏪ ⏩ jump along the row. */
function mediaKey(k) {
  const el = document.activeElement;
  if (k === 'menu') { // the remote's Menu key: more options for where you are (see tv.js), otherwise the sidebar
    if (inRail(el)) return focusEl((lastContent?.isConnected && lastContent) || primary());
    if (tv() && openOptions(el)) return true;
    if (el && el !== document.body) lastContent = el;
    return focusEl(document.querySelector('body.tv .nav .links a.on') || candidates(rail() || document.body)[0]?.[0]);
  }
  if (!el || el === document.body) return false;
  if (k === 'play') {
    // A title: open it and press its Play (which also picks the next episode of a show).
    const card = el.closest('a[href^="#/title/"]');
    if (card) {
      location.hash = card.getAttribute('href');
      let tries = 0;
      const t = setInterval(() => { const b = document.querySelector('#overlay .actions .btn.primary'); if (b || ++tries > 30) { clearInterval(t); b?.click(); } }, 100);
      return true;
    }
    if (el.matches('a, button')) { el.click(); return true; }
    return false;
  }
  const row = el.closest('.scroller');
  if (!row) return false;
  const items = [...row.querySelectorAll(':scope > *')].map((x) => (x.matches(FOCUSABLE) ? x : x.querySelector(FOCUSABLE))).filter(Boolean);
  const i = items.indexOf(el.matches(FOCUSABLE) ? el : el.closest(FOCUSABLE));
  return focusEl(items[Math.max(0, Math.min(items.length - 1, i + (k === 'ff' ? 6 : -6)))]);
}

let lastMove = 0;
export function initNav() {
  addEventListener('keydown', (e) => {
    if (!DIR[e.key] || e.altKey || e.ctrlKey || e.metaKey || e.defaultPrevented) return;
    const t = e.target;
    if (t.matches?.('input[type=range], select')) return;
    if (t.matches?.('input') && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && t.value) return;
    // A held key moves about eleven times a second, so the screen keeps up instead of lagging behind.
    held = e.repeat;
    const now = performance.now();
    if (e.repeat && now - lastMove < 90) { e.preventDefault(); return; }
    lastMove = now;
    if (move(e.key)) e.preventDefault();
  });
  // Remotes send Enter; make it activate anything focusable that is not natively clickable.
  addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches?.('[tabindex="0"]')) e.target.click(); });
  addEventListener('keyup', () => { held = false; });
  // Keep track of where you are in each row, and of the last place on the page before the sidebar.
  addEventListener('focusin', (e) => {
    const el = e.target;
    const row = rowOf(el);
    if (row) rowMemory.set(row, el.closest('.scroller > *')?.matches(FOCUSABLE) ? el.closest('.scroller > *') : el);
    if (!inRail(el) && document.body.classList.contains('tv')) document.body.classList.remove('rail-open');
    if (inRail(el)) document.body.classList.add('rail-open');
  });
  addEventListener('focusout', (e) => { if (inRail(e.target) && !inRail(e.relatedTarget)) document.body.classList.remove('rail-open'); });
  // Leaving a page remembers where focus was; arriving on one focuses something (after it has drawn).
  let current = location.hash, arrived = false, arrivedAt = 0, touched = false;
  addEventListener('hashchange', () => { remember(current); current = location.hash; lastContent = null; arrived = true; arrivedAt = performance.now(); touched = false; settle(); });
  addEventListener('keydown', () => { touched = true; }, true);
  // After a page (or a title) opens or closes, focus lands on it: where you were before, or its first control.
  // A page chosen from the sidebar takes focus out of the sidebar.
  let timer = 0;
  const settle = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!tv()) return;
      // A page that draws in stages: until a key is pressed (for a moment), keep focus on something you can see.
      const fresh = arrived && !touched && performance.now() - arrivedAt < 2000;
      const cur = document.activeElement, r = cur?.getBoundingClientRect?.();
      const offScreen = !r || r.bottom < 0 || r.top > innerHeight;
      const force = (arrived && inRail(cur)) || (fresh && offScreen && !pageMemory.has(location.hash));
      if (focusPage(force) && !fresh) arrived = false;
    }, 160);
  };
  for (const id of ['app', 'overlay']) { const el = document.getElementById(id); if (el) new MutationObserver(settle).observe(el, { childList: true, subtree: id === 'app' }); }
  // The TV app passes on Back and the media keys (see MainActivity).
  window.hallflixBack = () => goBack();
  addEventListener('hallflix-key', (e) => mediaKey(e.detail));
  addEventListener('keydown', (e) => { if (e.key === 'ContextMenu' && tv()) { e.preventDefault(); mediaKey('menu'); } });
  if (tv()) initTV();
  addEventListener('keydown', (e) => {
    if (e.key === 'MediaPlayPause' || e.key === 'MediaPlay') { if (mediaKey('play')) e.preventDefault(); }
    else if (e.key === 'MediaFastForward' || e.key === 'MediaRewind') { if (mediaKey(e.key === 'MediaFastForward' ? 'ff' : 'rew')) e.preventDefault(); }
    else if (tv() && (e.key === 'GoBack' || e.key === 'BrowserBack') && !e.defaultPrevented) { e.preventDefault(); goBack(); }
  });
}
