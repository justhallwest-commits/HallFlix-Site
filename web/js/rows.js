// Keeping Home and the libraries from overflowing: how many titles each row shows, how many rows show before
// "Show more rows", a visible scroll bar under each row, and an option to hold the rows in their own scrolling panel so
// the background stays in view. Set in Studio → Look and feel (whole app, and each library's tab).
// Works on the finished page, so every kind of row (movies, shows, music, comics, collections) is covered the same way.
import { $, $$, themeNow, libraryLook, on } from './core.js';

export const ROW_DEFAULTS = { items: 15, sections: 8, scroll: 'arrows', panel: false, panelHeight: 60 };
const KEYS = Object.keys(ROW_DEFAULTS);

/** Which settings apply here: Home uses the whole-app settings, a library adds its own on top. Elsewhere, none. */
function scope(hash = location.hash) {
  if (hash === '' || hash === '#' || /^#\/?(\?.*)?$/.test(hash)) return { lib: null };
  const m = /^#\/library\/(\d+)/.exec(hash);
  return m ? { lib: +m[1] } : null;
}
export function rowSettings(libId = null, theme = themeNow()) {
  const out = { ...ROW_DEFAULTS };
  const apply = (o) => { for (const k of KEYS) if (o?.[k] !== undefined && o[k] !== null && o[k] !== '') out[k] = o[k]; };
  apply(theme?.rows);
  if (libId != null) apply(libraryLook(libId).rows);
  out.items = Math.max(0, +out.items || 0);
  out.sections = Math.max(0, +out.sections || 0);
  out.panel = out.panel === true || out.panel === 'yes';
  out.panelHeight = Math.max(30, Math.min(90, +out.panelHeight || 60));
  return out;
}

let obs = null;
const rowsIn = (view) => $$('.row', view).filter((r) => r.querySelector(':scope > .scroller') && !r.closest('.sheet, #overlay, .preview-pop'));

/** The last tile of a row that was cut short: "See all" when the row has a page of its own, otherwise "Show all". */
function moreTile(row, extra) {
  const link = row.querySelector(':scope > h2 a[href]'), genre = row.querySelector(':scope > h2 [data-seegenre]');
  const el = document.createElement(link ? 'a' : 'button');
  el.className = 'cap-more';
  if (link) el.href = link.getAttribute('href');
  else if (genre) el.dataset.seegenre = genre.dataset.seegenre;
  else el.dataset.capOpen = '';
  el.innerHTML = `<b>+${extra}</b><span>${link || genre ? 'See all' : 'Show all'}</span>`;
  el.setAttribute('aria-label', `${link || genre ? 'See all' : 'Show all'}: ${extra} more`);
  if (row.classList.contains('keep')) el.classList.add('wide');
  if (row.classList.contains('squares')) el.classList.add('square');
  return el;
}

function arrows(row) {
  const sc = row.querySelector(':scope > .scroller'), l = row.querySelector(':scope > .arrow.l'), r = row.querySelector(':scope > .arrow.r');
  if (!sc || !l || !r) return;
  l.hidden = sc.scrollLeft < 10;
  r.hidden = sc.scrollLeft + sc.clientWidth > sc.scrollWidth - 10;
}

/** Apply the limits to the page as it stands. Safe to run again at any time: it undoes its own changes first. */
export function tidy() {
  const view = $('#view');
  if (!view) return;
  for (const el of $$('.cap-hide', view)) el.classList.remove('cap-hide');
  for (const el of $$('.cap-more, .cap-rows', view)) el.remove();
  for (const el of $$('.cap-panel', view)) { el.classList.remove('cap-panel'); el.style.removeProperty('--rows-panel-h'); }
  const where = scope();
  const s = where && rowSettings(where.lib);
  document.body.classList.toggle('rows-bar', !!s && s.scroll === 'bar');
  if (s) {
    const rows = rowsIn(view);
    // Titles per row
    if (s.items) for (const r of rows) {
      if ('capOpen' in r.dataset) continue;
      const sc = r.querySelector(':scope > .scroller'), kids = [...sc.children];
      if (kids.length <= s.items) continue;
      for (const k of kids.slice(s.items)) k.classList.add('cap-hide');
      sc.append(moreTile(r, kids.length - s.items));
    }
    // Rows on the page: counted within each group of rows, and the rest wait behind "Show more rows".
    if (s.sections) {
      const groups = new Map();
      for (const r of rows) { const p = r.parentElement; if (!groups.has(p)) groups.set(p, []); groups.get(p).push(r); }
      for (const [p, list] of groups) {
        if ('capOpen' in p.dataset || list.length <= s.sections) continue;
        for (const r of list.slice(s.sections)) r.classList.add('cap-hide');
        const b = document.createElement('button');
        b.className = 'btn cap-rows'; b.dataset.capRows = '';
        b.textContent = `Show ${list.length - s.sections} more ${list.length - s.sections === 1 ? 'row' : 'rows'}`;
        list[s.sections - 1].after(b);
      }
    }
    // The rows in their own scrolling panel, so the page stays short and the background shows.
    if (s.panel && rows.length) {
      let p = rows[0].parentElement;
      while (p && p !== view && !rows.every((r) => p.contains(r))) p = p.parentElement;
      // Only a container that holds just the rows: never one with the page's own heading in it.
      if (p && p !== view && !p.querySelector(':scope > h1, :scope > * > h1, .lib-head, .vlib-bar, .hero')) { p.classList.add('cap-panel'); p.style.setProperty('--rows-panel-h', `${s.panelHeight}vh`); }
    }
    for (const r of rows) arrows(r);
  }
  obs?.takeRecords(); // our own changes are not news
}

let queued = false;
const later = () => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; tidy(); }); };

/** Watch the page: whenever rows appear (a page opening, the mood dial, a tab), apply the limits. */
export function initRows() {
  const view = $('#view');
  if (!view) return;
  obs?.disconnect();
  obs = new MutationObserver((list) => {
    for (const m of list) for (const n of m.addedNodes) {
      if (n.nodeType === 1 && !n.classList.contains('cap-more') && !n.classList.contains('cap-rows') && (n.matches('.row') || n.querySelector('.row'))) { later(); return; }
    }
  });
  obs.observe(view, { childList: true, subtree: true });
  later();
}

document.addEventListener('click', (e) => {
  const open = e.target.closest?.('[data-cap-open]'), more = e.target.closest?.('[data-cap-rows]');
  if (open) {
    e.preventDefault();
    const row = open.closest('.row'), sc = open.parentElement, at = [...sc.children].indexOf(open);
    row.dataset.capOpen = ''; tidy();
    sc.children[at]?.querySelector?.('a, button')?.focus({ preventScroll: true }) ?? sc.children[at]?.focus?.({ preventScroll: true });
  }
  else if (more) {
    e.preventDefault();
    const p = more.parentElement, next = more.nextElementSibling;
    p.dataset.capOpen = ''; tidy();
    next?.querySelector?.('a, button')?.focus({ preventScroll: true });
  }
});
// A new look (the Studio's live preview, or a season) can change the limits.
on('look', later);
