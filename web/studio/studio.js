// HallFlix Studio: the admin panel. Every page here talks to /api/studio/* and needs an admin profile.
import { $, $$, api, html, raw, toast } from '/js/core.js';
import * as tools from './tools.js';
import { EVENTS, PACK_NAMES, playSound } from '/js/sounds.js';

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
  ['overview', 'Overview'], ['libraries', 'Libraries'], ['artwork', 'Artwork'], ['metadata', 'Metadata'], ['home', 'Home screen'], ['collections', 'Collections'],
  ['look', 'Look and feel'], ['seasons', 'Seasons'], ['prerolls', 'Pre-rolls'], ['guard', 'Parental controls'], ['profiles', 'Profiles'], ['lyrics', 'Lyrics'], ['ratings', 'Ratings'], ['subtitles', 'Subtitles'], ['plugins', 'Plugins'], ['settings', 'Settings'],
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
const choose = (o, p, label, options, blank) => html`<label class="f"><span>${label}</span><select data-path="${p}">${blank ? html`<option value="">${blank}</option>` : ''}
  ${options.map(([v, n]) => html`<option value="${v}" ${String(get(o, p) ?? '') === String(v) ? 'selected' : ''}>${n}</option>`)}</select></label>`;
const BG_SHADES = [['even', 'Even'], ['fade', 'Fade down'], ['spot', 'Spotlight'], ['tint', 'Accent tint']];
const BG_PLACES = [['center', 'Middle'], ['top', 'Top'], ['bottom', 'Bottom']];
const COVER_PLACES = [['br', 'Bottom right'], ['mr', 'Middle right'], ['tr', 'Top right'], ['bc', 'Bottom centre'], ['tc', 'Top centre'], ['tl', 'Top left']];
/** The covers on a library's Home tile: for the whole app, or one library (where empty means "same as the whole app"). */
const coversCard = (o, base, lib) => html`<div class="card"><h2>Covers on the Home tile</h2>
  <p class="muted small">${lib ? `How the covers sit on the ${lib} tile on Home. “Same as whole app” follows the Whole app tab.` : 'The stack of covers on each library’s tile on Home. A library can change any of this on its own tab.'}</p>
  ${choose(o, 'tileCovers.show', 'Covers', [['yes', 'Show'], ['no', 'Hide']], lib && 'Same as whole app')}
  ${choose(o, 'tileCovers.place', 'Position', COVER_PLACES, lib && 'Same as whole app')}
  ${range(o, 'tileCovers.size', 'Size (% of tile height)', 20, 100, 2, base.size)}
  ${choose(o, 'tileCovers.count', 'How many', [['1', 'One'], ['2', 'Two'], ['3', 'Three']], lib && 'Same as whole app')}
  ${choose(o, 'tileCovers.style', 'Style', [['angled', 'Angled'], ['flat', 'Flat, side by side'], ['fan', 'Fanned out']], lib && 'Same as whole app')}
  ${range(o, 'tileCovers.x', 'Move left or right', -40, 40, 1, base.x)}
  ${range(o, 'tileCovers.y', 'Move up or down', -40, 40, 1, base.y)}
  <p class="muted small">The two last sliders move the covers from the chosen position, as a share of the tile: negative is left or up.</p>
  ${lib && o.tileCovers ? html`<button class="btn sm" data-covers-reset>Use the whole-app settings for ${lib}</button>` : ''}</div>`;
/** Where a library's tile logo sits, as 0–100% across and down, from any of its settings (a dragged spot, or a place and nudges). */
const TL_PLACES = { tl: [0, 0], tc: [50, 0], tr: [100, 0], ml: [0, 50], mc: [50, 50], mr: [100, 50], bl: [0, 100], bc: [50, 100], br: [100, 100] };
function tileSpot(c) {
  if (c.place === 'free' && Number.isFinite(+c.fx) && Number.isFinite(+c.fy)) return [+c.fx, +c.fy];
  const [x, y] = TL_PLACES[c.place] || TL_PLACES.bl;
  return [Math.max(0, Math.min(100, x + (+c.x || 0))), Math.max(0, Math.min(100, y + (+c.y || 0)))];
}
const tlStyle = ([x, y], k) => `--ax:${(x / 100).toFixed(3)};--ay:${(y / 100).toFixed(3)};--k:${k};--j:${x < 34 ? 'start' : x > 66 ? 'end' : 'center'}`;
/** One library's tile in miniature: drag its logo (or name) anywhere, and size it, for that library alone. */
function tileEditor(l, own, base, bright = 100) {
  base = { ...base, brightness: bright };
  const c = { place: 'bl', size: 100, count: 'yes', ...base, ...(own.tileLogo || {}) };
  const vid = (u) => /\.(mp4|webm|m4v|mov)(\?|$)/i.test(u || '');
  const pic = own.tileBackground && !vid(own.tileBackground) ? own.tileBackground
    : own.tileUse !== 'artwork' && own.background && !vid(own.background) ? own.background : l.art;
  const k = Math.max(30, Math.min(300, +c.size || 100)) / 100;
  return html`<div class="tl-edit" data-tl-lib="${l.id}">
    <div class="tl-tile" style="${pic ? `--bg:url('${encodeURI(pic)}');` : ''}--bgpos:${({ top: 'center top', bottom: 'center bottom', left: 'left center', right: 'right center' })[own.tilePos] || 'center 30%'};--b:${(+own.tileBrightness || +base.brightness || 100) / 100}" title="Drag the logo to where it should sit on the ${l.name} tile">
      <span class="tl-logo" tabindex="0" role="button" aria-label="${l.name} logo: drag, or use the arrow keys, to move it" style="${tlStyle(tileSpot(c), k)}">${own.logo ? html`<img src="${own.logo}" alt="" draggable="false">` : html`<b>${l.name}</b>`}${c.count !== 'no' ? html`<small>Title count</small>` : ''}</span></div>
    <div class="tl-ctl"><b>${l.name}</b>
      <label class="tl-size">Size <input type="range" min="30" max="300" step="5" value="${Math.round(k * 100)}" data-tl-size><output>${Math.round(k * 100)}%</output></label>
      <label class="tl-size">Brightness <input type="range" min="0" max="160" step="5" value="${+own.tileBrightness || 0}" data-tl-bright><output>${+own.tileBrightness ? `${+own.tileBrightness}%` : 'Auto'}</output></label>
      <label class="check sm"><input type="checkbox" data-tl-count ${c.count !== 'no' ? 'checked' : ''}> Count</label>
      ${own.tileLogo ? html`<button class="btn sm" data-tl-reset title="Follow the Whole app settings again">Reset</button>` : ''}</div></div>`;
}
/** Home: how big the library tiles are, how bright their pictures, and the film logo on the banner. */
const homeCard = (theme) => html`<div class="card"><h2>Home page</h2>
  ${range(theme, 'homeTiles.width', 'Library tile width (pixels; smaller fits more in a row)', 180, 900, 10, 320)}
  ${range(theme, 'homeTiles.height', 'Library tile height (% of its width)', 20, 80, 1, 44)}
  ${range(theme, 'homeTiles.brightness', 'Brightness of the tile pictures (%)', 20, 160, 5, 100)}
  <p class="muted small">Each library can have its own brightness: use its slider under “Logo on each tile”, or on its tab.</p>
  ${range(theme, 'bannerLogo', 'Size of the film’s logo on the banner (% of the usual size)', 30, 250, 5, 100)}
  <p class="muted small">The preview shows Home while you adjust.</p></div>`;
const tilesEditorCard = (libraries, libs, base, bright = 100) => html`<div class="card"><h2>Logo on each tile</h2>
  <p class="muted small">Every library’s Home tile, each with its own logo position and size. Drag a logo anywhere on its tile (or click it and use the arrow keys), then set its size. Each tile keeps its own spot; the preview shows the Home tiles as you go.</p>
  <div class="tl-grid">${libraries.map((l) => tileEditor(l, libs[l.id], base, bright))}</div></div>`;

const LOGO_GRID = [['tl', 'Top left'], ['tc', 'Top centre'], ['tr', 'Top right'], ['ml', 'Middle left'], ['mc', 'Centre'], ['mr', 'Middle right'], ['bl', 'Bottom left'], ['bc', 'Bottom centre'], ['br', 'Bottom right']];
/** The logo (or name) on a library's Home tile, and the logo on its own page: for the whole app, or one library. */
const logoCard = (o, base, lib) => {
  const place = o.tileLogo?.place || (lib ? '' : 'bl');
  const shown = place || base.place || 'bl';
  return html`<div class="card"><h2>${lib ? `${lib} logo` : 'Library logos'}</h2>
  <p class="muted small">${lib ? `Where the ${lib} logo (or its name, if it has no logo) sits on its Home tile, and how big it is. Untouched settings follow the Whole app tab.` : 'Where each library’s logo (or its name) sits on its Home tile, and how big it is. Each library’s tab can change any of this.'}</p>
  <div class="f"><span>Position on the tile${lib && !place ? ' (same as whole app)' : ''}</span><div class="posgrid" role="group" aria-label="Where the logo sits on the tile">${LOGO_GRID.map(([v, n]) => html`<button type="button" data-tlpos="${v}" class="${shown === v ? 'on' : ''}" aria-label="${n}" title="${n}"><i></i></button>`)}</div></div>
  ${range(o, 'tileLogo.size', 'Size on the tile (% of the usual size)', 30, 300, 5, base.size ?? 100)}
  ${range(o, 'tileLogo.x', 'Move left or right', -45, 45, 1, base.x ?? 0)}
  ${range(o, 'tileLogo.y', 'Move up or down', -45, 45, 1, base.y ?? 0)}
  ${choose(o, 'tileLogo.count', 'Title count under the logo', [['yes', 'Show'], ['no', 'Hide']], lib && 'Same as whole app')}
  <p class="muted small">The sliders move the logo from the chosen position, as a share of the tile: negative is left or up. The preview jumps to the Home tiles while you adjust.</p>
  <h3 class="sub">${lib ? `At the top of the ${lib} page` : 'At the top of each library page'}</h3>
  ${choose(o, 'libPage.place', 'Logo on the page', [['left', 'Left, beside the tabs (usual)'], ['center', 'Centred, above the tabs'], ['right', 'Right'], ['name', 'Show the name instead of the logo'], ['hidden', 'Hidden: no logo or name']], lib && 'Same as whole app')}
  ${range(o, 'libPage.x', 'Move left or right (pixels)', -400, 400, 2, base.pageX ?? 0)}${range(o, 'libPage.y', 'Move up or down (pixels; down overlaps the banner)', -300, 300, 2, base.pageY ?? 0)}
  ${lib ? range(o, 'logoSize', `Logo height at the top of the ${lib} page (pixels, 0 = same as whole app)`, 0, 260, 2, 0)
    : range(o, 'libLogoSize', 'Logo height at the top of each library page (pixels, 0 = automatic)', 0, 260, 2, 0)}
  ${lib && (o.tileLogo || o.logoSize || o.libPage) ? html`<button class="btn sm" data-logo-reset>Use the whole-app settings for ${lib}</button>` : ''}</div>`;
};
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
      else { const url = await upload(b.dataset.accept); if (!url) return; set(obj, b.dataset.upload, url); }
      changed(true);
    } catch (err) { fail(err); }
  });
}

