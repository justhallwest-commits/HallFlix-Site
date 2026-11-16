// HallFlix Studio: the admin panel. Every page here talks to /api/studio/* and needs an admin profile.
import { $, $$, api, html, raw, toast } from '/js/core.js';

const root = $('#studio');
const clone = (o) => JSON.parse(JSON.stringify(o ?? {}));
const get = (o, p) => p.split('.').reduce((a, k) => a?.[k], o);
function set(o, p, v) {
  const ks = p.split('.'); let a = o;
  for (const k of ks.slice(0, -1)) a = (a[k] && typeof a[k] === 'object' ? a[k] : (a[k] = {}));
  a[ks.at(-1)] = v;
}
function merge(base, patch) {
  if (patch === undefined || patch === null) return base;
  if (typeof base !== 'object' || base === null || typeof patch !== 'object' || Array.isArray(patch)) return patch;
  const out = { ...base };
  for (const [k, v] of Object.entries(patch)) out[k] = merge(base[k], v);
  return out;
}
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const fail = (e) => toast(e.message || 'Something went wrong');
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const niceDate = (md) => (/^\d\d-\d\d$/.test(md || '') ? `${MONTHS[+md.slice(0, 2) - 1]} ${+md.slice(3)}` : '');
const mins = (s) => (s >= 60 ? `${Math.round(s / 60)} min` : `${Math.round(s || 0)} sec`);

const PAGES = [
  ['overview', 'Overview'], ['libraries', 'Libraries'], ['look', 'Look and feel'], ['seasons', 'Seasons'],
  ['prerolls', 'Pre-rolls'], ['profiles', 'Profiles'], ['plugins', 'Plugins'], ['settings', 'Settings'],
];
let timer = null; // the current page's refresh timer, cleared on every page change

// ---------- small building blocks ----------
const text = (o, p, label, ph = '') => html`<label class="f"><span>${label}</span><input type="text" data-path="${p}" value="${get(o, p) ?? ''}" placeholder="${ph}"></label>`;
const color = (o, p, label) => html`<label class="f"><span>${label}</span><span class="color">
  <input type="color" data-path="${p}" value="${/^#[0-9a-f]{6}$/i.test(get(o, p) || '') ? get(o, p) : '#000000'}"><input type="text" data-path="${p}" data-hex value="${get(o, p) ?? ''}" maxlength="7"></span></label>`;
const range = (o, p, label, min, max, step, def = min) => html`<label class="f"><span>${label}</span><span class="rangewrap">
  <input type="range" data-path="${p}" min="${min}" max="${max}" step="${step}" value="${get(o, p) ?? def}"><output>${get(o, p) ?? def}</output></span></label>`;
const select = (o, p, label, options, blank) => html`<label class="f"><span>${label}</span><select data-path="${p}">
  ${blank ? html`<option value="">${blank}</option>` : ''}${options.map((x) => html`<option value="${x}" ${get(o, p) === x ? 'selected' : ''}>${x[0].toUpperCase() + x.slice(1)}</option>`)}</select></label>`;
const check = (o, p, label) => html`<label class="check"><input type="checkbox" data-path="${p}" ${get(o, p) ? 'checked' : ''}> ${label}</label>`;
const image = (o, p, label) => html`<div class="f block"><span>${label}</span><div class="imgrow">
  <div class="thumb" style="background-image:url('${encodeURI(get(o, p) || '')}')"></div>
  <input type="text" data-path="${p}" value="${get(o, p) ?? ''}" placeholder="Paste a link, upload, or pick from the NAS">
  <button class="btn sm" data-upload="${p}">Upload</button><button class="btn sm" data-pick="${p}">From NAS</button>
  ${get(o, p) ? html`<button class="btn sm danger" data-clear="${p}" title="Remove">✕</button>` : ''}</div></div>`;
const dates = (id, label, value) => html`<div class="f"><span>${label}</span><span class="dates">
  <select data-md="${id}-m">${MONTHS.map((m, i) => html`<option value="${String(i + 1).padStart(2, '0')}" ${+String(value || '').slice(0, 2) === i + 1 ? 'selected' : ''}>${m}</option>`)}</select>
  <input type="number" min="1" max="31" data-md="${id}-d" value="${+String(value || '01-01').slice(3) || 1}"></span></div>`;
const readDate = (el, id) => `${$(`[data-md="${id}-m"]`, el).value}-${String(Math.max(1, Math.min(31, +$(`[data-md="${id}-d"]`, el).value || 1))).padStart(2, '0')}`;

/** Wire a form to an object: any control with data-path writes straight into `obj`. `changed(true)` asks for a redraw. */
function bind(el, obj, changed) {
  el.addEventListener('input', (e) => {
    const c = e.target.closest('[data-path]');
    if (!c) return;
    const p = c.dataset.path;
    if (c.hasAttribute('data-hex') && !/^#[0-9a-f]{6}$/i.test(c.value)) return;
    set(obj, p, c.type === 'checkbox' ? c.checked : c.type === 'range' || c.type === 'number' ? +c.value : c.value);
    for (const other of $$(`[data-path="${p}"]`, el)) if (other !== c && other.type !== 'checkbox') other.value = c.value;
    const out = c.parentElement.querySelector('output'); if (out) out.textContent = c.value;
    changed(false);
  });
  el.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-upload],[data-pick],[data-clear]');
    if (!b) return;
    e.preventDefault();
    try {
      if (b.dataset.clear) set(obj, b.dataset.clear, '');
      else if (b.dataset.pick) { const f = await browse({ files: 'images' }); if (!f) return; set(obj, b.dataset.pick, (await api('POST', '/api/studio/pick', { path: f })).url); }
      else { const url = await upload(); if (!url) return; set(obj, b.dataset.upload, url); }
      changed(true);
    } catch (err) { fail(err); }
  });
}

