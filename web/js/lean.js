// Only what's on screen (after Plex, which keeps just the visible titles alive): in a long grid (a library, search,
// My List) titles more than a few screens away are swapped for a plain placeholder of the same size, and swapped back
// as they come near. A big library otherwise grows by 72 titles every time you scroll near the bottom, and a Fire TV
// Stick lays out, styles and remembers every one of them.
let io = null;
const parked = new WeakMap(); // placeholder → the title it stands in for

/** Put a title back in place of its placeholder (the remote calls this before moving onto one). Returns the title. */
export function restore(ph) {
  const card = parked.get(ph);
  if (!card) return ph;
  io?.unobserve(ph);
  ph.replaceWith(card);
  parked.delete(ph);
  io?.observe(card);
  return card;
}

function park(card, b) {
  if (card === document.activeElement || card.contains(document.activeElement) || !card.isConnected) return;
  if (!b.height) return;
  const ph = document.createElement('div');
  ph.className = 'lean-ph';
  ph.style.height = `${Math.round(b.height)}px`;
  ph.setAttribute('aria-hidden', 'true');
  io.unobserve(card);
  card.replaceWith(ph);
  parked.set(ph, card);
  io.observe(ph);
}

function swap(entries) {
  for (const e of entries) {
    const el = e.target;
    // The observer already measured each title (boundingClientRect), so nothing here forces the page to lay out again.
    if (el.classList.contains('lean-ph')) { if (e.isIntersecting) restore(el); } else if (!e.isIntersecting) park(el, e.boundingClientRect);
  }
}

function watch(root) {
  for (const card of root.querySelectorAll('.grid > .card:not([data-lean])')) { card.dataset.lean = '1'; io.observe(card); }
}

export function initLean() {
  if (!('IntersectionObserver' in window)) return;
  // About three screens above and below stay real, so scrolling never meets a blank space.
  io = new IntersectionObserver(swap, { rootMargin: '300% 0px 300% 0px' });
  const app = document.getElementById('app');
  if (!app) return;
  let queued = false;
  new MutationObserver(() => { if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; watch(app); }); } }).observe(app, { childList: true, subtree: true });
  watch(app);
}