function upload(accept) {
  return uploadFiles(accept).then((list) => list[0]?.url || null);
}
/** Ask for files and upload each one. Resolves to [{ url, name }] (empty when nothing was chosen). */
function uploadFiles(accept = 'image/*,video/mp4,video/webm', multiple = false) {
  return new Promise((resolve, reject) => {
    const inp = Object.assign(document.createElement('input'), { type: 'file', accept, multiple });
    inp.onchange = async () => {
      const files = [...inp.files];
      if (!files.length) return resolve([]);
      toast(files.length > 1 ? `Uploading ${files.length} files…` : 'Uploading…', 1500);
      try {
        const out = [];
        for (const f of files) {
          const res = await fetch(`/api/studio/upload?name=${encodeURIComponent(f.name)}`, { method: 'POST', body: f, credentials: 'same-origin' });
          const d = await res.json();
          if (!res.ok) throw new Error(d.error || 'Upload failed');
          out.push({ url: d.url, name: f.name.replace(/\.[^.]+$/, '') });
        }
        resolve(out);
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
// The tool pages live in tools.js and borrow these helpers.
const kit = { head, dialog, confirmBox, fail, debounce, dates, readDate, niceDate, mins, browse };
pages.artwork = (main) => tools.artwork(main, kit);
pages.metadata = (main) => tools.metadata(main, kit);
pages.guard = (main) => tools.guard(main, kit);
pages.prerolls = (main) => tools.prerolls(main, kit);

// ---------- overview ----------
pages.overview = async (main) => {
  const draw = async () => {
    const [o, lk] = await Promise.all([api('GET', '/api/studio/overview'), api('GET', '/api/studio/look')]);
    const s = o.scan;
    main.innerHTML = String(html`${head('Overview', `HallFlix ${o.version} — everything at a glance.`)}
      <div class="grid">
        ${o.libraries.map((l) => html`<div class="stat"><span class="muted">${l.name}</span><b>${l.titles}</b><span class="muted small">${({ shows: `shows · ${l.episodes} episodes`, prerolls: 'clips', books: 'books', comics: `series · ${l.episodes} issues`, music: `albums · ${l.episodes} songs` })[l.kind] || 'movies'}${l.unmatched ? ` · ${l.unmatched} without details` : ''}</span></div>`)}
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
  const KIND = { movies: 'Movies', shows: 'Shows', books: 'Books', comics: 'Comics', music: 'Music', prerolls: 'Pre-roll clips' };
  const count = (l) => ({ shows: `${l.titles} shows, ${l.episodes} episodes`, books: `${l.titles} books`, comics: `${l.titles} series, ${l.episodes} issues`, music: `${l.titles} albums, ${l.episodes} songs`, prerolls: `${l.titles} clips` }[l.kind] || `${l.titles} titles`);
  const draw = async () => {
    const [o, hidden] = await Promise.all([api('GET', '/api/studio/overview'), api('GET', '/api/studio/hidden')]);
    const removed = [...new Map(hidden.map((h) => [`${h.library}|${h.title}`, h])).values()]; // a hidden season lists once, not per episode
    main.innerHTML = String(html`${head('Libraries', `Point HallFlix at folders inside ${o.mediaRoot}. Your files are only ever read, never changed.`, html`<button class="btn primary" data-add>Add a library</button>`)}
      <div class="card">${o.libraries.length ? o.libraries.map((l, i) => html`<div class="row" data-id="${l.id}">
        <div class="grow"><b>${l.name} <span class="pill">${KIND[l.kind]}</span> ${o.scan.running && o.scan.library === l.id ? html`<span class="pill live">Scanning</span>` : ''}</b>
          <span>${l.path} · ${count(l)}${l.unmatched ? ` · ${l.unmatched} without details` : ''}</span></div>
        <div class="tools">${i ? html`<button class="btn sm" data-up title="Move up">↑</button>` : ''}<button class="btn sm" data-scan>Scan</button>
          ${['movies', 'shows'].includes(l.kind) ? html`<button class="btn sm" data-fresh title="Look every title up again">Refresh details</button>` : ''}
          <button class="btn sm" data-edit>Edit</button><button class="btn sm danger" data-del>Remove</button></div></div>`)
    : html`<p class="muted">No libraries yet. Add your Movies and Shows folders, plus a folder of pre-roll clips if you have one.</p>`}</div>
      ${removed.length ? html`<div class="card"><h2>Removed titles</h2><p class="muted small" style="margin-bottom:6px">Removed from HallFlix with their files left on the NAS. Bring one back and the next scan adds it again.</p>
        ${removed.map((h) => html`<div class="row" data-hidden="${h.id}"><div class="grow"><b>${h.title}</b><span>${h.library || 'Removed library'} · removed ${new Date(h.hidden_at).toLocaleDateString()}</span></div><button class="btn sm" data-restore>Bring back</button></div>`)}</div>` : ''}
      <p class="muted small">Tip: inside a pre-roll folder, sub-folder names become tags. Clips in <code>halloween/</code> get the tag “halloween”, which pre-roll rules can use.</p>
      <p class="muted small">Books: EPUB and PDF, Calibre folders included. Comics: CBZ, CBR, CB7 and PDF; a folder per series works best. Music: MP3, FLAC, AAC/M4A, Ogg, Opus, WAV and more, sorted by their tags.</p>`);
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
      const rs = e.target.closest('[data-restore]');
      if (rs) { try { const r = await api('DELETE', `/api/studio/hidden/${rs.closest('[data-hidden]').dataset.hidden}`); toast(`Bringing back ${r.title}. It appears after the scan.`); draw(); } catch (err) { fail(err); } return; }
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

// ---------- choosing titles (Home spotlight, collections) ----------
/** A search box with results to add, and the chosen titles in order with move and remove buttons. */
function titlePicker(el, chosen, changed) {
  el.innerHTML = String(html`<input type="text" data-find placeholder="Search for a movie or show to add"><div class="browser" data-found hidden></div><div data-chosen></div>`);
  const draw = () => {
    $('[data-chosen]', el).innerHTML = String(html`${chosen.length ? chosen.map((t, i) => html`<div class="row" data-i="${i}"><span class="pill">${i + 1}</span>${t.poster ? html`<img src="${t.poster}" alt="" style="width:30px;height:45px;object-fit:cover;border-radius:3px">` : ''}
      <div class="grow"><b>${t.title}</b><span>${[t.year, t.kind === 'show' ? 'Show' : 'Movie'].filter(Boolean).join(' · ')}</span></div>
      <div class="tools">${i ? html`<button class="btn sm" data-up title="Move up">↑</button>` : ''}${i < chosen.length - 1 ? html`<button class="btn sm" data-down title="Move down">↓</button>` : ''}<button class="btn sm danger" data-drop title="Remove">✕</button></div></div>`)
    : html`<p class="muted small" style="margin-top:10px">Nothing chosen yet.</p>`}`);
  };
  const find = debounce(async (term) => {
    const box = $('[data-found]', el);
    if (!term.trim()) { box.hidden = true; return; }
    const r = await api('GET', `/api/search?q=${encodeURIComponent(term)}`).catch(() => ({ items: [] }));
    const list = r.items.filter((x) => !chosen.some((c) => c.id === x.id)).slice(0, 8);
    box.hidden = false;
    box.innerHTML = String(html`${list.length ? list.map((x) => html`<button data-add="${x.id}">＋ ${x.title} ${x.year ? `(${x.year})` : ''}</button>`) : html`<button disabled class="muted">No matches</button>`}`);
    box.list = list;
  }, 220);
  el.addEventListener('input', (e) => { if (e.target.matches('[data-find]')) { e.stopPropagation(); find(e.target.value); } });
  el.addEventListener('click', (e) => {
    const add = e.target.closest('[data-add]'), row = e.target.closest('[data-i]');
    if (add) { const x = $('[data-found]', el).list.find((i) => i.id === +add.dataset.add); chosen.push({ id: x.id, title: x.title, year: x.year, kind: x.kind, poster: x.poster }); $('[data-find]', el).value = ''; $('[data-found]', el).hidden = true; }
    else if (row && e.target.closest('button')) {
      const i = +row.dataset.i;
      if (e.target.closest('[data-drop]')) chosen.splice(i, 1);
      else { const j = e.target.closest('[data-up]') ? i - 1 : i + 1; [chosen[i], chosen[j]] = [chosen[j], chosen[i]]; }
    } else return;
    e.preventDefault(); draw(); changed?.();
  });
  draw();
}

// ---------- home screen ----------
pages.home = async (main) => {
  const H = await api('GET', '/api/studio/home');
  const order = [...H.order.filter((id) => H.sections.some((s) => s.id === id)), ...H.sections.map((s) => s.id).filter((id) => !H.order.includes(id))];
  const hidden = new Set(H.hidden), spot = [...H.spotlight], ann = { ...H.announcement }, banner = { ...H.banner };
  const save = debounce(async () => { try { await api('PUT', '/api/studio/home', { order, hidden: [...hidden], spotlight: spot.map((x) => x.id), announcement: ann, banner }); toast('Saved', 1200); } catch (e) { fail(e); } }, 350);
  main.innerHTML = String(html`${head('Home screen', 'Decide what Home shows and in what order. Changes save as you make them and show on every device.')}
    <div class="card"><h2>Sections, top to bottom</h2><div data-order></div>
      <p class="muted small" style="margin-top:10px">To limit how many titles each section shows, how many sections show before “Show more rows”, or to add a scroll bar, see <a href="#look">Look and feel → Rows on Home and in libraries</a>. It covers every library too.</p></div>
    <div class="card"><h2>Spotlight</h2><p class="muted small" style="margin-bottom:10px">Pick titles for the big banner on Home, in the order they should show. With none picked, HallFlix shuffles titles from your libraries.</p><div data-spot></div>
      <div data-banner style="margin-top:14px">
        ${check(banner, 'pickedOnly', 'When titles are picked, show only those (otherwise shuffled titles follow them)')}
        ${choose(banner, 'shuffle', 'Shuffle to a new mix', [['visit', 'Every time Home opens'], ['hour', 'Every hour'], ['day', 'Once a day']])}
        ${range(banner, 'count', 'How many titles the banner goes through', 3, 12, 1, 8)}
        ${check(banner, 'favourNew', 'Favour recent additions (up to half the mix)')}
        <p class="muted small">Library pages shuffle the same way. How the banner moves (clips from the films, trailers or still pictures) is under <a href="#look">Look and feel → Motion</a>.</p></div></div>
    <div class="card" data-ann><h2>Announcement</h2><p class="muted small">A banner above the rows, such as “New this week: three more seasons of…”. Leave empty for none.</p>
      ${text(ann, 'text', 'Message', 'New this week…')}${text(ann, 'link', 'Link (optional)', '#/library/1 or https://…')}</div>`);
  const drawOrder = () => {
    $('[data-order]', main).innerHTML = String(html`${order.map((id, i) => html`<div class="row" data-id="${id}"><span class="pill">${i + 1}</span><div class="grow"><b>${H.sections.find((s) => s.id === id).name}</b></div>
      <div class="tools"><label class="check"><input type="checkbox" data-show ${hidden.has(id) ? '' : 'checked'}> Show</label>${i ? html`<button class="btn sm" data-up>↑</button>` : ''}${i < order.length - 1 ? html`<button class="btn sm" data-down>↓</button>` : ''}</div></div>`)}`);
  };
  $('[data-order]', main).addEventListener('click', (e) => {
    const row = e.target.closest('[data-id]'), b = e.target.closest('button');
    if (!row || !b) return;
    const i = order.indexOf(row.dataset.id), j = b.hasAttribute('data-up') ? i - 1 : i + 1;
    [order[i], order[j]] = [order[j], order[i]]; drawOrder(); save();
  });
  $('[data-order]', main).addEventListener('change', (e) => { if (!e.target.matches('[data-show]')) return; const id = e.target.closest('[data-id]').dataset.id; if (e.target.checked) hidden.delete(id); else hidden.add(id); save(); });
  drawOrder();
  titlePicker($('[data-spot]', main), spot, save);
  bind($('[data-ann]', main), ann, save);
  bind($('[data-banner]', main), banner, save);
};

// ---------- collections ----------
pages.collections = async (main) => {
  const draw = async () => {
    const list = await api('GET', '/api/studio/collections');
    main.innerHTML = String(html`${head('Collections', 'Group titles into a world of their own, with a backdrop, a logo and a viewing order: a franchise, a marathon, a director.', html`<button class="btn primary" data-new>New collection</button>`)}
      <div class="card">${list.length ? list.map((c) => html`<div class="row" data-id="${c.id}"><div class="grow"><b>${c.name}</b><span>${c.items.length} title${c.items.length === 1 ? '' : 's'}${c.items.length ? `: ${c.items.slice(0, 4).map((i) => i.title).join(', ')}${c.items.length > 4 ? '…' : ''}` : ''}</span></div>
        <div class="tools"><button class="btn sm" data-edit>Edit</button><button class="btn sm danger" data-del>Delete</button></div></div>`)
    : html`<p class="muted">No collections yet. Make one and it appears as a row on Home.</p>`}</div>`);
    const form = (c) => {
      const v = { id: c?.id, name: c?.name || '', description: c?.description || '', backdrop: c?.backdrop || '', logo: c?.logo || '' };
      const chosen = [...(c?.items || [])];
      const body = () => html`<div data-fields>${text(v, 'name', 'Name', 'Halloween marathon')}${text(v, 'description', 'Description')}
        ${image(v, 'backdrop', 'Backdrop (empty uses art from the first title)')}${image(v, 'logo', 'Logo instead of the name (optional)')}</div>
        <h3 style="margin:16px 0 8px">Titles, in viewing order</h3><div data-titles></div>`;
      const d = dialog(c ? `Edit ${c.name}` : 'New collection', body(), { wide: true, onOk: async () => {
        await api('POST', '/api/studio/collections', { ...v, items: chosen.map((x) => x.id) }); toast('Collection saved'); draw();
      } });
      const wire = () => { bind($('[data-fields]', d.el), v, (redraw) => { if (redraw) { const fresh = document.createElement('div'); fresh.innerHTML = String(body()); $('[data-fields]', d.el).replaceWith($('[data-fields]', fresh)); wire(); } }); };
      wire();
      titlePicker($('[data-titles]', d.el), chosen);
    };
    $('[data-new]', main).onclick = () => form(null);
    main.onclick = (e) => {
      const b = e.target.closest('button'), row = e.target.closest('[data-id]'); if (!b || !row) return;
      const c = list.find((x) => x.id === +row.dataset.id);
      if (b.hasAttribute('data-edit')) form(c);
      if (b.hasAttribute('data-del')) confirmBox(`Delete ${c.name}?`, 'Only the collection goes. The titles stay in your libraries.', 'Delete', async () => { await api('DELETE', `/api/studio/collections/${c.id}`); draw(); });
    };
  };
  await draw();
};

// ---------- live preview shared by Look and Seasons ----------
function previewPane(libraries) {
  return html`<section class="preview"><div class="bar"><h3 style="margin-right:auto">Live preview</h3>
    <select data-pv-go style="width:auto"><option value="#/">Home</option>${libraries.map((l) => html`<option value="#/library/${l.id}" data-lib="${l.id}">${l.name}</option>`)}<option value="#/signin">Sign-in page</option></select>
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

// The Sign-in page tab: background, logo, where the box sits, and what sets the box off from the picture behind it.
const LOGO_PLACES = [['above', 'Above the sign-in box'], ['inside', 'Inside the box’s panel'], ['corner', 'Top-left corner'], ['hidden', 'Hidden']];
const PANELS = [['none', 'No panel (floating)'], ['glass', 'Frosted glass'], ['solid', 'Solid']];
const WHERE = [['all', 'Everywhere'], ['behind', 'Behind the box'], ['away', 'Around the box (spotlight)'], ['side', 'The box’s side of the screen']];
const fileName = (u) => decodeURIComponent(String(u || '').split('/').pop());
const GLOWS = [['natural', 'Natural: soft light that falls off and is cast downward'], ['neon', 'Neon: a sharp halo all around'], ['ambient', 'Ambient: light only spills underneath']];
const RINGS = [['glow', 'A glow'], ['line', 'A crisp line'], ['aurora', 'A ring of light that travels around']];
const ATMOS = [['none', 'Nothing'], ['aurora', 'Aurora: slow drifting colour'], ['leak', 'Film light leak: warm light from the corner'], ['both', 'Both']];
const TILE_STYLES = [['layered', 'Layered 3D: picture, covers and name at different depths'], ['tilt', 'Tilt toward the pointer'], ['flat', 'Flat: lift a little']];
/** Glow, focus outline, the living light behind the app, and the pointer's light. */
const lightCard = (theme) => html`<div class="card"><h2>Glow and light</h2>
  ${choose(theme, 'glowStyle', 'Glow style', GLOWS)}${range(theme, 'glow', 'Glow strength', 0, 1, 0.05)}
  <p class="muted small">Natural light takes its colour from each poster's artwork when “Colour follows the artwork” is on, below.</p>
  ${choose(theme, 'focusRing', 'Outline around a title in focus', RINGS)}
  ${choose(theme, 'atmosphere', 'Living light behind the app', ATMOS)}
  ${check(theme, 'pointerLight', 'A soft light follows the pointer across the background (computers)')}
  <p class="muted small">The living light holds still on TVs and stops during playback, so it never slows a film down.</p></div>`;
/** The library tiles on Home. */
const tilesCard = (theme) => {
  const style = theme.tiles3d?.style || 'layered';
  return html`<div class="card"><h2>3D library tiles</h2>${choose(theme, 'tiles3d.style', 'Tiles on Home', TILE_STYLES)}
    ${style === 'layered' ? html`${range(theme, 'tiles3d.depth', 'Depth (how far the layers move)', 0.1, 1, 0.05, 0.6)}${range(theme, 'tiles3d.thickness', 'Edge thickness (pixels)', 0, 16, 1, 6)}
      ${check(theme, 'tiles3d.shine', 'A sheen slides across the tile as it turns')}${check(theme, 'tiles3d.sway', 'The tile in focus sways gently (TV remote and keyboard)')}` : ''}
    ${check(theme, 'tiles3d.video', 'Play a library’s tile video while the tile is pointed at or in focus')}
    <p class="muted small">Each library’s tab has a “Tile video” setting. A library with a background video plays that if it has no tile video.</p></div>`;
};
/** The sound pack, and each sound: test it, replace it with an upload, change its volume or switch it off. */
const soundsCard = (theme) => {
  const ev = theme.soundFx?.events || {};
  return html`<div class="card" data-sounds><h2>Sounds</h2>
    ${choose(theme, 'sounds', 'Sound pack', Object.entries(PACK_NAMES))}${range(theme, 'soundFx.volume', 'Volume of every sound', 0, 1, 0.05, 0.8)}
    <p class="muted small">Press ▶ to hear a sound. Upload your own to replace any of them (MP3, M4A, OGG or WAV; short clips of under a second work best for moving and choosing). Everyone can still turn sounds off for themselves from their profile menu.</p>
    <div class="sfx">${EVENTS.map(([k, name, desc]) => {
      const e = ev[k] || {};
      return html`<div class="sfx-row">
        <button class="btn sm sfx-play" data-sfx-play="${k}" title="Play this sound" aria-label="Play ${name}">▶</button>
        <div class="grow"><b>${name}</b><span>${e.url ? html`Your sound: ${e.name || fileName(e.url)}` : desc}</span></div>
        <label class="sfx-vol" title="Volume"><input type="range" data-path="soundFx.events.${k}.volume" min="0" max="1.5" step="0.05" value="${e.volume ?? 1}"></label>
        <label class="check"><input type="checkbox" data-path="soundFx.events.${k}.off" ${e.off ? 'checked' : ''}> Off</label>
        <button class="btn sm" data-sfx-up="${k}">${e.url ? 'Replace' : 'Upload'}</button>
        ${e.url ? html`<button class="btn sm danger" data-sfx-clear="${k}" title="Go back to the pack’s sound">✕</button>` : ''}</div>`;
    })}</div></div>`;
};
/** Songs for the sign-in page: uploaded or taken from the music library, in order or shuffled. */
const musicCard = (theme) => {
  const m = theme.login?.music || {}, list = Array.isArray(m.tracks) ? m.tracks : [];
  return html`<div class="card" data-music><h2>Music</h2>${check(theme, 'login.music.enabled', 'Play music on the sign-in page')}
    <div class="tracks">${list.length ? list.map((t, i) => html`<div class="row track" data-trk="${i}">
        <button class="btn sm" data-trk-play="${i}" title="Listen" aria-label="Listen">${studioSong.i === i && studioSong.a && !studioSong.a.paused ? '■' : '▶'}</button>
        <input type="text" data-trk-name="${i}" value="${t.name || fileName(t.url)}" aria-label="Song name shown on the page">
        <div class="tools">${i ? html`<button class="btn sm" data-trk-move="${i},-1" title="Move up">↑</button>` : ''}${i < list.length - 1 ? html`<button class="btn sm" data-trk-move="${i},1" title="Move down">↓</button>` : ''}
          <button class="btn sm danger" data-trk-del="${i}" title="Remove">✕</button></div></div>`)
      : html`<p class="muted small">No songs yet. Upload some, or pick songs from your music library.</p>`}</div>
    <div class="row-btns"><button class="btn sm" data-trk-add>Upload songs</button><button class="btn sm" data-trk-lib>From the music library</button></div>
    ${range(theme, 'login.music.volume', 'Volume', 0, 1, 0.05, 0.5)}${range(theme, 'login.music.fade', 'Fade in (seconds)', 0, 10, 0.5, 3)}
    ${check(theme, 'login.music.shuffle', 'Shuffle the songs')}
    ${choose(theme, 'login.music.button', 'Music button', [['corner', 'In the bottom corner'], ['hidden', 'Hidden']])}${check(theme, 'login.music.showTitle', 'Show the song’s name on the button')}
    <p class="muted small">The music fades out as someone signs in, and each device remembers if it was paused there. Web browsers may wait for the first tap or key press before playing sound; the Fire TV and phone apps play it straight away. The preview on the right doesn't start music on its own; press the button on it to try.</p></div>`;
};
const studioSong = { a: null, i: -1 };
/** Idents before a feature: several uploads, shuffled or in turn, with the built-in animation in the mix if wanted. */
const identCard = (theme) => {
  const id = theme.ident || {}, list = identList(theme);
  return html`<div class="card" data-idents><h2>Ident before a feature</h2>${check(theme, 'ident.enabled', 'Play an ident before a movie or episode')}
    <div class="tracks">${list.length ? list.map((v, i) => html`<div class="row track ident-row">
        <video src="${v.url}#t=0.5" muted preload="metadata" playsinline data-idv="${i}" title="Point at it to watch"></video>
        <input type="text" data-idname="${i}" value="${v.name || fileName(v.url)}" aria-label="Ident name">
        <div class="tools">${id.order === 'order' && i ? html`<button class="btn sm" data-idmove="${i},-1" title="Move up">↑</button>` : ''}${id.order === 'order' && i < list.length - 1 ? html`<button class="btn sm" data-idmove="${i},1" title="Move down">↓</button>` : ''}
          <button class="btn sm danger" data-iddel="${i}" title="Remove">✕</button></div></div>`)
      : html`<p class="muted small">No ident videos yet: the website plays the built-in HallFlix animation.</p>`}</div>
    <div class="row-btns"><button class="btn sm" data-idadd>Upload idents</button></div>
    ${choose(theme, 'ident.when', 'When it plays', [['first', 'First, before any pre-rolls'], ['last', 'Last, after the pre-rolls and right before the movie or episode']])}
    ${choose(theme, 'ident.order', 'Which one plays', [['shuffle', 'Shuffle (never the same one twice in a row)'], ['order', 'Take turns, in this order']])}
    ${check(theme, 'ident.builtIn', 'Include the built-in HallFlix animation in the mix (website only)')}
    <p class="muted small">MP4 (H.264) or WebM. Uploaded idents also play in the Fire TV, phone and Roku apps. A season can carry its own set.</p></div>`;
};
/** The ident videos in a look, including the older single "video" setting. */
function identList(theme) {
  const id = theme.ident || (theme.ident = {});
  if (!Array.isArray(id.videos)) id.videos = [];
  if (id.video && !id.videos.some((v) => v.url === id.video)) id.videos.unshift({ url: id.video, name: 'Ident 1' });
  id.video = '';
  return id.videos;
}

/** Rows on Home and in the libraries: for the whole app, or one library (where empty means "same as the whole app"). */
const ROW_ITEMS = [['6', '6'], ['8', '8'], ['10', '10'], ['12', '12'], ['15', '15'], ['20', '20'], ['0', 'All of them']];
const ROW_COUNT = [['3', '3'], ['4', '4'], ['5', '5'], ['6', '6'], ['8', '8'], ['10', '10'], ['12', '12'], ['0', 'All of them']];
/** The numbers in the Top rated row. */
const rankedCard = (theme, fonts) => {
  const st = theme.ranked?.style || 'outline';
  return html`<div class="card"><h2>Top rated numbers</h2>
  ${choose(theme, 'ranked.style', 'Style', [['outline', 'Outline (the usual)'], ['solid', 'Solid'], ['glow', 'Glowing'], ['badge', 'A small badge on the poster’s bottom corner'], ['hidden', 'Hidden: posters only']])}
  ${st === 'badge' || st === 'hidden' ? '' : choose(theme, 'ranked.place', 'Where', [['behind', 'Behind the poster, partly covered (the usual)'], ['front', 'In front of the poster, overlapping its corner'], ['beside', 'Beside the poster, not covered']])}
  ${st === 'hidden' ? '' : html`${range(theme, 'ranked.size', 'Size (% of the usual size)', 40, 160, 5, 100)}
    ${choose(theme, 'ranked.font', 'Font', [['theme', 'Same as the titles'], ...fonts.map((f) => [f, f])])}
    ${choose(theme, 'ranked.color', 'Colour', [['text', 'Like the text'], ['accent', 'Accent colour'], ['gradient', 'Accent gradient (second accent for outlines)']])}
    ${range(theme, 'ranked.strength', 'Strength (how solid the number looks, %)', 15, 100, 1, 62)}`}
  ${check(theme, 'ranked.scrollbar', 'Show the scroll bar under this row too (when the other rows have one)')}
  <p class="muted small">The preview jumps to the Top rated row while you adjust.</p></div>`;
};
const rowsCard = (o, lib, wholePanel = false, wholeHeight = 60) => {
  const same = lib && 'Same as whole app';
  const panel = lib ? String(o.rows?.panel ?? '') : '';
  return html`<div class="card"><h2>${lib ? `Rows in ${lib}` : 'Rows on Home and in libraries'}</h2>
    <p class="muted small">${lib ? `Keep the ${lib} page tidy. “Same as whole app” follows the Whole app tab.` : 'Keep Home and every library from overflowing, so the background stays in view. Each library’s tab can change any of this for that library.'}</p>
    ${choose(o, 'rows.items', 'Titles in each row', ROW_ITEMS, same)}
    <p class="muted small">A longer row ends with a “See all” tile that opens the full list, or “Show all” where there is no list to open.</p>
    ${choose(o, 'rows.sections', 'Rows on the page before “Show more rows”', ROW_COUNT, same)}
    ${choose(o, 'rows.scroll', 'Moving along a row', [['arrows', 'Arrows at the ends'], ['bar', 'Arrows and a scroll bar under the row']], same)}
    ${lib ? choose(o, 'rows.panel', 'Rows in their own scrolling panel', [['no', 'No: the page scrolls'], ['yes', 'Yes: rows scroll inside a panel']], same)
      : check(o, 'rows.panel', 'Hold the rows in their own scrolling panel, so the page stays short and the background shows')}
    ${(lib ? panel === 'yes' || (panel === '' && wholePanel) : o.rows?.panel) ? range(o, 'rows.panelHeight', 'Panel height (% of the screen)', 30, 90, 5, wholeHeight) : ''}</div>`;
};


function signinCards(theme) {
  const L = theme.login || {};
  const x = L.x || 'center', y = L.y || 'middle';
  const split = L.layout === 'split';
  return html`<div class="card"><h2>Layout</h2>${choose(theme, 'login.layout', 'Layout', [['floating', 'A box over the picture'], ['split', 'A side panel, with the picture beside it']])}
      ${split ? html`${choose(theme, 'login.side', 'Panel side', [['left', 'Left'], ['right', 'Right']])}${range(theme, 'login.sideWidth', 'Panel width (% of the screen)', 20, 70, 1, 33)}
        ${choose(theme, 'login.sidePicture', 'Picture', [['beside', 'Beside the panel'], ['behind', 'Full screen, behind the panel']])}
        ${color(theme, 'login.sideColor', 'Panel colour (empty uses the theme background)')}${range(theme, 'login.sideOpacity', 'Panel shade (0 = see-through, 1 = solid)', 0, 1, 0.02, 0.96)}
        ${range(theme, 'login.sideBlur', 'Frost (blur the picture behind the panel)', 0, 40, 1, 0)}
        ${choose(theme, 'login.sideEdge', 'Panel edge', [['line', 'A line'], ['none', 'Straight, no line'], ['fade', 'Soft fade into the picture']])}
        ${(L.sideEdge || (L.divider === false ? 'none' : 'line')) === 'fade' ? range(theme, 'login.fadeWidth', 'Fade width (% of the screen)', 4, 45, 1, 18) : ''}
        <p class="muted small">To see the picture through the panel, choose “Full screen, behind the panel” and lower the shade; add frost to blur it so the sign-in area stays easy to read.</p>
        ${choose(theme, 'login.y', 'Content in the panel', [['top', 'At the top'], ['middle', 'In the middle'], ['bottom', 'At the bottom']])}
        <p class="muted small">On phones the panel covers the screen.</p>` : ''}</div>
    <div class="card"><h2>Background</h2>${image(theme, 'login.image', 'Sign-in background picture or video')}
      ${range(theme, 'login.dim', 'Darken the whole screen', 0, 0.95, 0.05)}${range(theme, 'login.blur', 'Blur the whole picture', 0, 30, 1)}</div>
    ${musicCard(theme)}
    <div class="card"><h2>After signing in</h2>
      <p class="muted small">The loading screen shows for a moment while HallFlix opens, including right after someone signs in. Each device picks up a change the next time it opens HallFlix.</p>
      ${image(theme, 'splash.image', 'Loading screen picture (empty = your HallFlix logo from Logo above)')}
      ${range(theme, 'splash.size', 'Size (% of the usual size)', 30, 250, 5, 100)}
      ${choose(theme, 'splash.motion', 'Motion', [['pulse', 'Pulse (the usual)'], ['breathe', 'Breathe slowly'], ['glow', 'Glow on and off'], ['still', 'Still']])}
      ${color(theme, 'splash.background', 'Background colour (empty = the theme’s)')}
      <h3 class="sub">Welcome ident</h3>
      ${image(theme, 'splash.video', 'A short video that plays after signing in (MP4 or WebM; a GIF works as the loading picture instead)')}
      ${choose(theme, 'splash.when', 'When it plays', [['signin', 'Right after someone signs in'], ['open', 'Each time HallFlix opens (once per visit)'], ['never', 'Never (keep it for later)']])}
      ${choose(theme, 'splash.audio', 'Sound while it plays', [['own', 'Its own sound'], ['music', 'Keep the sign-in music playing (the video is silent)'], ['silent', 'Silent']])}
      <p class="muted small">It plays without any player controls, on TVs too. A browser that blocks sound plays it silently.</p>
      <p class="muted small">Anyone can skip it with any key, a tap, or the Skip button. It never runs longer than 30 seconds.</p></div>
    <div class="card"><h2>Logo</h2>${choose(theme, 'login.logoPlace', 'Where', LOGO_PLACES)}${range(theme, 'login.logoSize', 'Size (pixels tall)', 40, 340, 5)}
      ${image(theme, 'login.logo', 'A different logo for this page (empty uses the site logo)')}
      ${text(theme, 'login.title', 'Heading over the profiles', 'Who’s watching?')}</div>
    ${split ? '' : html`<div class="card"><h2>Sign-in box</h2>
      <div class="f"><span>Where on the screen</span><div class="posgrid" role="group" aria-label="Where the sign-in box sits">${['top', 'middle', 'bottom'].flatMap((yy) => ['left', 'center', 'right'].map((xx) => html`<button type="button" data-lpos="${xx},${yy}" class="${x === xx && y === yy ? 'on' : ''}" aria-label="${yy} ${xx}" title="${yy === 'middle' ? '' : `${yy} `}${xx === 'center' ? (yy === 'middle' ? 'centre' : 'centre') : xx}"><i></i></button>`))}</div></div>
      ${choose(theme, 'login.panel', 'Panel behind the box', PANELS)}
      ${L.panel && L.panel !== 'none' ? html`${range(theme, 'login.panelOpacity', 'Panel strength', 0.1, 1, 0.05)}${L.panel === 'glass' ? range(theme, 'login.panelBlur', 'Frost (blur behind the panel)', 0, 40, 1) : ''}` : ''}
      <p class="muted small">On phones the box is always centred.</p></div>`}
    <div class="card"><h2>Profiles and buttons</h2>
      ${choose(theme, 'login.tileShape', 'Profile picture shape', [['theme', 'Same as the theme'], ['rounded', 'Rounded square'], ['square', 'Square'], ['circle', 'Circle']])}
      ${check(theme, 'login.tileMotion', 'Profiles lift and tilt when pointed at')}${range(theme, 'login.tileSize', 'Profile picture size (pixels)', 56, 220, 2, 132)}${range(theme, 'login.tileColumns', 'Profiles per row (0 = as many as fit)', 0, 8, 1, 0)}
      ${choose(theme, 'login.buttons', 'Other ways to sign in', [['links', 'Small links'], ['outlined', 'Full-width outlined buttons'], ['filled', 'Full-width filled buttons']])}
      ${check(theme, 'login.manualButton', 'Offer “Sign in with name and password” under the profiles')}
      ${text(theme, 'login.manualLabel', 'Its label', 'Sign in with name and password')}${text(theme, 'login.phoneLabel', 'Label for signing in with a phone', 'Sign in with your phone')}
      ${text(theme, 'login.footer', 'Note at the bottom', 'Forgot your password? Ask Jus.')}${text(theme, 'login.footerLink', 'Link for the note (optional)', 'https://…')}</div>
    <div class="card"><h2>Make the box stand out</h2>
      ${choose(theme, 'login.darkWhere', 'Darken', [['none', 'Nothing extra'], ...WHERE])}${L.darkWhere && L.darkWhere !== 'none' ? range(theme, 'login.dark', 'How dark', 0.05, 1, 0.05) : ''}
      ${range(theme, 'login.focusBlur', 'Blur', 0, 40, 1)}${+L.focusBlur ? choose(theme, 'login.blurWhere', 'Blur where', WHERE) : ''}
      <p class="muted small">“Behind the box” keeps the rest of the picture clear; “Around the box” fades and softens everything else so the box is the bright spot.</p></div>`;
}

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
      <div class="tabs"><button data-tab="theme" class="${tab === 'theme' ? 'on' : ''}">Whole app</button><button data-tab="signin" class="${tab === 'signin' ? 'on' : ''}">Sign-in page</button>${L.libraries.map((l) => html`<button data-tab="lib-${l.id}" class="${tab === `lib-${l.id}` ? 'on' : ''}">${l.name}</button>`)}</div>
      ${tab === 'signin' ? signinCards(theme) : lib ? html`<div class="card" data-form="lib"><h2>${lib.name} only</h2><p class="muted small">Leave anything empty to use the whole-app look.</p>
          ${image(libs[lib.id], 'background', 'Library page background (picture or video). The Home tile has its own setting below.')}${range(libs[lib.id], 'dim', 'Darken background', 0, 0.95, 0.05, theme.background.dim)}
          ${range(libs[lib.id], 'blur', 'Blur background', 0, 30, 1, theme.background.blur || 0)}${choose(libs[lib.id], 'shade', 'Shade', BG_SHADES, 'Same as whole app')}${choose(libs[lib.id], 'position', 'Keep in view', BG_PLACES, 'Same as whole app')}
          <p class="muted small">You can also change this on the ${lib.name} page itself: admins see a picture button next to the library name.</p>
          ${image(libs[lib.id], 'logo', 'Logo shown instead of the library name')}
          ${image(libs[lib.id], 'tileVideo', 'Tile video: plays on the Home tile while it is pointed at or in focus (MP4 or WebM, short and silent)')}
          ${check(libs[lib.id], 'useAccent', 'Give this library its own accent colours')}
          ${libs[lib.id].useAccent ? html`${color(libs[lib.id], 'accent', 'Accent')}${color(libs[lib.id], 'accent2', 'Second accent')}` : ''}</div>
        <div class="card"><h2>${lib.name} tile</h2><p class="muted small">The ${lib.name} tile on Home has its own background, separate from the background of the ${lib.name} page above. Drag the logo to where it should sit, and set its size.</p>
          ${image(libs[lib.id], 'tileBackground', 'Tile background: a picture (or a short video) for the Home tile only')}
          ${choose(libs[lib.id], 'tileUse', 'With no tile background, the tile shows', [['', 'The library page’s background'], ['artwork', 'The newest artwork in the library']])}
          ${choose(libs[lib.id], 'tilePos', 'Which part of the picture shows', [['', 'Centre, a little high (usual)'], ['center', 'Centre'], ['top', 'Top'], ['bottom', 'Bottom'], ['left', 'Left'], ['right', 'Right']])}
          ${tileEditor(lib, libs[lib.id], theme.tileLogo || {}, theme.homeTiles?.brightness ?? 100)}</div>
        ${logoCard(libs[lib.id], { ...(theme.tileLogo || {}), pageX: theme.libPage?.x, pageY: theme.libPage?.y }, lib.name)}
        ${coversCard(libs[lib.id], theme.tileCovers || {}, lib.name)}
        ${rowsCard(libs[lib.id], lib.name, !!theme.rows?.panel, theme.rows?.panelHeight ?? 60)}`
    : html`<div class="card"><h2>Start from a preset</h2><div class="presets">${L.presets.map((p) => html`<button class="preset ${theme.preset === p.id ? 'on' : ''}" data-preset="${p.id}" title="${p.description}">${swatch(p.theme, L.defaults)}<b>${p.name}</b></button>`)}</div></div>
        <div data-form="theme">
        <div class="card"><h2>Colours</h2>${color(theme, 'colors.bg', 'Background')}${color(theme, 'colors.surface', 'Panels')}${color(theme, 'colors.text', 'Text')}${color(theme, 'colors.muted', 'Quiet text')}${color(theme, 'colors.accent', 'Accent')}${color(theme, 'colors.accent2', 'Second accent')}</div>
        <div class="card"><h2>Type and shape</h2>${select(theme, 'interface', 'Interface style', L.options.interfaces)}${select(theme, 'fonts.display', 'Title font', L.options.fonts)}${select(theme, 'fonts.body', 'Reading font', L.options.fonts)}
          ${range(theme, 'radius', theme.interface === 'classic' ? 'Card corners' : 'Corner cut', 0, 28, 1)}${select(theme, 'cardShape', 'Card shape', L.options.cardShapes)}${range(theme, 'heroHeight', 'Banner height', 40, 100, 5)}</div>
        ${lightCard(theme)}
        <div class="card"><h2>Texture and effects</h2>${select(theme, 'texture', 'Texture', L.options.textures)}${select(theme, 'effect', 'Moving effect', L.options.effects)}</div>
        <div class="card"><h2>Backgrounds</h2>${image(theme, 'background.image', 'Home background picture or video')}${range(theme, 'background.dim', 'Darken', 0, 0.95, 0.05)}${range(theme, 'background.blur', 'Blur', 0, 30, 1)}${choose(theme, 'background.shade', 'Shade', BG_SHADES)}${choose(theme, 'background.position', 'Keep in view', BG_PLACES)}
          <p class="muted small">The sign-in screen has its own background and layout: see the Sign-in page tab.</p></div>
        ${tilesCard(theme)}
        ${rowsCard(theme, '')}
        ${rankedCard(theme, L.options.fonts || [])}
        ${homeCard(theme)}
        ${tilesEditorCard(L.libraries, libs, theme.tileLogo || {}, theme.homeTiles?.brightness ?? 100)}
        ${logoCard(theme, theme.tileLogo || {}, '')}
        ${coversCard(theme, theme.tileCovers || {}, '')}
        <div class="card"><h2>Motion</h2>
          ${check(theme, 'artColor', 'Colour follows the artwork in focus')}${check(theme, 'depth', 'Posters lean toward the pointer')}
          ${choose(theme, 'heroMotion', 'Spotlight banner', [['clip', 'Clips from the film itself'], ['trailer', 'YouTube trailers (computers only)'], ['pan', 'Pan the picture slowly'], ['none', 'Still picture']])}
          ${(theme.heroMotion || 'clip') === 'clip' ? html`<p class="muted small">HallFlix cuts short clips from each banner title’s own file, from a random moment in the window below, and keeps a few per title so they vary. The first time a title comes up it shows its picture while its first clip is made.</p>
            ${range(theme, 'heroClips.start', 'Clips start from (seconds in, to skip studio logos)', 0, 600, 10, 60)}
            ${range(theme, 'heroClips.end', 'Clips come from before (seconds in; 600 = the first 10 minutes)', 60, 1800, 30, 600)}
            ${range(theme, 'heroClips.length', 'Clip length (seconds)', 10, 60, 5, 30)}
            ${check(theme, 'heroClips.sound', 'Play clips with sound (each device can switch it with the banner’s speaker button)')}
            ${check(theme, 'heroClips.tv', 'Play clips on TVs too')}
            <p class="muted small">Changing the window or the length makes fresh clips as the banner asks for them.</p>` : ''}
          ${check(theme, 'profileColors', 'Tint each profile’s session with its own colour')}
          ${check(theme, 'glass', 'Glass controls that pick up the picture behind them')}${check(theme, 'previews', 'Open a larger preview when the pointer rests on a title')}
          ${select(theme, 'screensaver', 'Screensaver after five idle minutes', L.options.screensavers)}<p class="muted small">“tv” shows drifting artwork on TVs only, “all” on every screen. Glass and previews switch themselves off on TVs to keep them fast.</p></div>
        <div class="card"><h2>TVs (Fire TV and Android TV)</h2>
          <p class="muted small">A Fire TV Stick has far less power than a computer, so TVs get a lighter HallFlix. These settings only change TVs.</p>
          ${choose(theme, 'tv.width', 'Size of everything on the TV screen', [['1600', 'Like a computer (smallest, fits the most)'], ['1280', 'Medium'], ['960', 'Large (easiest to read from the sofa)']])}
          ${choose(theme, 'tv.focus', 'What is selected is outlined in', [['white', 'White (clearest on any picture)'], ['accent', 'The accent colour']])}
          ${range(theme, 'tv.rowItems', 'Most titles in a row on TVs', 6, 40, 1, 12)}
          ${range(theme, 'tv.rows', 'Most rows on a page on TVs', 2, 20, 1, 6)}
          ${check(theme, 'tv.effects', 'Moving background effects (snow, stars and so on)')}
          ${check(theme, 'tv.textures', 'Grain and texture over the page')}
          ${check(theme, 'tv.glow', 'Full soft glow (off uses a simpler, faster glow)')}
          ${check(theme, 'tv.wash', 'Colour wash that follows the banner')}
          ${check(theme, 'tv.tileVideos', 'Videos on library tiles')}
          ${check(theme, 'tv.stills', 'Show background videos and GIFs (sign-in page included) as still pictures (fastest)')}
          <p class="muted small">Banner clips on TVs are under Motion (“Play clips on TVs too”). The TV picks up changes the next time HallFlix opens on it.</p></div>
        ${soundsCard(theme)}
        ${identCard(theme)}
        <div class="card"><h2>Evening look</h2>${check(theme, 'night.enabled', 'Switch to a second look in the evening')}
          <label class="f"><span>From</span><input type="time" data-path="night.from" value="${theme.night?.from || '20:00'}"></label>
          <label class="f"><span>Until</span><input type="time" data-path="night.to" value="${theme.night?.to || '06:00'}"></label>
          <label class="f"><span>Look</span><select data-path="night.preset"><option value="">Choose a look</option>${L.presets.map((p) => html`<option value="${p.id}" ${theme.night?.preset === p.id ? 'selected' : ''}>${p.name}</option>`)}</select></label>
          <p class="muted small">Each device goes by its own clock. A running season takes priority.</p></div>
        <div class="card"><h2>Name and logo</h2>${text(theme, 'siteName', 'Site name')}${image(theme, 'logo.image', 'Logo (empty uses the HallFlix neon logo)')}${range(theme, 'logo.height', 'Logo size', 20, 120, 2)}${image(theme, 'logo.favicon', 'Browser tab icon (a small square picture; empty uses the HallFlix crown)')}</div></div>`}
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
  // On the Sign-in page tab, some choices show or hide others (panel strength, how dark, where to blur).
  box.addEventListener('change', (e) => { if (tab === 'signin' && e.target.matches('select[data-path^="login."], [data-path="login.focusBlur"]')) draw(); });
  // Choices that show or hide others on the Whole app tab.
  box.addEventListener('change', (e) => { if (e.target.matches('[data-path="tiles3d.style"], [data-path="login.music.enabled"], [data-path="rows.panel"], [data-path="tileUse"], [data-path="tilePos"], [data-path="ranked.style"], [data-path="heroMotion"]')) draw(); });
  // Sounds and sign-in music: test, upload, reorder and remove.
  const touched = (redraw = true) => { dirty = true; if (redraw) draw(); else for (const b of $$('.savebar button', box)) b.disabled = false; send(); };
  const music = () => { theme.login ||= {}; theme.login.music ||= {}; if (!Array.isArray(theme.login.music.tracks)) theme.login.music.tracks = []; return theme.login.music; };
  const stopSong = () => { studioSong.a?.pause(); studioSong.a = null; studioSong.i = -1; };
  box.addEventListener('input', (e) => {
    const n = e.target.closest('[data-idname]');
    if (n) { identList(theme)[+n.dataset.idname].name = n.value; touched(false); }
  });
  box.addEventListener('change', (e) => { if (e.target.matches('[data-path="ident.order"]')) draw(); });
  box.addEventListener('pointerover', (e) => { const v = e.target.closest?.('[data-idv]'); if (v) { v.currentTime = 0; v.play().catch(() => {}); } });
  box.addEventListener('pointerout', (e) => { const v = e.target.closest?.('[data-idv]'); if (v) v.pause(); });
  box.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-idadd],[data-iddel],[data-idmove]');
    if (!b) return;
    e.preventDefault();
    const list = identList(theme);
    try {
      if ('idadd' in b.dataset) {
        const files = await uploadFiles('video/mp4,video/webm', true);
        if (!files.length) return;
        list.push(...files); theme.ident.enabled = true;
        touched(); toast(files.length > 1 ? `${files.length} idents added` : 'Ident added');
      } else if (b.dataset.iddel) { list.splice(+b.dataset.iddel, 1); touched(); }
      else { const [i, by] = b.dataset.idmove.split(',').map(Number); [list[i], list[i + by]] = [list[i + by], list[i]]; touched(); }
    } catch (err) { fail(err); }
  });
  box.addEventListener('input', (e) => {
    const n = e.target.closest('[data-trk-name]');
    if (n) { music().tracks[+n.dataset.trkName].name = n.value; touched(false); }
  });
  box.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-sfx-play],[data-sfx-up],[data-sfx-clear],[data-trk-play],[data-trk-move],[data-trk-del],[data-trk-add],[data-trk-lib]');
    if (!b) return;
    e.preventDefault();
    const d = b.dataset;
    try {
      if (d.sfxPlay) { if (!playSound(d.sfxPlay, theme, { test: true })) toast('That sound is switched off'); return; }
      if (d.sfxUp) {
        const [f] = await uploadFiles('audio/*,.mp3,.m4a,.ogg,.wav,.flac');
        if (!f) return;
        theme.soundFx ||= {}; theme.soundFx.events ||= {};
        theme.soundFx.events[d.sfxUp] = { ...(theme.soundFx.events[d.sfxUp] || {}), url: f.url, name: f.name, off: false };
        touched(); playSound(d.sfxUp, theme, { test: true });
        return;
      }
      if (d.sfxClear) { const ev = theme.soundFx?.events?.[d.sfxClear]; if (ev) { delete ev.url; delete ev.name; } touched(); return; }
      const m = music();
      if (d.trkPlay) {
        const i = +d.trkPlay, playing = studioSong.i === i && studioSong.a && !studioSong.a.paused;
        stopSong();
        if (!playing) {
          studioSong.a = new Audio(m.tracks[i].url); studioSong.i = i;
          studioSong.a.volume = Math.max(0, Math.min(1, m.volume ?? 0.5));
          studioSong.a.onended = () => { stopSong(); draw(); };
          await studioSong.a.play();
        }
        draw(); return;
      }
      if (d.trkMove) { const [i, by] = d.trkMove.split(',').map(Number); const j = i + by; [m.tracks[i], m.tracks[j]] = [m.tracks[j], m.tracks[i]]; stopSong(); touched(); return; }
      if (d.trkDel) { m.tracks.splice(+d.trkDel, 1); stopSong(); touched(); return; }
      if ('trkAdd' in d) {
        const files = await uploadFiles('audio/*,.mp3,.m4a,.ogg,.wav,.flac', true);
        if (!files.length) return;
        m.tracks.push(...files); m.enabled = true;
        touched(); toast(files.length > 1 ? `${files.length} songs added` : 'Song added');
        return;
      }
      if ('trkLib' in d) songPicker((t) => { m.tracks.push(t); m.enabled = true; touched(); });
    } catch (err) { fail(err); }
  });
  // Logo on each tile: drag (or arrow keys) to place, a slider to size, for one library at a time.
  const tlOf = (el) => { const ed = el.closest('[data-tl-lib]'); return ed && { ed, id: +ed.dataset.tlLib, own: libs[+ed.dataset.tlLib] }; };
  const tlPaint = (t) => {
    const c = { place: 'bl', size: 100, ...(theme.tileLogo || {}), ...(t.own.tileLogo || {}) };
    $('.tl-logo', t.ed).setAttribute('style', tlStyle(tileSpot(c), Math.max(30, Math.min(300, +c.size || 100)) / 100));
  };
  const tlSet = (t, patch, redraw = false) => {
    t.own.tileLogo = { ...(t.own.tileLogo || {}), ...patch };
    if (redraw) { draw(); } else { tlPaint(t); const r = $('[data-tl-reset]', t.ed); if (!r) $('.tl-ctl', t.ed).insertAdjacentHTML('beforeend', '<button class="btn sm" data-tl-reset title="Follow the Whole app settings again">Reset</button>'); }
    dirty = true; for (const b of $$('.savebar button', box)) b.disabled = false; send(); showTiles();
  };
  const tlMove = (t, e) => {
    const r = $('.tl-tile', t.ed).getBoundingClientRect();
    const fx = Math.round(Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width) * 100)));
    const fy = Math.round(Math.max(0, Math.min(100, ((e.clientY - r.top) / r.height) * 100)));
    tlSet(t, { place: 'free', fx, fy });
  };
  box.addEventListener('pointerdown', (e) => {
    const tile = e.target.closest('.tl-tile');
    if (!tile || e.button) return;
    const t = tlOf(tile);
    e.preventDefault();
    tile.setPointerCapture(e.pointerId);
    tile.classList.add('dragging');
    $('.tl-logo', t.ed).focus({ preventScroll: true });
    tlMove(t, e);
    const move = (ev) => tlMove(t, ev);
    const up = () => { tile.classList.remove('dragging'); tile.removeEventListener('pointermove', move); tile.removeEventListener('pointerup', up); tile.removeEventListener('pointercancel', up); };
    tile.addEventListener('pointermove', move); tile.addEventListener('pointerup', up); tile.addEventListener('pointercancel', up);
  });
  box.addEventListener('keydown', (e) => {
    const logo = e.target.closest('.tl-logo');
    const d = { ArrowLeft: [-2, 0], ArrowRight: [2, 0], ArrowUp: [0, -3], ArrowDown: [0, 3] }[e.key];
    if (!logo || !d) return;
    e.preventDefault();
    const t = tlOf(logo), [x, y] = tileSpot({ place: 'bl', ...(theme.tileLogo || {}), ...(t.own.tileLogo || {}) });
    const step = e.shiftKey ? 5 : 1;
    tlSet(t, { place: 'free', fx: Math.max(0, Math.min(100, x + d[0] * step)), fy: Math.max(0, Math.min(100, y + d[1] * step)) });
  });
  box.addEventListener('input', (e) => {
    const tb = e.target.closest('[data-tl-bright]');
    if (tb) {
      const t = tlOf(tb), v = +tb.value;
      if (v) t.own.tileBrightness = v; else delete t.own.tileBrightness;
      tb.nextElementSibling.textContent = v ? `${v}%` : 'Auto';
      $('.tl-tile', t.ed).style.setProperty('--b', String((v || +theme.homeTiles?.brightness || 100) / 100));
      dirty = true; for (const b of $$('.savebar button', box)) b.disabled = false; send(); showTiles();
      return;
    }
    const sz = e.target.closest('[data-tl-size]');
    if (sz) { const t = tlOf(sz); sz.nextElementSibling.textContent = `${sz.value}%`; tlSet(t, { size: +sz.value }); }
  });
  box.addEventListener('change', (e) => {
    const ct = e.target.closest('[data-tl-count]');
    if (ct) tlSet(tlOf(ct), { count: ct.checked ? 'yes' : 'no' }, true);
  });
  box.addEventListener('click', (e) => {
    const rs = e.target.closest('[data-tl-reset]');
    if (rs) { const t = tlOf(rs); delete t.own.tileLogo; dirty = true; draw(); send(); showTiles(); }
  });
  // While the tile covers are being changed, the preview shows Home with the library tiles in view.
  const showTiles = () => {
    const sel = $('[data-pv-go]', main), frame = $('iframe', main);
    if (sel.value !== '#/') { sel.value = '#/'; sel.onchange({ target: sel }); }
    clearTimeout(showTiles.t);
    showTiles.t = setTimeout(() => frame.contentWindow?.postMessage({ type: 'hallflix-show', selector: '.libs' }, location.origin), 500);
  };
  box.addEventListener('input', (e) => { if (e.target.closest('[data-path^="tileCovers"], [data-path^="tileLogo"], [data-path^="homeTiles"], [data-path="bannerLogo"]')) showTiles(); });
  // While the logo at the top of the library pages is being moved, the preview shows a library page.
  const showLibPage = () => {
    const sel = $('[data-pv-go]', main);
    if (sel.value.startsWith('#/library/')) return;
    const want = curLib() ? `#/library/${curLib().id}` : [...sel.options].find((o) => o.value.startsWith('#/library/'))?.value;
    if (want) { sel.value = want; sel.onchange({ target: sel }); }
  };
  box.addEventListener('input', (e) => { if (e.target.closest('[data-path^="libPage"], [data-path="logoSize"], [data-path="libLogoSize"]')) showLibPage(); });
  const showRanked = () => {
    const sel = $('[data-pv-go]', main), frame = $('iframe', main);
    if (sel.value !== '#/') { sel.value = '#/'; sel.onchange({ target: sel }); }
    clearTimeout(showRanked.t);
    showRanked.t = setTimeout(() => frame.contentWindow?.postMessage({ type: 'hallflix-show', selector: '.row.ranked' }, location.origin), 500);
  };
  box.addEventListener('input', (e) => { if (e.target.closest('[data-path^="ranked."]')) showRanked(); });
  box.addEventListener('change', (e) => { if (e.target.closest('[data-path^="libPage"]')) showLibPage(); });
  box.addEventListener('click', async (e) => {
    const tl = e.target.closest('[data-tlpos]');
    if (tl) { const o = target(); o.tileLogo = { ...(o.tileLogo || {}), place: tl.dataset.tlpos }; dirty = true; draw(); send(); showTiles(); return; }
    if (e.target.closest('[data-logo-reset]') && curLib()) { delete libs[curLib().id].tileLogo; delete libs[curLib().id].logoSize; delete libs[curLib().id].libPage; dirty = true; draw(); send(); showTiles(); return; }
    if (e.target.closest('[data-covers-reset]') && curLib()) { delete libs[curLib().id].tileCovers; dirty = true; draw(); send(); showTiles(); return; }
    const lp = e.target.closest('[data-lpos]');
    if (lp) {
      const [x, y] = lp.dataset.lpos.split(',');
      theme.login = { ...(theme.login || {}), x, y };
      dirty = true; draw(); send();
      return;
    }
    const t = e.target.closest('[data-tab],[data-preset],[data-save],[data-undo]');
    if (!t) return;
    if (t.dataset.tab) {
      tab = t.dataset.tab; draw();
      const sel = $('[data-pv-go]', main); sel.value = curLib() ? `#/library/${curLib().id}` : tab === 'signin' ? '#/signin' : '#/'; sel.onchange({ target: sel });
    } else if (t.dataset.preset) {
      const p = L.presets.find((x) => x.id === t.dataset.preset);
      const keep = { siteName: theme.siteName, logo: theme.logo, background: theme.background, login: theme.login };
      theme = { ...merge(clone(L.defaults), p.theme), ...keep, preset: p.id };
      dirty = true; draw(); send();
    } else if (t.hasAttribute('data-undo')) route();
    else if (t.hasAttribute('data-save')) {
      try {
        if (theme.night) theme.night.theme = clone(L.presets.find((x) => x.id === theme.night.preset)?.theme || {});
        await api('PUT', '/api/studio/theme', { theme });
        for (const l of L.libraries) if (JSON.stringify(libs[l.id]) !== JSON.stringify(l.look)) { await api('PUT', `/api/studio/libraries/${l.id}`, { look: libs[l.id] }); l.look = clone(libs[l.id]); }
        dirty = false; draw(); toast('Saved. The new look is live on every device.');
      } catch (err) { fail(err); }
    }
  });
  draw();
};