function upload() {
  return new Promise((resolve, reject) => {
    const inp = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/*,video/mp4,video/webm' });
    inp.onchange = async () => {
      const f = inp.files[0];
      if (!f) return resolve(null);
      toast('Uploading…', 1500);
      try {
        const res = await fetch(`/api/studio/upload?name=${encodeURIComponent(f.name)}`, { method: 'POST', body: f, credentials: 'same-origin' });
        const d = await res.json();
        if (!res.ok) throw new Error(d.error || 'Upload failed');
        resolve(d.url);
      } catch (e) { reject(e); }
    };
    inp.click();
  });
}

function dialog(title, body, { ok = 'Save', danger = false, onOk, wide = false } = {}) {
  const m = $('#modal');
  m.innerHTML = String(html`<div class="dialog" role="dialog" aria-modal="true" style="${wide ? 'width:min(720px,100%)' : ''}"><h2>${title}</h2><div class="body">${body}</div>
    <div class="foot"><button class="btn" data-x>Cancel</button>${ok ? html`<button class="btn ${danger ? 'danger' : 'primary'}" data-ok>${ok}</button>` : ''}</div></div>`);
  const close = () => { m.innerHTML = ''; };
  $('[data-x]', m).onclick = close;
  const okBtn = $('[data-ok]', m);
  if (okBtn) okBtn.onclick = async () => { okBtn.disabled = true; try { if ((await onOk?.($('.body', m))) !== false) close(); } catch (e) { fail(e); } okBtn.disabled = false; };
  m.onkeydown = (e) => { if (e.key === 'Escape') close(); };
  $('input,select,button', $('.body', m))?.focus();
  return { el: $('.body', m), close };
}
const confirmBox = (title, message, ok, onOk) => dialog(title, html`<p class="muted">${message}</p>`, { ok, danger: true, onOk });

/** Pick a folder (or a picture) on the NAS. Resolves to the full path, or null. */
function browse({ files } = {}) {
  return new Promise((resolve) => {
    let here = '';
    const d = dialog(files ? 'Pick a picture on the NAS' : 'Pick a folder on the NAS', html`<p class="muted small" data-here></p><div class="browser"></div>`,
      { ok: files ? '' : 'Use this folder', onOk: () => resolve(here) });
    $('[data-x]', $('#modal')).addEventListener('click', () => resolve(null));
    const open = async (p) => {
      let r;
      try { r = await api('GET', `/api/studio/fs?path=${encodeURIComponent(p || '')}${files ? `&files=${files}` : ''}`); }
      catch (e) { $('[data-here]', d.el).textContent = p || ''; $('.browser', d.el).innerHTML = String(html`<button disabled style="white-space:normal;color:var(--bad)">${e.message}</button>`); return; }
      here = r.path;
      $('[data-here]', d.el).textContent = r.path;
      $('.browser', d.el).innerHTML = String(html`${r.parent ? html`<button data-go="${r.parent}">↑ Up one level</button>` : ''}
        ${r.entries.map((x) => html`<button data-${x.dir ? 'go' : 'file'}="${x.path}">${x.dir ? '📁' : '🖼️'} ${x.name}</button>`)}
        ${!r.entries.length ? html`<button disabled class="muted" style="white-space:normal">${r.note || 'Nothing here'}</button>` : ''}`);
    };
    d.el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-go],[data-file]');
      if (!b) return;
      if (b.dataset.file) { d.close(); resolve(b.dataset.file); } else open(b.dataset.go);
    });
    open('');
  });
}

// ---------- shell ----------
function shell(profile) {
  root.innerHTML = String(html`<nav class="side"><div class="brand"><img src="/assets/logo.png" alt="HallFlix"><b>STUDIO</b></div>
    ${PAGES.map(([id, name]) => html`<a class="nav" href="#${id}" data-page="${id}">${name}</a>`)}
    <div class="grow"></div><a class="nav" href="/">← Back to HallFlix</a><div class="foot">Signed in as ${profile.name}</div></nav><main></main>`);
}
async function route() {
  clearInterval(timer); timer = null; $('#modal').innerHTML = '';
  const id = PAGES.some(([p]) => p === location.hash.slice(1)) ? location.hash.slice(1) : 'overview';
  for (const a of $$('.side a[data-page]')) a.classList.toggle('on', a.dataset.page === id);
  const old = $('main', root), main = document.createElement('main'); // a fresh element drops the last page's listeners
  old.replaceWith(main);
  try { await pages[id](main); } catch (e) { main.innerHTML = String(html`<div class="card"><h2>That page could not load</h2><p class="muted">${e.message}</p></div>`); }
}
const head = (title, sub, tools = '') => html`<div class="head"><div><h1>${title}</h1><p>${sub}</p></div><div class="tools">${tools}</div></div>`;

const pages = {};

// ---------- overview ----------
pages.overview = async (main) => {
  const draw = async () => {
    const [o, lk] = await Promise.all([api('GET', '/api/studio/overview'), api('GET', '/api/studio/look')]);
    const s = o.scan;
    main.innerHTML = String(html`${head('Overview', `HallFlix ${o.version} — everything at a glance.`)}
      <div class="grid">
        ${o.libraries.map((l) => html`<div class="stat"><span class="muted">${l.name}</span><b>${l.titles}</b><span class="muted small">${l.kind === 'shows' ? `shows · ${l.episodes} episodes` : l.kind === 'prerolls' ? 'clips' : 'movies'}${l.unmatched ? ` · ${l.unmatched} without details` : ''}</span></div>`)}
        <div class="stat"><span class="muted">Look right now</span><b style="font-size:19px">${lk.active || 'Everyday look'}</b><span class="muted small">${lk.active ? 'A season is switched on' : 'No season is running'}</span></div>
      </div>
      <div class="card"><h2>Health</h2>
        <div class="row"><div class="grow"><b>Library scan</b><span>${s.running ? `${s.phase || 'Working'} ${s.total ? `· ${s.done} of ${s.total}` : ''}` : s.finishedAt ? `Last finished ${new Date(s.finishedAt).toLocaleString()}` : 'Not run yet'}</span></div>
          <span class="pill ${s.running ? 'live' : 'ok'}">${s.running ? 'Scanning' : 'Idle'}</span><button class="btn sm" data-scan>Scan everything</button></div>
        ${s.errors.map((e) => html`<div class="row"><div class="grow"><b>Scan problem</b><span>${e}</span></div><span class="pill bad">Check</span></div>`)}
        <div class="row"><div class="grow"><b>Video converter</b><span>${o.transcoder.ok ? `${o.transcoder.hw === 'software' ? 'Using the processor (no graphics chip found)' : `Using the graphics chip (${o.transcoder.hw})`} · ${o.transcoder.sessions} playing now` : 'Not answering. Titles that need converting will not play.'}</span></div>
          <span class="pill ${o.transcoder.ok ? 'ok' : 'bad'}">${o.transcoder.ok ? 'Running' : 'Down'}</span></div>
        <div class="row"><div class="grow"><b>TMDb (posters and details)</b><span>${o.tmdb ? 'Connected' : 'No key yet. Titles will show without posters.'}</span></div>
          ${o.tmdb ? html`<span class="pill ok">Connected</span>` : html`<a class="btn sm" href="#settings">Add a key</a>`}</div>
      </div>
      ${!o.libraries.length ? html`<div class="card"><h2>Start here</h2><p class="muted">Add a movie or show folder and HallFlix will scan it.</p><p style="margin-top:12px"><a class="btn primary" href="#libraries">Add a library</a></p></div>` : ''}`);
    $('[data-scan]', main).onclick = async () => { await api('POST', '/api/studio/scan', {}); toast('Scan started'); draw(); };
  };
  await draw();
  timer = setInterval(() => { if (!$('#modal').childElementCount) draw().catch(() => {}); }, 4000);
};

