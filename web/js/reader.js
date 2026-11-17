// The reader: comics and PDFs page by page (one page or two side by side, left-to-right or manga order),
// EPUBs as flowing text laid out in pages, with the reader's own size, typeface and colours.
import { $, $$, api, html, raw, icons, toast } from './core.js';

let R = null;
const pref = (k, d) => { try { return localStorage.getItem(`hf_read_${k}`) ?? d; } catch { return d; } };
const setPref = (k, v) => { try { localStorage.setItem(`hf_read_${k}`, v); } catch { /* private mode */ } };
const THEMES = { dark: ['#141218', '#e9e5f0'], sepia: ['#f3e9d6', '#3b2f22'], light: ['#ffffff', '#1c1b1f'] };
const FONTS = { publisher: '', serif: "Georgia, 'Iowan Old Style', 'Palatino Linotype', serif", sans: "'Inter', system-ui, sans-serif" };

export const readerOpen = () => !!R;

export function closeReader() {
  if (!R) return;
  const r = R; R = null;
  r.save(true);
  removeEventListener('keydown', r.onKey, true);
  removeEventListener('resize', r.onResize);
  clearTimeout(r.hideTimer); clearTimeout(r.saveTimer);
  const el = $('#reader');
  el.hidden = true; el.innerHTML = ''; el.className = ''; el.removeAttribute('style');
  if ($('#overlay').childElementCount === 0 && $('#player').hidden) document.body.classList.remove('locked');
}

export async function openReader(id) {
  closeReader();
  const el = $('#reader');
  el.hidden = false; el.className = 'loading'; el.removeAttribute('style');
  document.body.classList.add('locked');
  let d;
  try { d = await api('GET', `/api/read/${id}`); } catch (e) { toast(e.message); history.back(); return; }
  if (d.mode === 'pages') pages(el, d); else book(el, d);
}

