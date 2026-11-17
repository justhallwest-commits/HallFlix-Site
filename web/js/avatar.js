// Choosing a profile picture, in the app and in the Studio: upload one (drag and drop, paste, or the phone's camera),
// pick a ready-made character, or use artwork from your own library; then frame it by dragging and zooming.
// Resolves with { blob } for a new picture, { remove: true } to go back to the initial, or null if cancelled.

const CSS = `
.av-modal [hidden] { display: none !important; }
.av-modal { position: fixed; inset: 0; z-index: 400; display: grid; place-items: center; padding: 16px; background: rgba(4,3,10,0.72); backdrop-filter: blur(6px); animation: av-in .2s ease; }
@keyframes av-in { from { opacity: 0; } }
.av-box { width: min(720px, 100%); max-height: calc(100dvh - 32px); overflow: auto; background: var(--surface, #15131d); color: var(--text, #f2f0f7); border: 1px solid rgba(255,255,255,0.12); border-radius: 18px; box-shadow: 0 30px 90px rgba(0,0,0,0.7); padding: 20px clamp(16px, 3vw, 26px) 22px; font-family: var(--font-body, Inter, system-ui, sans-serif); }
.av-box h2 { margin: 0; font-size: 21px; font-family: var(--font-display, inherit); }
.av-head { display: flex; align-items: center; gap: 14px; margin-bottom: 14px; }
.av-head .av-x { margin-left: auto; }
.av-tabs { display: flex; gap: 6px; margin-bottom: 16px; flex-wrap: wrap; }
.av-tabs button, .av-btn { border: 1px solid rgba(255,255,255,0.16); background: rgba(255,255,255,0.06); color: inherit; border-radius: 10px; padding: 9px 14px; font: inherit; font-size: 14px; cursor: pointer; display: inline-flex; gap: 8px; align-items: center; }
.av-tabs button.on { border-color: var(--accent, #35d0d0); background: rgba(var(--accent-rgb, 53,208,208), 0.18); }
.av-btn.primary { background: var(--accent, #35d0d0); color: #061016; border-color: transparent; font-weight: 700; }
.av-btn.danger { color: #ff8a8a; border-color: rgba(255,120,120,0.35); }
.av-btn:focus-visible, .av-tabs button:focus-visible, .av-grid button:focus-visible { outline: 2px solid var(--accent, #35d0d0); outline-offset: 2px; }
.av-btn svg { width: 17px; height: 17px; }
.av-drop { border: 2px dashed rgba(255,255,255,0.22); border-radius: 16px; padding: 34px 18px; text-align: center; display: grid; gap: 14px; justify-items: center; transition: border-color .2s, background .2s; }
.av-drop.over { border-color: var(--accent, #35d0d0); background: rgba(var(--accent-rgb, 53,208,208), 0.1); }
.av-drop p { margin: 0; color: rgba(255,255,255,0.7); font-size: 14.5px; line-height: 1.5; }
.av-drop .row { display: flex; gap: 10px; flex-wrap: wrap; justify-content: center; }
.av-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(84px, 1fr)); gap: 12px; }
.av-grid button { aspect-ratio: 1; border: 0; padding: 0; border-radius: 16px; overflow: hidden; cursor: pointer; background: rgba(255,255,255,0.06); transition: transform .18s, box-shadow .18s; }
.av-grid button:hover { transform: translateY(-3px) scale(1.04); box-shadow: 0 0 0 3px var(--accent, #35d0d0); }
.av-grid img { width: 100%; height: 100%; object-fit: cover; display: block; }
.av-grid.art button { aspect-ratio: 2 / 3; border-radius: 10px; }
.av-grid.art button.wide { aspect-ratio: 16 / 9; grid-column: span 2; }
.av-search { width: 100%; height: 44px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.18); background: rgba(0,0,0,0.25); color: inherit; padding: 0 14px; font: inherit; margin-bottom: 14px; }
.av-note { color: rgba(255,255,255,0.6); font-size: 13.5px; margin: 6px 0 0; }
.av-crop { display: grid; grid-template-columns: auto 1fr; gap: 24px; align-items: center; }
.av-view { position: relative; width: 280px; height: 280px; border-radius: 22px; overflow: hidden; background: #000; touch-action: none; cursor: grab; box-shadow: 0 0 0 1px rgba(255,255,255,0.14); }
.av-view:active { cursor: grabbing; }
.av-view img { position: absolute; left: 50%; top: 50%; transform-origin: center; max-width: none; user-select: none; -webkit-user-drag: none; pointer-events: none; }
.av-view::after { content: ''; position: absolute; inset: 0; pointer-events: none; background-image: linear-gradient(rgba(255,255,255,0.18) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.18) 1px, transparent 1px); background-size: 33.34% 33.34%; background-position: -1px -1px; opacity: 0; transition: opacity .2s; }
.av-view.moving::after { opacity: 1; }
.av-side { display: grid; gap: 16px; }
.av-side label { display: grid; gap: 6px; font-size: 13px; color: rgba(255,255,255,0.7); }
.av-side input[type=range] { width: 100%; accent-color: var(--accent, #35d0d0); }
.av-prev { display: flex; gap: 14px; align-items: flex-end; }
.av-prev canvas { border-radius: 12px; box-shadow: 0 0 0 1px rgba(255,255,255,0.15); }
.av-prev canvas.sm { border-radius: 8px; }
.av-foot { display: flex; gap: 10px; margin-top: 20px; flex-wrap: wrap; align-items: center; }
.av-foot .grow { flex: 1; }
.av-err { color: #ff9a9a; font-size: 14px; margin: 10px 0 0; }
@media (max-width: 600px) { .av-crop { grid-template-columns: 1fr; justify-items: center; } .av-view { width: min(280px, 78vw); height: min(280px, 78vw); } }
`;
const ICON = {
  up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/></svg>',
  cam: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
  rot: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  dice: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="9" cy="9" r="1.2" fill="currentColor"/><circle cx="15" cy="15" r="1.2" fill="currentColor"/><circle cx="15" cy="9" r="1.2" fill="currentColor"/><circle cx="9" cy="15" r="1.2" fill="currentColor"/></svg>',
};
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