// ---------- libraries ----------
pages.libraries = async (main) => {
  const KIND = { movies: 'Movies', shows: 'Shows', prerolls: 'Pre-roll clips' };
  const draw = async () => {
    const o = await api('GET', '/api/studio/overview');
    main.innerHTML = String(html`${head('Libraries', `Point HallFlix at folders inside ${o.mediaRoot}. Your files are only ever read, never changed.`, html`<button class="btn primary" data-add>Add a library</button>`)}
      <div class="card">${o.libraries.length ? o.libraries.map((l, i) => html`<div class="row" data-id="${l.id}">
        <div class="grow"><b>${l.name} <span class="pill">${KIND[l.kind]}</span> ${o.scan.running && o.scan.library === l.id ? html`<span class="pill live">Scanning</span>` : ''}</b>
          <span>${l.path} · ${l.titles} ${l.kind === 'prerolls' ? 'clips' : 'titles'}${l.kind === 'shows' ? `, ${l.episodes} episodes` : ''}${l.unmatched ? ` · ${l.unmatched} without details` : ''}</span></div>
        <div class="tools">${i ? html`<button class="btn sm" data-up title="Move up">↑</button>` : ''}<button class="btn sm" data-scan>Scan</button>
          ${l.kind !== 'prerolls' ? html`<button class="btn sm" data-fresh title="Look every title up again">Refresh details</button>` : ''}
          <button class="btn sm" data-edit>Edit</button><button class="btn sm danger" data-del>Remove</button></div></div>`)
    : html`<p class="muted">No libraries yet. Add your Movies and Shows folders, plus a folder of pre-roll clips if you have one.</p>`}</div>
      <p class="muted small">Tip: inside a pre-roll folder, sub-folder names become tags. Clips in <code>halloween/</code> get the tag “halloween”, which pre-roll rules can use.</p>`);
    const libOf = (e) => o.libraries.find((l) => l.id === +e.target.closest('[data-id]').dataset.id);
    const form = (l) => {
      const v = { name: l?.name || '', kind: l?.kind || 'movies', path: l?.path || '' };
      const d = dialog(l ? `Edit ${l.name}` : 'Add a library', html`<label class="f"><span>Name</span><input type="text" data-k="name" value="${v.name}" placeholder="Movies"></label>
        ${l ? '' : html`<label class="f"><span>Type</span><select data-k="kind">${Object.entries(KIND).map(([k, n]) => html`<option value="${k}">${n}</option>`)}</select></label>`}
        <div class="f"><span>Folder</span><span class="imgrow"><input type="text" data-k="path" value="${v.path}" placeholder="${o.mediaRoot}/Movies"><button class="btn sm" data-browse>Browse</button></span></div>`,
      { ok: l ? 'Save' : 'Add and scan', onOk: async (el) => {
        const b = Object.fromEntries($$('[data-k]', el).map((x) => [x.dataset.k, x.value]));
        if (l) await api('PUT', `/api/studio/libraries/${l.id}`, b); else await api('POST', '/api/studio/libraries', b);
        toast(l ? 'Saved' : 'Library added. Scanning now.'); draw();
      } });
      $('[data-browse]', d.el).onclick = async () => {
        const keep = Object.fromEntries($$('[data-k]', d.el).map((x) => [x.dataset.k, x.value]));
        const p = await browse(); // replaces the dialog, so reopen the form with what was typed
        form(l); for (const x of $$('[data-k]', $('#modal'))) x.value = x.dataset.k === 'path' && p ? p : keep[x.dataset.k];
        const nm = $('[data-k=name]', $('#modal')); if (p && !nm.value) nm.value = p.split('/').pop();
      };
    };
    $('[data-add]', main).onclick = () => form(null);
    main.onclick = async (e) => {
      const b = e.target.closest('button'); if (!b || !e.target.closest('[data-id]')) return;
      const l = libOf(e);
      try {
        if (b.hasAttribute('data-scan')) { await api('POST', '/api/studio/scan', { libraryId: l.id }); toast(`Scanning ${l.name}`); draw(); }
        if (b.hasAttribute('data-fresh')) { await api('POST', '/api/studio/scan', { libraryId: l.id, fresh: true }); toast(`Looking up ${l.name} again`); draw(); }
        if (b.hasAttribute('data-edit')) form(l);
        if (b.hasAttribute('data-up')) { const prev = o.libraries[o.libraries.indexOf(l) - 1]; await api('PUT', `/api/studio/libraries/${l.id}`, { position: prev.position }); await api('PUT', `/api/studio/libraries/${prev.id}`, { position: prev.position === l.position ? l.position + 1 : l.position }); draw(); }
        if (b.hasAttribute('data-del')) confirmBox(`Remove ${l.name}?`, 'HallFlix forgets this library and its watch history. The files on the NAS are not touched.', 'Remove', async () => { await api('DELETE', `/api/studio/libraries/${l.id}`); draw(); });
      } catch (err) { fail(err); }
    };
  };
  await draw();
  timer = setInterval(() => { if (!$('#modal').childElementCount) draw().catch(() => {}); }, 5000);
};

