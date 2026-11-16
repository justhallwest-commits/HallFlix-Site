// Arrow-key and TV-remote navigation: move focus to the nearest control in the pressed direction.
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex="0"]';
const DIR = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

function scope() {
  const player = document.getElementById('player');
  if (player && !player.hidden) return player;
  const overlay = document.getElementById('overlay');
  if (overlay && overlay.childElementCount) return overlay;
  return document.getElementById('app');
}
const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };

export function move(key) {
  const [dx, dy] = DIR[key];
  const root = scope();
  const all = [...root.querySelectorAll(FOCUSABLE)].filter(visible);
  if (!all.length) return false;
  const from = document.activeElement && root.contains(document.activeElement) ? document.activeElement : null;
  if (!from) { (all.find((el) => el.matches('.btn.primary, .card')) || all[0]).focus(); return true; }
  const a = from.getBoundingClientRect();
  const ax = a.left + a.width / 2, ay = a.top + a.height / 2;
  let best = null, bestScore = Infinity;
  for (const el of all) {
    if (el === from) continue;
    const b = el.getBoundingClientRect();
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
  if (!best) return false;
  best.focus({ preventScroll: true });
  best.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  return true;
}

export function initNav() {
  addEventListener('keydown', (e) => {
    if (!DIR[e.key] || e.altKey || e.ctrlKey || e.metaKey || e.defaultPrevented) return;
    const t = e.target;
    if (t.matches?.('input[type=range], select')) return;
    if (t.matches?.('input') && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && t.value) return;
    if (move(e.key)) e.preventDefault();
  });
  // Remotes send Enter; make it activate anything focusable that is not natively clickable.
  addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches?.('[tabindex="0"]')) e.target.click(); });
}
