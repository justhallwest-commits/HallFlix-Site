// The comic and PDF reader. Four ways to read:
//  - Automatic / one page / two pages: page by page; two-page spreads keep the cover alone and give wide (double-page)
//    art a screen of its own, with an optional spine shadow like a printed book.
//  - Vertical scroll: every page in one long strip, for webtoons and manhwa (picked automatically for very tall pages).
//  - Panel by panel: zooms from panel to panel, like guided view in the big comic apps. Panels are found by looking
//    for the gutters between them, so it needs no extra data in the file.
// Plus zoom (double-tap, pinch, ctrl+wheel, + and -), a thumbnail strip and a page grid, a jump-back button, time left,
// per-series settings, brightness, background colour, night warmth, and full screen. Pages are fetched at the size the
// screen needs (the server keeps small copies), so a TV or phone isn't sent 6000-pixel scans.
import { $, $$, api, html, raw, icons, toast } from './core.js';

const BUCKETS = [240, 480, 720, 1080, 1440, 2048];
const S = (d, fill = false) => raw(`<svg viewBox="0 0 24 24" fill="${fill ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`);
const ICON = {
  auto: S('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M12 5v14" stroke-dasharray="2 2.5"/>'),
  single: S('<rect x="6" y="3" width="12" height="18" rx="2"/>'),
  double: S('<rect x="2.5" y="4" width="9" height="16" rx="1.5"/><rect x="12.5" y="4" width="9" height="16" rx="1.5"/>'),
  scroll: S('<rect x="7" y="2" width="10" height="9" rx="1.5"/><rect x="7" y="13" width="10" height="9" rx="1.5"/>'),
  panels: S('<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 10h18M12 10v11"/><rect x="13.5" y="12" width="6" height="7.5" rx="1" fill="currentColor" stroke="none" opacity=".55"/>'),
  grid: S('<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/>'),
  full: S('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'),
  prev: S('<path d="M18 6 10 12l8 6V6zM6 6v12"/>', true), next: S('<path d="M6 6l8 6-8 6V6zM18 6v12"/>', true),
  undo: S('<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>'),
  zoom: S('<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4M8 11h6M11 8v6"/>'),
  help: S('<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.6v.4M12 17v.5"/>'),
};
const MODE_NAMES = { auto: 'Automatic', single: 'One page', double: 'Two pages', scroll: 'Vertical scroll', panels: 'Panel by panel' };
const BG = { black: '#050507', gray: '#2a2a2e', white: '#f4f4f4', theme: '' };
const json = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const keep = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } };
const DEFAULTS = { mode: 'auto', fit: 'screen', bg: 'black', bright: 100, spine: true, cover: true, scrollW: 100, gap: false, wholeFirst: true };