// ---------- live preview shared by Look and Seasons ----------
function previewPane(libraries) {
  return html`<section class="preview"><div class="bar"><h3 style="margin-right:auto">Live preview</h3>
    <select data-pv-go style="width:auto"><option value="#/">Home</option>${libraries.map((l) => html`<option value="#/library/${l.id}" data-lib="${l.id}">${l.name}</option>`)}</select>
    <div class="tabs" style="margin:0"><button class="on" data-pv-size="tv">TV / computer</button><button data-pv-size="phone">Phone</button></div></div>
    <div class="stage"><iframe src="/?preview=1" title="Preview of HallFlix"></iframe></div></section>`;
}
function wirePreview(main, payload) {
  const frame = $('iframe', main); let ready = false, lib = null;
  const send = debounce(async () => {
    if (!ready || !frame.isConnected) return;
    try { frame.contentWindow.postMessage({ type: 'hallflix-look', look: await api('POST', '/api/studio/look/preview', payload()), library: lib }, location.origin); } catch { /* preview is best effort */ }
  }, 120);
  const onMsg = (e) => { if (e.source === frame.contentWindow && e.data?.type === 'hallflix-ready') { ready = true; send(); } };
  addEventListener('message', onMsg);
  $('[data-pv-go]', main).onchange = (e) => {
    lib = e.target.selectedOptions[0].dataset.lib ? +e.target.selectedOptions[0].dataset.lib : null;
    frame.contentWindow.postMessage({ type: 'hallflix-go', hash: e.target.value }, location.origin); send();
  };
  for (const b of $$('[data-pv-size]', main)) b.onclick = () => { for (const x of $$('[data-pv-size]', main)) x.classList.toggle('on', x === b); $('.stage', main).classList.toggle('phone', b.dataset.pvSize === 'phone'); };
  return send;
}
const swatch = (t, d) => { const c = { ...d.colors, ...(t.colors || {}) }; return html`<span class="sw" style="background:${c.bg}"><i style="background:${c.accent}"></i><i style="background:${c.accent2}"></i><i style="background:${c.text}"></i></span>`; };

// ---------- look and feel ----------
pages.look = async (main) => {
  main.className = 'split';
  const L = await api('GET', '/api/studio/look');
  let theme = merge(clone(L.defaults), L.theme);
  const libs = Object.fromEntries(L.libraries.map((l) => [l.id, clone(l.look)]));
  let tab = 'theme', dirty = false;
  main.innerHTML = String(html`<section class="controls"></section>${previewPane(L.libraries)}`);
  const box = $('.controls', main);
  const send = wirePreview(main, () => ({ theme, libraries: libs, noSeason: true }));
  const draw = () => {
    const lib = L.libraries.find((l) => `lib-${l.id}` === tab);
    box.innerHTML = String(html`${head('Look and feel', 'Changes show in the preview straight away. Nothing goes live until you save.')}
      <div class="tabs"><button data-tab="theme" class="${tab === 'theme' ? 'on' : ''}">Whole app</button>${L.libraries.map((l) => html`<button data-tab="lib-${l.id}" class="${tab === `lib-${l.id}` ? 'on' : ''}">${l.name}</button>`)}</div>
      ${lib ? html`<div class="card" data-form="lib"><h2>${lib.name} only</h2><p class="muted small">Leave anything empty to use the whole-app look.</p>
          ${image(libs[lib.id], 'background', 'Background picture or video')}${range(libs[lib.id], 'dim', 'Darken background', 0, 0.95, 0.05, theme.background.dim)}
          ${image(libs[lib.id], 'logo', 'Logo shown instead of the library name')}
          ${check(libs[lib.id], 'useAccent', 'Give this library its own accent colours')}
          ${libs[lib.id].useAccent ? html`${color(libs[lib.id], 'accent', 'Accent')}${color(libs[lib.id], 'accent2', 'Second accent')}` : ''}</div>`
    : html`<div class="card"><h2>Start from a preset</h2><div class="presets">${L.presets.map((p) => html`<button class="preset ${theme.preset === p.id ? 'on' : ''}" data-preset="${p.id}" title="${p.description}">${swatch(p.theme, L.defaults)}<b>${p.name}</b></button>`)}</div></div>
        <div data-form="theme">
        <div class="card"><h2>Colours</h2>${color(theme, 'colors.bg', 'Background')}${color(theme, 'colors.surface', 'Panels')}${color(theme, 'colors.text', 'Text')}${color(theme, 'colors.muted', 'Quiet text')}${color(theme, 'colors.accent', 'Accent')}${color(theme, 'colors.accent2', 'Second accent')}</div>
        <div class="card"><h2>Type and shape</h2>${select(theme, 'fonts.display', 'Title font', L.options.fonts)}${select(theme, 'fonts.body', 'Reading font', L.options.fonts)}
          ${range(theme, 'radius', 'Card corners', 0, 28, 1)}${range(theme, 'glow', 'Neon glow', 0, 1, 0.05)}${select(theme, 'cardShape', 'Card shape', L.options.cardShapes)}${range(theme, 'heroHeight', 'Banner height', 40, 100, 5)}</div>
        <div class="card"><h2>Texture and effects</h2>${select(theme, 'texture', 'Texture', L.options.textures)}${select(theme, 'effect', 'Moving effect', L.options.effects)}</div>
        <div class="card"><h2>Backgrounds</h2>${image(theme, 'background.image', 'Home background picture or video')}${range(theme, 'background.dim', 'Darken', 0, 0.95, 0.05)}${range(theme, 'background.blur', 'Blur', 0, 30, 1)}
          ${image(theme, 'login.image', 'Sign-in screen background')}${range(theme, 'login.dim', 'Darken sign-in', 0, 0.95, 0.05)}</div>
        <div class="card"><h2>Name and logo</h2>${text(theme, 'siteName', 'Site name')}${image(theme, 'logo.image', 'Logo (empty uses the HallFlix neon logo)')}${range(theme, 'logo.height', 'Logo size', 20, 120, 2)}</div></div>`}
      <div class="savebar"><button class="btn primary" data-save ${dirty ? '' : 'disabled'}>Save and go live</button><button class="btn" data-undo ${dirty ? '' : 'disabled'}>Undo changes</button></div>`);
  };
  const curLib = () => L.libraries.find((l) => `lib-${l.id}` === tab);
  const target = () => (curLib() ? libs[curLib().id] : theme);
  // The form edits whichever of the whole-app theme or the open library is showing.
  bind(box, new Proxy({}, { get: (_, k) => target()[k], set: (_, k, v) => { target()[k] = v; return true; } }), (redraw) => {
    const l = curLib();
    if (l) {
      const o = libs[l.id], shown = !!$('[data-path=accent]', box);
      if (o.useAccent) { o.accent ||= theme.colors.accent; o.accent2 ||= theme.colors.accent2; } else { delete o.accent; delete o.accent2; }
      if (shown !== !!o.useAccent) redraw = true;
    }
    dirty = true;
    if (redraw) draw(); else for (const b of $$('.savebar button', box)) b.disabled = false;
    send();
  });
  box.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-tab],[data-preset],[data-save],[data-undo]');
    if (!t) return;
    if (t.dataset.tab) {
      tab = t.dataset.tab; draw();
      const sel = $('[data-pv-go]', main); sel.value = curLib() ? `#/library/${curLib().id}` : '#/'; sel.onchange({ target: sel });
    } else if (t.dataset.preset) {
      const p = L.presets.find((x) => x.id === t.dataset.preset);
      const keep = { siteName: theme.siteName, logo: theme.logo, background: theme.background, login: theme.login };
      theme = { ...merge(clone(L.defaults), p.theme), ...keep, preset: p.id };
      dirty = true; draw(); send();
    } else if (t.hasAttribute('data-undo')) route();
    else if (t.hasAttribute('data-save')) {
      try {
        await api('PUT', '/api/studio/theme', { theme });
        for (const l of L.libraries) if (JSON.stringify(libs[l.id]) !== JSON.stringify(l.look)) { await api('PUT', `/api/studio/libraries/${l.id}`, { look: libs[l.id] }); l.look = clone(libs[l.id]); }
        dirty = false; draw(); toast('Saved. The new look is live on every device.');
      } catch (err) { fail(err); }
    }
  });
  draw();
};