/** Find songs in the music library and add them to the sign-in music. Each one is copied beside the uploads. */
function songPicker(add) {
  const d = dialog('Songs from the music library', html`<input type="text" data-song-q placeholder="Search by song, artist or album" style="width:100%">
    <div class="browser" data-songs><p class="muted small">Type to search your music.</p></div>`, { ok: '' });
  const box = $('[data-songs]', d.el);
  const find = debounce(async (term) => {
    const r = await api('GET', `/api/studio/songs?q=${encodeURIComponent(term)}`).catch(() => ({ songs: [] }));
    box.innerHTML = String(html`${r.songs.length ? r.songs.map((x) => html`<button data-song="${x.id}">＋ <b>${x.title}</b> <span class="muted">${[x.artist, x.album].filter(Boolean).join(' · ')}${x.seconds ? ` · ${mins(x.seconds)}` : ''}</span></button>`) : html`<p class="muted small">No songs match.</p>`}`);
  }, 220);
  $('[data-song-q]', d.el).addEventListener('input', (e) => find(e.target.value));
  box.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-song]');
    if (!b || b.disabled) return;
    b.disabled = true; b.firstChild.textContent = '… ';
    try { add(await api('POST', `/api/studio/songs/${b.dataset.song}/use`)); b.firstChild.textContent = '✓ '; toast('Song added'); }
    catch (err) { b.disabled = false; b.firstChild.textContent = '＋ '; fail(err); }
  });
  find('');
}

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
        ${image(cur, 'look.theme.background.image', 'Home background')}${image(cur, 'look.theme.login.image', 'Sign-in background')}${image(cur, 'look.theme.logo.image', 'Seasonal logo')}${image(cur, 'look.theme.ident.video', 'Seasonal ident video (MP4)')}</div>
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
// ---------- profiles ----------
// A "Manage profiles" grid: big pictures, when each person was last active and on how many devices, and an editor
// with the picture chooser, colour, PIN, admin access, the parental controls that apply, and the account tools.
const PROFILE_COLORS = ['#35d0d0', '#2a6df4', '#6366f1', '#b344d6', '#ff4d7e', '#f43f5e', '#ff7a3d', '#e8b84a', '#84cc16', '#1ce783', '#14b8a6', '#94a3b8'];
function ago(t) {
  if (!t) return 'Never signed in';
  const s = (Date.now() - new Date(t)) / 1000;
  if (s < 120) return 'Active just now';
  if (s < 3600) return `Active ${Math.round(s / 60)} min ago`;
  if (s < 86400) return `Active ${Math.round(s / 3600)} h ago`;
  if (s < 86400 * 45) return `Active ${Math.round(s / 86400)} days ago`;
  return `Last active ${new Date(t).toLocaleDateString()}`;
}
const faceStyle = (p) => `background:${p.color ? `linear-gradient(135deg, ${p.color}, color-mix(in srgb, ${p.color} 55%, #000))` : 'linear-gradient(135deg, var(--violet), var(--cyan))'}`;
const face = (p, big = false) => html`<span class="avatar ${big ? 'xl' : ''}" style="${faceStyle(p)}">${p.avatar ? html`<img src="${p.avatar}" alt="">` : (p.name || '?')[0].toUpperCase()}</span>`;
pages.profiles = async (main) => {
  const { editAvatar, saveAvatar, addToGallery } = await import('/js/avatar.js');
  let me = null, list = [], gallery = [];
  try { me = (await api('GET', '/api/boot')).profile; } catch { /* fine */ }
  const draw = async () => {
    let guard;
    [list, guard, gallery] = await Promise.all([api('GET', '/api/studio/profiles'), api('GET', '/api/studio/guard').catch(() => ({ rules: [] })), api('GET', '/api/avatars').catch(() => [])]);
    const rulesFor = (id) => (guard.rules || []).filter((r) => r.enabled !== false && (r.profiles || []).includes(id)).map((r) => r.name);
    main.innerHTML = String(html`${head('Profiles', 'Everyone who watches gets a profile with their own picture, history, list and sign-in. Click a profile to change anything about it.', html`<button class="btn primary" data-new>Add a profile</button>`)}
      <div class="pf-grid">${list.map((p) => {
        const rules = rulesFor(p.id);
        return html`<button class="pf-tile" data-edit="${p.id}" aria-label="Edit ${p.name}">${face(p, true)}<span class="pf-edit">Edit</span>
          <b>${p.name}${p.id === me?.id ? html` <small class="muted">(you)</small>` : ''}</b>
          <span class="pf-tags">${p.admin ? html`<span class="pill live">Admin</span>` : html`<span class="pill">Viewer</span>`}${rules.length ? html`<span class="pill bad" title="${rules.join(', ')}">Parental controls</span>` : ''}</span>
          <span class="muted small">${ago(p.seen)}${p.devices ? ` · ${p.devices} device${p.devices === 1 ? '' : 's'}` : ''}</span>
          <span class="muted small">${p.watched} watched · ${p.read} read</span></button>`;
      })}<button class="pf-tile pf-add" data-new><span class="avatar xl">+</span><b>Add a profile</b><span class="muted small">For someone else who watches</span></button></div>
      <div class="card pf-gallery"><div class="pf-ghead"><div><h2>Picture gallery</h2><p class="muted small">Add pictures once, then give them to anyone: drag a picture onto a profile above, or click it and choose who gets it.
        You can also drop a picture from your computer straight onto a profile. Pictures are cut to a square from the middle; use “Add one and frame it” to choose the part yourself.</p></div>
        <div class="tools"><button class="btn primary" data-gadd>Add pictures</button><button class="btn" data-gframe>Add one and frame it</button><input type="file" accept="image/*" multiple hidden data-gin></div></div>
        <div class="pf-gdrop" data-gdrop>${gallery.length ? gallery.map((g) => html`<div class="pf-g" draggable="true" data-g="${g.name}"><button data-guse="${g.name}" aria-label="Give this picture to a profile"><img src="${g.url}" alt="" loading="lazy" draggable="false"></button>
          <button class="pf-gx" data-gdel="${g.name}" aria-label="Remove from the gallery" title="Remove from the gallery">✕</button></div>`)
        : html`<p class="muted">No pictures yet. Drop some here, or press “Add pictures”. You can pick several at once.</p>`}</div><p class="muted small" data-gnote></p></div>`);
    const form = (p) => {
      const v = { id: p?.id, name: p?.name || '', admin: !!p?.admin, color: p?.color || '', password: '' };
      let pic = null; // a picture chosen before saving: { blob } or { remove: true }
      const preview = () => (pic?.blob ? { ...v, avatar: URL.createObjectURL(pic.blob) } : pic?.gallery ? { ...v, avatar: `/uploads/avatar-gallery/${pic.gallery}` } : pic?.remove ? { ...v, avatar: null } : { ...v, avatar: p?.avatar });
      const rules = p ? rulesFor(p.id) : [];
      const body = () => html`<div class="pf-form"><div class="pf-left"><button class="pf-face" data-pic aria-label="Change the picture">${face(preview(), true)}<span>Change picture</span></button>
          ${preview().avatar ? html`<button class="btn sm" data-nopic>Remove picture</button>` : ''}</div>
        <div class="pf-right">${text(v, 'name', 'Name')}
          <div class="f"><span>Colour</span><span class="pf-swatches">${PROFILE_COLORS.map((c) => html`<button type="button" data-sw="${c}" class="${v.color === c ? 'on' : ''}" style="background:${c}" aria-label="Colour ${c}"></button>`)}</span></div>
          <label class="f"><span>${p ? 'New password or PIN' : 'Password or PIN'}</span><input type="password" data-path="password" autocomplete="new-password" placeholder="${p ? 'Leave empty to keep the current one' : 'At least 4 characters'}"></label>
          ${check(v, 'admin', 'Admin (can open the Studio and change everything)')}
          ${p ? html`<div class="f"><span>Parental controls</span><span>${rules.length ? rules.join(', ') : html`<span class="muted">None</span>`} · <a href="#guard" data-x>Change</a></span></div>
            <div class="pf-danger"><h3>Account</h3><p class="muted small">${ago(p.seen)} · ${p.devices || 0} signed-in device${p.devices === 1 ? '' : 's'} · added ${new Date(p.created).toLocaleDateString()}</p>
              <div class="pf-actions"><button class="btn sm" data-signout ${p.devices ? '' : 'disabled'}>Sign out on all devices</button><button class="btn sm" data-clearhist>Clear watch and reading history</button>
              ${p.id !== me?.id ? html`<button class="btn sm danger" data-del>Delete profile</button>` : ''}</div></div>` : ''}</div></div>`;
      const d = dialog(p ? `Edit ${p.name}` : 'Add a profile', body(), { wide: true, onOk: async () => {
        const b = { id: v.id, name: v.name, admin: v.admin, color: v.color || null };
        if (v.password) b.password = v.password;
        const saved = await api('POST', '/api/studio/profiles', b);
        if (pic) await saveAvatar(saved.id, pic);
        toast('Saved'); draw();
      } });
      const redraw = () => { d.el.innerHTML = String(body()); };
      bind(d.el, v, () => {});
      d.el.addEventListener('click', async (e) => {
        const t = e.target;
        const sw = t.closest('[data-sw]');
        if (sw) { v.color = v.color === sw.dataset.sw ? '' : sw.dataset.sw; redraw(); return; }
        if (t.closest('[data-pic]')) { const res = await editAvatar({ profile: preview(), title: `A picture for ${v.name || 'this profile'}`, manage: true }); if (res) { pic = res; redraw(); } return; }
        if (t.closest('[data-nopic]')) { pic = { remove: true }; redraw(); return; }
        if (t.closest('[data-x]')) { d.close(); return; }
        if (t.closest('[data-signout]')) { await api('POST', `/api/studio/profiles/${p.id}/signout`).then(() => toast(`${p.name} is signed out everywhere${p.id === me?.id ? ' else' : ''}`), fail); d.close(); draw(); return; }
        if (t.closest('[data-clearhist]')) { d.close(); confirmBox(`Clear ${p.name}'s history?`, 'Everything they have watched and read, and where they stopped, is forgotten. Their list and playlists stay.', 'Clear history', async () => { await api('POST', `/api/studio/profiles/${p.id}/clear`); toast('History cleared'); draw(); }); return; }
        if (t.closest('[data-del]')) { d.close(); confirmBox(`Delete ${p.name}?`, 'Their watch history, list and playlists are deleted too.', 'Delete', async () => { await api('DELETE', `/api/studio/profiles/${p.id}`); draw(); }); }
      });
    };
    main.onclick = async (e) => {
      if (e.target.closest('[data-new]')) return form(null);
      if (e.target.closest('[data-gadd]')) return $('[data-gin]', main).click();
      if (e.target.closest('[data-gframe]')) { const res = await editAvatar({ title: 'Add a picture to the gallery' }); if (res?.blob) { await addToGallery(res.blob).then(() => toast('Added to the gallery'), fail); draw(); } return; }
      const del = e.target.closest('[data-gdel]');
      if (del) { await api('DELETE', `/api/studio/avatars/${del.dataset.gdel}`).catch(fail); toast('Removed from the gallery. Profiles using it keep their picture.'); draw(); return; }
      const use = e.target.closest('[data-guse]');
      if (use) {
        const name = use.dataset.guse, g = gallery.find((x) => x.name === name);
        const d = dialog('Who gets this picture?', html`<div class="pf-pick"><img class="pf-pickimg" src="${g.url}" alt=""><div class="pf-pickwho">${list.map((p) => html`<button class="pf-who" data-to="${p.id}">${face(p)}<b>${p.name}</b></button>`)}</div></div>`, { ok: '' });
        d.el.addEventListener('click', async (ev) => { const b = ev.target.closest('[data-to]'); if (!b) return; d.close(); await give(+b.dataset.to, { gallery: name }); });
        return;
      }
      const t = e.target.closest('[data-edit]');
      if (t) form(list.find((x) => x.id === +t.dataset.edit));
    };
    const give = async (id, res) => {
      const p = list.find((x) => x.id === id);
      try { await saveAvatar(id, res); toast(`New picture for ${p?.name || 'that profile'}`); } catch (err) { fail(err); }
      draw();
    };
    const upload = async (files) => {
      const pics = [...files].filter((f) => /^image\//.test(f.type));
      if (!pics.length) return;
      const note = $('[data-gnote]', main);
      let k = 0, bad = 0;
      for (const f of pics) { note.textContent = `Adding ${++k} of ${pics.length}…`; try { await addToGallery(f); } catch { bad++; } }
      toast(bad ? `Added ${pics.length - bad}, ${bad} could not be read` : `Added ${pics.length} picture${pics.length === 1 ? '' : 's'} to the gallery`);
      draw();
    };
    $('[data-gin]', main).onchange = (e) => upload(e.target.files);
    // Drag a gallery picture, or a file from the computer, onto a profile; or files onto the gallery.
    main.ondragstart = (e) => { const g = e.target.closest?.('[data-g]'); if (g) { e.dataTransfer.setData('application/x-hallflix-avatar', g.dataset.g); e.dataTransfer.effectAllowed = 'copy'; } };
    main.ondragover = (e) => {
      const zone = e.target.closest?.('[data-edit], [data-gdrop]');
      for (const z of $$('.drop-on', main)) if (z !== zone) z.classList.remove('drop-on');
      if (!zone) return;
      if (zone.matches('[data-gdrop]') && !e.dataTransfer.types.includes('Files')) return;
      e.preventDefault(); zone.classList.add('drop-on');
    };
    main.ondragleave = (e) => { const zone = e.target.closest?.('.drop-on'); if (zone && !zone.contains(e.relatedTarget)) zone.classList.remove('drop-on'); };
    main.ondrop = async (e) => {
      const zone = e.target.closest?.('[data-edit], [data-gdrop]');
      for (const z of $$('.drop-on', main)) z.classList.remove('drop-on');
      if (!zone) return;
      e.preventDefault();
      if (zone.matches('[data-gdrop]')) return upload(e.dataTransfer.files);
      const name = e.dataTransfer.getData('application/x-hallflix-avatar');
      const file = [...e.dataTransfer.files].find((f) => /^image\//.test(f.type));
      if (name) give(+zone.dataset.edit, { gallery: name });
      else if (file) give(+zone.dataset.edit, { blob: file });
    };
  };
  await draw();
};

// ---------- lyrics ----------
// Where lyrics come from: files on the NAS first, then the services here, in this order. LRCLIB is built in; any JSON
// lyrics API can be added by its address and where the lyrics sit in its answer; plugins can add services too.
pages.lyrics = async (main) => {
  let L = await api('GET', '/api/studio/lyrics');
  let dirty = false;
  const KIND = { builtin: 'Built in', custom: 'Your own', plugin: 'Plugin' };
  const save = async () => {
    try { L = { ...L, ...(await api('PUT', '/api/studio/lyrics', { providers: L.providers, autoFetch: L.autoFetch, saveLrc: L.saveLrc })) }; dirty = false; toast('Saved'); draw(); }
    catch (e) { fail(e); }
  };
  const editor = (p) => {
    const v = p ? JSON.parse(JSON.stringify(p)) : { id: `custom:${Date.now().toString(36)}`, name: '', url: '', synced: 'syncedLyrics', plain: 'plainLyrics', result: '', searchUrl: '', searchList: '', headers: {}, enabled: true };
    const hdr = Object.entries(v.headers || {}).map(([k, x]) => `${k}: ${x}`).join('\n');
    const d = dialog(p ? `Edit ${p.name}` : 'Add a lyrics service', html`<p class="muted small" style="margin-bottom:10px">Any web service that answers with JSON (or plain LRC text) works. Put
        <code>{artist}</code>, <code>{title}</code>, <code>{album}</code> and <code>{duration}</code> (seconds) in the address where the song goes.</p>
      ${text(v, 'name', 'Name', 'My lyrics service')}
      ${text(v, 'url', 'Address', 'https://lyrics.example.com/get?artist={artist}&title={title}&duration={duration}')}
      ${text(v, 'result', 'Answer is inside', 'Leave empty, or a path like data or results.0')}
      ${text(v, 'synced', 'Synced lyrics field', 'syncedLyrics')}
      ${text(v, 'plain', 'Plain lyrics field', 'plainLyrics')}
      <details style="margin-top:8px"><summary class="muted">Search and sign-in (optional)</summary>
        ${text(v, 'searchUrl', 'Search address', 'https://lyrics.example.com/search?q={query}')}
        ${text(v, 'searchList', 'Results are in', 'Leave empty if the answer is a list')}
        <label class="f block"><span>Headers</span><textarea data-hdr rows="3" placeholder="Authorization: Bearer abc123" style="width:100%">${hdr}</textarea></label></details>`,
    { wide: true, onOk: async (el) => {
      if (!v.name.trim() || !/^https?:\/\//i.test(v.url.trim())) { toast('Give it a name and an address starting with https://'); return false; }
      v.headers = Object.fromEntries($('[data-hdr]', el).value.split('\n').map((l) => l.split(/:(.*)/s).map((x) => (x || '').trim())).filter(([k, x]) => k && x));
      const i = L.providers.findIndex((x) => x.id === v.id);
      if (i >= 0) L.providers[i] = { ...v, kind: 'custom' }; else L.providers.push({ ...v, kind: 'custom' });
      await save();
    } });
    bind(d.el, v, () => {});
  };
  const draw = () => {
    const c = L.counts || {};
    main.innerHTML = String(html`${head('Lyrics', 'Lyrics come from the NAS first: a .lrc or .txt file with the same name as the song, or the song’s own tags. If there are none, HallFlix asks the services below, in order, and keeps what it finds.',
      html`<button class="btn primary" data-save ${dirty ? '' : 'disabled'}>Save</button>`)}
      <div class="card"><h2>Looking songs up</h2>
        <label class="check"><input type="checkbox" data-auto ${L.autoFetch ? 'checked' : ''}> Look up lyrics online when a song has none on the NAS</label>
        <label class="check"><input type="checkbox" data-savelrc ${L.saveLrc ? 'checked' : ''}> Save lyrics found online next to the songs as .lrc files</label>
        <p class="muted small">Saving needs write access to your media folder (drop <code>:ro</code> from the media line in the compose file). Existing files are never overwritten, except by lyrics someone chose by hand.</p></div>
      <div class="card"><h2>Lyrics services</h2><p class="muted small" style="margin-bottom:6px">Tried from the top. Turn one off to skip it; use the arrows to change the order.</p>
        ${L.providers.map((p, i) => html`<div class="row" data-i="${i}"><label class="check" style="margin:0"><input type="checkbox" data-on ${p.enabled ? 'checked' : ''} aria-label="Use ${p.name}"></label>
          <div class="grow"><b>${p.name} <span class="pill ${p.kind === 'builtin' ? 'live' : ''}">${KIND[p.kind] || p.kind}${p.plugin ? `: ${p.plugin}` : ''}</span></b><span>${p.description || p.url || ''}</span></div>
          <div class="tools"><button class="btn sm" data-up ${i ? '' : 'disabled'} aria-label="Move up">↑</button><button class="btn sm" data-down ${i < L.providers.length - 1 ? '' : 'disabled'} aria-label="Move down">↓</button>
            <button class="btn sm" data-try>Test</button>${p.kind === 'custom' ? html`<button class="btn sm" data-edit>Edit</button><button class="btn sm danger" data-del>Remove</button>` : ''}</div></div>`)}
        <div class="row"><button class="btn" data-add>Add a lyrics service</button><span class="muted small grow">Plugins can add services too: see “Lyrics” in the plugin guide.</span></div></div>
      <div class="card"><h2>Try a song</h2><p class="muted small">Asks every service for one song, to check they are set up right.</p>
        <div class="imgrow" style="margin-top:10px;flex-wrap:wrap"><input type="text" data-ta placeholder="Artist" style="flex:1;min-width:140px"><input type="text" data-tt placeholder="Song title" style="flex:1;min-width:140px"><input type="text" data-tl placeholder="Album (optional)" style="flex:1;min-width:140px"><input data-td type="number" placeholder="Seconds" style="width:110px"><button class="btn primary" data-test>Try it</button></div>
        <div data-out></div></div>
      <div class="card"><h2>What HallFlix has found</h2><p>${c.found || 0} songs with lyrics from online services (${c.synced || 0} time-synced), ${c.chosen || 0} chosen by hand, ${c.missing || 0} with none found yet.</p>
        <div class="tools" style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap"><button class="btn" data-again>Look again for songs with none</button><button class="btn danger" data-clear>Forget everything found online</button></div></div>`);
  };
  const test = async (only) => {
    const out = $('[data-out]', main);
    const b = { artist: $('[data-ta]', main).value, title: $('[data-tt]', main).value, album: $('[data-tl]', main).value, duration: +$('[data-td]', main).value || 0, only };
    if (!b.artist || !b.title) { toast('Type an artist and a song title first'); $('[data-ta]', main).focus(); return; }
    out.innerHTML = '<p class="muted" style="margin-top:12px">Asking…</p>';
    try {
      const { results } = await api('POST', '/api/studio/lyrics/test', b);
      out.innerHTML = String(html`<div style="margin-top:12px">${results.map((x) => html`<div class="row"><div class="grow"><b>${x.name} ${x.found ? html`<span class="pill ok">${x.synced ? `Synced · ${x.lines} lines` : 'Plain'}</span>` : x.error ? html`<span class="pill bad">Error</span>` : html`<span class="pill">Nothing found</span>`}${x.enabled ? '' : html` <span class="pill">Off</span>`}</b>
        <span>${x.error || x.preview || ''}</span></div><span class="muted small">${x.ms} ms</span></div>`)}</div>`);
    } catch (e) { out.innerHTML = String(html`<p class="muted" style="margin-top:12px">${e.message}</p>`); }
  };
  draw();
  main.onchange = (e) => {
    if (e.target.matches('[data-auto]')) { L.autoFetch = e.target.checked; dirty = true; }
    if (e.target.matches('[data-savelrc]')) { L.saveLrc = e.target.checked; dirty = true; }
    if (e.target.matches('[data-on]')) { L.providers[+e.target.closest('[data-i]').dataset.i].enabled = e.target.checked; dirty = true; }
    $('[data-save]', main).disabled = !dirty;
  };
  main.onclick = async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const row = b.closest('[data-i]'), i = row ? +row.dataset.i : -1;
    if (b.matches('[data-save]')) return save();
    if (b.matches('[data-add]')) return editor(null);
    if (b.matches('[data-edit]')) return editor(L.providers[i]);
    if (b.matches('[data-del]')) return confirmBox(`Remove ${L.providers[i].name}?`, 'Lyrics it already found stay.', 'Remove', async () => { L.providers.splice(i, 1); await save(); });
    if (b.matches('[data-up]') || b.matches('[data-down]')) { const j = i + (b.matches('[data-up]') ? -1 : 1); [L.providers[i], L.providers[j]] = [L.providers[j], L.providers[i]]; dirty = true; draw(); return; }
    if (b.matches('[data-try]')) { $('[data-ta]', main).focus(); if ($('[data-ta]', main).value && $('[data-tt]', main).value) test(L.providers[i].id); else toast('Type an artist and a song below, then press Test again'); return; }
    if (b.matches('[data-test]')) return test();
    if (b.matches('[data-again]')) { await api('DELETE', '/api/studio/lyrics/cache?missing=1').catch(fail); toast('Songs with no lyrics will be looked up again'); L = await api('GET', '/api/studio/lyrics'); draw(); return; }
    if (b.matches('[data-clear]')) return confirmBox('Forget the lyrics found online?', 'Each song is looked up again the next time it plays. Lyrics chosen by hand, and files on the NAS, stay.', 'Forget them', async () => { await api('DELETE', '/api/studio/lyrics/cache'); L = await api('GET', '/api/studio/lyrics'); draw(); });
  };
};

// ---------- ratings and subtitles ----------
// Both are lists of services tried from the top: built-in ones that need a free key, your own JSON services, and
// services that plugins add. servicePage() draws the list; each page adds its own settings and test.
const KINDS = { builtin: 'Built in', custom: 'Your own', plugin: 'Plugin' };
function servicePage(main, o) {
  let D, dirty = false;
  const load = async () => { D = await api('GET', o.url); };
  const save = async () => {
    try { D = { ...D, ...(await api('PUT', o.url, o.body(D))) }; dirty = false; toast('Saved'); draw(); }
    catch (e) { fail(e); }
  };
  const keyRow = (p) => (p.kind !== 'builtin' && p.kind !== 'custom') || (!p.needsKey && p.kind === 'builtin') ? '' : html`<div class="keys">
      <input type="password" data-k="apiKey" autocomplete="off" spellcheck="false" placeholder="${p.apiKeySet ? 'Key saved: type to replace it' : p.kind === 'custom' ? 'Key for {key} in the address (optional)' : 'API key'}" value="${p.apiKey || ''}">
      ${p.login ? html`<input type="text" data-k="username" autocomplete="off" placeholder="Account name (optional)" value="${p.username || ''}"><input type="password" data-k="password" autocomplete="off" placeholder="${p.passwordSet ? 'Password saved' : 'Password (optional)'}" value="">` : ''}
      ${p.keyUrl ? html`<a class="btn sm" href="${p.keyUrl}" target="_blank" rel="noopener">Get a free key ↗</a>` : ''}
      ${p.apiKeySet ? html`<button class="btn sm" data-clearkey>Forget key</button>` : ''}</div>`;
  const editor = (p) => {
    const v = p ? clone(p) : { id: `custom:${Date.now().toString(36)}`, name: '', url: '', headers: {}, enabled: true, ...o.blank };
    const hdr = Object.entries(v.headers || {}).map(([k, x]) => `${k}: ${x}`).join('\n');
    const d = dialog(p ? `Edit ${p.name}` : o.addTitle, html`${o.editorHelp}${text(v, 'name', 'Name', o.namePh)}${text(v, 'url', 'Address', o.urlPh)}
      ${o.fields.map(([k, label, ph]) => text(v, k, label, ph))}
      <label class="f block"><span>Headers (optional)</span><textarea data-hdr rows="3" placeholder="Authorization: Bearer abc123" style="width:100%">${hdr}</textarea></label>`,
    { wide: true, onOk: async (el) => {
      if (!v.name.trim() || !/^https?:\/\//i.test(v.url.trim())) { toast('Give it a name and an address starting with https://'); return false; }
      v.headers = Object.fromEntries($('[data-hdr]', el).value.split('\n').map((l) => l.split(/:(.*)/s).map((x) => (x || '').trim())).filter(([k, x]) => k && x));
      const i = D.providers.findIndex((x) => x.id === v.id);
      if (i >= 0) D.providers[i] = { ...v, kind: 'custom' }; else D.providers.push({ ...v, kind: 'custom' });
      await save();
    } });
    bind(d.el, v, () => {});
  };
  const draw = () => {
    main.innerHTML = String(html`${head(o.title, o.intro, html`<button class="btn primary" data-save ${dirty ? '' : 'disabled'}>Save</button>`)}
      ${o.settings(D)}
      <div class="card"><h2>${o.listTitle}</h2><p class="muted small" style="margin-bottom:6px">${o.listHelp}</p>
        ${D.providers.map((p, i) => html`<div class="row svc" data-i="${i}"><label class="check" style="margin:0"><input type="checkbox" data-on ${p.enabled ? 'checked' : ''} aria-label="Use ${p.name}"></label>
          <div class="grow"><b>${p.name} <span class="pill ${p.kind === 'builtin' ? 'live' : ''}">${KINDS[p.kind] || p.kind}${p.plugin ? `: ${p.plugin}` : ''}</span>
            ${p.needsKey && !p.apiKeySet && !p.apiKey ? html` <span class="pill bad">Needs a key</span>` : ''}</b><span>${p.description || p.url || ''}</span>${keyRow(p)}</div>
          <div class="tools"><button class="btn sm" data-up ${i ? '' : 'disabled'} aria-label="Move up">↑</button><button class="btn sm" data-down ${i < D.providers.length - 1 ? '' : 'disabled'} aria-label="Move down">↓</button>
            <button class="btn sm" data-try>Test</button>${p.kind === 'custom' ? html`<button class="btn sm" data-edit>Edit</button><button class="btn sm danger" data-del>Remove</button>` : ''}</div></div>`)}
        <div class="row"><button class="btn" data-add>${o.addTitle}</button><span class="muted small grow">${o.pluginHint}</span></div></div>
      <div class="card"><h2>Try it</h2><p class="muted small">${o.testHelp}</p>${o.testForm}<div data-out></div></div>
      ${o.stats(D)}`);
  };
  const test = async (only) => {
    const out = $('[data-out]', main);
    if (dirty) { toast('Save first, so the test uses what you typed'); return; }
    const b = { ...o.testBody(main), only };
    if (b === null) return;
    out.innerHTML = '<p class="muted" style="margin-top:12px">Asking…</p>';
    try {
      const r = await api('POST', `${o.url}/test`, b);
      out.innerHTML = String(html`<div style="margin-top:12px">${r.title ? html`<p class="muted small">Searching for ${r.title}</p>` : ''}${r.results.map((x) => html`<div class="row"><div class="grow"><b>${x.name} ${x.found ? html`<span class="pill ok">${o.foundText(x)}</span>` : x.error ? html`<span class="pill bad">${x.error === 'No key yet' || x.error === 'Switched off' ? x.error : 'Error'}</span>` : html`<span class="pill">Nothing found</span>`}${x.enabled ? '' : html` <span class="pill">Off</span>`}</b>
        <span>${x.error && !/^(No key yet|Switched off)$/.test(x.error) ? x.error : o.detail(x)}</span></div><span class="muted small">${x.ms != null ? `${x.ms} ms` : ''}</span></div>`)}</div>`);
    } catch (e) { out.innerHTML = String(html`<p class="muted" style="margin-top:12px">${e.message}</p>`); }
  };
  const mark = () => { dirty = true; const b = $('[data-save]', main); if (b) b.disabled = false; };
  main.oninput = (e) => {
    const k = e.target.dataset.k;
    if (k) { D.providers[+e.target.closest('[data-i]').dataset.i][k] = e.target.value; mark(); }
  };
  main.onchange = (e) => {
    if (e.target.matches('[data-on]')) { D.providers[+e.target.closest('[data-i]').dataset.i].enabled = e.target.checked; mark(); return; }
    if (o.onChange(D, e)) mark();
  };
  main.onclick = async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const row = b.closest('[data-i]'), i = row ? +row.dataset.i : -1;
    if (b.matches('[data-save]')) return save();
    if (b.matches('[data-add]')) return editor(null);
    if (b.matches('[data-edit]')) return editor(D.providers[i]);
    if (b.matches('[data-clearkey]')) { Object.assign(D.providers[i], { apiKey: '', apiKeyClear: true, apiKeySet: false }); mark(); draw(); return; }
    if (b.matches('[data-del]')) return confirmBox(`Remove ${D.providers[i].name}?`, o.removeNote, 'Remove', async () => { D.providers.splice(i, 1); await save(); });
    if (b.matches('[data-up]') || b.matches('[data-down]')) { const j = i + (b.matches('[data-up]') ? -1 : 1); [D.providers[i], D.providers[j]] = [D.providers[j], D.providers[i]]; mark(); draw(); return; }
    if (b.matches('[data-try]')) return test(D.providers[i].id);
    if (b.matches('[data-test]')) return test();
    if (await o.onClick?.(b, D, { reload: async () => { await load(); draw(); } })) return;
  };
  return load().then(draw);
}

pages.ratings = async (main) => {
  const SRC = (D) => Object.entries(D.sources || {});
  let poll = null;
  await servicePage(main, {
    url: '/api/studio/ratings', title: 'Ratings',
    intro: 'Scores from IMDb, Rotten Tomatoes, Metacritic, Letterboxd and more, on each title’s page and as a badge on its card. TMDb’s score is always there; the others need a free key from one of the services below.',
    body: (D) => ({ providers: D.providers, show: D.show, badge: D.badge, autoFetch: D.autoFetch }),
    settings: (D) => html`<div class="card"><h2>What to show</h2>
      <label class="check"><input type="checkbox" data-auto ${D.autoFetch ? 'checked' : ''}> Look ratings up when someone opens a title (kept for two weeks)</label>
      <label class="f"><span>Badge on cards</span><select data-badge>${[['auto', 'The first rating in the list below'], ['none', 'No badge'], ...SRC(D).map(([k, x]) => [k, x.label])].map(([v, n]) => html`<option value="${v}" ${D.badge === v ? 'selected' : ''}>${n}</option>`)}</select></label>
      <p class="muted small" style="margin:10px 0 4px">On the title page, in this order (untick to hide):</p>
      <div class="srcs">${[...D.show, ...SRC(D).map(([k]) => k).filter((k) => !D.show.includes(k))].map((k) => html`<span class="src ${D.show.includes(k) ? 'on' : ''}" data-src="${k}">
        <label><input type="checkbox" data-show ${D.show.includes(k) ? 'checked' : ''}> ${D.sources[k]?.label || k}</label>
        <button class="btn sm" data-srcup aria-label="Earlier">←</button><button class="btn sm" data-srcdown aria-label="Later">→</button></span>`)}</div></div>`,
    listTitle: 'Rating services', listHelp: 'Asked from the top. For each kind of rating, the first service that has it wins.',
    addTitle: 'Add a ratings service', namePh: 'My ratings service', urlPh: 'https://ratings.example.com/title/{imdb}?key={key}',
    editorHelp: html`<p class="muted small" style="margin-bottom:10px">Any web service that answers with JSON works. In the address, use <code>{imdb}</code> (tt1234567), <code>{tmdb}</code>, <code>{type}</code> (movie or tv), <code>{title}</code>, <code>{year}</code> and <code>{key}</code>.
      If the answer has a list of ratings, say where the list is and which fields hold the name and the score; names like IMDb, Rotten Tomatoes, Metacritic and Letterboxd are recognised. For a single score, leave the list empty and say where the score is.</p>`,
    blank: { list: 'ratings', source: 'source', value: 'value', votes: '', link: '', label: '', max: '' },
    fields: [['list', 'List of ratings is in', 'ratings (empty for a single score)'], ['source', 'Name field', 'source'], ['value', 'Score field', 'value'], ['votes', 'Votes field (optional)', 'votes'], ['link', 'Link field (optional)', 'url'], ['label', 'Name, for a single score', 'Douban'], ['max', 'Best possible score, for a single score', '10']],
    pluginHint: 'Plugins can add services too: see “Ratings” in the plugin guide.', removeNote: 'Ratings it already found stay until they are looked up again.',
    testHelp: 'Asks every service about one title, to check keys and new services.',
    testForm: html`<div class="imgrow" style="margin-top:10px;flex-wrap:wrap"><input type="text" data-tt placeholder="Title, like Arrival" style="flex:2;min-width:160px"><input data-ty type="number" placeholder="Year" style="width:100px">
      <select data-tk><option value="movie">Movie</option><option value="show">Show</option></select><button class="btn primary" data-test>Try it</button></div>`,
    testBody: (m) => ({ title: $('[data-tt]', m).value.trim() || 'Arrival', year: +$('[data-ty]', m).value || ($('[data-tt]', m).value.trim() ? null : 2016), kind: $('[data-tk]', m).value }),
    foundText: (x) => `${x.ratings.length} rating${x.ratings.length === 1 ? '' : 's'}`, detail: (x) => (x.ratings || []).join(' · '),
    stats: (D) => { const c = D.counts || {}, j = D.job || {}; return html`<div class="card"><h2>Your library</h2>
      <p>${c.found || 0} of ${c.titles || 0} movies and shows have ratings${c.missing ? `, ${c.missing} with none found` : ''}.</p>
      ${j.running ? html`<p class="muted" data-job>Looking up ${j.done} of ${j.total}…</p>` : j.finished ? html`<p class="muted small">Last run: ${j.found} found, ${j.errors} errors, ${j.done} looked up.</p>` : ''}
      <div class="tools" style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">${j.running ? html`<button class="btn" data-stop>Stop</button>` : html`<button class="btn" data-fill>Look up titles without ratings</button><button class="btn" data-fillall>Refresh every title</button>`}
        <button class="btn danger" data-clear>Forget all ratings</button></div>
      <p class="muted small">Free keys allow about 1,000 lookups a day, so a big library fills in over a few days. Titles are also looked up as people open them.</p></div>`; },
    onChange: (D, e) => {
      if (e.target.matches('[data-auto]')) { D.autoFetch = e.target.checked; return true; }
      if (e.target.matches('[data-badge]')) { D.badge = e.target.value; return true; }
      if (e.target.matches('[data-show]')) {
        const k = e.target.closest('[data-src]').dataset.src;
        D.show = e.target.checked ? [...D.show.filter((x) => x !== k), k] : D.show.filter((x) => x !== k);
        e.target.closest('.src').classList.toggle('on', e.target.checked);
        return true;
      }
      return false;
    },
    onClick: async (b, D, { reload }) => {
      const src = b.closest('[data-src]')?.dataset.src;
      if (src && (b.matches('[data-srcup]') || b.matches('[data-srcdown]'))) {
        if (!D.show.includes(src)) return true;
        const i = D.show.indexOf(src), j = i + (b.matches('[data-srcup]') ? -1 : 1);
        if (j < 0 || j >= D.show.length) return true;
        [D.show[i], D.show[j]] = [D.show[j], D.show[i]];
        const box = b.closest('.srcs'), el = b.closest('.src');
        if (j < i) box.insertBefore(el, el.previousElementSibling); else box.insertBefore(el.nextElementSibling, el);
        $('[data-save]', main).disabled = false;
        return true;
      }
      const run = async (body) => {
        await api('POST', '/api/studio/ratings/refresh', body).catch(fail);
        await reload();
        clearInterval(poll);
        poll = timer = setInterval(async () => { if (!main.isConnected) return clearInterval(poll); const d = await api('GET', '/api/studio/ratings').catch(() => null); if (!d) return; const el = $('[data-job]', main); if (d.job.running && el) el.textContent = `Looking up ${d.job.done} of ${d.job.total}…`; else { clearInterval(poll); reload(); } }, 2500);
      };
      if (b.matches('[data-fill]')) { await run({}); return true; }
      if (b.matches('[data-fillall]')) { await run({ all: true }); return true; }
      if (b.matches('[data-stop]')) { await api('POST', '/api/studio/ratings/refresh', { stop: true }).catch(fail); setTimeout(reload, 600); return true; }
      if (b.matches('[data-clear]')) { confirmBox('Forget all ratings?', 'They are looked up again as people open titles, or when you fill them in here.', 'Forget them', async () => { await api('DELETE', '/api/studio/ratings/cache'); await reload(); }); return true; }
      return false;
    },
  });
};

pages.subtitles = async (main) => {
  await servicePage(main, {
    url: '/api/studio/subtitles', title: 'Subtitles',
    intro: 'Subtitles inside the video file and next to it (Movie.en.srt) always show up. For anything missing, viewers can pick “Find subtitles online” in the player, and HallFlix can fetch them by itself in your first language.',
    body: (D) => ({ providers: D.providers, languages: D.languages, autoFetch: D.autoFetch, saveBeside: D.saveBeside, hi: D.hi }),
    settings: (D) => html`<div class="card"><h2>Languages and fetching</h2>
      <p class="muted small" style="margin-bottom:6px">Your languages, first choice first (up to six). Searches look for these.</p>
      <div class="srcs">${D.languages.map((l, i) => html`<span class="src on" data-lang="${l}">${(D.langs.find((x) => x[0] === l) || [l, l])[1]}<button class="btn sm" data-langup ${i ? '' : 'disabled'} aria-label="Earlier">←</button><button class="btn sm danger" data-langdel aria-label="Remove">✕</button></span>`)}
        ${D.languages.length < 6 ? html`<select data-langadd><option value="">Add a language…</option>${D.langs.filter(([k]) => !D.languages.includes(k)).map(([k, n]) => html`<option value="${k}">${n}</option>`)}</select>` : ''}</div>
      <label class="check"><input type="checkbox" data-auto ${D.autoFetch ? 'checked' : ''}> When a video has nothing in ${(D.langs.find((x) => x[0] === D.languages[0]) || ['', 'your first language'])[1]}, fetch the best match as it starts (viewers who had subtitles on get them right away)</label>
      <label class="check"><input type="checkbox" data-beside ${D.saveBeside ? 'checked' : ''}> Save subtitles found online next to the video as .srt files</label>
      <p class="muted small">Saving next to the video needs write access to your media folder (drop <code>:ro</code> from the media line in the compose file); otherwise they’re kept in HallFlix’s data folder. Files already there are never overwritten.</p>
      <label class="f"><span>Subtitles for deaf and hard of hearing (SDH)</span><select data-hi>${[['either', 'No preference'], ['prefer', 'Prefer them'], ['avoid', 'Avoid them']].map(([v, n]) => html`<option value="${v}" ${D.hi === v ? 'selected' : ''}>${n}</option>`)}</select></label></div>`,
    listTitle: 'Subtitle services', listHelp: 'Searched together; results are ranked by your languages, how well they fit the exact video file, and how popular they are.',
    addTitle: 'Add a subtitle service', namePh: 'My subtitle service', urlPh: 'https://subs.example.com/search?tmdb={tmdb}&season={season}&episode={episode}&lang={lang}',
    editorHelp: html`<p class="muted small" style="margin-bottom:10px">Any web service that answers a search with a JSON list of subtitles works. In the address, use <code>{tmdb}</code>, <code>{imdb}</code>, <code>{type}</code> (movie or tv), <code>{title}</code>, <code>{year}</code>,
      <code>{season}</code>, <code>{episode}</code>, <code>{lang}</code> (like en,es), <code>{query}</code>, <code>{file}</code> and <code>{key}</code>. Each result needs a download address (an .srt, .ass or .vtt file, or a .zip of them).</p>`,
    blank: { list: 'results', language: 'language', release: 'release', download: 'url', hi: 'hi', downloads: 'downloads' },
    fields: [['list', 'Results are in', 'results (empty if the answer is a list)'], ['download', 'Download address field', 'url'], ['language', 'Language field', 'language'], ['release', 'Release name field', 'release'], ['hi', 'SDH field (optional)', 'hi'], ['downloads', 'Download count field (optional)', 'downloads']],
    pluginHint: 'Plugins can add services too: see “Subtitles” in the plugin guide.', removeNote: 'Subtitles already downloaded stay.',
    testHelp: 'Searches every service for the most recently added movie or episode, to check keys and new services. Nothing is downloaded.',
    testForm: html`<div class="imgrow" style="margin-top:10px"><button class="btn primary" data-test>Try it</button></div>`,
    testBody: () => ({}),
    foundText: (x) => `${x.found} found`, detail: (x) => (x.sample || []).join(' · '),
    stats: (D) => html`<div class="card"><h2>Downloaded so far</h2><p>${D.counts?.downloaded || 0} subtitle files for ${D.counts?.titles || 0} videos, kept in HallFlix’s data folder.</p></div>`,
    onChange: (D, e) => {
      if (e.target.matches('[data-auto]')) { D.autoFetch = e.target.checked; return true; }
      if (e.target.matches('[data-beside]')) { D.saveBeside = e.target.checked; return true; }
      if (e.target.matches('[data-hi]')) { D.hi = e.target.value; return true; }
      if (e.target.matches('[data-langadd]') && e.target.value) { D.languages.push(e.target.value); redraw(D); return true; }
      return false;
    },
    onClick: async (b, D) => {
      const l = b.closest('[data-lang]')?.dataset.lang;
      if (!l) return false;
      const i = D.languages.indexOf(l);
      if (b.matches('[data-langdel]')) { if (D.languages.length > 1) D.languages.splice(i, 1); else toast('Keep at least one language'); }
      if (b.matches('[data-langup]') && i > 0) [D.languages[i - 1], D.languages[i]] = [D.languages[i], D.languages[i - 1]];
      redraw(D);
      $('[data-save]', main).disabled = false;
      return true;
    },
  });
  // The language chips redraw on their own, so the rest of the page (and anything typed in it) stays as it is.
  function redraw(D) {
    const card = $('.srcs', main).closest('.card');
    const tmp = document.createElement('div');
    tmp.innerHTML = String(html`<div class="srcs">${D.languages.map((l, i) => html`<span class="src on" data-lang="${l}">${(D.langs.find((x) => x[0] === l) || [l, l])[1]}<button class="btn sm" data-langup ${i ? '' : 'disabled'} aria-label="Earlier">←</button><button class="btn sm danger" data-langdel aria-label="Remove">✕</button></span>`)}
      ${D.languages.length < 6 ? html`<select data-langadd><option value="">Add a language…</option>${D.langs.filter(([k]) => !D.languages.includes(k)).map(([k, n]) => html`<option value="${k}">${n}</option>`)}</select>` : ''}</div>`);
    $('.srcs', card).replaceWith(tmp.firstElementChild);
  }
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
    <div class="card"><h2>Apps</h2><p class="muted">The HallFlix apps use this server, its look and its pre-rolls. New builds appear here after every update.</p>
      <div class="row"><div class="grow"><b>Fire TV, Android TV and Android phones</b><span>On a Fire TV, type <code>${location.origin}/get/android</code> into the Downloader app. On a phone, open that address in the browser.</span></div><a class="btn sm" href="/get/android">Download APK</a></div>
      <div class="row"><div class="grow"><b>Roku</b><span>Download the channel on a computer, then upload it on your Roku's Developer Settings page. The install guide has the steps.</span></div><a class="btn sm" href="/get/roku">Download channel</a></div></div>
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