// ---------- shared frame ----------
function frame(el, d, extra) {
  el.innerHTML = String(html`<div class="rd-stage"></div>
    <header class="rd-top"><button class="rd-btn" data-act="close" aria-label="Back">${icons.back}</button>
      <div class="rd-title"><b>${d.title}</b><small>${d.series?.title || d.author || ''}</small></div>
      <button class="rd-btn" data-act="marks" aria-label="Bookmarks">${raw(RIBBON)}</button>${extra}</header>
    <footer class="rd-bottom"><input type="range" class="rd-range" min="1" value="1" aria-label="Page"><span class="rd-where"></span></footer>
    <div class="rd-panel" hidden></div><div class="rd-end" hidden></div><div class="rd-warm" aria-hidden="true"></div>`);
}
const RIBBON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 3h10v18l-5-4-5 4z"/></svg>';
const calm = () => document.body.classList.contains('tv') || matchMedia('(prefers-reduced-motion: reduce)').matches;
/** A warm tint over the page for reading at night, the same on every book. */
const warmHtml = (r) => html`<h4>Night warmth</h4><label class="rd-warmrow"><input type="range" min="0" max="60" step="5" value="${r.warm}" data-warm aria-label="Night warmth"><span>${r.warm ? `${Math.round((r.warm / 60) * 100)}%` : 'Off'}</span></label>`;
function setWarm(r, v) {
  r.warm = v; setPref('warm', v);
  $('.rd-warm', r.el).style.opacity = String(v / 100);
  const s = $('.rd-warmrow span', r.el); if (s) s.textContent = v ? `${Math.round((v / 60) * 100)}%` : 'Off';
}
async function marksPanel(r) {
  let list = [];
  try { list = await api('GET', `/api/bookmarks/${r.d.id}`); } catch { /* shown empty */ }
  if (R !== r) return;
  const p = $('.rd-panel', r.el);
  p.dataset.body = 'marks';
  p.innerHTML = String(html`<h4>Bookmarks</h4><button data-act="addmark" class="rd-add">${raw(RIBBON)} Bookmark this page</button>
    <div class="rd-toc">${list.length ? list.map((b) => html`<div class="rd-mark"><button data-act="gomark" data-pos="${b.position}">${b.label || 'Bookmark'}</button><button data-act="delmark" data-id="${b.id}" aria-label="Remove bookmark">${icons.x}</button></div>`)
    : html`<p class="rd-none">No bookmarks in this one yet.</p>`}</div>`);
  p.hidden = false;
  $('button', p)?.focus();
}
function showUi(r, on = !r.el.classList.contains('ui')) {
  r.el.classList.toggle('ui', on);
  clearTimeout(r.hideTimer);
  if (on) r.hideTimer = setTimeout(() => { if ($('.rd-panel', r.el).hidden && !document.activeElement?.closest?.('.rd-top, .rd-bottom')) r.el.classList.remove('ui'); }, 4000);
}
function panel(r, body) {
  const p = $('.rd-panel', r.el);
  if (!p.hidden && p.dataset.body === body?.toString().slice(0, 40)) { p.hidden = true; return; }
  if (!body) { p.hidden = true; return; }
  p.innerHTML = String(body); p.hidden = false; p.dataset.body = body.toString().slice(0, 40);
  $('button.on, button', p)?.focus();
}
function common(r) {
  r.warm = +pref('warm', 0) || 0;
  $('.rd-warm', r.el).style.opacity = String(r.warm / 100);
  r.el.addEventListener('input', (e) => { if (e.target.matches('[data-warm]')) setWarm(r, +e.target.value); });
  const inner = r.act;
  r.act = async (a, btn) => {
    if (a === 'marks') { const p = $('.rd-panel', r.el); if (!p.hidden && p.dataset.body === 'marks') { p.hidden = true; return; } return marksPanel(r); }
    if (a === 'addmark') {
      try { await api('POST', `/api/bookmarks/${r.d.id}`, { position: r.where().position, label: $('.rd-where', r.el).textContent }); toast('Bookmarked'); } catch (e) { toast(e.message); }
      return marksPanel(r);
    }
    if (a === 'gomark') { panel(r, null); r.goTo(+btn.dataset.pos); return; }
    if (a === 'delmark') { await api('DELETE', `/api/bookmarks/${r.d.id}/${btn.dataset.id}`).catch(() => {}); return marksPanel(r); }
    return inner(a, btn);
  };
  r.save = (now = false) => {
    clearTimeout(r.saveTimer);
    const send = () => {
      const { position, duration } = r.where();
      if (!duration) return;
      fetch('/api/progress', { method: 'POST', credentials: 'same-origin', keepalive: true, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId: r.d.id, position, duration }) }).catch(() => {});
    };
    if (now) send(); else r.saveTimer = setTimeout(send, 1200);
  };
  r.el.addEventListener('click', (e) => {
    const a = e.target.closest('[data-act]');
    if (a) { e.stopPropagation(); r.act(a.dataset.act, a); showUi(r, true); return; }
    if (e.target.closest('.rd-panel, .rd-top, .rd-bottom, .rd-end')) return;
    const x = e.clientX / innerWidth;
    if (x < 0.28) r.turn(-1); else if (x > 0.72) r.turn(1); else showUi(r);
  });
  $('.rd-range', r.el).addEventListener('input', (e) => r.jump(+e.target.value));
  let sx = null;
  r.el.addEventListener('touchstart', (e) => { sx = e.touches.length === 1 ? e.touches[0].clientX : null; }, { passive: true });
  r.el.addEventListener('touchend', (e) => { if (sx == null || r.zoomed?.()) return; const dx = e.changedTouches[0].clientX - sx; if (Math.abs(dx) > 50) r.turn(dx < 0 ? 1 : -1); sx = null; });
  r.onKey = (e) => {
    if (R !== r) return;
    const k = e.key;
    if (k === 'Escape' || k === 'Backspace' || k === 'GoBack' || k === 'BrowserBack') {
      e.preventDefault(); e.stopImmediatePropagation();
      if (!$('.rd-panel', r.el).hidden) panel(r, null); else history.back();
      return;
    }
    if (!$('.rd-panel', r.el).hidden || e.target.closest?.('.rd-top, .rd-bottom, .rd-end')) {
      if (k === 'ArrowDown' && e.target.closest?.('.rd-top')) { e.preventDefault(); e.stopImmediatePropagation(); r.el.focus(); showUi(r, false); }
      return; // the open menu, the bar or the end card uses normal focus
    }
    const fwd = r.rtl ? 'ArrowLeft' : 'ArrowRight', back = r.rtl ? 'ArrowRight' : 'ArrowLeft';
    let used = true;
    if (k === fwd || k === 'PageDown' || (k === ' ' && !e.shiftKey) || k === 'MediaFastForward') r.turn(1);
    else if (k === back || k === 'PageUp' || (k === ' ' && e.shiftKey) || k === 'MediaRewind') r.turn(-1);
    else if (k === 'ArrowDown') used = r.scroll?.(1) ?? (r.turn(1), true);
    else if (k === 'ArrowUp') { used = r.scroll?.(-1) ?? false; if (!used) { showUi(r, true); $('.rd-top .rd-btn', r.el)?.focus(); used = true; } }
    else if (k === 'Enter') showUi(r);
    else if (k === 'Home') r.jump(1);
    else if (k === 'End') r.jump(r.count());
    else used = false;
    if (used) { e.preventDefault(); e.stopImmediatePropagation(); }
  };
  addEventListener('keydown', r.onKey, true);
  r.el.tabIndex = -1; r.el.focus();
  showUi(r, true);
}