// ---------- seasons ----------
pages.seasons = async (main) => {
  main.className = 'split';
  const L = await api('GET', '/api/studio/look');
  let cur = null; // the season being edited
  main.innerHTML = String(html`<section class="controls"></section>${previewPane(L.libraries)}`);
  const box = $('.controls', main);
  const send = wirePreview(main, () => (cur ? { season: { ...cur, enabled: true } } : { noSeason: true }));
  const STARTERS = [['Halloween', '10-01', '10-31', 'halloween'], ['Winter Holiday', '12-01', '12-26', 'winter-holiday'], ['Valentine', '02-07', '02-14', 'valentine'], ['Autumn', '11-01', '11-30', 'autumn']];
  const fresh = (name = '', starts = '01-01', ends = '01-07', preset = '') => ({ name, starts, ends, enabled: true, look: { theme: preset ? { ...clone(L.presets.find((p) => p.id === preset).theme), preset } : {}, libraries: {} } });
  const draw = () => {
    if (!cur) {
      box.innerHTML = String(html`${head('Seasons', 'A season is a look that switches itself on between two dates each year, then hands back to your everyday look.', html`<button class="btn primary" data-new>New season</button>`)}
        <div class="card">${L.seasons.length ? L.seasons.map((s) => html`<div class="row" data-id="${s.id}"><div class="grow"><b>${s.name} ${L.active === s.name ? html`<span class="pill live">On now</span>` : !s.enabled ? html`<span class="pill">Off</span>` : ''}</b><span>${niceDate(s.starts)} to ${niceDate(s.ends)}, every year</span></div>
          <div class="tools"><button class="btn sm" data-edit>Edit</button><button class="btn sm danger" data-del>Delete</button></div></div>`) : html`<p class="muted">No seasons yet. Start with one of these, or make your own.</p>`}</div>
        <div class="card"><h2>Quick starts</h2><div class="presets">${STARTERS.map(([n, , , p]) => html`<button class="preset" data-starter="${p}">${swatch(L.presets.find((x) => x.id === p).theme, L.defaults)}<b>${n}</b></button>`)}</div></div>`);
      return;
    }
    const t = cur.look.theme;
    box.innerHTML = String(html`${head(cur.id ? `Edit ${cur.name}` : 'New season', 'The preview shows this season as if it were switched on today. Anything left alone keeps your everyday look.')}
      <div class="card"><h2>When</h2><label class="f"><span>Name</span><input type="text" data-path="name" value="${cur.name}" placeholder="Halloween"></label>
        ${dates('s', 'Starts', cur.starts)}${dates('e', 'Ends', cur.ends)}${check(cur, 'enabled', 'Switch on automatically each year')}</div>
      <div class="card"><h2>Look</h2><div class="presets" style="margin-bottom:12px">${L.presets.map((p) => html`<button class="preset ${t.preset === p.id ? 'on' : ''}" data-preset="${p.id}" title="${p.description}">${swatch(p.theme, L.defaults)}<b>${p.name}</b></button>`)}</div>
        ${check(cur, 'look.custom', 'Fine-tune the colours')}
        ${cur.look.custom ? html`${color(cur, 'look.theme.colors.bg', 'Background')}${color(cur, 'look.theme.colors.surface', 'Panels')}${color(cur, 'look.theme.colors.accent', 'Accent')}${color(cur, 'look.theme.colors.accent2', 'Second accent')}` : ''}
        ${select(cur, 'look.theme.effect', 'Moving effect', L.options.effects, 'Keep the usual')}${select(cur, 'look.theme.texture', 'Texture', L.options.textures, 'Keep the usual')}
        ${image(cur, 'look.theme.background.image', 'Home background')}${image(cur, 'look.theme.login.image', 'Sign-in background')}${image(cur, 'look.theme.logo.image', 'Seasonal logo')}</div>
      ${L.libraries.length ? html`<div class="card"><h2>Library backgrounds for this season</h2>${L.libraries.map((l) => image(cur, `look.libraries.${l.id}.background`, l.name))}</div>` : ''}
      <div class="savebar"><button class="btn primary" data-save>Save season</button><button class="btn" data-back>Cancel</button></div>`);
  };
  bind(box, new Proxy({}, { get: (_, k) => cur?.[k], set: (_, k, v) => { cur[k] = v; return true; } }), (redraw) => {
    if (!cur) return;
    const base = merge(clone(L.defaults), L.theme).colors;
    if (cur.look.custom && !cur.look.theme.colors) { cur.look.theme.colors = { ...base, ...(L.presets.find((p) => p.id === cur.look.theme.preset)?.theme.colors || {}) }; redraw = true; }
    if (!cur.look.custom && $('[data-path="look.theme.colors.bg"]', box)) redraw = true;
    if (redraw) draw();
    send();
  });
  box.addEventListener('input', (e) => { if (cur && e.target.matches('[data-md]')) { cur.starts = readDate(box, 's'); cur.ends = readDate(box, 'e'); } });
  box.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-new],[data-edit],[data-del],[data-starter],[data-preset],[data-save],[data-back]');
    if (!t) return;
    const row = t.closest('[data-id]'), s = row && L.seasons.find((x) => x.id === +row.dataset.id);
    try {
      if (t.hasAttribute('data-new')) cur = fresh();
      else if (t.dataset.starter) { const st = STARTERS.find((x) => x[3] === t.dataset.starter); cur = fresh(st[0], st[1], st[2], st[3]); }
      else if (t.hasAttribute('data-edit')) { cur = clone(s); cur.look = { theme: {}, libraries: {}, ...cur.look }; }
      else if (t.hasAttribute('data-del')) return void confirmBox(`Delete ${s.name}?`, 'The season is removed. Your everyday look is not affected.', 'Delete', async () => { await api('DELETE', `/api/studio/seasons/${s.id}`); route(); });
      else if (t.dataset.preset) { const p = L.presets.find((x) => x.id === t.dataset.preset); const keep = cur.look.theme; cur.look.theme = { ...clone(p.theme), preset: p.id, background: keep.background, login: keep.login, logo: keep.logo }; if (!p.theme.effect && keep.effect) cur.look.theme.effect = keep.effect; }
      else if (t.hasAttribute('data-back')) cur = null;
      else if (t.hasAttribute('data-save')) {
        cur.starts = readDate(box, 's'); cur.ends = readDate(box, 'e');
        if (!cur.look.custom && !cur.look.theme.preset) delete cur.look.theme.colors;
        await api('POST', '/api/studio/seasons', cur);
        toast(`${cur.name} saved`); return void route();
      }
      draw(); send();
    } catch (err) { fail(err); }
  });
  draw();
};