// Ready-made characters: a picture drawn here, so it looks the same on every device once saved.
const CHARS = ['🦊', '🐼', '🐯', '🦁', '🐸', '🐙', '🦄', '🐲', '🤖', '👾', '🎃', '🦖', '🐧', '🦉', '🐝', '🦈', '🚀', '🌙', '⚡', '🎮', '🎧', '🍿', '🍕', '🌵', '🎸', '🏀', '🛸', '👻', '🐱', '🐶'];
const PAIRS = [['#35d0d0', '#2a6df4'], ['#b344d6', '#ff4d7e'], ['#ff7a3d', '#e8b84a'], ['#1ce783', '#2a6df4'], ['#ff4d7e', '#8a2be2'], ['#e8b84a', '#ff7a3d'],
  ['#2a6df4', '#b344d6'], ['#14b8a6', '#84cc16'], ['#f43f5e', '#f59e0b'], ['#6366f1', '#06b6d4'], ['#0ea5e9', '#a855f7'], ['#22c55e', '#eab308']];

function drawChar(size, glyph, [a, b], seed) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, size, size);
  g.addColorStop(0, a); g.addColorStop(1, b);
  x.fillStyle = g; x.fillRect(0, 0, size, size);
  // Soft circles for depth.
  x.globalAlpha = 0.16;
  for (let i = 0; i < 4; i++) {
    const r = ((seed * (i + 3) * 37) % 40) / 100 + 0.25;
    x.beginPath(); x.arc(((seed * (i + 1) * 53) % 100) / 100 * size, ((seed * (i + 2) * 29) % 100) / 100 * size, r * size, 0, Math.PI * 2);
    x.fillStyle = i % 2 ? '#fff' : '#000'; x.fill();
  }
  x.globalAlpha = 1;
  x.font = `${Math.round(size * 0.58)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.shadowColor = 'rgba(0,0,0,0.35)'; x.shadowBlur = size * 0.05; x.shadowOffsetY = size * 0.02;
  x.fillText(glyph, size / 2, size * 0.54);
  return c;
}
const toBlob = (canvas) => new Promise((res) => canvas.toBlob((b) => res(b), 'image/jpeg', 0.92));

let styled = false;
export function editAvatar({ profile = {}, title, manage = false } = {}) {
  if (!styled) { const st = document.createElement('style'); st.textContent = CSS; document.head.append(st); styled = true; }
  return new Promise((resolve) => {
    const prior = document.activeElement;
    const m = document.createElement('div');
    m.className = 'av-modal';
    m.innerHTML = `<div class="av-box" role="dialog" aria-modal="true" aria-label="Profile picture">
      <div class="av-head"><h2>${esc(title || `A picture for ${profile.name || 'this profile'}`)}</h2><button class="av-btn av-x" data-x aria-label="Close">${ICON.x}</button></div>
      <div class="av-tabs" role="tablist"><button data-tab="gallery">Gallery</button><button class="on" data-tab="upload">Upload</button><button data-tab="chars">Characters</button><button data-tab="lib">From your library</button></div>
      <section data-pane="gallery" hidden><div class="av-grid" data-gal></div>
        ${manage ? `<div class="av-foot"><button class="av-btn" data-galadd>${ICON.up} Add pictures to the gallery</button><input type="file" accept="image/*" multiple hidden data-galin><span class="av-note" data-galnote></span></div>` : ''}</section>
      <section data-pane="upload"><div class="av-drop"><p>Drop a picture here, or paste one.<br>Any shape is fine: you can frame it next.</p>
        <div class="row"><button class="av-btn primary" data-file>${ICON.up} Choose a picture</button><button class="av-btn" data-camera>${ICON.cam} Take a photo</button></div>
        <input type="file" accept="image/*" hidden data-in><input type="file" accept="image/*" capture="user" hidden data-cam></div></section>
      <section data-pane="chars" hidden><div class="av-grid" data-chars></div><div class="av-foot"><button class="av-btn" data-shuffle>${ICON.dice} New colours</button></div></section>
      <section data-pane="lib" hidden><input class="av-search" type="search" placeholder="Search a movie, show, comic or album" data-q aria-label="Search your library">
        <div class="av-grid art" data-art></div><p class="av-note" data-artnote>Use a poster or backdrop from your own library, then frame it.</p></section>
      <section data-pane="crop" hidden><div class="av-crop"><div class="av-view" data-view><img alt="" data-img></div>
        <div class="av-side"><label>Zoom<input type="range" min="1" max="4" step="0.01" value="1" data-zoom></label>
          <div><button class="av-btn" data-rot>${ICON.rot} Turn</button></div>
          <div class="av-prev"><canvas width="96" height="96" data-p1></canvas><canvas class="sm" width="40" height="40" data-p2></canvas></div>
          <p class="av-note">Drag to move it. Pinch, scroll or use the slider to zoom.</p></div></div>
        <div class="av-foot"><button class="av-btn" data-back>Back</button><span class="grow"></span><button class="av-btn primary" data-save>Use this picture</button></div></section>
      <p class="av-err" data-err hidden></p>
      <div class="av-foot" data-mainfoot>${profile.avatar ? '<button class="av-btn danger" data-remove>Remove the picture</button>' : ''}<span class="grow"></span><button class="av-btn" data-x>Cancel</button></div></div>`;
    document.body.append(m);
    const $ = (s) => m.querySelector(s), $$ = (s) => [...m.querySelectorAll(s)];
    const err = (t) => { const e = $('[data-err]'); e.textContent = t || ''; e.hidden = !t; };
    const done = (v) => { removeEventListener('paste', onPaste); m.remove(); prior?.focus?.(); resolve(v); };
    let pane = 'upload';
    const show = (p) => {
      pane = p;
      for (const s of $$('[data-pane]')) s.hidden = s.dataset.pane !== p;
      for (const b of $$('[data-tab]')) b.classList.toggle('on', b.dataset.tab === p);
      $('.av-tabs').hidden = p === 'crop';
      $('[data-mainfoot]').hidden = p === 'crop';
      err('');
      if (p === 'chars' && !$('[data-chars]').childElementCount) drawChars();
      if (p === 'gallery') drawGallery();
      if (p === 'lib') setTimeout(() => $('[data-q]').focus(), 30);
    };

    // ----- the gallery
    let gal = [];
    const drawGallery = () => {
      $('[data-gal]').innerHTML = gal.length ? gal.map((g) => `<button data-galpick="${esc(g.name)}" aria-label="Use this picture"><img alt="" loading="lazy" src="${esc(g.url)}"></button>`).join('')
        : `<p class="av-note" style="grid-column:1/-1">No pictures in the gallery yet.${manage ? ' Add some below, or in Studio → Profiles.' : ' An admin can add some in the Studio.'}</p>`;
    };
    const loadGallery = async () => { try { gal = await (await fetch('/api/avatars', { credentials: 'same-origin' })).json(); } catch { gal = []; } };
    if (manage) {
      $('[data-galin]').addEventListener('change', async (e) => {
        const files = [...e.target.files]; e.target.value = '';
        const note = $('[data-galnote]');
        let k = 0;
        for (const f of files) { note.textContent = `Adding ${++k} of ${files.length}…`; try { await addToGallery(f); } catch (err) { err && (note.textContent = err.message); } }
        note.textContent = files.length ? `Added ${files.length}` : '';
        await loadGallery(); drawGallery();
      });
    }
    loadGallery().then(() => { if (gal.length || manage) show('gallery'); else show('upload'); $('.av-tabs [data-tab=gallery]').hidden = !gal.length && !manage; });

    // ----- characters
    let shift = Math.floor(Math.random() * PAIRS.length);
    const drawChars = () => {
      $('[data-chars]').innerHTML = CHARS.map((g, i) => `<button data-char="${i}" aria-label="Character ${i + 1}"><img alt="" src="${drawChar(168, g, PAIRS[(i + shift) % PAIRS.length], i + 7).toDataURL('image/jpeg', 0.85)}"></button>`).join('');
    };

    // ----- library art
    let qt = 0;
    const search = async (term) => {
      const box = $('[data-art]'), note = $('[data-artnote]');
      if (!term) { box.innerHTML = ''; note.textContent = 'Use a poster or backdrop from your own library, then frame it.'; return; }
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(term)}`, { credentials: 'same-origin' });
        const d = await res.json();
        const tiles = [];
        for (const it of d.items || []) {
          if (it.poster) tiles.push(`<button data-art-src="${esc(it.poster.replace(/\/w\d+\//, '/w500/'))}" title="${esc(it.title)}"><img loading="lazy" alt="" src="${esc(it.poster)}"></button>`);
          if (it.backdrop) tiles.push(`<button class="wide" data-art-src="${esc(it.backdrop.replace(/\/w\d+\//, '/w1280/'))}" title="${esc(it.title)}"><img loading="lazy" alt="" src="${esc(it.backdrop)}"></button>`);
        }
        box.innerHTML = tiles.slice(0, 40).join('');
        note.textContent = tiles.length ? 'Pick one, then frame it.' : 'Nothing in your library matches that.';
      } catch { note.textContent = 'Search is not available right now.'; }
    };

    // ----- cropper
    const view = $('[data-view]'), img = $('[data-img]');
    const st = { w: 0, h: 0, rot: 0, z: 1, ox: 0, oy: 0 };
    const V = () => view.clientWidth;
    const dims = () => (st.rot % 180 ? [st.h, st.w] : [st.w, st.h]);
    const base = () => { const [w, h] = dims(); return V() / Math.min(w, h); };
    const clamp = () => {
      const [w, h] = dims(), s = base() * st.z, v = V();
      const mx = Math.max(0, (w * s - v) / 2), my = Math.max(0, (h * s - v) / 2);
      st.ox = Math.max(-mx, Math.min(mx, st.ox)); st.oy = Math.max(-my, Math.min(my, st.oy));
    };
    let raf = 0;
    const paint = () => {
      clamp();
      img.style.width = `${st.w}px`; img.style.height = `${st.h}px`;
      img.style.transform = `translate(-50%, -50%) translate(${st.ox}px, ${st.oy}px) rotate(${st.rot}deg) scale(${base() * st.z})`;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => { draw($('[data-p1]')); draw($('[data-p2]')); });
    };
    const draw = (c) => {
      const n = c.width, k = n / V(), x = c.getContext('2d');
      x.fillStyle = '#000'; x.fillRect(0, 0, n, n);
      x.save(); x.translate(n / 2 + st.ox * k, n / 2 + st.oy * k); x.rotate((st.rot * Math.PI) / 180); x.scale(base() * st.z * k, base() * st.z * k);
      x.imageSmoothingQuality = 'high'; x.drawImage(img, -st.w / 2, -st.h / 2); x.restore();
    };
    const crop = (src) => new Promise((ok) => {
      err('');
      img.onload = () => { st.w = img.naturalWidth; st.h = img.naturalHeight; st.rot = 0; st.z = 1; st.ox = 0; st.oy = 0; $('[data-zoom]').value = '1'; show('crop'); paint(); ok(true); };
      img.onerror = () => { err('That picture could not be opened here. Try a JPG or PNG.'); ok(false); };
      img.src = src;
    });
    const fromFile = (f) => {
      if (!f) return;
      if (!/^image\//.test(f.type || 'image/')) { err('That is not a picture.'); return; }
      if (f.size > 25e6) { err('That picture is too large (over 25 MB).'); return; }
      crop(URL.createObjectURL(f));
    };
    const pts = new Map();
    let drag = null;
    view.addEventListener('pointerdown', (e) => { view.setPointerCapture(e.pointerId); pts.set(e.pointerId, [e.clientX, e.clientY]); drag = { ox: st.ox, oy: st.oy, x: e.clientX, y: e.clientY, z: st.z, d: null }; view.classList.add('moving'); if (pts.size === 2) { const [a, b] = [...pts.values()]; drag.d = Math.hypot(a[0] - b[0], a[1] - b[1]); } });
    view.addEventListener('pointermove', (e) => {
      if (!drag || !pts.has(e.pointerId)) return;
      pts.set(e.pointerId, [e.clientX, e.clientY]);
      if (pts.size === 2 && drag.d) { const [a, b] = [...pts.values()]; st.z = Math.max(1, Math.min(4, drag.z * (Math.hypot(a[0] - b[0], a[1] - b[1]) / drag.d))); $('[data-zoom]').value = String(st.z); }
      else { st.ox = drag.ox + (e.clientX - drag.x); st.oy = drag.oy + (e.clientY - drag.y); }
      paint();
    });
    const end = (e) => { pts.delete(e.pointerId); if (!pts.size) { drag = null; view.classList.remove('moving'); } };
    view.addEventListener('pointerup', end); view.addEventListener('pointercancel', end);
    view.addEventListener('wheel', (e) => { e.preventDefault(); st.z = Math.max(1, Math.min(4, st.z * (e.deltaY < 0 ? 1.08 : 1 / 1.08))); $('[data-zoom]').value = String(st.z); paint(); }, { passive: false });
    view.tabIndex = 0;
    view.addEventListener('keydown', (e) => {
      const step = 12, k = e.key;
      if (k === 'ArrowLeft') st.ox -= step; else if (k === 'ArrowRight') st.ox += step; else if (k === 'ArrowUp') st.oy -= step; else if (k === 'ArrowDown') st.oy += step;
      else if (k === '+' || k === '=') st.z = Math.min(4, st.z * 1.1); else if (k === '-') st.z = Math.max(1, st.z / 1.1); else return;
      e.preventDefault(); e.stopPropagation(); $('[data-zoom]').value = String(st.z); paint();
    });
    $('[data-zoom]').addEventListener('input', (e) => { st.z = +e.target.value; paint(); });

    // ----- wiring
    const drop = $('.av-drop');
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); fromFile(e.dataTransfer.files[0]); });
    const onPaste = (e) => { const f = [...(e.clipboardData?.files || [])].find((x) => x.type.startsWith('image/')); if (f) { e.preventDefault(); fromFile(f); } };
    addEventListener('paste', onPaste);
    $('[data-in]').addEventListener('change', (e) => fromFile(e.target.files[0]));
    $('[data-cam]').addEventListener('change', (e) => fromFile(e.target.files[0]));
    $('[data-q]').addEventListener('input', (e) => { clearTimeout(qt); qt = setTimeout(() => search(e.target.value.trim()), 250); });
    m.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); if (pane === 'crop') show('upload'); else done(null); } });
    m.addEventListener('click', async (e) => {
      const t = e.target;
      if (t === m || t.closest('[data-x]')) return done(null);
      const tab = t.closest('[data-tab]'); if (tab) return show(tab.dataset.tab);
      if (t.closest('[data-file]')) return $('[data-in]').click();
      if (t.closest('[data-camera]')) return $('[data-cam]').click();
      if (t.closest('[data-shuffle]')) { shift = (shift + 1) % PAIRS.length; return drawChars(); }
      if (t.closest('[data-galadd]')) return $('[data-galin]').click();
      const gp = t.closest('[data-galpick]'); if (gp) return done({ gallery: gp.dataset.galpick });
      const ch = t.closest('[data-char]');
      if (ch) { const i = +ch.dataset.char; return done({ blob: await toBlob(drawChar(512, CHARS[i], PAIRS[(i + shift) % PAIRS.length], i + 7)) }); }
      const art = t.closest('[data-art-src]'); if (art) return crop(art.dataset.artSrc);
      if (t.closest('[data-rot]')) { st.rot = (st.rot + 90) % 360; return paint(); }
      if (t.closest('[data-back]')) return show('upload');
      if (t.closest('[data-remove]')) return done({ remove: true });
      if (t.closest('[data-save]')) {
        const c = document.createElement('canvas'); c.width = c.height = 512;
        try { draw(c); return done({ blob: await toBlob(c) }); } catch { return err('That picture could not be used. Try another one.'); }
      }
    });
    $('[data-file]').focus();
  });
}

/** Save the result of editAvatar() for a profile. Returns the updated profile. */
export async function saveAvatar(profileId, result) {
  if (!result) return null;
  if (result.gallery) {
    const r = await fetch(`/api/profiles/${profileId}/avatar/gallery`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: result.gallery }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'The picture could not be saved');
    return d;
  }
  const res = await fetch(`/api/profiles/${profileId}/avatar`, result.remove ? { method: 'DELETE', credentials: 'same-origin' }
    : { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/octet-stream' }, body: result.blob });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error || 'The picture could not be saved');
  return d;
}

/** Add a picture (a File or Blob) to the shared gallery. Admins only. */
export async function addToGallery(file) {
  const res = await fetch('/api/studio/avatars', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/octet-stream' }, body: file });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error || 'That picture could not be added');
  return d;
}