/** At the end of an issue: on to the next one, or back. */
function endCard(r) {
  const end = $('.rd-end', r.el), n = r.d.next;
  end.hidden = false;
  end.innerHTML = String(html`<div><p>You finished ${r.d.title}.</p>${n ? html`<a class="btn primary" href="#/read/${n.id}" data-replace>${icons.play} Read ${n.title}</a>` : ''}
    <button class="btn" data-act="close">Back to ${r.d.series?.title || 'the library'}</button></div>`);
  $('.btn', end).focus();
  $('[data-replace]', end)?.addEventListener('click', (e) => { e.preventDefault(); history.replaceState(null, '', `#/read/${n.id}`); openReader(n.id); });
}

// ---------- comics and PDFs ----------
function pages(el, d) {
  frame(el, d, html`<button class="rd-btn" data-act="settings" aria-label="Reading options">${icons.gear}</button>`);
  const r = R = { el, d, rtl: pref(`rtl_${d.series?.id || d.id}`, d.rtl ? '1' : '0') === '1', fit: pref('fit', 'screen'), spreadPref: pref('spread', 'auto'), page: 1 };
  const total = d.pages;
  const url = (n) => `/api/read/${d.id}/page/${n}`;
  const stage = $('.rd-stage', el);
  const range = $('.rd-range', el);
  range.max = String(total);
  el.classList.add('mode-pages');
  const spread = () => r.spreadPref === 'two' || (r.spreadPref === 'auto' && innerWidth > innerHeight * 1.15 && r.fit === 'screen');
  // Two pages side by side keep the cover on its own, like a printed comic.
  const shown = (p) => (spread() && p > 1 && p < total ? [p % 2 === 0 ? p : p - 1, (p % 2 === 0 ? p : p - 1) + 1].filter((x) => x <= total) : [p]);
  r.count = () => total;
  r.where = () => ({ position: Math.max(...shown(r.page)), duration: total });
  r.zoomed = () => r.fit === 'width' && stage.scrollHeight > stage.clientHeight + 4;
  const draw = () => {
    const list = shown(r.page);
    el.classList.toggle('fit-width', r.fit === 'width');
    el.classList.toggle('two', list.length === 2);
    stage.classList.toggle('rtl', r.rtl);
    stage.innerHTML = String(html`${list.map((n) => html`<img class="rd-page" src="${url(n)}" alt="Page ${n}" draggable="false">`)}`);
    stage.scrollTop = 0;
    range.value = String(r.page); range.style.setProperty('--p', `${((r.page - 1) / Math.max(1, total - 1)) * 100}%`);
    range.classList.toggle('rtl', r.rtl);
    $('.rd-where', el).textContent = list.length === 2 ? `Pages ${list[0]}–${list[1]} of ${total}` : `Page ${list[0]} of ${total}`;
    for (let k = 1; k <= 3; k++) { const n = Math.max(...list) + k; if (n <= total) new Image().src = url(n); }
    el.classList.remove('loading');
    r.save();
  };
  r.turn = (dir) => {
    const list = shown(r.page);
    const to = dir > 0 ? Math.max(...list) + 1 : Math.min(...list) - 1;
    if (to > total) { r.save(true); endCard(r); return; }
    if (to < 1) return;
    $('.rd-end', el).hidden = true;
    r.page = dir < 0 && spread() && to > 1 ? (to % 2 === 0 ? to : to - 1) : to;
    draw();
    if (!calm()) { const fwd = (dir > 0) !== r.rtl; stage.classList.remove('turn-f', 'turn-b'); void stage.offsetWidth; stage.classList.add(fwd ? 'turn-f' : 'turn-b'); }
  };
  r.goTo = (pos) => r.jump(Math.floor(pos));
  r.jump = (n) => { r.page = Math.max(1, Math.min(total, n)); $('.rd-end', el).hidden = true; draw(); };
  r.scroll = (dir) => {
    if (r.fit !== 'width') return null;
    const max = stage.scrollHeight - stage.clientHeight;
    if ((dir > 0 && stage.scrollTop >= max - 2) || (dir < 0 && stage.scrollTop <= 2)) { r.turn(dir); if (dir < 0) stage.scrollTop = stage.scrollHeight; return true; }
    stage.scrollBy({ top: dir * stage.clientHeight * 0.8, behavior: 'smooth' });
    return true;
  };
  r.act = (a, btn) => {
    if (a === 'close') { history.back(); return; }
    if (a === 'settings') {
      panel(r, html`<h4>Page fit</h4><div class="seg"><button data-act="fit" data-v="screen" class="${r.fit === 'screen' ? 'on' : ''}">Whole page</button><button data-act="fit" data-v="width" class="${r.fit === 'width' ? 'on' : ''}">Fit width</button></div>
        <h4>Pages</h4><div class="seg"><button data-act="spread" data-v="auto" class="${r.spreadPref === 'auto' ? 'on' : ''}">Automatic</button><button data-act="spread" data-v="one" class="${r.spreadPref === 'one' ? 'on' : ''}">One</button><button data-act="spread" data-v="two" class="${r.spreadPref === 'two' ? 'on' : ''}">Two</button></div>
        <h4>Reading direction</h4><div class="seg"><button data-act="dir" data-v="0" class="${r.rtl ? '' : 'on'}">Left to right</button><button data-act="dir" data-v="1" class="${r.rtl ? 'on' : ''}">Right to left (manga)</button></div>${warmHtml(r)}`);
      return;
    }
    if (a === 'fit') { r.fit = btn.dataset.v; setPref('fit', r.fit); }
    if (a === 'spread') { r.spreadPref = btn.dataset.v; setPref('spread', r.spreadPref); }
    if (a === 'dir') { r.rtl = btn.dataset.v === '1'; setPref(`rtl_${d.series?.id || d.id}`, btn.dataset.v); }
    if (['fit', 'spread', 'dir'].includes(a)) { draw(); for (const b of $$(`[data-act=${a}]`, el)) b.classList.toggle('on', b === btn); }
  };
  r.onResize = () => draw();
  addEventListener('resize', r.onResize);
  common(r);
  const p = d.progress;
  r.page = p && !p.finished && p.position >= 1 ? Math.min(total, Math.floor(p.position)) : 1;
  draw();
}