// ---------- pre-rolls ----------
pages.prerolls = async (main) => {
  const draw = async () => {
    const P = await api('GET', '/api/studio/prerolls');
    const set0 = P.settings;
    const libName = (id) => P.libraries.find((l) => l.id === +id)?.name || 'a removed library';
    const describe = (r) => {
      const m = r.match || {}, bits = [];
      if (m.kinds?.length === 1) bits.push(m.kinds[0] === 'movie' ? 'movies only' : 'episodes only');
      if (m.libraries?.length) bits.push(`in ${m.libraries.map(libName).join(', ')}`);
      if (m.genres?.length) bits.push(m.genres.join(' or '));
      if (m.ratings?.length) bits.push(`rated ${m.ratings.join(', ')}`);
      if (m.from && m.to) bits.push(`${niceDate(m.from)} to ${niceDate(m.to)}`);
      const what = r.clips?.mode === 'tag' ? `clips tagged “${r.clips.tag}”` : r.clips?.mode === 'pick' ? `${r.clips.ids?.length || 0} chosen clips` : 'any clip';
      return `Plays ${r.count} from ${what} before ${bits.length ? bits.join(' · ') : 'everything'}`;
    };
    main.innerHTML = String(html`${head('Pre-rolls', 'Short clips that play before a movie or episode, the same way on every device. Rules run from top to bottom until the limit is reached.', html`<button class="btn primary" data-new>New rule</button>`)}
      <div class="card" data-settings><h2>Settings</h2>${check(set0, 'enabled', 'Play pre-rolls')}${range(set0, 'max', 'Most clips per title', 0, 6, 1)}${check(set0, 'onResume', 'Also play them when resuming part-way through')}</div>
      <div class="card"><h2>Rules</h2>${P.rules.length ? P.rules.map((r, i) => html`<div class="row" data-id="${r.id}"><div class="grow"><b>${r.name} ${r.enabled ? '' : html`<span class="pill">Off</span>`}</b><span>${describe(r)}</span></div>
        <div class="tools">${i ? html`<button class="btn sm" data-up title="Run earlier">↑</button>` : ''}<button class="btn sm" data-edit>Edit</button><button class="btn sm danger" data-del>Delete</button></div></div>`)
    : html`<p class="muted">${P.clips.length ? 'No rules yet, so nothing plays. Add a rule to choose which clips play before what.' : 'Add a “Pre-roll clips” library first, then come back to make rules.'}</p>`}</div>
      <div class="card"><h2>Clips (${P.clips.length})</h2>${P.clips.length ? P.clips.map((c) => html`<div class="row"><div class="grow"><b>${c.title}</b><span>${mins(c.runtime_s)}${c.tags.length ? ` · tags: ${c.tags.join(', ')}` : ''}</span></div></div>`) : html`<p class="muted">No clips found. <a href="#libraries">Add a pre-roll library</a>.</p>`}</div>`);
    bind($('[data-settings]', main), set0, debounce(async () => { try { await api('PUT', '/api/studio/settings', { prerolls: set0 }); toast('Saved', 1200); } catch (e) { fail(e); } }, 400));
    const tags = [...new Set(P.clips.flatMap((c) => c.tags))].sort();
    const form = (r) => {
      const v = clone(r || { name: '', enabled: true, count: 1, clips: { mode: 'all' }, match: {} });
      v.match.kinds ||= []; v.match.libraries ||= []; v.match.genres ||= []; v.match.ratings ||= []; v.clips.ids ||= [];
      const boxes = (key, list, label = (x) => x) => html`<div class="checks">${list.map((x) => html`<label class="check"><input type="checkbox" data-multi="${key}" value="${x}" ${get(v, key).map(String).includes(String(x)) ? 'checked' : ''}> ${label(x)}</label>`)}</div>`;
      const d = dialog(r ? `Edit ${r.name}` : 'New pre-roll rule', html`${text(v, 'name', 'Name', 'Halloween bumpers')}${check(v, 'enabled', 'Rule is on')}${range(v, 'count', 'Clips to play', 1, 6, 1)}
        <h3 style="margin:14px 0 6px">Which clips</h3>
        <label class="f"><span>Choose from</span><select data-path="clips.mode"><option value="all" ${v.clips.mode === 'all' ? 'selected' : ''}>Any clip</option><option value="tag" ${v.clips.mode === 'tag' ? 'selected' : ''}>Clips with a tag</option><option value="pick" ${v.clips.mode === 'pick' ? 'selected' : ''}>Clips I pick</option></select></label>
        <div data-show="tag">${tags.length ? html`<label class="f"><span>Tag</span><select data-path="clips.tag">${tags.map((t) => html`<option ${v.clips.tag === t ? 'selected' : ''}>${t}</option>`)}</select></label>` : html`<p class="muted small">No tags yet. Put clips in a sub-folder to tag them.</p>`}</div>
        <div data-show="pick">${boxes('clips.ids', P.clips.map((c) => c.id), (id) => P.clips.find((c) => c.id === id).title)}</div>
        <h3 style="margin:14px 0 6px">Before what (leave empty for everything)</h3>
        <div class="f"><span>Type</span>${boxes('match.kinds', ['movie', 'episode'], (k) => (k === 'movie' ? 'Movies' : 'Episodes'))}</div>
        ${P.libraries.filter((l) => l.kind !== 'prerolls').length ? html`<div class="f"><span>Library</span>${boxes('match.libraries', P.libraries.filter((l) => l.kind !== 'prerolls').map((l) => l.id), libName)}</div>` : ''}
        ${P.genres.length ? html`<div class="f"><span>Genre</span>${boxes('match.genres', P.genres)}</div>` : ''}
        ${P.ratings.length ? html`<div class="f"><span>Rating</span>${boxes('match.ratings', P.ratings)}</div>` : ''}
        ${check(v, 'dated', 'Only between two dates each year')}<div data-show="dated">${dates('f', 'From', v.match.from)}${dates('t', 'To', v.match.to)}</div>`,
      { wide: true, onOk: async (el) => {
        for (const key of ['clips.ids', 'match.kinds', 'match.libraries', 'match.genres', 'match.ratings']) set(v, key, $$(`[data-multi="${key}"]:checked`, el).map((x) => (/ids|libraries/.test(key) ? +x.value : x.value)));
        if (v.clips.mode === 'tag') v.clips.tag ||= tags[0] || '';
        if (v.dated) { v.match.from = readDate(el, 'f'); v.match.to = readDate(el, 't'); } else { delete v.match.from; delete v.match.to; }
        delete v.dated;
        if (!r) v.position = (P.rules.at(-1)?.position ?? 0) + 1;
        await api('POST', '/api/studio/prerolls/rules', v); toast('Rule saved'); draw();
      } });
      v.dated = !!(v.match.from && v.match.to); $('[data-path=dated]', d.el).checked = v.dated;
      const show = () => { for (const s of $$('[data-show]', d.el)) s.hidden = s.dataset.show === 'dated' ? !v.dated : v.clips.mode !== s.dataset.show; };
      bind(d.el, v, show); show();
    };
    $('[data-new]', main).onclick = () => form(null);
    main.onclick = async (e) => {
      const b = e.target.closest('button'), row = e.target.closest('[data-id]'); if (!b || !row) return;
      const r = P.rules.find((x) => x.id === +row.dataset.id);
      try {
        if (b.hasAttribute('data-edit')) form(r);
        if (b.hasAttribute('data-del')) confirmBox(`Delete ${r.name}?`, 'The rule is removed. The clips stay.', 'Delete', async () => { await api('DELETE', `/api/studio/prerolls/rules/${r.id}`); draw(); });
        if (b.hasAttribute('data-up')) { const i = P.rules.indexOf(r); const order = [...P.rules]; [order[i - 1], order[i]] = [order[i], order[i - 1]]; for (const [n, x] of order.entries()) if (x.position !== n + 1) await api('POST', '/api/studio/prerolls/rules', { ...x, position: n + 1 }); draw(); }
      } catch (err) { fail(err); }
    };
  };
  await draw();
};

