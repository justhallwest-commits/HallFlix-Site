// The background behind a library: admins change it right on the library page with a live preview. Choices are
// a picture or short video (uploaded, or one of the library's own backdrops), how dark it is, blur, a shade style
// (even, fading down, spotlight, or tinted with the accent colour) and which part of the picture stays in view.
// Saved into the library's look, the same setting as Studio → Look and feel.
import { $, $$, api, html, raw, state, toast, applyLook, on } from './core.js';

const SHADES = [['even', 'Even'], ['fade', 'Fade down'], ['spot', 'Spotlight'], ['tint', 'Accent tint']];
const PLACES = [['top', 'Top'], ['center', 'Middle'], ['bottom', 'Bottom']];
const isVid = (u) => /\.(mp4|webm)(\?|$)/i.test(u || '');

/** The button for a library's header (only admins see it). */
export const button = (lib) => (state.profile?.admin && lib ? html`<button class="btn round bg-edit" data-bgedit="${lib.id}" aria-label="Change this library’s background" title="Change background">${raw(ICON)}</button>` : '');
const ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.8"/><path d="m21 16-5-5-8 9"/></svg>';

let open = null;
document.addEventListener('click', (e) => { const b = e.target.closest('[data-bgedit]'); if (b) { e.preventDefault(); edit(+b.dataset.bgedit); } });
on('route', () => close(true));