export function comicReader(el, d, kit) {
  const { frame, common, panel, showUi, endCard, calm } = kit;
  const seriesKey = `hf_cmx_s${d.series?.id || `i${d.id}`}`;
  const defaults = { ...DEFAULTS, ...json('hf_cmx_def', {}) };
  const series = json(seriesKey, null);
  const total = d.pages;
  frame(el, d, html`<button class="rd-btn" data-act="mode" aria-label="Reading mode" title="Reading mode"></button>
    ${document.fullscreenEnabled && !document.body.classList.contains('tv') ? html`<button class="rd-btn" data-act="fullscreen" aria-label="Full screen" title="Full screen">${ICON.full}</button>` : ''}
    <button class="rd-btn" data-act="settings" aria-label="Reading options" title="Reading options">${icons.gear}</button>`);
  const r = {
    el, d, page: 0, view: 0, zoom: 1, tx: 0, ty: 0, panel: -1, panels: null, ownGestures: true,
    rtl: series?.rtl ?? !!d.rtl, mode: series?.mode || defaults.mode, fit: series?.fit || defaults.fit,
    bg: defaults.bg, bright: defaults.bright, spine: defaults.spine, cover: series?.cover ?? defaults.cover, scrollW: defaults.scrollW, gap: defaults.gap, wholeFirst: defaults.wholeFirst,
    sizes: Array.from({ length: total }, () => null), chosen: !!series?.mode, times: [], turnedAt: Date.now(),
  };
  kit.claim(r);
  el.classList.add('mode-pages', 'cx');
  const title = $('.rd-title b', el);
  if (d.number != null && d.series?.title && !String(d.title).includes(`#${d.number}`)) title.textContent = `${d.series.title} #${d.number} · ${d.title}`;
  const stage = $('.rd-stage', el);
  const range = $('.rd-range', el);
  range.max = String(total);
  const bottom = $('.rd-bottom', el);
  bottom.insertAdjacentHTML('afterbegin', String(html`<div class="cx-strip" role="listbox" aria-label="Pages">${Array.from({ length: total }, (_, i) => html`<button data-act="thumb" data-n="${i}" aria-label="Page ${i + 1}"><img loading="lazy" decoding="async" alt="" data-src="${src(i, 240, true)}"><span>${i + 1}</span></button>`)}</div>`));
  const row = document.createElement('div');
  row.className = 'cx-row';
  row.append(...[...bottom.children].filter((c) => !c.classList.contains('cx-strip')));
  row.insertAdjacentHTML('afterbegin', String(html`<button class="rd-btn sm" data-act="previssue" aria-label="Previous issue" title="${d.prev ? `Previous: ${d.prev.title}` : 'No previous issue'}" ${d.prev ? '' : 'disabled'}>${ICON.prev}</button>`));
  row.insertAdjacentHTML('beforeend', String(html`<button class="rd-btn sm" data-act="grid" aria-label="All pages" title="All pages">${ICON.grid}</button>
    <button class="rd-btn sm" data-act="nextissue" aria-label="Next issue" title="${d.next ? `Next: ${d.next.title}` : 'No next issue'}" ${d.next ? '' : 'disabled'}>${ICON.next}</button>`));
  bottom.append(row);
  $('.rd-top', el).insertAdjacentHTML('afterend', '<button class="cx-back" data-act="jumpback" hidden></button>');
  const strip = $('.cx-strip', el);

  // ---------- sizes and URLs ----------
  function src(i, w, exact = false) {
    const n = i + 1, base = `/api/read/${d.id}/page/${n}`;
    if (exact) return `${base}?w=${w}`;
    const want = BUCKETS.find((b) => b >= w) || 0;
    const orig = d.pdf ? 1800 : r.sizes[i]?.[0];
    if (!want || (orig && orig <= want * 1.15)) return base;
    return `${base}?w=${want}`;
  }
  const dpr = () => Math.min(2.5, window.devicePixelRatio || 1);
  const aspect = (i) => { const s = r.sizes[i]; return s && s[0] > 0 && s[1] > 0 ? s[0] / s[1] : 0.66; };
  const wide = (i) => aspect(i) > 1.05;
  const isTall = () => { const known = r.sizes.filter(Boolean); if (known.length < 3) return false; const a = known.map((s) => s[1] / s[0]).sort((x, y) => x - y); return a[a.length >> 1] > 2.0; };
  const landscape = () => innerWidth > innerHeight * 1.15;
  const effMode = () => (r.mode === 'auto' ? (landscape() && r.fit === 'screen' ? 'double' : 'single') : r.mode);

  // ---------- views: what one screen shows ----------
  let views = [], pageView = [];
  function buildViews() {
    views = [];
    if (effMode() === 'double') {
      let i = 0;
      if (r.cover && total > 1) { views.push([0]); i = 1; }
      while (i < total) {
        if (wide(i) || i === total - 1 || wide(i + 1)) { views.push([i]); i++; } else { views.push([i, i + 1]); i += 2; }
      }
    } else for (let i = 0; i < total; i++) views.push([i]);
    pageView = new Array(total);
    views.forEach((v, k) => { for (const p of v) pageView[p] = k; });
  }

  // ---------- drawing ----------
  let scroller = null, tailer = null;
  function apply() {
    const m = effMode();
    el.dataset.mode = m;
    el.dataset.fit = m === 'scroll' ? 'strip' : m === 'panels' ? 'screen' : r.fit;
    el.style.setProperty('--rd-bg', BG[r.bg] || 'var(--bg)');
    el.style.setProperty('--cx-bright', `${r.bright / 100}`);
    el.classList.toggle('cx-light', r.bg === 'white');
    stage.classList.toggle('rtl', r.rtl);
    range.classList.toggle('rtl', r.rtl);
    strip.classList.toggle('rtl', r.rtl);
    $('[data-act=mode]', el).innerHTML = String(ICON[r.mode] || ICON.auto);
    $('[data-act=mode]', el).title = `Reading mode: ${MODE_NAMES[r.mode]}`;
  }
  function draw({ anim = 0 } = {}) {
    apply();
    buildViews();
    r.page = Math.max(0, Math.min(total - 1, r.page));
    resetZoom(false);
    if (effMode() === 'scroll') return drawScroll();
    scroller?.disconnect(); scroller = null; tailer?.disconnect(); tailer = null;
    r.view = pageView[r.page];
    const v = views[r.view];
    r.page = v[0];
    const sw = stage.clientWidth, sh = stage.clientHeight;
    const per = v.length;
    const widthFor = (i) => {
      if (r.fit === 'width') return sw / per;
      if (r.fit === 'height') return sh * aspect(i);
      if (r.fit === 'original') return 99999;
      return Math.min(sw / per, sh * aspect(i));
    };
    stage.innerHTML = String(html`<div class="cx-spread ${per === 2 ? 'two' : ''} ${per === 2 && r.spine ? 'spine' : ''}">${v.map((i) => html`<img class="cx-pg" data-n="${i}" src="${src(i, widthFor(i) * dpr() * (effMode() === 'panels' ? 1.8 : 1))}" alt="Page ${i + 1}" draggable="false" style="--ar:${aspect(i)}">`)}${effMode() === 'panels' ? raw('<div class="cx-mask" hidden></div>') : ''}</div>`);
    stage.scrollTop = 0; stage.scrollLeft = r.rtl ? stage.scrollWidth : 0;
    for (const img of $$('.cx-pg', stage)) img.addEventListener('load', () => learn(img), { once: true });
    if (anim && !calm()) { const fwd = (anim > 0) !== r.rtl; stage.classList.remove('turn-f', 'turn-b'); void stage.offsetWidth; stage.classList.add(fwd ? 'turn-f' : 'turn-b'); }
    if (effMode() === 'panels') startPanels(anim < 0);
    preload(v);
    el.classList.remove('loading');
    status();
  }
  /** A picture that loaded tells us its real shape if the server didn't. */
  function learn(img) {
    const i = +img.dataset.n;
    if (!r.sizes[i] && img.naturalWidth) {
      const was = wide(i);
      r.sizes[i] = [img.naturalWidth, img.naturalHeight];
      if (was !== wide(i) && effMode() === 'double') draw();
    }
  }
  function preload(v) {
    const ahead = [Math.max(...v) + 1, Math.max(...v) + 2, Math.max(...v) + 3, Math.min(...v) - 1].filter((n) => n >= 0 && n < total);
    const sw = stage.clientWidth, sh = stage.clientHeight;
    for (const i of ahead) { const im = new Image(); im.decoding = 'async'; im.src = src(i, Math.min(sw / v.length, sh * aspect(i)) * dpr()); }
  }

  // ---------- vertical scroll ----------
  let tops = [];
  function drawScroll() {
    const colW = Math.min(stage.clientWidth, 1000) * (r.scrollW / 100);
    stage.innerHTML = String(html`<div class="cx-scroll ${r.gap ? 'gap' : ''}" style="--cw-n:${r.scrollW / 100}">${Array.from({ length: total }, (_, i) => html`<div class="cx-cell" data-n="${i}" style="aspect-ratio:${r.sizes[i] ? `${r.sizes[i][0]} / ${r.sizes[i][1]}` : '2 / 3'}"><img class="cx-pg" data-n="${i}" data-src="${src(i, colW * dpr())}" alt="Page ${i + 1}" draggable="false"></div>`)}
      <div class="cx-tail">${d.next ? html`<a class="cx-nextcard" href="#/read/${d.next.id}" data-act="nextissue"><img src="/api/cover/${d.next.id}" alt="" onerror="this.remove()"><span><small>Up next</small><b>${d.next.title}</b></span></a>` : html`<p>The end of ${d.title}.</p>`}</div></div>`);
    const box = $('.cx-scroll', stage);
    scroller?.disconnect();
    scroller = new IntersectionObserver((entries) => {
      for (const en of entries) {
        if (!en.isIntersecting) continue;
        const img = $('img', en.target);
        if (img?.dataset.src) { img.src = img.dataset.src; delete img.dataset.src; img.addEventListener('load', () => { learn(img); const s = r.sizes[+img.dataset.n]; if (s) en.target.style.aspectRatio = `${s[0]} / ${s[1]}`; measure(); }, { once: true }); }
      }
    }, { root: stage, rootMargin: '200% 0px' });
    for (const c of $$('.cx-cell', box)) scroller.observe(c);
    tailer?.disconnect();
    tailer = new IntersectionObserver(([en]) => { if (en.isIntersecting && !r.ended) { r.ended = true; r.page = total - 1; status(); r.save(true); } }, { root: stage, threshold: 0.6 });
    tailer.observe($('.cx-tail', box));
    measure();
    const cell = $(`.cx-cell[data-n="${r.page}"]`, box);
    stage.scrollTop = cell ? cell.offsetTop : 0;
    el.classList.remove('loading');
    status();
  }
  const measure = () => { tops = $$('.cx-cell', stage).map((c) => c.offsetTop); };
  let ticking = false;
  stage.addEventListener('scroll', () => {
    if (effMode() !== 'scroll' || ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      if (!tops.length) measure();
      const y = stage.scrollTop + stage.clientHeight * 0.35;
      let lo = 0, hi = tops.length - 1;
      while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (tops[mid] <= y) lo = mid; else hi = mid - 1; }
      if (lo !== r.page) { noteTurn(); r.page = lo; status(); }
    });
  }, { passive: true });

  // ---------- panel by panel ----------
  const panelCache = new Map();
  function startPanels(fromEnd) {
    const img = $('.cx-pg', stage);
    r.panels = null;
    const go = () => {
      r.panels = findPanels(img, r.rtl);
      r.panel = fromEnd ? r.panels.length - 1 : r.wholeFirst || r.panels.length < 2 ? -1 : 0;
      showPanel(false);
    };
    if (img.complete && img.naturalWidth) go(); else img.addEventListener('load', go, { once: true });
  }
  function findPanels(img, rtl) {
    const key = `${img.currentSrc}|${rtl}`;
    if (panelCache.has(key)) return panelCache.get(key);
    let out = [];
    try { out = detectPanels(img, rtl); } catch { out = []; }
    panelCache.set(key, out);
    return out;
  }
  function showPanel(anim = true) {
    const sp = $('.cx-spread', stage), mask = $('.cx-mask', stage), img = $('.cx-pg', stage);
    if (!sp || !img) return;
    sp.style.transition = anim && !calm() ? 'transform 0.45s cubic-bezier(.3,.7,.2,1)' : 'none';
    const p = r.panels?.[r.panel];
    if (!p) { mask.hidden = true; setTransform(1, 0, 0); status(); return; }
    const W = img.offsetWidth, H = img.offsetHeight, ox = img.offsetLeft, oy = img.offsetTop;
    const pw = p.w * W, ph = p.h * H;
    const z = Math.min(6, (stage.clientWidth * 0.94) / pw, (stage.clientHeight * 0.92) / ph);
    const cx = ox + (p.x + p.w / 2) * W, cy = oy + (p.y + p.h / 2) * H;
    setTransform(z, stage.clientWidth / 2 - sp.offsetLeft - cx * z, stage.clientHeight / 2 - sp.offsetTop - cy * z);
    Object.assign(mask.style, { left: `${ox + p.x * W}px`, top: `${oy + p.y * H}px`, width: `${pw}px`, height: `${ph}px` });
    mask.hidden = false;
    status();
  }

  // ---------- zoom and pan ----------
  function setTransform(z, tx, ty) {
    r.zoom = z; r.tx = tx; r.ty = ty;
    const sp = $('.cx-spread', stage);
    if (sp) sp.style.transform = z === 1 && !tx && !ty ? '' : `translate(${tx}px, ${ty}px) scale(${z})`;
    el.classList.toggle('zoomed', z > 1.01);
  }
  function resetZoom(anim = true) {
    const sp = $('.cx-spread', stage);
    if (sp) sp.style.transition = anim && !calm() ? 'transform 0.25s ease' : 'none';
    setTransform(1, 0, 0);
  }
  const canZoom = () => effMode() !== 'scroll' && effMode() !== 'panels' && r.fit === 'screen';
  function clampPan(z, tx, ty) {
    const sp = $('.cx-spread', stage);
    if (!sp) return [tx, ty];
    const W = sp.offsetWidth * z, H = sp.offsetHeight * z, sw = stage.clientWidth, sh = stage.clientHeight, x0 = sp.offsetLeft, y0 = sp.offsetTop;
    const fix = (t, size, view, at) => (size <= view ? (view - size) / 2 - at : Math.min(-at, Math.max(view - at - size, t)));
    return [fix(tx, W, sw, x0), fix(ty, H, sh, y0)];
  }
  function zoomAt(z, px, py, anim = false) {
    if (!canZoom()) return;
    const sp = $('.cx-spread', stage);
    if (!sp) return;
    z = Math.max(1, Math.min(5, z));
    const rect = stage.getBoundingClientRect();
    const x = px - rect.left, y = py - rect.top;
    const qx = (x - sp.offsetLeft - r.tx) / r.zoom, qy = (y - sp.offsetTop - r.ty) / r.zoom;
    const [tx, ty] = z === 1 ? [0, 0] : clampPan(z, x - sp.offsetLeft - z * qx, y - sp.offsetTop - z * qy);
    sp.style.transition = anim && !calm() ? 'transform 0.25s ease' : 'none';
    setTransform(z, tx, ty);
    // Sharper pictures once zoomed in.
    if (z > 1.3) for (const img of $$('.cx-pg', stage)) { const full = `/api/read/${d.id}/page/${+img.dataset.n + 1}`; if (!img.src.endsWith(full)) img.src = full; }
  }
  r.zoomed = () => r.zoom > 1.01;

  // Pointer gestures: drag to pan when zoomed, pinch to zoom, swipe to turn.
  const pts = new Map();
  let g = null;
  stage.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 1) g = { x: e.clientX, y: e.clientY, tx: r.tx, ty: r.ty, t: Date.now(), moved: false, pinch: null };
    else if (pts.size === 2 && g) {
      const [a, b] = [...pts.values()];
      g.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: r.zoom };
      g.moved = true;
    }
  });
  stage.addEventListener('pointermove', (e) => {
    if (!g || !pts.has(e.pointerId)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (g.pinch && pts.size === 2) {
      const [a, b] = [...pts.values()];
      zoomAt(g.pinch.z * (Math.hypot(a.x - b.x, a.y - b.y) / g.pinch.d), (a.x + b.x) / 2, (a.y + b.y) / 2);
      return;
    }
    const dx = e.clientX - g.x, dy = e.clientY - g.y;
    if (Math.abs(dx) + Math.abs(dy) > 6) g.moved = true;
    if (r.zoomed() && g.moved && canZoom()) {
      const [tx, ty] = clampPan(r.zoom, g.tx + dx, g.ty + dy);
      $('.cx-spread', stage).style.transition = 'none';
      setTransform(r.zoom, tx, ty);
    }
  });
  const up = (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.delete(e.pointerId);
    if (pts.size || !g) return;
    const dx = e.clientX - g.x, dy = e.clientY - g.y, quick = Date.now() - g.t < 700;
    // Swipe sideways to turn (vertical scroll mode scrolls instead). A swipe toward the left goes forward, mirrored for manga.
    if (!g.pinch && !r.zoomed() && effMode() !== 'scroll' && quick && Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.4 && (e.pointerType !== 'mouse')) {
      r.turn((dx < 0) !== r.rtl ? 1 : -1);
    }
    r.dragged = g.moved;
    g = null;
  };
  stage.addEventListener('pointerup', up);
  stage.addEventListener('pointercancel', up);
  stage.addEventListener('wheel', (e) => {
    if (e.ctrlKey || e.metaKey) { e.preventDefault(); zoomAt(r.zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15), e.clientX, e.clientY); return; }
    if (effMode() === 'scroll' || r.zoomed() || stage.scrollHeight > stage.clientHeight + 4 || stage.scrollWidth > stage.clientWidth + 4) return;
    e.preventDefault();
    r.wheel = (r.wheel || 0) + e.deltaY;
    if (Math.abs(r.wheel) > 60 && Date.now() - (r.wheelAt || 0) > 350) { r.turn(r.wheel > 0 ? 1 : -1); r.wheel = 0; r.wheelAt = Date.now(); }
  }, { passive: false });

  // Taps: the outer thirds turn the page (mirrored for manga), the middle shows the controls; double-tap zooms.
  let tapTimer = 0, lastTap = 0;
  r.tap = (e) => {
    if (r.dragged) { r.dragged = false; return; }
    const x = e.clientX / innerWidth, now = Date.now();
    if (now - lastTap < 300 && canZoom()) { clearTimeout(tapTimer); lastTap = 0; zoomAt(r.zoomed() ? 1 : 2.5, e.clientX, e.clientY, true); return; }
    lastTap = now;
    if (r.zoomed()) return;
    if (x < 0.3 || x > 0.7) { const left = x < 0.3; r.turn(left !== r.rtl ? -1 : 1); return; }
    clearTimeout(tapTimer);
    tapTimer = setTimeout(() => showUi(r), canZoom() ? 260 : 0);
  };

  // ---------- moving through ----------
  function noteTurn() {
    const now = Date.now(), dt = (now - r.turnedAt) / 1000;
    r.turnedAt = now;
    if (dt > 2 && dt < 150) { r.times.push(dt); if (r.times.length > 12) r.times.shift(); }
  }
  r.count = () => total;
  r.where = () => {
    const shown = effMode() === 'scroll' ? [r.page] : views[r.view] || [r.page];
    return { position: Math.max(...shown) + 1, duration: total };
  };
  r.turn = (dir) => {
    if (effMode() === 'scroll') { stage.scrollBy({ top: dir * stage.clientHeight * 0.85, behavior: calm() ? 'auto' : 'smooth' }); return; }
    if (effMode() === 'panels' && r.panels) {
      const n = r.panel + dir;
      if (n >= (r.wholeFirst && r.panels.length > 1 ? -1 : 0) && n < r.panels.length) { r.panel = n; showPanel(); return; }
    }
    if (r.zoomed() && effMode() !== 'panels') resetZoom();
    const to = r.view + dir;
    if (to >= views.length) { r.page = total - 1; r.save(true); endCard(r); return; }
    if (to < 0) return;
    $('.rd-end', el).hidden = true;
    noteTurn();
    r.page = views[to][0];
    draw({ anim: dir });
  };
  r.jump = (n, remember = true) => {
    const from = r.page;
    r.page = Math.max(0, Math.min(total - 1, n - 1));
    $('.rd-end', el).hidden = true;
    if (remember && Math.abs(r.page - from) > 2) offerBack(from);
    draw();
  };
  r.goTo = (pos) => r.jump(Math.floor(pos));
  r.scroll = (dir) => {
    if (effMode() === 'scroll') { r.turn(dir); return true; }
    if (r.fit !== 'width' && r.fit !== 'original') return null;
    const max = stage.scrollHeight - stage.clientHeight;
    if ((dir > 0 && stage.scrollTop >= max - 2) || (dir < 0 && stage.scrollTop <= 2)) { r.turn(dir); if (dir < 0) stage.scrollTop = stage.scrollHeight; return true; }
    stage.scrollBy({ top: dir * stage.clientHeight * 0.8, behavior: calm() ? 'auto' : 'smooth' });
    return true;
  };
  function offerBack(from) {
    const b = $('.cx-back', el);
    if (!b.hidden && Date.now() - (r.backAt || 0) < 2000) { r.backAt = Date.now(); return; } // still dragging the slider
    r.backAt = Date.now();
    b.innerHTML = String(html`${ICON.undo} Back to page ${from + 1}`);
    b.dataset.n = String(from + 1);
    b.hidden = false;
    clearTimeout(r.backTimer);
    r.backTimer = setTimeout(() => { b.hidden = true; }, 9000);
  }

  // The page counter, the slider, the strip and time left.
  function status() {
    const shown = effMode() === 'scroll' ? [r.page] : views[r.view] || [r.page];
    const lo = Math.min(...shown) + 1, hi = Math.max(...shown) + 1;
    range.value = String(hi);
    range.style.setProperty('--p', `${((hi - 1) / Math.max(1, total - 1)) * 100}%`);
    let txt = lo === hi ? `Page ${lo} of ${total}` : `Pages ${lo}–${hi} of ${total}`;
    if (effMode() === 'panels' && r.panels?.length > 1 && r.panel >= 0) txt += ` · panel ${r.panel + 1}/${r.panels.length}`;
    if (r.times.length >= 3 && hi < total) {
      const avg = r.times.reduce((a, b) => a + b, 0) / r.times.length, mins = Math.round(((total - hi) * avg) / 60);
      txt += mins >= 1 ? ` · ${mins} min left` : ' · under a minute left';
    }
    $('.rd-where', el).textContent = txt;
    for (const b of $$('.cx-strip .on', el)) b.classList.remove('on');
    for (const p of shown) strip.children[p]?.classList.add('on');
    if (el.classList.contains('ui')) centerStrip();
    r.save();
  }
  function centerStrip() {
    const b = strip.children[r.page];
    if (!b) return;
    for (const img of $$('img[data-src]', strip)) { const bx = img.parentElement.offsetLeft; if (Math.abs(bx - b.offsetLeft) < strip.clientWidth * 1.5) { img.src = img.dataset.src; delete img.dataset.src; } }
    strip.scrollTo({ left: b.offsetLeft - strip.clientWidth / 2 + b.offsetWidth / 2, behavior: calm() ? 'auto' : 'smooth' });
  }
  const watcher = new MutationObserver(() => { if (el.classList.contains('ui')) centerStrip(); });
  watcher.observe(el, { attributes: true, attributeFilter: ['class'] });
  strip.addEventListener('scroll', () => {
    for (const img of $$('img[data-src]', strip)) { const bx = img.parentElement.offsetLeft - strip.scrollLeft; if (bx > -300 && bx < strip.clientWidth + 600) { img.src = img.dataset.src; delete img.dataset.src; } }
  }, { passive: true });

  // ---------- settings ----------
  const save = () => keep(seriesKey, { mode: r.chosen ? r.mode : undefined, fit: r.fit, rtl: r.rtl, cover: r.cover });
  const look = () => keep('hf_cmx_def', { ...json('hf_cmx_def', {}), bg: r.bg, bright: r.bright, spine: r.spine, scrollW: r.scrollW, gap: r.gap, wholeFirst: r.wholeFirst });
  const seg = (act, list, cur) => html`<div class="seg">${list.map(([v, name, ic]) => html`<button data-act="${act}" data-v="${v}" class="${String(cur) === String(v) ? 'on' : ''}">${ic ? ICON[ic] : ''}${name}</button>`)}</div>`;
  function settings() {
    const m = r.mode, e = effMode();
    panel(r, html`<h4>Reading mode</h4>${seg('setmode', [['auto', 'Automatic', 'auto'], ['single', 'One page', 'single'], ['double', 'Two pages', 'double'], ['scroll', 'Vertical', 'scroll'], ['panels', 'Panels', 'panels']], m)}
      <p class="cx-hint">${{ auto: 'Two pages side by side on a wide screen, one on a tall one.', single: 'One page at a time.', double: 'Two pages side by side, the cover on its own. Double-page art gets the whole screen.', scroll: 'One long strip, for webtoons and manhwa.', panels: 'Zooms from panel to panel, like guided view. Best on phones.' }[m]}</p>
      <h4>Reading direction</h4>${seg('dir', [['0', 'Left to right'], ['1', 'Right to left (manga)']], r.rtl ? '1' : '0')}
      ${e === 'scroll' ? html`<h4>Strip width</h4><label class="rd-warmrow"><input type="range" min="30" max="100" step="5" value="${r.scrollW}" data-cx="scrollW" aria-label="Strip width"><span>${r.scrollW}%</span></label>
        <label class="cx-check"><input type="checkbox" data-cx="gap" ${r.gap ? 'checked' : ''}> A gap between pages</label>`
      : e === 'panels' ? html`<label class="cx-check"><input type="checkbox" data-cx="wholeFirst" ${r.wholeFirst ? 'checked' : ''}> Show the whole page before its panels</label>`
        : html`<h4>Page fit</h4>${seg('fit', [['screen', 'Whole page'], ['width', 'Width'], ['height', 'Height'], ['original', 'Actual size']], r.fit)}`}
      ${e === 'double' || m === 'auto' ? html`<label class="cx-check"><input type="checkbox" data-cx="cover" ${r.cover ? 'checked' : ''}> Cover on its own (turn off if the pages pair up wrong)</label>
        <label class="cx-check"><input type="checkbox" data-cx="spine" ${r.spine ? 'checked' : ''}> Spine shadow between pages</label>` : ''}
      <h4>Background</h4>${seg('bg', [['black', 'Black'], ['gray', 'Grey'], ['white', 'White'], ['theme', 'Theme']], r.bg)}
      <h4>Brightness</h4><label class="rd-warmrow"><input type="range" min="40" max="100" step="5" value="${r.bright}" data-cx="bright" aria-label="Brightness"><span>${r.bright}%</span></label>
      ${kit.warmHtml(r)}
      <div class="cx-foot"><button data-act="makedefault" class="rd-add">${icons.check} Use this mode and fit for every comic</button><button data-act="help" class="cx-link">${ICON.help} Keys and gestures</button></div>`);
  }
  function help() {
    panel(r, html`<h4>Keys</h4><dl class="cx-keys">
      <dt>→ ← Space</dt><dd>Next and previous page (mirrored for manga)</dd><dt>↓ ↑</dt><dd>Scroll the page, then turn</dd>
      <dt>+ − 0</dt><dd>Zoom in, out, reset</dd><dt>M</dt><dd>Next reading mode</dd><dt>T</dt><dd>All pages</dd><dt>F</dt><dd>Full screen</dd>
      <dt>[ ]</dt><dd>Previous and next issue</dd><dt>B</dt><dd>Bookmark this page</dd><dt>Home End</dt><dd>First and last page</dd></dl>
      <h4>Touch and mouse</h4><dl class="cx-keys"><dt>Tap the edges</dt><dd>Turn the page</dd><dt>Tap the middle</dt><dd>Show the controls</dd><dt>Double-tap</dt><dd>Zoom in and out</dd>
      <dt>Pinch, Ctrl + wheel</dt><dd>Zoom</dd><dt>Swipe</dt><dd>Turn the page</dd><dt>Wheel</dt><dd>Turn the page</dd></dl>`);
  }
  function grid() {
    panel(r, html`<div data-wide class="cx-grid">${Array.from({ length: total }, (_, i) => html`<button data-act="thumb" data-n="${i}" class="${i === r.page ? 'on' : ''}"><img loading="lazy" decoding="async" src="${src(i, 240, true)}" alt=""><span>${i + 1}</span></button>`)}</div>`);
    $('.cx-grid .on', el)?.scrollIntoView({ block: 'center' });
    $('.cx-grid .on', el)?.focus();
  }
  const ORDER = ['auto', 'single', 'double', 'scroll', 'panels'];
  function setMode(m) {
    const keepPage = r.page;
    r.mode = m; r.chosen = true; save();
    r.page = keepPage;
    draw();
    toast(MODE_NAMES[m], 1400);
  }
  function issue(n) {
    if (!n) return;
    r.save(true);
    history.replaceState(null, '', `#/read/${n.id}`);
    kit.open(n.id);
  }
  r.act = (a, btn) => {
    if (a === 'close') { history.back(); return; }
    if (a === 'settings') return settings();
    if (a === 'help') return help();
    if (a === 'grid') return grid();
    if (a === 'mode') return setMode(ORDER[(ORDER.indexOf(r.mode) + 1) % ORDER.length]);
    if (a === 'fullscreen') { if (document.fullscreenElement) document.exitFullscreen(); else el.requestFullscreen?.().catch(() => {}); return; }
    if (a === 'thumb') { panel(r, null); r.jump(+btn.dataset.n + 1); return; }
    if (a === 'jumpback') { $('.cx-back', el).hidden = true; r.jump(+btn.dataset.n, false); return; }
    if (a === 'previssue') return issue(d.prev);
    if (a === 'nextissue') return issue(d.next);
    if (a === 'makedefault') { keep('hf_cmx_def', { ...json('hf_cmx_def', {}), mode: r.mode, fit: r.fit }); toast('Saved as your default'); return; }
    if (a === 'setmode') { setMode(btn.dataset.v); $('.rd-panel', el).hidden = true; settings(); return; }
    if (a === 'dir') { r.rtl = btn.dataset.v === '1'; save(); draw(); }
    if (a === 'fit') { r.fit = btn.dataset.v; save(); draw(); if (r.mode === 'auto') { $('.rd-panel', el).hidden = true; settings(); return; } }
    if (a === 'bg') { r.bg = btn.dataset.v; look(); apply(); }
    if (['dir', 'fit', 'bg'].includes(a)) for (const b of $$(`[data-act=${a}]`, el)) b.classList.toggle('on', b === btn);
  };
  el.addEventListener('input', (e) => {
    const k = e.target.dataset?.cx;
    if (!k) return;
    if (k === 'bright' || k === 'scrollW') {
      r[k] = +e.target.value; e.target.nextElementSibling.textContent = `${r[k]}%`; look();
      if (k === 'bright') apply(); else { clearTimeout(r.wt); r.wt = setTimeout(() => draw(), 200); }
    }
  });
  el.addEventListener('change', (e) => {
    const k = e.target.dataset?.cx;
    if (!k || e.target.type !== 'checkbox') return;
    r[k] = e.target.checked;
    if (k === 'cover') save(); else look();
    draw();
  });
  r.key = (e) => {
    const k = e.key;
    if (k === '+' || k === '=') { const s = stage.getBoundingClientRect(); zoomAt(r.zoom * 1.25, s.left + s.width / 2, s.top + s.height / 2, true); return true; }
    if (k === '-' || k === '_') { const s = stage.getBoundingClientRect(); zoomAt(r.zoom / 1.25, s.left + s.width / 2, s.top + s.height / 2, true); return true; }
    if (k === '0') { resetZoom(); return true; }
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    if (k === 'm' || k === 'M') { r.act('mode'); return true; }
    if (k === 't' || k === 'T') { showUi(r, true); grid(); return true; }
    if (k === 'f' || k === 'F') { r.act('fullscreen'); return true; }
    if (k === '?') { showUi(r, true); help(); return true; }
    if (k === '[') { issue(d.prev); return true; }
    if (k === ']') { issue(d.next); return true; }
    if (k === 'b' || k === 'B') { r.act('addmark'); return true; }
    // Zoomed in with the arrow keys: move around the page before turning it.
    if (r.zoomed() && canZoom() && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(k)) {
      const step = 120, dx = k === 'ArrowLeft' ? step : k === 'ArrowRight' ? -step : 0, dy = k === 'ArrowUp' ? step : k === 'ArrowDown' ? -step : 0;
      const [tx, ty] = clampPan(r.zoom, r.tx + dx, r.ty + dy);
      if (tx !== r.tx || ty !== r.ty) { $('.cx-spread', stage).style.transition = 'transform 0.15s'; setTransform(r.zoom, tx, ty); return true; }
      resetZoom();
    }
    return false;
  };
  r.onResize = () => { clearTimeout(r.rt); r.rt = setTimeout(() => { measure(); draw(); }, 150); };
  addEventListener('resize', r.onResize);
  r.destroy = () => { scroller?.disconnect(); tailer?.disconnect(); watcher.disconnect(); clearTimeout(r.backTimer); if (document.fullscreenElement === el) document.exitFullscreen().catch(() => {}); };
  common(r);

  // Start where the reader left off, then learn the page sizes and lay out again.
  const p = d.progress;
  r.page = p && !p.finished && p.position >= 1 ? Math.min(total, Math.floor(p.position)) - 1 : 0;
  draw();
  api('GET', `/api/read/${d.id}/pages`).then(({ sizes }) => {
    if (kit.current() !== r || !Array.isArray(sizes)) return;
    sizes.forEach((s, i) => { if (s && i < total) r.sizes[i] = s; });
    // Very tall pages are a webtoon: read them as one long strip unless this series has a mode already.
    if (!r.chosen && isTall()) { r.mode = 'scroll'; toast('Vertical scroll, for this webtoon', 2200); }
    draw();
  }).catch(() => {});
}