// ---------- profiles ----------
pages.profiles = async (main) => {
  const COLORS = ['#35d0d0', '#b344d6', '#ff7a3d', '#4ade80', '#ff4d7e', '#e8b84a', '#2a6df4'];
  const draw = async () => {
    const list = await api('GET', '/api/studio/profiles');
    main.innerHTML = String(html`${head('Profiles', 'Everyone who watches gets a profile with their own history, list and sign-in.', html`<button class="btn primary" data-new>Add a profile</button>`)}
      <div class="card">${list.map((p) => html`<div class="row" data-id="${p.id}"><div class="avatar" style="${p.color ? `background:${p.color}` : ''}">${p.name[0].toUpperCase()}</div>
        <div class="grow"><b>${p.name}</b><span>${p.admin ? 'Admin · can open the Studio' : 'Viewer'}</span></div>
        <div class="tools"><button class="btn sm" data-edit>Edit</button><button class="btn sm danger" data-del>Delete</button></div></div>`)}</div>`);
    const form = (p) => {
      const v = { id: p?.id, name: p?.name || '', admin: !!p?.admin, color: p?.color || '', password: '' };
      const d = dialog(p ? `Edit ${p.name}` : 'Add a profile', html`${text(v, 'name', 'Name')}
        <label class="f"><span>${p ? 'New password or PIN' : 'Password or PIN'}</span><input type="password" data-path="password" autocomplete="new-password" placeholder="${p ? 'Leave empty to keep the current one' : 'At least 4 characters'}"></label>
        <div class="f"><span>Colour</span><span class="checks">${COLORS.map((c) => html`<label class="check"><input type="radio" name="pc" value="${c}" ${v.color === c ? 'checked' : ''}><i style="width:22px;height:22px;border-radius:6px;background:${c};display:block"></i></label>`)}</span></div>
        ${check(v, 'admin', 'Admin (can open the Studio and change everything)')}`,
      { onOk: async (el) => {
        const b = { id: v.id, name: v.name, admin: v.admin, color: $('input[name=pc]:checked', el)?.value || v.color || null };
        if (v.password) b.password = v.password;
        await api('POST', '/api/studio/profiles', b); toast('Saved'); draw();
      } });
      bind(d.el, v, () => {});
    };
    $('[data-new]', main).onclick = () => form(null);
    main.onclick = (e) => {
      const b = e.target.closest('button'), row = e.target.closest('[data-id]'); if (!b || !row) return;
      const p = list.find((x) => x.id === +row.dataset.id);
      if (b.hasAttribute('data-edit')) form(p);
      if (b.hasAttribute('data-del')) confirmBox(`Delete ${p.name}?`, 'Their watch history and list are deleted too.', 'Delete', async () => { await api('DELETE', `/api/studio/profiles/${p.id}`); draw(); });
    };
  };
  await draw();
};