// ---------- EPUB ----------
function book(el, d) {
  frame(el, d, html`<button class="rd-btn" data-act="toc" aria-label="Contents">${icons.list}</button><button class="rd-btn" data-act="type" aria-label="Text options">${icons.type}</button>`);
  const r = R = { el, d, chapter: 0, page: 0, pages: 1, size: +pref('size', 100), theme: pref('theme', 'dark'), font: pref('font', 'publisher'), rtl: false };
  el.classList.add('mode-book');
  const stage = $('.rd-stage', el);
  stage.innerHTML = '<iframe class="rd-frame" sandbox="allow-same-origin" title="Book"></iframe>';
  const frameEl = $('.rd-frame', stage);
  const range = $('.rd-range', el);
  range.max = String(d.spine.length * 100);
  r.count = () => d.spine.length * 100;
  r.where = () => ({ position: r.chapter + (r.pages > 1 ? r.page / (r.pages - 1) : 0) * 0.999, duration: d.spine.length });
  const geom = () => {
    const pad = innerWidth < 700 ? 22 : 56, two = innerWidth >= 1100 && innerWidth > innerHeight;
    const W = Math.min(innerWidth - pad * 2, two ? 1500 : 760), H = innerHeight - (innerWidth < 700 ? 110 : 130);
    const gap = two ? 80 : pad * 2, col = two ? (W - gap) / 2 : W;
    return { W, H, gap, col, step: W + gap };
  };
  const doc = () => frameEl.contentDocument;
  // Lay the chapter out in columns as wide as the page, then move along them one screen at a time.
  const layout = () => {
    const dc = doc();
    if (!dc?.body) return;
    const g = geom(), [bg, fg] = THEMES[r.theme] || THEMES.dark;
    frameEl.style.width = `${g.W}px`; frameEl.style.height = `${g.H}px`;
    el.style.setProperty('--rd-bg', bg); el.style.setProperty('--rd-fg', fg);
    let st = dc.getElementById('hf-reader');
    if (!st) { st = dc.createElement('style'); st.id = 'hf-reader'; (dc.head || dc.documentElement).append(st); }
    st.textContent = `
      html { height: ${g.H}px !important; overflow: hidden !important; background: ${bg} !important; font-size: ${r.size}% !important; -webkit-text-size-adjust: none; }
      body { margin: 0 !important; padding: 0 !important; height: ${g.H}px !important; box-sizing: border-box; color: ${fg} !important; background: ${bg} !important;
        column-width: ${g.col}px !important; column-gap: ${g.gap}px !important; column-fill: auto !important; overflow: visible !important; max-width: none !important; width: auto !important;
        ${FONTS[r.font] ? `font-family: ${FONTS[r.font]} !important;` : ''} line-height: 1.6; text-align: start; word-wrap: break-word; hyphens: auto; }
      body * { color: inherit !important; background-color: transparent !important; ${FONTS[r.font] ? `font-family: inherit !important;` : ''} max-width: 100% !important; }
      img, svg, video, image { max-width: 100% !important; max-height: ${Math.floor(g.H * 0.94)}px !important; height: auto !important; object-fit: contain; break-inside: avoid; }
      a { color: ${r.theme === 'dark' ? '#7fdcdc' : '#1f5fbf'} !important; }
      p { orphans: 2; widows: 2; } h1, h2, h3 { break-after: avoid; }`;
    const total = dc.body.scrollWidth;
    r.pages = Math.max(1, Math.round((total + g.gap) / g.step));
    r.step = g.step;
  };
  const show = (anim = false) => {
    r.page = Math.max(0, Math.min(r.pages - 1, r.page));
    const dc = doc();
    if (dc?.body) { dc.body.style.transition = anim && !calm() ? 'transform 0.28s cubic-bezier(0.3, 0.7, 0.2, 1)' : 'none'; dc.body.style.transform = `translateX(${-r.page * r.step}px)`; }
    const pos = r.chapter * 100 + Math.round((r.pages > 1 ? r.page / (r.pages - 1) : 0) * 99);
    range.value = String(pos); range.style.setProperty('--p', `${(pos / Math.max(1, d.spine.length * 100)) * 100}%`);
    const toc = [...d.toc].reverse().find((t) => d.spine.indexOf(t.href.split('#')[0]) <= r.chapter && d.spine.indexOf(t.href.split('#')[0]) >= 0);
    const pct = Math.round(((r.chapter + (r.pages > 1 ? r.page / (r.pages - 1) : 1)) / d.spine.length) * 100);
    $('.rd-where', el).textContent = `${toc ? `${toc.label} · ` : ''}${Math.min(100, pct)}%`;
    r.save();
  };
  const load = (idx, target = 0) => new Promise((resolve) => {
    r.chapter = Math.max(0, Math.min(d.spine.length - 1, idx));
    el.classList.add('loading');
    frameEl.onload = () => {
      const dc = doc();
      layout();
      // Fonts and pictures change the length of a chapter once they arrive.
      const settle = () => { const keep = r.pages > 1 ? r.page / (r.pages - 1) : 0; layout(); r.page = Math.round(keep * (r.pages - 1)); show(); };
      dc?.fonts?.ready?.then(settle);
      for (const im of dc?.images || []) if (!im.complete) im.addEventListener('load', settle, { once: true });
      if (target === 'end') r.page = r.pages - 1;
      else if (typeof target === 'string' && target.startsWith('#')) {
        const node = dc?.getElementById(decodeURIComponent(target.slice(1)));
        r.page = node ? Math.floor((node.getBoundingClientRect().left + 1) / r.step) : 0;
      } else r.page = Math.round((+target || 0) * (r.pages - 1));
      show();
      dc?.addEventListener('keydown', (e) => r.onKey(e), true);
      dc?.addEventListener('click', (e) => {
        const a = e.target.closest?.('a[href]');
        if (a) {
          e.preventDefault();
          const u = new URL(a.getAttribute('href'), dc.location.href);
          if (u.origin !== location.origin) { window.open(u.href, '_blank', 'noopener'); return; }
          const rel = decodeURIComponent(u.pathname.slice(d.base.length));
          const i = d.spine.indexOf(rel);
          if (i >= 0) load(i, u.hash || 0);
          return;
        }
        const x = (e.clientX + frameEl.getBoundingClientRect().left) / innerWidth;
        if (x < 0.28) r.turn(-1); else if (x > 0.72) r.turn(1); else showUi(r);
      });
      let sx = null;
      dc?.addEventListener('touchstart', (e) => { sx = e.touches[0].clientX; }, { passive: true });
      dc?.addEventListener('touchend', (e) => { if (sx == null) return; const dx = e.changedTouches[0].clientX - sx; if (Math.abs(dx) > 50) r.turn(dx < 0 ? 1 : -1); sx = null; });
      el.classList.remove('loading');
      resolve();
    };
    frameEl.src = d.base + d.spine[r.chapter].split('/').map(encodeURIComponent).join('/');
  });
  r.turn = (dir) => {
    if (dir > 0) { if (r.page < r.pages - 1) { r.page++; show(true); } else if (r.chapter < d.spine.length - 1) load(r.chapter + 1, 0); else if (!r.ended) { r.ended = true; r.save(true); toast(`You finished ${d.title}`); } }
    else if (r.page > 0) { r.page--; show(true); } else if (r.chapter > 0) load(r.chapter - 1, 'end');
  };
  r.goTo = (pos) => { const c = Math.min(d.spine.length - 1, Math.floor(pos)); if (c !== r.chapter) load(c, pos % 1); else { r.page = Math.round((pos % 1) * (r.pages - 1)); show(); } };
  r.jump = (v) => { const c = Math.min(d.spine.length - 1, Math.floor(v / 100)), f = (v % 100) / 99; if (c !== r.chapter) load(c, f); else { r.page = Math.round(f * (r.pages - 1)); show(); } };
  r.act = (a, btn) => {
    if (a === 'close') { history.back(); return; }
    if (a === 'toc') {
      panel(r, html`<h4>Contents</h4><div class="rd-toc">${(d.toc.length ? d.toc : d.spine.map((h, i) => ({ label: `Part ${i + 1}`, href: h }))).map((t) => {
        const i = d.spine.indexOf(t.href.split('#')[0]);
        return i < 0 ? '' : html`<button data-act="goto" data-i="${i}" data-hash="${t.href.includes('#') ? `#${t.href.split('#')[1]}` : ''}" class="${i === r.chapter ? 'on' : ''}">${t.label}</button>`;
      })}</div>`);
      return;
    }
    if (a === 'goto') { panel(r, null); load(+btn.dataset.i, btn.dataset.hash || 0); return; }
    if (a === 'type') {
      panel(r, html`<h4>Text size</h4><div class="seg"><button data-act="size" data-v="-10" aria-label="Smaller">A−</button><span class="rd-size">${r.size}%</span><button data-act="size" data-v="10" aria-label="Larger">A+</button></div>
        <h4>Typeface</h4><div class="seg">${[['publisher', 'Book’s own'], ['serif', 'Serif'], ['sans', 'Sans']].map(([k, n]) => html`<button data-act="font" data-v="${k}" class="${r.font === k ? 'on' : ''}">${n}</button>`)}</div>
        <h4>Colours</h4><div class="seg">${[['dark', 'Dark'], ['sepia', 'Sepia'], ['light', 'Light']].map(([k, n]) => html`<button data-act="theme" data-v="${k}" class="sw-${k} ${r.theme === k ? 'on' : ''}">${n}</button>`)}</div>${warmHtml(r)}`);
      return;
    }
    const keep = r.pages > 1 ? r.page / (r.pages - 1) : 0;
    if (a === 'size') { r.size = Math.max(70, Math.min(220, r.size + +btn.dataset.v)); setPref('size', r.size); const s = $('.rd-size', el); if (s) s.textContent = `${r.size}%`; }
    if (a === 'font') { r.font = btn.dataset.v; setPref('font', r.font); }
    if (a === 'theme') { r.theme = btn.dataset.v; setPref('theme', r.theme); }
    if (['font', 'theme'].includes(a)) for (const b of $$(`[data-act=${a}]`, el)) b.classList.toggle('on', b === btn);
    if (['size', 'font', 'theme'].includes(a)) { layout(); r.page = Math.round(keep * (r.pages - 1)); show(); }
  };
  let rt;
  r.onResize = () => { clearTimeout(rt); rt = setTimeout(() => { const keep = r.pages > 1 ? r.page / (r.pages - 1) : 0; layout(); r.page = Math.round(keep * (r.pages - 1)); show(); }, 150); };
  addEventListener('resize', r.onResize);
  common(r);
  const p = d.progress;
  const start = p && !p.finished ? p.position : 0;
  load(Math.floor(start), start % 1);
}