async function edit(id) {
  if (open) return close(true);
  let all;
  try { all = await api('GET', '/api/studio/look'); } catch (e) { toast(e.message); return; }
  const lib = all.libraries.find((l) => l.id === id);
  if (!lib) return;
  const saved = JSON.parse(JSON.stringify(lib.look || {}));
  const v = { ...saved };
  const theme = { ...all.defaults.background, ...(all.theme.background || {}) };
  const el = document.createElement('aside');
  el.className = 'bg-panel';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', `Background for ${lib.name}`);
  document.body.append(el);
  open = { el, id, lib, v, saved };
  const val = (k, d) => (v[k] ?? d);
  const draw = () => {
    const bg = v.background || '';
    el.innerHTML = String(html`<header><b>Background · ${lib.name}</b><button class="btn round sm" data-bgx aria-label="Close">✕</button></header>
      <div class="bg-now" style="${bg && !isVid(bg) ? `background-image:url('${encodeURI(bg)}')` : ''}">${bg ? (isVid(bg) ? html`<span>Video background</span>` : '') : html`<span>${theme.image ? 'Using the whole-app background' : 'No picture yet'}</span>`}</div>
      <div class="bg-btns"><label class="btn sm">Upload picture or video<input type="file" accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm" hidden data-bgfile></label>
        <button class="btn sm" data-bgpick>From this library</button>${bg ? html`<button class="btn sm danger" data-bgclear>Remove</button>` : ''}</div>
      <div class="bg-pick" hidden></div>
      <label class="bg-r"><span>Darken <output>${Math.round(val('dim', theme.dim ?? 0.6) * 100)}%</output></span><input type="range" min="0" max="0.95" step="0.05" value="${val('dim', theme.dim ?? 0.6)}" data-bgk="dim"></label>
      <label class="bg-r"><span>Blur <output>${val('blur', theme.blur || 0)}px</output></span><input type="range" min="0" max="30" step="1" value="${val('blur', theme.blur || 0)}" data-bgk="blur"></label>
      <div class="bg-r"><span>Shade</span><div class="seg">${SHADES.map(([k, n]) => html`<button data-bgshade="${k}" class="${val('shade', theme.shade || 'even') === k ? 'on' : ''}">${n}</button>`)}</div></div>
      <div class="bg-r"><span>Keep in view</span><div class="seg">${PLACES.map(([k, n]) => html`<button data-bgplace="${k}" class="${val('position', 'center') === k ? 'on' : ''}">${n}</button>`)}</div></div>
      <footer><button class="linkbtn" data-bgreset>Use the whole-app look</button><span></span><button class="btn" data-bgx>Cancel</button><button class="btn primary" data-bgsave>Save</button></footer>`);
  };
  const preview = () => {
    const look = { ...state.look, libraries: { ...state.look.libraries, [id]: { ...(state.look.libraries?.[id] || {}), ...clean(v) } } };
    for (const k of ['background', 'dim', 'blur', 'shade', 'position']) if (v[k] === undefined || v[k] === '') delete look.libraries[id][k];
    applyLook(look, id);
    state.look = open.real; // the preview isn't saved into the app's look
  };
  open.real = state.look;
  draw();
  el.addEventListener('input', (e) => {
    const k = e.target.dataset.bgk;
    if (!k) return;
    v[k] = +e.target.value;
    $('output', e.target.parentElement).textContent = k === 'dim' ? `${Math.round(v[k] * 100)}%` : `${v[k]}px`;
    preview();
  });
  el.addEventListener('change', async (e) => {
    if (!e.target.matches('[data-bgfile]')) return;
    const f = e.target.files[0];
    if (!f) return;
    if (f.size > 250e6) { toast('That file is too large (250 MB at most)'); return; }
    toast('Uploading…');
    try {
      const r = await fetch(`/api/studio/upload?name=${encodeURIComponent(f.name)}`, { method: 'POST', body: f, credentials: 'same-origin' });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Upload failed');
      v.background = j.url; draw(); preview();
    } catch (err) { toast(err.message); }
  });
  el.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.matches('[data-bgx]')) return close(true);
    if (b.dataset.bgshade) { v.shade = b.dataset.bgshade; for (const x of $$('[data-bgshade]', el)) x.classList.toggle('on', x === b); return preview(); }
    if (b.dataset.bgplace) { v.position = b.dataset.bgplace; for (const x of $$('[data-bgplace]', el)) x.classList.toggle('on', x === b); return preview(); }
    if (b.matches('[data-bgclear]')) { v.background = ''; draw(); return preview(); }
    if (b.matches('[data-bgreset]')) { for (const k of ['background', 'dim', 'blur', 'shade', 'position']) delete v[k]; draw(); return preview(); }
    if (b.matches('[data-bgpick]')) {
      const box = $('.bg-pick', el);
      if (!box.hidden) { box.hidden = true; return; }
      box.hidden = false; box.innerHTML = '<p class="muted">Loading…</p>';
      try {
        const list = await api('GET', `/api/studio/libraries/${id}/backdrops`);
        box.innerHTML = String(list.length ? html`${list.map((x) => html`<button data-bgurl="${x.url}" title="${x.title}" style="background-image:url('${encodeURI(x.thumb)}')" aria-label="${x.title}"></button>`)}`
          : html`<p class="muted">This library has no backdrops yet.</p>`);
      } catch (err) { box.innerHTML = String(html`<p class="muted">${err.message}</p>`); }
      return;
    }
    if (b.dataset.bgurl) { v.background = b.dataset.bgurl; draw(); return preview(); }
    if (b.matches('[data-bgsave]')) {
      b.disabled = true;
      try {
        await api('PUT', `/api/studio/libraries/${id}`, { look: clean(v) });
        const fresh = await api('GET', '/api/boot');
        state.boot.look = fresh.look; open.real = fresh.look; state.look = fresh.look;
        close(false);
        applyLook(fresh.look, id);
        toast('Background saved');
      } catch (err) { b.disabled = false; toast(err.message); }
    }
  });
  el.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(true); } });
  $('[data-bgsave]', el)?.focus();
}

const clean = (v) => Object.fromEntries(Object.entries(v).filter(([, x]) => x !== '' && x !== undefined && x !== null));

function close(restore) {
  if (!open) return;
  const { el, id, real } = open;
  open = null;
  el.remove();
  if (restore) { state.look = real; if (location.hash.includes(`/library/${id}`)) applyLook(real, id); }
}