/**
 * Panels on a page, found by looking for gutters (rows or columns of plain background) and cutting along them,
 * across first, then down within each strip, a few levels deep. Returns boxes as fractions of the page, in
 * reading order. A page with no clear gutters comes back as no panels and is shown whole.
 */
export function detectPanels(img, rtl = false) {
  const W0 = img.naturalWidth, H0 = img.naturalHeight;
  if (!W0 || !H0) return [];
  const scale = Math.min(1, 480 / Math.max(W0, H0));
  const W = Math.max(1, Math.round(W0 * scale)), H = Math.max(1, Math.round(H0 * scale));
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, W, H);
  const px = ctx.getImageData(0, 0, W, H).data;
  const gray = new Uint8Array(W * H);
  for (let i = 0, j = 0; i < gray.length; i++, j += 4) gray[i] = (px[j] * 77 + px[j + 1] * 150 + px[j + 2] * 29) >> 8;
  // The gutter colour: the most common shade along the edges.
  const hist = new Uint32Array(256);
  for (let x = 0; x < W; x++) { hist[gray[x]]++; hist[gray[(H - 1) * W + x]]++; }
  for (let y = 0; y < H; y++) { hist[gray[y * W]]++; hist[gray[y * W + W - 1]]++; }
  let bg = 255, best = 0;
  for (let v = 0; v < 256; v++) { let s = 0; for (let k = Math.max(0, v - 8); k <= Math.min(255, v + 8); k++) s += hist[k]; if (s > best) { best = s; bg = v; } }
  const ink = new Uint8Array(W * H);
  for (let i = 0; i < ink.length; i++) ink[i] = Math.abs(gray[i] - bg) > 38 ? 1 : 0;
  const minGap = Math.max(2, Math.round(Math.min(W, H) * 0.008));
  const minSide = Math.min(W, H) * 0.08;

  const bounds = (x0, y0, x1, y1) => {
    let a = x1, b = y1, cx = x0 - 1, cy = y0 - 1;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (ink[y * W + x]) { if (x < a) a = x; if (x > cx) cx = x; if (y < b) b = y; if (y > cy) cy = y; }
    return cx < a ? null : [a, b, cx + 1, cy + 1];
  };
  /** Runs of near-empty lines across (horizontal) or down (vertical) a box. */
  const cuts = (x0, y0, x1, y1, across) => {
    const len = across ? y1 - y0 : x1 - x0, span = across ? x1 - x0 : y1 - y0;
    const empty = new Uint8Array(len);
    for (let k = 0; k < len; k++) {
      let n = 0;
      if (across) { const y = y0 + k; for (let x = x0; x < x1; x++) n += ink[y * W + x]; } else { const x = x0 + k; for (let y = y0; y < y1; y++) n += ink[y * W + x]; }
      empty[k] = n <= span * 0.012 ? 1 : 0;
    }
    const out = [];
    let start = -1;
    for (let k = 0; k <= len; k++) {
      if (k < len && empty[k]) { if (start < 0) start = k; } else if (start >= 0) { if (k - start >= minGap && start > 0 && k < len) out.push([start, k]); start = -1; }
    }
    return out;
  };
  const split = (box, across, depth, out) => {
    const b = bounds(...box);
    if (!b) return;
    const [x0, y0, x1, y1] = b;
    if (x1 - x0 < minSide || y1 - y0 < minSide) { if ((x1 - x0) * (y1 - y0) > W * H * 0.01) out.push(b); return; }
    const gaps = cuts(x0, y0, x1, y1, across);
    if (!gaps.length) {
      if (depth < 5) { const other = cuts(x0, y0, x1, y1, !across); if (other.length) return split(b, !across, depth + 1, out); }
      out.push(b); return;
    }
    const parts = [];
    let from = 0;
    for (const [s, e] of gaps) { parts.push([from, s]); from = e; }
    parts.push([from, across ? y1 - y0 : x1 - x0]);
    const ordered = !across && rtl ? parts.reverse() : parts;
    for (const [s, e] of ordered) {
      const sub = across ? [x0, y0 + s, x1, y0 + e] : [x0 + s, y0, x0 + e, y1];
      if (depth < 5) split(sub, !across, depth + 1, out); else { const bb = bounds(...sub); if (bb) out.push(bb); }
    }
  };
  const found = [];
  split([0, 0, W, H], true, 0, found);
  // Drop specks (page numbers, stray marks) and give each panel a little breathing room.
  const pad = Math.min(W, H) * 0.012;
  const panels = found.filter(([a, b, cx, cy]) => (cx - a) * (cy - b) >= W * H * 0.02)
    .map(([a, b, cx, cy]) => { const x = Math.max(0, a - pad), y = Math.max(0, b - pad), x2 = Math.min(W, cx + pad), y2 = Math.min(H, cy + pad); return { x: x / W, y: y / H, w: (x2 - x) / W, h: (y2 - y) / H }; });
  if (panels.length < 2) return [];
  // One panel covering nearly the whole page means the cut found nothing useful.
  if (panels.some((p) => p.w * p.h > 0.85)) return [];
  return panels;
}
