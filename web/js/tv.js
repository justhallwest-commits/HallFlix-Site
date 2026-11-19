// TV layout rules (Fire TV, Android TV and ?tv), after the 10-foot apps (Plex, Jellyfin, Emby, Netflix):
// the remote stops only on things worth choosing, and less-used actions live behind the remote's Menu (☰) key
// instead of being extra stops on every page. Nothing is removed: each hidden action is still one Menu press away.

/** Things the remote passes over on a TV: duplicate links, links to other websites, and small controls next to bigger ones. */
const PASS = [
  '.nav a.logo', // the same place as Home
  '.row > h2 a', // a row's "See all" is the last tile of the row instead
  '.sheet [data-x]', // Back closes a title
  '.sheet .facts a', // the cast names in "Starring" (the cast row below has them all)
  '.ratings a.rating', // rating websites can't be opened on a TV
  '.sheet .dlinks a', // nor can IMDb or TMDb pages
  '.ep-manage', // per-episode remove: Menu on the episode
  '.sheet [data-manage]', // remove or delete a title: Menu on the title
  '[data-seasonseen]', // Menu on a show
  '.bg-edit', // Menu on a library page
];

/** Actions kept behind the Menu key, nearest first: what belongs to the focused item, then to the open title, then to the page. */
function options(el) {
  const out = [];
  const add = (node, label) => { if (node && !out.some((o) => o.node === node)) out.push({ node, label: label || node.getAttribute('aria-label') || node.textContent.trim(), run: () => node.click() }); };
  // The title's own handlers act on a button with these data- attributes, wherever it sits in the title.
  const fire = (sheet, data) => { const b = document.createElement('button'); b.hidden = true; Object.assign(b.dataset, data); sheet.append(b); b.click(); b.remove(); };
  const ep = el?.closest?.('.ep-wrap');
  if (ep) add(ep.querySelector('.ep-manage'), 'Remove or delete this episode');
  const sheet = document.querySelector('#overlay .sheet');
  if (sheet) {
    const ss = sheet.querySelector('[data-seasonseen]');
    if (ss && !sheet.querySelector('[data-pane="episodes"]')?.hidden) add(ss);
    if (sheet.querySelector('[data-manage]')) { // admins: the same choices as the bin button's menu on a computer
      const show = !!sheet.querySelector('[data-pane="episodes"]'), season = sheet.querySelector('.seasons [data-season].on');
      out.push({ node: sheet, label: show ? 'Remove or delete the whole show' : 'Remove or delete this movie', run: () => fire(sheet, { remove: sheet.dataset.id }) });
      if (season) out.push({ node: season, label: `Remove or delete ${season.textContent.trim()} only`, run: () => fire(sheet, { remove: season.dataset.season }) });
    }
  } else {
    add(document.querySelector('#view .bg-edit'));
  }
  return out.filter((o) => o.node.isConnected && o.label);
}

let menu = null, back = null;
function close(restore = true) {
  if (!menu) return;
  menu.remove(); menu = null;
  if (restore && back?.isConnected) back.focus({ preventScroll: true });
}

/** The Menu key: a short list of the hidden actions for where you are. Returns false when there are none (the sidebar opens instead). */
export function openOptions(el) {
  if (menu) { close(); return true; }
  const list = options(el);
  if (!list.length) return false;
  back = el;
  menu = document.createElement('div');
  menu.className = 'tv-menu';
  menu.setAttribute('role', 'menu');
  menu.innerHTML = `<p>More options</p>${list.map((o, i) => `<button role="menuitem" data-i="${i}"></button>`).join('')}`;
  list.forEach((o, i) => { menu.querySelector(`[data-i="${i}"]`).textContent = o.label; });
  menu.addEventListener('click', (e) => {
    const b = e.target.closest('[data-i]');
    if (!b) return;
    const o = list[+b.dataset.i];
    close(false);
    back?.focus({ preventScroll: true });
    o.run();
  });
  document.body.append(menu);
  menu.querySelector('button').focus();
  return true;
}

/** Keep the remote inside the options list; Back (Escape) closes it. */
function keys(e) {
  if (!menu) return;
  if (e.key === 'Escape' || e.key === 'Backspace') { e.preventDefault(); e.stopImmediatePropagation(); close(); return; }
  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    e.preventDefault(); e.stopImmediatePropagation();
    const bs = [...menu.querySelectorAll('button')], i = bs.indexOf(document.activeElement);
    bs[Math.max(0, Math.min(bs.length - 1, (i < 0 ? 0 : i) + (e.key === 'ArrowDown' ? 1 : -1)))].focus();
  } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); e.stopImmediatePropagation(); }
}

/** A small "☰ More options" note on a title, so the Menu key is discoverable. */
function hint() {
  const sheet = document.querySelector('#overlay .sheet');
  if (!sheet || sheet.querySelector('.tv-hint')) return;
  if (!sheet.querySelector('[data-seasonseen], [data-manage], .ep-manage')) return;
  const a = sheet.querySelector('.actions');
  a?.insertAdjacentHTML('beforeend', '<span class="tv-hint" aria-hidden="true"><b>☰</b> More options</span>');
}

let queued = false;
function tidy() {
  queued = false;
  for (const el of document.querySelectorAll(PASS.join(','))) if (el.tabIndex !== -1) el.tabIndex = -1;
  hint();
  if (menu && !back?.isConnected) close(false);
}

export function initTV() {
  addEventListener('keydown', keys, true);
  const schedule = () => { if (!queued) { queued = true; requestAnimationFrame(tidy); } };
  for (const id of ['app', 'overlay']) { const el = document.getElementById(id); if (el) new MutationObserver(schedule).observe(el, { childList: true, subtree: true }); }
  tidy();
}