// ---------- plugins ----------
pages.plugins = async (main) => {
  const draw = async () => {
    const list = await api('GET', '/api/studio/plugins');
    main.innerHTML = String(html`${head('Plugins', 'Plugins add themes, styles and features without touching HallFlix itself. Install one from a .zip file.', html`<button class="btn primary" data-install>Install from .zip</button>`)}
      <div class="card">${list.length ? list.map((p) => html`<div class="row" data-id="${p.id}"><div class="grow"><b>${p.name} ${p.version ? html`<span class="pill">v${p.version}</span>` : ''} ${p.broken ? html`<span class="pill bad">Broken</span>` : ''}</b>
        <span>${p.broken || p.description || ''}${p.themes?.length ? ` · adds ${p.themes.length} theme${p.themes.length > 1 ? 's' : ''}` : ''}</span></div>
        <div class="tools">${p.broken ? '' : html`<label class="check"><input type="checkbox" data-toggle ${p.enabled ? 'checked' : ''}> On</label>`}<button class="btn sm danger" data-del>Remove</button></div></div>`)
    : html`<p class="muted">No plugins installed. See <code>docs/PLUGINS.md</code> in the HallFlix repo for how to make one.</p>`}</div>
      <p class="muted small">Only install plugins you trust: a plugin's code runs inside HallFlix for everyone who signs in.</p>`);
    $('[data-install]', main).onclick = () => {
      const inp = Object.assign(document.createElement('input'), { type: 'file', accept: '.zip' });
      inp.onchange = async () => {
        if (!inp.files[0]) return;
        try {
          const res = await fetch('/api/studio/plugins', { method: 'POST', body: inp.files[0], credentials: 'same-origin' });
          const d = await res.json(); if (!res.ok) throw new Error(d.error || 'Install failed');
          toast(`Installed ${d.id}`); draw();
        } catch (e) { fail(e); }
      };
      inp.click();
    };
    main.onchange = async (e) => { if (!e.target.matches('[data-toggle]')) return; try { await api('PUT', `/api/studio/plugins/${e.target.closest('[data-id]').dataset.id}`, { enabled: e.target.checked }); toast(e.target.checked ? 'Plugin on' : 'Plugin off'); } catch (err) { fail(err); } };
    main.onclick = (e) => { const b = e.target.closest('[data-del]'); if (!b) return; const id = b.closest('[data-id]').dataset.id; confirmBox(`Remove ${id}?`, 'The plugin and its themes are removed.', 'Remove', async () => { await api('DELETE', `/api/studio/plugins/${id}`); draw(); }); };
  };
  await draw();
};

// ---------- settings ----------
pages.settings = async (main) => {
  const s = await api('GET', '/api/studio/settings');
  main.innerHTML = String(html`${head('Settings', 'The few things that are set once.')}
    <div class="card"><h2>TMDb key</h2><p class="muted">HallFlix uses TMDb for posters, backdrops, cast and descriptions. The key is stored only in your HallFlix database.</p>
      <div class="f" style="margin-top:12px"><span>Key or read token</span><span class="imgrow"><input type="password" data-key value="${s.tmdbKey}" autocomplete="off" placeholder="Paste your TMDb API key"><button class="btn primary" data-savekey>Save and test</button></span></div>
      <p class="small" data-keymsg>${s.hasTmdb ? raw('<span class="pill ok">Connected</span>') : raw('<span class="pill bad">No key yet</span>')}</p></div>
    <div class="card"><h2>Sign-in screen</h2>${check(s, 'showProfilesOnLogin', 'Show the “Who’s watching?” profile picker (off asks for a name instead)')}</div>`);
  $('[data-key]', main).onfocus = (e) => { if (e.target.value.includes('…')) e.target.value = ''; };
  $('[data-savekey]', main).onclick = async () => {
    const msg = $('[data-keymsg]', main);
    try {
      const r = await api('PUT', '/api/studio/settings', { tmdbKey: $('[data-key]', main).value });
      msg.innerHTML = r.ok ? '<span class="pill ok">Connected</span> Scanning your libraries for details now.' : `<span class="pill bad">Not accepted</span> ${String(r.error || '').replace(/[<>&]/g, '')}`;
    } catch (e) { fail(e); }
  };
  bind(main, s, async () => { try { await api('PUT', '/api/studio/settings', { showProfilesOnLogin: s.showProfilesOnLogin }); toast('Saved', 1200); } catch (e) { fail(e); } });
};

// ---------- start ----------
(async () => {
  let b;
  try { b = await api('GET', '/api/boot'); } catch { root.innerHTML = '<div class="wait">HallFlix is not answering. Try again in a moment.</div>'; return; }
  if (b.setup || !b.profile) { location.href = '/'; return; }
  if (!b.profile.admin) { root.innerHTML = '<div class="wait"><div style="text-align:center"><h1>The Studio is for admins</h1><p class="muted" style="margin:10px 0 18px">Ask an admin to give your profile access.</p><a class="btn primary" href="/">Back to HallFlix</a></div></div>'; return; }
  shell(b.profile);
  addEventListener('hashchange', route);
  route();
})();
