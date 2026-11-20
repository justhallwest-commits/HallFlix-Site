// Studio tools: Artwork, Metadata, Parental controls and Pre-rolls. Each page gets the Studio's shared helpers as `k`.
import { $, $$, api, html, raw, toast } from '/js/core.js';

const enc = (u) => String(u || '').replace(/"/g, '%22');
const bg = (u) => (u ? `background-image:url("${enc(u)}")` : '');
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const ago = (d) => { const s = (Date.now() - new Date(d)) / 1000; return s < 60 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : new Date(d).toLocaleDateString(); };
const short = (v, n = 80) => { const s = Array.isArray(v) ? v.join(' | ') : v == null || v === '' ? '—' : String(v); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };

async function uploadFile(f) {
  const res = await fetch(`/api/studio/upload?name=${encodeURIComponent(f.name || 'pasted.png')}`, { method: 'POST', body: f, credentials: 'same-origin' });
  const d = await res.json();
  if (!res.ok) throw new Error(d.error || 'Upload failed');
  return { type: 'ref', ref: d.url };
}
/** Turn what was dropped or pasted into sources: files are uploaded, links are fetched by the server. */
async function sourcesFrom(dt) {
  const files = [...(dt.files || [])].filter((f) => /^image\//.test(f.type));
  if (files.length) { toast(files.length > 1 ? `Uploading ${files.length} pictures…` : 'Uploading…', 1500); return Promise.all(files.map(uploadFile)); }
  const htmlText = dt.getData?.('text/html') || '';
  const fromHtml = /<img[^>]+src=["']([^"']+)/i.exec(htmlText)?.[1];
  const url = fromHtml || (dt.getData?.('text/uri-list') || dt.getData?.('text/plain') || '').split('\n').find((l) => /^https?:\/\//.test(l.trim()));
  return url ? [{ type: 'url', url: url.trim() }] : [];
}
function dropZone(el, onSources) {
  el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('over'); });
  el.addEventListener('dragleave', () => el.classList.remove('over'));
  el.addEventListener('drop', async (e) => { e.preventDefault(); el.classList.remove('over'); try { const s = await sourcesFrom(e.dataTransfer); if (s.length) await onSources(s); else toast('Drop a picture or a picture link'); } catch (err) { toast(err.message); } });
}

// ---------- chips: type a value and press Enter ----------
const chipsIn = (key, values, suggest = [], ph = 'Type and press Enter') => html`<div class="chips-in" data-chips="${key}">${(values || []).map((v) => html`<span class="chip">${v}<button type="button" data-unchip aria-label="Remove ${v}">×</button></span>`)}
  <input list="dl-${key}" placeholder="${ph}" autocomplete="off"><datalist id="dl-${key}">${suggest.map((s) => html`<option value="${s}">`)}</datalist></div>`;
const readChips = (el, key) => $$(`[data-chips="${key}"] .chip`, el).map((c) => c.firstChild.textContent.trim());
function wireChips(el, changed = () => {}) {
  const add = (input) => {
    const parts = input.value.split(/[,|]/).map((x) => x.trim()).filter(Boolean);
    const box = input.closest('[data-chips]'), have = readChips(box.parentElement, box.dataset.chips).map((x) => x.toLowerCase());
    for (const v of parts) if (!have.includes(v.toLowerCase())) input.insertAdjacentHTML('beforebegin', String(html`<span class="chip">${v}<button type="button" data-unchip aria-label="Remove ${v}">×</button></span>`));
    input.value = ''; if (parts.length) changed();
  };
  el.addEventListener('keydown', (e) => {
    const inp = e.target.closest('[data-chips] input'); if (!inp) return;
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(inp); }
    else if (e.key === 'Backspace' && !inp.value) { inp.previousElementSibling?.matches('.chip') && (inp.previousElementSibling.remove(), changed()); }
  });
  el.addEventListener('change', (e) => { const inp = e.target.closest('[data-chips] input'); if (inp && inp.value) add(inp); });
  el.addEventListener('focusout', (e) => { const inp = e.target.closest('[data-chips] input'); if (inp && inp.value) add(inp); });
  el.addEventListener('click', (e) => { const b = e.target.closest('[data-unchip]'); if (b) { b.parentElement.remove(); changed(); } else if (e.target.matches('[data-chips]')) $('input', e.target).focus(); });
}

// ---------- choosing a picture: upload, web link, NAS or online ----------
/** Opens a picker. Resolves to an array of sources ({type,…}) or null. */
export function chooseSource(k, { title = 'Choose a picture', online = null, multiple = false, ratio = '2/3' } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (done) return; done = true; d.close(); resolve(v); };
    const tabs = [['upload', 'Upload'], ['link', 'Web link'], ['nas', 'NAS'], ...(online ? [['online', 'Online']] : [])];
    const d = k.dialog(title, html`<div class="tabs" data-tabs>${tabs.map(([id, n], i) => html`<button data-tab="${id}" class="${i ? '' : 'on'}">${n}</button>`)}</div><div class="src-body"></div>`, { ok: '', wide: true });
    $('[data-x]', $('#modal')).addEventListener('click', () => { if (!done) { done = true; resolve(null); } });
    $('.dialog', $('#modal')).style.width = 'min(980px, 100%)';
    const body = $('.src-body', d.el);
    const show = async (tab) => {
      for (const b of $$('[data-tab]', d.el)) b.classList.toggle('on', b.dataset.tab === tab);
      if (tab === 'upload') {
        body.innerHTML = String(html`<label class="drop big" tabindex="0"><input type="file" accept="image/*" ${multiple ? raw('multiple') : ''} hidden><b>Drop a picture here, or click to choose</b>
          <span class="muted small">You can also paste one (Ctrl+V) or drag it straight from another browser tab.</span></label>`);
        const zone = $('.drop', body), inp = $('input', zone);
        inp.onchange = async () => { try { toast('Uploading…', 1500); finish(await Promise.all([...inp.files].map(uploadFile))); } catch (e) { k.fail(e); } };
        dropZone(zone, async (s) => finish(s));
        zone.focus();
      } else if (tab === 'link') {
        body.innerHTML = String(html`<p class="muted">Any public picture address. Google Drive, Dropbox, OneDrive and Imgur share links work too, and so does a web page that has a picture for sharing.</p>
          <div class="imgrow" style="margin-top:12px"><input type="text" data-url placeholder="https://…" autocomplete="off"><button class="btn primary" data-use>Use this link</button></div><p class="small muted" data-msg style="margin-top:8px">HallFlix downloads the picture and keeps its own copy.</p>`);
        const go = () => { const u = $('[data-url]', body).value.trim(); if (!/^https?:\/\//.test(u)) { $('[data-msg]', body).textContent = 'Paste an address that starts with http:// or https://'; return; } finish([{ type: 'url', url: u }]); };
        $('[data-use]', body).onclick = go; $('[data-url]', body).onkeydown = (e) => { if (e.key === 'Enter') go(); };
        $('[data-url]', body).focus();
      } else if (tab === 'nas') {
        await nasBrowser(k, body, (src) => finish([src]), { ratio });
      } else {
        body.innerHTML = '<p class="muted">Looking on TMDb…</p>';
        const draw = async (lang) => {
          let list;
          try { list = await online(lang); } catch (e) { body.innerHTML = String(html`<p class="muted">${e.message}</p>`); return; }
          body.innerHTML = String(html`<div class="imgrow" style="margin-bottom:10px"><span class="muted">Language</span><select data-lang style="width:auto"><option value="en" ${lang === 'en' ? 'selected' : ''}>English and no text</option><option value="all" ${lang === 'all' ? 'selected' : ''}>Every language</option></select>
            <span class="muted small">${plural(list.length, 'picture')}, best rated first</span></div>
            ${list.length ? html`<div class="pick-grid" style="--ratio:${ratio}">${list.map((x) => html`<button class="pick" data-path="${x.path}"><span class="ph" style="${bg(x.url)}"></span><small>${x.w}×${x.h}${x.lang ? ` · ${x.lang.toUpperCase()}` : ''}${x.votes ? ` · ★ ${x.score.toFixed(1)}` : ''}</small></button>`)}</div>`
              : html`<p class="muted">TMDb has nothing for this one${lang === 'en' ? '. Try every language.' : '.'}</p>`}`);
          $('[data-lang]', body).onchange = (e) => draw(e.target.value);
          body.onclick = (e) => { const b = e.target.closest('[data-path]'); if (b) finish([{ type: 'tmdb', path: b.dataset.path }]); };
        };
        draw('en');
      }
    };
    $('[data-tabs]', d.el).onclick = (e) => { const b = e.target.closest('[data-tab]'); if (b) show(b.dataset.tab); };
    $('#modal').onpaste = async (e) => { const s = await sourcesFrom(e.clipboardData).catch(() => []); if (s.length) { e.preventDefault(); finish(s); } };
    show('upload');
  });
}
/** Browse and search the NAS with thumbnails. `pick({type:'nas', path, mode})`. */
async function nasBrowser(k, body, pick, { ratio = '2/3' } = {}) {
  let roots;
  try { roots = await api('GET', '/api/studio/art/roots'); } catch (e) { body.innerHTML = String(html`<p class="muted">${e.message}</p>`); return; }
  body.innerHTML = String(html`<div class="imgrow"><select data-root style="width:auto">${roots.map((r) => html`<option value="${r.path}">${r.path}${r.found ? '' : ' (not found)'}</option>`)}</select>
    <input type="text" data-q placeholder="Search file names in this folder and below"><button class="btn" data-find>Search</button></div>
    <p class="small muted" data-where style="margin:8px 0"></p><div class="nas"></div>
    <p class="small muted" style="margin-top:8px"><b>Copy</b> keeps a copy inside HallFlix, so it's safe if the file moves. <b>Link</b> uses the file where it is, so editing it on the NAS changes the picture. Add more folders on the NAS folders tab.</p>`);
  const box = $('.nas', body);
  const tiles = (images) => html`<div class="pick-grid" style="--ratio:${ratio}">${images.map((x) => html`<div class="pick nasimg"><span class="ph" style="${bg(x.url)}"></span><small title="${x.path}">${x.folder && x.folder !== '.' ? `${x.folder}/` : ''}${x.name}</small>
    <span class="acts"><button class="btn sm primary" data-copy="${x.path}">Copy</button><button class="btn sm" data-link="${x.path}">Link</button></span></div>`)}</div>`;
  const open = async (p) => {
    let r;
    try { r = await api('GET', `/api/studio/art/browse?path=${encodeURIComponent(p)}`); } catch (e) { box.innerHTML = String(html`<p class="muted">${e.message}</p>`); return; }
    $('[data-where]', body).textContent = r.path;
    box.innerHTML = String(html`<div class="folders">${r.parent ? html`<button class="btn sm" data-go="${r.parent}">↑ Up</button>` : ''}${r.folders.map((f) => html`<button class="btn sm" data-go="${f.path}">📁 ${f.name}</button>`)}</div>
      ${r.images.length ? tiles(r.images) : html`<p class="muted small">No pictures in this folder${r.folders.length ? ', open a folder above' : ''}.</p>`}${r.more ? html`<p class="muted small">and ${r.more} more. Search to narrow it down.</p>` : ''}`);
  };
  const find = async () => {
    const qv = $('[data-q]', body).value.trim(); if (!qv) return;
    box.innerHTML = '<p class="muted">Searching…</p>';
    try { const r = await api('GET', `/api/studio/art/search?path=${encodeURIComponent($('[data-root]', body).value)}&q=${encodeURIComponent(qv)}`); box.innerHTML = String(r.images.length ? html`${tiles(r.images)}${r.capped ? html`<p class="muted small">Showing the first 300.</p>` : ''}` : html`<p class="muted">No file names match.</p>`); }
    catch (e) { box.innerHTML = String(html`<p class="muted">${e.message}</p>`); }
  };
  $('[data-root]', body).onchange = (e) => open(e.target.value);
  $('[data-find]', body).onclick = find; $('[data-q]', body).onkeydown = (e) => { if (e.key === 'Enter') find(); };
  box.onclick = (e) => {
    const g = e.target.closest('[data-go]'); if (g) return open(g.dataset.go);
    const c = e.target.closest('[data-copy],[data-link]'); if (c) pick({ type: 'nas', path: c.dataset.copy || c.dataset.link, mode: c.dataset.copy ? 'copy' : 'link' });
  };
  open(roots[0].path);
}

// =====================================================================================
// Artwork
// =====================================================================================
export async function artwork(main, k) {
  const st = { tab: 'titles', library: '', kind: '', q: '', missing: '', offset: 0, select: false, picked: new Set(), editing: null };
  const libs = (await api('GET', '/api/studio/meta/catalog')).libraries.filter((l) => l.kind !== 'prerolls');
  const KIND = { '': 'Everything', movie: 'Movies', show: 'Shows', episode: 'Episodes', book: 'Books', series: 'Comic series', album: 'Albums', artist: 'Artists' };
  const frame = (inner) => html`${k.head('Artwork', 'Posters, backdrops, logos and thumbs for every title, library tiles, and your screensaver pictures. Add them from your computer, a web link, the NAS or TMDb.')}
    <div class="tabs" data-arttabs>${[['titles', 'Titles'], ['libraries', 'Library tiles'], ['screensaver', 'Screensaver'], ['folders', 'NAS folders']].map(([id, n]) => html`<button data-at="${id}" class="${st.tab === id ? 'on' : ''}">${n}</button>`)}</div>${inner}`;
  const go = (tab) => { st.tab = tab; st.editing = null; draw(); };

  const drawTitles = async (append = false) => {
    if (!append) st.offset = 0;
    const qs = new URLSearchParams({ library: st.library, kind: st.kind, q: st.q, missing: st.missing, offset: st.offset, limit: 60 });
    const r = await api('GET', `/api/studio/art/items?${qs}`);
    const card = (x) => html`<button class="art-card ${st.picked.has(x.id) ? 'picked' : ''} ${x.kind === 'episode' ? 'wide' : ''} ${['album', 'artist'].includes(x.kind) ? 'square' : ''}" data-item="${x.id}">
      <span class="ph" style="${bg(x.image)}">${x.image ? '' : html`<i>${x.title}</i>`}</span>${st.select ? html`<span class="tick">${st.picked.has(x.id) ? '✓' : ''}</span>` : ''}
      <b>${x.series || x.title}</b><small>${x.series ? x.title : [x.year, KIND[x.kind] ? KIND[x.kind].replace(/s$/, '') : x.kind].filter(Boolean).join(' · ')}</small>
      ${['movie', 'show'].includes(x.kind) ? html`<span class="badges">${[['poster', 'P'], ['backdrop', 'B'], ['logo', 'L'], ['thumb', 'T']].map(([key, l]) => html`<i class="${x.has[key] ? 'yes' : ''}" title="${x.has[key] ? 'Has a' : 'No'} ${key}">${l}</i>`)}</span>` : ''}</button>`;
    if (append) { $('.art-grid', main).insertAdjacentHTML('beforeend', String(html`${r.items.map(card)}`)); }
    else {
      main.innerHTML = String(frame(html`<div class="filters"><select data-f="library"><option value="">All libraries</option>${libs.map((l) => html`<option value="${l.id}" ${String(st.library) === String(l.id) ? 'selected' : ''}>${l.name}</option>`)}</select>
        <select data-f="kind">${Object.entries(KIND).map(([v, n]) => html`<option value="${v}" ${st.kind === v ? 'selected' : ''}>${n}</option>`)}</select>
        <select data-f="missing"><option value="">Any artwork</option>${[['poster', 'Missing a poster or cover'], ['backdrop', 'Missing a backdrop'], ['logo', 'Missing a logo'], ['thumb', 'Missing a thumb'], ['still', 'Episodes missing a still']].map(([v, n]) => html`<option value="${v}" ${st.missing === v ? 'selected' : ''}>${n}</option>`)}</select>
        <input type="text" data-f="q" placeholder="Search titles" value="${st.q}"><button class="btn ${st.select ? 'primary' : ''}" data-selectmode>${st.select ? 'Done selecting' : 'Select several'}</button></div>
        ${st.select ? html`<div class="selbar"><b>${plural(st.picked.size, 'title')} selected</b><button class="btn sm" data-selall>Select all shown</button><button class="btn sm" data-selnone>Clear</button><span class="grow"></span>
          <button class="btn sm" data-fill ${st.picked.size ? '' : raw('disabled')}>Fill missing from TMDb</button><button class="btn sm" data-bulk ${st.picked.size ? '' : raw('disabled')}>Put one picture on all</button></div>` : ''}
        <p class="muted small" style="margin:8px 0 12px">${plural(r.total, 'title')}${st.missing ? ' missing that' : ''}. ${st.select ? 'Click titles to select them.' : 'Click a title to change its pictures.'}</p>
        <div class="art-grid">${r.items.map(card)}</div>${r.total > r.items.length ? html`<div style="text-align:center;margin:18px"><button class="btn" data-more>Show more</button></div>` : ''}`));
      const q = $('[data-f=q]', main); q.oninput = k.debounce(() => { st.q = q.value; drawTitles(); }, 300);
    }
    st.offset += r.items.length;
    const more = $('[data-more]', main); if (more) more.parentElement.hidden = st.offset >= r.total;
  };

  // ----- one title
  const drawEditor = async (id) => {
    const d = await api('GET', `/api/studio/art/item/${id}`);
    st.editing = id;
    main.innerHTML = String(frame(html`<div class="ed-head"><button class="btn" data-back>← All artwork</button><div><h2>${d.series ? `${d.series} · ` : ''}${d.title}${d.year ? html` <span class="muted">(${d.year})</span>` : ''}</h2>
        <p class="muted small">Drop a picture on any slot, drag one from another tab, or click a slot and press Ctrl+V. Pictures you choose stay through rescans.</p></div></div>
      ${d.slots.map((s) => html`<section class="slot card" data-slot="${s.key}"><div class="slot-head"><div><h2>${s.label}</h2><p class="muted small">${s.hint}</p></div>
          <div class="tools">${s.locked ? html`<button class="btn sm" data-auto title="Unlock it so HallFlix picks a picture again on the next match">Let HallFlix choose</button>` : ''}</div></div>
        <div class="slot-row" style="--ratio:${s.ratio}">${s.images.map((im, i) => html`<figure class="shot ${s.clear ? 'clear' : ''}" data-index="${i}" tabindex="0">
            <img src="${im.url}" alt="" onload="this.nextElementSibling.querySelector('.dim').textContent=this.naturalWidth+'×'+this.naturalHeight">
            <figcaption><span class="tag ${im.source === 'NAS' ? 'nas' : ''}">${s.multi && i === 0 ? 'Main · ' : ''}${im.source}</span><span class="dim"></span></figcaption>
            <div class="acts">${s.multi && i > 0 ? html`<button class="btn sm" data-main>Make main</button><button class="btn sm" data-left title="Move earlier">←</button>` : ''}${s.multi && i < s.images.length - 1 ? html`<button class="btn sm" data-right title="Move later">→</button>` : ''}
              <button class="btn sm" data-replace>Replace</button><a class="btn sm" href="${im.full}" target="_blank" rel="noopener">View</a><button class="btn sm danger" data-remove>Remove</button></div></figure>`)}
          ${s.multi || !s.images.length ? html`<button class="shot add" data-add tabindex="0"><b>+ ${s.images.length ? 'Add another' : 'Add'}</b><span class="muted small">Upload, link, NAS${d.online ? ' or online' : ''}<br>or drop / paste here</span></button>` : ''}</div></section>`)}`));
    for (const sec of $$('[data-slot]', main)) {
      const slot = sec.dataset.slot;
      for (const zone of $$('.shot', sec)) dropZone(zone, (srcs) => apply(slot, srcs, zone.matches('[data-add]') ? undefined : +zone.dataset.index));
    }
    async function apply(slot, srcs, index) {
      try {
        for (const [n, source] of srcs.entries()) await api('POST', `/api/studio/art/item/${id}/set`, { slot, source, index: n === 0 ? index : undefined });
        toast('Saved', 1200); drawEditor(id);
      } catch (e) { k.fail(e); }
    }
    main.onpaste = async (e) => {
      const z = document.activeElement?.closest?.('[data-slot] .shot'); if (!z) return;
      const srcs = await sourcesFrom(e.clipboardData).catch(() => []); if (!srcs.length) return;
      e.preventDefault();
      const slot = z.closest('[data-slot]').dataset.slot;
      apply(slot, srcs, z.matches('[data-add]') ? undefined : +z.dataset.index);
    };
    main.onclick = async (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.matches('[data-back]')) return go('titles');
      const sec = b.closest('[data-slot]'); if (!sec) return;
      const slot = sec.dataset.slot, s = d.slots.find((x) => x.key === slot), idx = +b.closest('[data-index]')?.dataset.index;
      try {
        if (b.matches('[data-add],[data-replace]')) {
          const srcs = await chooseSource(k, { title: `${b.matches('[data-add]') ? 'Add' : 'Replace'} ${s.label.toLowerCase().replace(/s$/, '')}`, multiple: s.multi && b.matches('[data-add]'), ratio: s.ratio,
            online: d.online ? (lang) => api('GET', `/api/studio/art/item/${id}/online?slot=${slot}&lang=${lang}`) : null });
          if (srcs?.length) await apply(slot, srcs, b.matches('[data-replace]') ? idx : undefined);
        }
        if (b.matches('[data-remove]')) { await api('POST', `/api/studio/art/item/${id}/remove`, { slot, index: idx }); toast('Removed', 1200); drawEditor(id); }
        if (b.matches('[data-main],[data-left],[data-right]')) {
          const order = s.images.map((_, i) => i);
          if (b.matches('[data-main]')) { order.splice(idx, 1); order.unshift(idx); }
          else { const j = b.matches('[data-left]') ? idx - 1 : idx + 1; [order[idx], order[j]] = [order[j], order[idx]]; }
          await api('POST', `/api/studio/art/item/${id}/order`, { order }); drawEditor(id);
        }
        if (b.matches('[data-auto]')) { await api('POST', `/api/studio/art/item/${id}/auto`, { slot }); toast('HallFlix will choose this picture again', 2200); drawEditor(id); }
      } catch (err) { k.fail(err); }
    };
  };

  // ----- library tiles
  const drawLibraries = async () => {
    const all = (await api('GET', '/api/studio/look')).libraries;
    main.innerHTML = String(frame(html`<p class="muted" style="margin-bottom:14px">The picture behind each library's tile on the Home screen (and its page), and an optional logo in place of its name. A short MP4 or WebM loop works as a tile picture too.</p>
      <div class="lib-tiles">${all.map((l) => html`<div class="card lib-art" data-lib="${l.id}"><div class="tile-prev" style="${l.look?.background && !/\.(mp4|webm)/i.test(l.look.background) ? bg(l.look.background) : ''}">${l.look?.logo ? html`<img src="${l.look.logo}" alt="">` : html`<b>${l.name}</b>`}</div>
        <div class="tools"><button class="btn sm" data-pic="background">${l.look?.background ? 'Change picture' : 'Add picture'}</button><button class="btn sm" data-pic="logo">${l.look?.logo ? 'Change logo' : 'Add logo'}</button>
          ${l.look?.background ? html`<button class="btn sm danger" data-clear="background">Remove picture</button>` : ''}${l.look?.logo ? html`<button class="btn sm danger" data-clear="logo">Remove logo</button>` : ''}</div></div>`)}</div>`));
    for (const c of $$('[data-lib]', main)) dropZone(c, async (srcs) => save(c.dataset.lib, 'background', srcs[0]));
    async function save(id, key, source) {
      const l = all.find((x) => x.id === +id);
      const look = { ...(l.look || {}) };
      if (source) look[key] = (await api('POST', '/api/studio/art/resolve', { source })).url; else look[key] = '';
      await api('PUT', `/api/studio/libraries/${id}`, { look }); toast('Saved', 1200); drawLibraries();
    }
    main.onclick = async (e) => {
      const b = e.target.closest('[data-pic],[data-clear]'); if (!b) return;
      const id = b.closest('[data-lib]').dataset.lib;
      try {
        if (b.dataset.clear) return save(id, b.dataset.clear, null);
        const srcs = await chooseSource(k, { title: b.dataset.pic === 'logo' ? 'Library logo' : 'Library tile picture', ratio: b.dataset.pic === 'logo' ? '800/310' : '16/9' });
        if (srcs?.length) await save(id, b.dataset.pic, srcs[0]);
      } catch (err) { k.fail(err); }
    };
  };

  // ----- screensaver
  const drawSaver = async () => {
    const s = await api('GET', '/api/studio/art/screensaver');
    main.innerHTML = String(frame(html`<div class="card"><h2>What the screensaver shows</h2>
        <label class="check"><input type="radio" name="mode" value="mine" ${s.mode === 'mine' ? 'checked' : ''}> Only my pictures</label>
        <label class="check"><input type="radio" name="mode" value="mixed" ${s.mode !== 'mine' ? 'checked' : ''}> My pictures mixed with movie and show backdrops</label>
        <div class="f" data-share ${s.mode === 'mine' ? raw('hidden') : ''}><span>My pictures</span><span class="rangewrap"><input type="range" min="0" max="100" step="10" value="${s.share}" data-sharev><output>${s.share}%</output></span></div>
        <p class="muted small">The screensaver starts after five idle minutes, on TVs by default (Look and feel → Screensaver chooses where). It never starts while something plays. With no pictures here it shows backdrops.</p></div>
      <div class="card"><div class="slot-head"><div><h2>My pictures (${s.pictures.length})</h2><p class="muted small">Big photos are shrunk to 4K as they're added. Drop pictures anywhere in this box.</p></div>
        <div class="tools"><button class="btn primary" data-addpics>Add pictures</button><button class="btn" data-play ${s.pictures.length ? '' : raw('disabled')}>Preview</button></div></div>
        <div class="saver-grid">${s.pictures.map((p) => html`<figure class="shot" data-index="${p.index}"><img src="${p.thumb}" alt="" loading="lazy"><figcaption>${p.caption || ''}</figcaption><div class="acts"><button class="btn sm danger" data-del>Remove</button></div></figure>`)}
          ${!s.pictures.length ? html`<p class="muted">No pictures yet.</p>` : ''}</div></div>`));
    const box = $('.saver-grid', main).parentElement;
    const add = async (sources) => { toast('Adding…', 1500); const r = await api('POST', '/api/studio/art/screensaver', { sources }); toast(`Added ${plural(r.added, 'picture')}`); drawSaver(); };
    dropZone(box, add);
    const saveMode = k.debounce(async () => { await api('PUT', '/api/studio/art/screensaver', { mode: $('[name=mode]:checked', main).value, share: +$('[data-sharev]', main).value }); toast('Saved', 1000); }, 300);
    main.oninput = (e) => {
      if (e.target.name === 'mode') $('[data-share]', main).hidden = e.target.value === 'mine';
      if (e.target.matches('[data-sharev]')) e.target.nextElementSibling.textContent = `${e.target.value}%`;
      if (e.target.name === 'mode' || e.target.matches('[data-sharev]')) saveMode();
    };
    main.onclick = async (e) => {
      try {
        if (e.target.closest('[data-addpics]')) { const srcs = await chooseSource(k, { title: 'Add screensaver pictures', multiple: true, ratio: '16/9' }); if (srcs?.length) await add(srcs); }
        const del = e.target.closest('[data-del]'); if (del) { await api('DELETE', `/api/studio/art/screensaver/${del.closest('[data-index]').dataset.index}`); drawSaver(); }
        if (e.target.closest('[data-play]')) {
          const list = s.pictures.map((p) => p.url.startsWith('/') ? p.url : p.thumb);
          let i = 0;
          const d = k.dialog('Screensaver preview', html`<div class="saver-prev"><div class="sp" style="${bg(list[0])}"></div></div>`, { ok: '', wide: true });
          const t = setInterval(() => { const el = $('.sp', d.el); if (!el) return clearInterval(t); i = (i + 1) % list.length; el.style.backgroundImage = `url("${enc(list[i])}")`; }, 2500);
        }
      } catch (err) { k.fail(err); }
    };
  };

  // ----- NAS folders
  const drawFolders = async () => {
    const roots = await api('GET', '/api/studio/art/roots');
    main.innerHTML = String(frame(html`<div class="card"><h2>Folders HallFlix can pick pictures from</h2>
      ${roots.map((r) => html`<div class="row"><div class="grow"><b>${r.path}</b><span>${r.media ? 'Your media folder (always included)' : 'Artwork folder'}</span></div><span class="pill ${r.found ? 'ok' : 'bad'}">${r.found ? 'Found' : 'Not found'}</span>${r.media ? '' : html`<button class="btn sm danger" data-rm="${r.path}">Remove</button>`}</div>`)}
      <div class="imgrow" style="margin-top:12px"><input type="text" data-newroot placeholder="/artwork"><button class="btn primary" data-addroot>Add folder</button></div></div>
      <div class="card"><h2>Adding a folder on the UGREEN NAS</h2><p class="muted">HallFlix runs in Docker, so it only sees folders mapped into it. To use an artwork folder outside your media share:</p>
        <ol class="muted steps"><li>In the HallFlix compose file, under <code>hallflix:</code> → <code>volumes:</code>, add a line such as <code>- /volume1/Media/Artwork:/artwork:ro</code>.</li><li>Redeploy the project in UGOS → Docker → Projects.</li><li>Add <code>/artwork</code> above. “Found” confirms HallFlix can see it.</li></ol></div>`));
    main.onclick = async (e) => {
      const rm = e.target.closest('[data-rm]'), add = e.target.closest('[data-addroot]');
      if (!rm && !add) return;
      const list = roots.filter((r) => !r.media).map((r) => r.path).filter((p) => !rm || p !== rm.dataset.rm);
      if (add) { const v = $('[data-newroot]', main).value.trim(); if (!v.startsWith('/')) return toast('Folders start with /'); list.push(v); }
      try { await api('PUT', '/api/studio/art/roots', { roots: list }); drawFolders(); } catch (err) { k.fail(err); }
    };
  };

  const draw = () => (st.tab === 'titles' ? (st.editing ? drawEditor(st.editing) : drawTitles()) : st.tab === 'libraries' ? drawLibraries() : st.tab === 'screensaver' ? drawSaver() : drawFolders()).catch(k.fail);
  main.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-at]'); if (t) return go(t.dataset.at);
    if (st.tab !== 'titles' || st.editing) return;
    const item = e.target.closest('[data-item]');
    if (item) { const id = +item.dataset.item; if (st.select) { st.picked.has(id) ? st.picked.delete(id) : st.picked.add(id); item.classList.toggle('picked'); $('.tick', item).textContent = st.picked.has(id) ? '✓' : ''; $('.selbar b', main).textContent = `${plural(st.picked.size, 'title')} selected`; for (const b of $$('[data-fill],[data-bulk]', main)) b.disabled = !st.picked.size; } else drawEditor(id); return; }
    if (e.target.closest('[data-more]')) return drawTitles(true);
    if (e.target.closest('[data-selectmode]')) { st.select = !st.select; return drawTitles(); }
    if (e.target.closest('[data-selall]')) { for (const c of $$('[data-item]', main)) st.picked.add(+c.dataset.item); return drawTitles(); }
    if (e.target.closest('[data-selnone]')) { st.picked.clear(); return drawTitles(); }
    try {
      if (e.target.closest('[data-fill]')) {
        k.dialog(`Fill missing artwork for ${plural(st.picked.size, 'title')}`, html`<p class="muted">For each selected movie or show that is matched to TMDb, HallFlix adds the best-rated picture for every empty slot you tick. Pictures already there are kept.</p>
          <div class="checks" style="margin-top:10px">${[['poster', 'Poster'], ['backdrops', 'Backdrop'], ['logo', 'Logo']].map(([v, n]) => html`<label class="check"><input type="checkbox" data-s="${v}" checked> ${n}</label>`)}</div>`,
        { ok: 'Fill missing', onOk: async (el) => { const r = await api('POST', '/api/studio/art/fill', { ids: [...st.picked], slots: $$('[data-s]:checked', el).map((x) => x.dataset.s) }); toast(`Added ${plural(r.filled, 'picture')}${r.skipped ? ` · TMDb had nothing for ${r.skipped}` : ''}`, 4000); drawTitles(); } });
      }
      if (e.target.closest('[data-bulk]')) {
        const slots = [['poster', 'Poster'], ['backdrops', 'Main backdrop'], ['logo', 'Logo'], ['thumb', 'Thumb'], ['cover', 'Cover (books, comics, albums)']];
        k.dialog(`One picture on ${plural(st.picked.size, 'title')}`, html`<label class="f"><span>Slot</span><select data-slot>${slots.map(([v, n]) => html`<option value="${v}">${n}</option>`)}</select></label>
          <label class="check"><input type="checkbox" data-skip checked> Skip titles that already have one</label><p class="muted small">Next you choose the picture.</p>`,
        { ok: 'Choose picture', onOk: async (el) => {
          const slot = $('[data-slot]', el).value, skip = $('[data-skip]', el).checked;
          setTimeout(async () => { const srcs = await chooseSource(k, { title: 'The picture for all of them', ratio: slot === 'poster' || slot === 'cover' ? '2/3' : '16/9' }); if (!srcs?.length) return;
            try { const r = await api('POST', '/api/studio/art/bulk', { ids: [...st.picked], slot, source: srcs[0], skipExisting: skip }); toast(`Done: ${r.done}${r.skipped ? ` · skipped ${r.skipped}` : ''}`, 3000); drawTitles(); } catch (err) { k.fail(err); } }, 0);
        } });
      }
    } catch (err) { k.fail(err); }
  });
  main.addEventListener('change', (e) => { const f = e.target.closest('[data-f]'); if (!f || f.dataset.f === 'q') return; st[f.dataset.f] = f.value; drawTitles(); });
  await draw();
}

// =====================================================================================
// Metadata
// =====================================================================================
const OPS = {
  set: 'Set to', clear: 'Clear', add: 'Add values', remove: 'Remove values', replace: 'Find and replace', prepend: 'Add text at the start', append: 'Add text at the end',
  case: 'Change capitalization', copy: 'Copy from another field', trim: 'Clean up', sort: 'Sort A→Z', lock: 'Lock', unlock: 'Unlock',
};
const OPS_FOR = { text: ['set', 'clear', 'replace', 'prepend', 'append', 'case', 'copy', 'trim', 'lock', 'unlock'], list: ['add', 'remove', 'set', 'clear', 'replace', 'case', 'copy', 'trim', 'sort', 'lock', 'unlock'],
  int: ['set', 'clear', 'copy', 'lock', 'unlock'], decimal: ['set', 'clear', 'copy', 'lock', 'unlock'], date: ['set', 'clear', 'copy', 'lock', 'unlock'], all: ['lock', 'unlock'] };
const QUICK = [
  ['Add tags', [{ op: 'add', field: 'tags', value: '' }]], ['Set parental rating', [{ op: 'set', field: 'rating', value: '' }]],
  ['Rename a genre', [{ op: 'replace', field: 'genres', find: '', replace: '' }]], ['Title Case titles', [{ op: 'case', field: 'title', mode: 'title' }]],
  ['Clean up genres and tags', [{ op: 'trim', field: 'genres' }, { op: 'trim', field: 'tags' }, { op: 'sort', field: 'tags' }]],
  ['Sort title from a pattern', [{ op: 'set', field: 'sort_title', value: '{Name} {Year}' }]],
  ['Lock genres and tags', [{ op: 'lock', field: 'genres' }, { op: 'lock', field: 'tags' }]], ['Unlock everything', [{ op: 'unlock', field: 'all' }]],
];

export async function metadata(main, k) {
  const C = await api('GET', '/api/studio/meta/catalog');
  const F = Object.fromEntries(C.fields.map((f) => [f.key, f]));
  const st = { tab: 'find', filter: { sort: 'title' }, offset: 0, total: 0, rows: [], picked: new Set(), last: null, ops: [], options: { onlyEmpty: false, lock: true }, more: false };
  const frame = (inner) => html`${k.head('Metadata', 'Find titles across every library and change many at once: genres, tags, studios, ratings, titles, years and more. Every change is previewed first and can be undone. Fields you change are locked, so rescans and TMDb keep your edits.')}
    <div class="tabs" data-mtabs>${[['find', 'Find and edit'], ['values', 'Genres, tags and studios'], ['sheet', 'Spreadsheet'], ['history', 'History and undo']].map(([id, n]) => html`<button data-mt="${id}" class="${st.tab === id ? 'on' : ''}">${n}</button>`)}</div>${inner}`;
  const opt = (v, n, cur) => html`<option value="${v}" ${String(cur ?? '') === String(v) ? 'selected' : ''}>${n}</option>`;
  const fieldOpts = (cur, withAll) => html`${withAll ? opt('all', 'All fields', cur) : ''}${C.fields.map((f) => opt(f.key, f.label, cur))}`;

  // ----- Find and edit
  const filterBar = () => {
    const f = st.filter;
    return html`<div class="card"><div class="filters">
      <input type="text" data-ff="q" value="${f.q || ''}" placeholder="Title, file name or path (e.g. 1080p)">
      <select data-ff="library"><option value="">All libraries</option>${C.libraries.map((l) => opt(l.id, l.name, f.library))}</select>
      <select data-ff="kinds"><option value="">Every type</option>${Object.entries(C.kinds).map(([v, n]) => opt(v, n, f.kinds))}</select>
      <select data-ff="missing"><option value="">Missing anything or not</option>${[['overview', 'No overview'], ['genres', 'No genres'], ['tags', 'No tags'], ['rating', 'No rating'], ['year', 'No year'], ['studios', 'No studios'], ['author', 'No author'], ['tmdb', 'Not matched to TMDb'], ['poster', 'No poster'], ['backdrop', 'No backdrop'], ['logo', 'No logo']].map(([v, n]) => opt(v, n, f.missing))}</select>
      <button class="btn sm" data-morefilters>${st.more ? 'Fewer filters' : 'More filters'}</button></div>
      ${st.more ? html`<div class="filters" style="margin-top:8px">
        <select data-ff="genre"><option value="">Any genre</option>${C.genres.map((g) => opt(g, g, f.genre))}</select>
        <select data-ff="tag"><option value="">Any tag</option>${C.tags.map((g) => opt(g, `Has ${g}`, f.tag))}</select>
        <select data-ff="notTag"><option value="">—</option>${C.tags.map((g) => opt(g, `Doesn't have ${g}`, f.notTag))}</select>
        <select data-ff="studio"><option value="">Any studio</option>${C.studios.map((g) => opt(g, g, f.studio))}</select>
        <select data-ff="rating"><option value="">Any rating</option>${opt('(none)', 'No rating', f.rating)}${C.ratings.map((g) => opt(g, g, f.rating))}</select>
        <input type="number" data-ff="yearFrom" value="${f.yearFrom || ''}" placeholder="From year" style="width:110px"><input type="number" data-ff="yearTo" value="${f.yearTo || ''}" placeholder="To year" style="width:110px">
        <input type="text" data-ff="series" value="${f.series || ''}" placeholder="Show or series name" style="width:180px">
        <select data-ff="containsField"><option value="">Field contains…</option>${C.fields.map((x) => opt(x.key, x.label, f.containsField))}</select><input type="text" data-ff="contains" value="${f.contains || ''}" placeholder="text" style="width:140px">
        <select data-ff="locked">${opt('', 'Locked or not', f.locked)}${opt('any', 'Has locked fields', f.locked)}${opt('none', 'Nothing locked', f.locked)}</select>
        <select data-ff="sort">${opt('title', 'Sort: title', f.sort)}${opt('series', 'Sort: series and episode', f.sort)}${opt('added', 'Sort: recently added', f.sort)}${opt('year', 'Sort: newest', f.sort)}</select></div>` : ''}</div>`;
  };
  const opRow = (o, i) => {
    const kind = o.field === 'all' ? 'all' : F[o.field]?.kind || 'text';
    const ops = OPS_FOR[kind];
    if (!ops.includes(o.op)) o.op = ops[0];
    const tokensHint = 'Tokens: {Name} {Year} {SeriesName} {SeasonNumber:00} {EpisodeNumber:00} {Library} {Type} {FileName} {Folder} {Author} {value}';
    let extra = '';
    if (['set', 'add', 'remove', 'prepend', 'append'].includes(o.op)) extra = html`<input type="text" data-o="value" value="${o.value || ''}" placeholder="${kind === 'list' ? 'Values, separated by |' : o.op === 'set' && kind === 'date' ? '2024-05-31' : 'Value'}" title="${tokensHint}">${o.op === 'remove' ? html`<label class="check sm"><input type="checkbox" data-o="regex" ${o.regex ? 'checked' : ''}> pattern</label>` : ''}`;
    if (o.op === 'replace') extra = html`<input type="text" data-o="find" value="${o.find || ''}" placeholder="Find"><input type="text" data-o="replace" value="${o.replace || ''}" placeholder="Replace with (empty removes it)" title="${tokensHint}"><label class="check sm"><input type="checkbox" data-o="regex" ${o.regex ? 'checked' : ''}> pattern</label>`;
    if (o.op === 'case') extra = html`<select data-o="mode">${opt('title', 'Title Case', o.mode)}${opt('sentence', 'Sentence case', o.mode)}${opt('upper', 'UPPER CASE', o.mode)}${opt('lower', 'lower case', o.mode)}</select>`;
    if (o.op === 'copy') extra = html`<select data-o="from"><option value="">from…</option>${C.fields.filter((x) => x.key !== o.field).map((x) => opt(x.key, x.label, o.from))}</select>`;
    return html`<div class="oprow" data-op="${i}"><span class="n">${i + 1}</span><select data-o="field">${fieldOpts(o.field, ['lock', 'unlock'].includes(o.op))}</select><select data-o="op">${ops.map((x) => opt(x, OPS[x], o.op))}</select>${extra}<button class="btn sm danger" data-delop aria-label="Remove this edit">✕</button></div>`;
  };
  const table = () => {
    const allOnPage = st.rows.length && st.rows.every((r) => st.picked.has(r.id));
    return html`<div class="selbar"><b>${st.picked.size ? `${plural(st.picked.size, 'title')} selected` : 'Nothing selected'}</b><span class="muted">${plural(st.total, 'match', 'matches')}</span>
        <button class="btn sm" data-selpage>${allOnPage ? 'Unselect page' : 'Select page'}</button>${st.total > st.rows.length ? html`<button class="btn sm" data-selmatches>Select all ${st.total}</button>` : ''}${st.picked.size ? html`<button class="btn sm" data-selclear>Clear selection</button>` : ''}</div>
      <div class="tablewrap"><table class="mt"><thead><tr><th></th><th>Title</th><th>Type</th><th>Year</th><th>Rating</th><th>Genres</th><th>Tags</th><th title="Locked fields">🔒</th></tr></thead><tbody>
      ${st.rows.map((r, i) => html`<tr class="${st.picked.has(r.id) ? 'on' : ''}" data-row="${i}"><td><input type="checkbox" data-pick ${st.picked.has(r.id) ? 'checked' : ''} aria-label="Select ${r.title}"></td>
        <td><button class="linkish" data-open="${r.id}">${r.series ? html`<small class="muted">${r.series}${r.season_no != null && r.kind === 'episode' ? ` · S${r.season_no} E${r.episode_no}` : ''} · </small>` : ''}${r.title}</button><small class="muted file">${r.library}${r.file ? ` · ${r.file}` : ''}</small></td>
        <td>${C.kinds[r.kind]?.replace(/s$/, '') || r.kind}</td><td>${r.year || ''}</td><td>${r.rating || ''}</td><td>${short(r.genres, 40)}</td><td>${short(r.tags, 40)}</td>
        <td title="${r.locked.join(', ')}">${r.locked.length || ''}</td></tr>`)}</tbody></table></div>
      ${!st.rows.length ? html`<p class="muted" style="padding:16px">No titles match.</p>` : ''}
      <div class="pager">${st.offset > 0 ? html`<button class="btn sm" data-page="-1">← Previous</button>` : ''}<span class="muted small">${st.rows.length ? `${st.offset + 1}–${st.offset + st.rows.length} of ${st.total}` : ''}</span>${st.offset + st.rows.length < st.total ? html`<button class="btn sm" data-page="1">Next →</button>` : ''}</div>`;
  };
  const editPanel = () => html`<div class="card"><h2>Edit the selected titles</h2>
    <div class="quick">${QUICK.map(([n], i) => html`<button class="btn sm" data-quick="${i}">${n}</button>`)}</div>
    <div class="ops">${st.ops.map(opRow)}</div>
    <div class="tools" style="margin:10px 0"><button class="btn sm" data-addop>+ Add an edit</button></div>
    <label class="check"><input type="checkbox" data-opt="onlyEmpty" ${st.options.onlyEmpty ? 'checked' : ''}> Only fill fields that are empty</label>
    <label class="check"><input type="checkbox" data-opt="lock" ${st.options.lock ? 'checked' : ''}> Lock every field I change, so rescans and TMDb don't undo it</label>
    <p class="muted small">Edits run top to bottom on every selected title. Text values can use tokens like {Name}, {Year}, {SeriesName}, {SeasonNumber:00}, {EpisodeNumber:00}, {Library}, {FileName} and {value} (the current value). Tick “pattern” to use a regular expression.</p>
    <div class="tools" style="margin-top:12px"><button class="btn primary" data-preview ${st.picked.size && st.ops.length ? '' : raw('disabled')}>Preview changes</button><button class="btn" data-refresh ${st.picked.size ? '' : raw('disabled')}>Refresh from TMDb</button></div></div>`;
  const search = async () => {
    const r = await api('POST', '/api/studio/meta/search', { ...st.filter, offset: st.offset, limit: 100 });
    st.rows = r.items; st.total = r.total;
  };
  const drawFind = async (refetch = true) => {
    if (refetch) await search();
    main.innerHTML = String(frame(html`${filterBar()}<div class="card"><div data-table>${table()}</div></div>${editPanel()}`));
    const qbox = $('[data-ff=q]', main); if (qbox) qbox.oninput = k.debounce(() => { st.filter.q = qbox.value; st.offset = 0; drawFind(); }, 350);
    for (const inp of $$('input[data-ff]:not([data-ff=q])', main)) inp.oninput = k.debounce(() => { st.filter[inp.dataset.ff] = inp.value; st.offset = 0; drawFind(); }, 450);
  };
  const redrawTable = () => { $('[data-table]', main).innerHTML = String(table()); const p = $('[data-preview]', main); if (p) p.disabled = !(st.picked.size && st.ops.length); const r = $('[data-refresh]', main); if (r) r.disabled = !st.picked.size; };
  const redrawOps = () => { $('.ops', main).innerHTML = String(html`${st.ops.map(opRow)}`); const p = $('[data-preview]', main); if (p) p.disabled = !(st.picked.size && st.ops.length); };

  const diffTable = (planned) => html`<div class="tablewrap" style="max-height:52vh"><table class="mt diff"><thead><tr><th>Title</th><th>Field</th><th>Before</th><th>After</th></tr></thead><tbody>
    ${planned.flatMap((p) => (p.error ? [html`<tr class="err"><td>${p.title}</td><td colspan="3">${p.error}</td></tr>`] : p.changes.map((c, i) => html`<tr><td>${i ? '' : html`${p.show ? html`<small class="muted">${p.show} · </small>` : ''}${p.title}`}</td>
      <td>${F[c.field]?.label || c.field}${c.auto ? html` <small class="muted">(follows title)</small>` : ''}</td>${'lock' in c ? html`<td colspan="2">${c.lock ? '🔒 Locked' : '🔓 Unlocked'}</td>` : html`<td class="before">${short(c.before, 120)}</td><td class="after">${short(c.after, 120)}</td>`}</tr>`)))}</tbody></table></div>`;

  const preview = async () => {
    const ids = [...st.picked];
    const r = await api('POST', '/api/studio/meta/preview', { ids, ops: st.ops, options: st.options });
    k.dialog('Preview changes', html`<p><b>${plural(r.items, 'title')}</b> change (${plural(r.changes, 'field')})${r.selected - r.items - r.errors > 0 ? html`<span class="muted">, ${r.selected - r.items - r.errors} already match</span>` : ''}${r.errors ? html`, <span class="bad">${plural(r.errors, 'problem')}</span>` : ''}.</p>
      ${r.planned.length ? diffTable(r.planned) : html`<p class="muted">Nothing would change.</p>`}${r.planned.length >= 500 ? html`<p class="muted small">Showing the first 500.</p>` : ''}`,
    { ok: r.items ? `Apply to ${plural(r.items, 'title')}` : '', wide: true, onOk: async () => {
      const a = await api('POST', '/api/studio/meta/apply', { ids, ops: st.ops, options: st.options });
      toast(a.saved ? `Changed ${plural(a.saved.items, 'title')}. You can undo it in History.` : 'Nothing changed', 3500);
      await drawFind();
    } });
    $('.dialog', $('#modal')).style.width = 'min(1000px, 100%)';
  };

  const openItem = async (id) => {
    const d = await api('GET', `/api/studio/meta/item/${id}`);
    const v = d.values, locked = new Set(d.locked);
    const input = (f) => { const val = v[f.key]; const shown = Array.isArray(val) ? val.join(' | ') : val ?? '';
      return f.key === 'overview' ? html`<textarea data-k="${f.key}" rows="4">${shown}</textarea>` : html`<input type="${f.kind === 'date' ? 'date' : f.kind === 'int' || f.kind === 'decimal' ? 'number' : 'text'}" ${f.kind === 'decimal' ? raw('step="0.1" min="0" max="10"') : ''} data-k="${f.key}" value="${shown}" ${f.kind === 'list' ? raw('placeholder="Separate values with |"') : ''}>`; };
    k.dialog(`${d.series ? `${d.series} · ` : ''}${d.values.title}`, html`<p class="muted small">${C.kinds[d.kind]?.replace(/s$/, '')} · ${d.library}${d.path ? html` · <span title="${d.path}">${d.path.split('/').pop()}</span>` : ''}</p>
      <div class="itemform">${C.fields.map((f) => html`<label class="f"><span>${f.label}</span>${input(f)}<button type="button" class="lockbtn ${locked.has(f.key) ? 'on' : ''}" data-lock="${f.key}" title="${locked.has(f.key) ? 'Locked: rescans keep this value. Click to unlock.' : 'Unlocked: TMDb or a rescan can change it. Click to lock.'}">${locked.has(f.key) ? '🔒' : '🔓'}</button></label>`)}</div>
      <p class="muted small">Fields you change are locked automatically.</p>`, { ok: 'Save', wide: true, onOk: async (el) => {
      const values = {};
      for (const f of C.fields) {
        const cur = $(`[data-k="${f.key}"]`, el).value, was = Array.isArray(v[f.key]) ? v[f.key].join(' | ') : v[f.key] ?? '';
        if (String(cur) !== String(was)) values[f.key] = cur;
      }
      if (Object.keys(values).length) await api('POST', `/api/studio/meta/item/${id}`, { values });
      const now = new Set($$('.lockbtn.on', el).map((b) => b.dataset.lock));
      const ops = [...C.fields.map((f) => f.key).filter((f) => now.has(f) && !locked.has(f) && !(f in values)).map((field) => ({ op: 'lock', field })), ...[...locked].filter((f) => !now.has(f)).map((field) => ({ op: 'unlock', field }))];
      if (ops.length) await api('POST', '/api/studio/meta/apply', { ids: [id], ops, options: { lock: false } });
      toast('Saved', 1200); await drawFind();
    } });
    $('.dialog', $('#modal')).style.width = 'min(820px, 100%)';
    $('#modal').addEventListener('click', (e) => { const b = e.target.closest('[data-lock]'); if (!b) return; b.classList.toggle('on'); b.textContent = b.classList.contains('on') ? '🔒' : '🔓'; });
  };

  // ----- values manager
  const drawValues = async () => {
    st.vfield ||= 'genres';
    const rows = await api('GET', `/api/studio/meta/values?field=${st.vfield}${st.vlib ? `&library=${st.vlib}` : ''}`);
    const fields = [['genres', 'Genres'], ['tags', 'Tags'], ['studios', 'Studios and networks'], ['rating', 'Parental ratings'], ['year', 'Years'], ['author', 'Authors and artists']];
    main.innerHTML = String(frame(html`<div class="card"><div class="filters"><select data-vf>${fields.map(([v, n]) => opt(v, n, st.vfield))}</select><select data-vl><option value="">Across every library</option>${C.libraries.map((l) => opt(l.id, l.name, st.vlib))}</select>
      <input type="text" data-vq placeholder="Filter the list"><span class="grow"></span><button class="btn sm" data-vrename disabled>Rename</button><button class="btn sm" data-vmerge disabled>Merge into one</button><button class="btn sm danger" data-vdelete disabled>Delete everywhere</button></div>
      <p class="muted small" style="margin:8px 0">${plural(rows.length, 'value')}. Tick values, then rename, merge or delete them on every title at once. All of it lands in History, so it can be undone.</p>
      <div class="vals">${rows.map((r) => html`<label class="val" data-v="${r.value}"><input type="checkbox"><span>${r.value}</span><b>${r.n}</b><button class="linkish small" data-vshow="${r.value}">See titles</button></label>`)}</div></div>`));
    const sel = () => $$('.val input:checked', main).map((x) => x.closest('[data-v]').dataset.v);
    const sync = () => { const n = sel().length; $('[data-vrename]', main).disabled = n !== 1; $('[data-vmerge]', main).disabled = n < 2; $('[data-vdelete]', main).disabled = !n; };
    main.onchange = (e) => { if (e.target.matches('[data-vf]')) { st.vfield = e.target.value; drawValues(); } else if (e.target.matches('[data-vl]')) { st.vlib = e.target.value; drawValues(); } else sync(); };
    $('[data-vq]', main).oninput = (e) => { const t = e.target.value.toLowerCase(); for (const v of $$('.val', main)) v.hidden = !v.dataset.v.toLowerCase().includes(t); };
    main.onclick = async (e) => {
      const show = e.target.closest('[data-vshow]');
      if (show) { e.preventDefault(); const key = { genres: 'genre', tags: 'tag', studios: 'studio', rating: 'rating' }[st.vfield]; st.filter = { sort: 'title', ...(key ? { [key]: show.dataset.vshow } : st.vfield === 'year' ? { yearFrom: show.dataset.vshow, yearTo: show.dataset.vshow } : { containsField: st.vfield, contains: show.dataset.vshow }) }; st.more = true; st.tab = 'find'; st.offset = 0; return drawFind(); }
      const act = e.target.closest('[data-vrename],[data-vmerge],[data-vdelete]'); if (!act) return;
      const from = sel(), action = act.matches('[data-vdelete]') ? 'delete' : 'merge';
      const pv = await api('POST', '/api/studio/meta/values', { field: st.vfield, from, to: action === 'delete' ? null : from[0], action, preview: true }).catch(() => ({ items: '?' }));
      k.dialog(action === 'delete' ? `Delete ${from.join(', ')}?` : act.matches('[data-vrename]') ? `Rename “${from[0]}”` : `Merge ${plural(from.length, 'value')}`,
        html`${action === 'delete' ? html`<p class="muted">Removes it from ${plural(pv.items, 'title')}.</p>` : html`<label class="f"><span>New name</span><input type="text" data-to value="${from[0]}"></label><p class="muted small">Changes ${plural(pv.items, 'title')}.</p>`}`,
        { ok: action === 'delete' ? 'Delete' : 'Save', danger: action === 'delete', onOk: async (el) => {
          const r = await api('POST', '/api/studio/meta/values', { field: st.vfield, from, to: action === 'delete' ? null : $('[data-to]', el).value, action });
          toast(`Changed ${plural(r.items, 'title')}`); drawValues();
        } });
    };
  };

  // ----- spreadsheet
  const drawSheet = async () => {
    main.innerHTML = String(frame(html`<div class="card"><h2>Export to a spreadsheet</h2><p class="muted">Download a CSV, edit it in Excel, Numbers or Google Sheets, then import it below. Lists use “ | ” between values.</p>
        <div class="checks" style="margin:12px 0"><label class="check"><input type="radio" name="scope" value="sel" ${st.picked.size ? 'checked' : raw('disabled')}> The ${plural(st.picked.size, 'selected title')}</label>
          <label class="check"><input type="radio" name="scope" value="filter" ${st.picked.size ? '' : 'checked'}> Everything matching the current search (${plural(st.total, 'title')})</label><label class="check"><input type="radio" name="scope" value="all"> Every title</label></div>
        <div class="checks" data-cols>${C.fields.map((f) => html`<label class="check"><input type="checkbox" value="${f.key}" ${['title', 'sort_title', 'year', 'rating', 'genres', 'tags', 'studios'].includes(f.key) ? 'checked' : ''}> ${f.label}</label>`)}<label class="check"><input type="checkbox" value="library" checked> Library</label><label class="check"><input type="checkbox" value="type" checked> Type</label><label class="check"><input type="checkbox" value="path"> File path</label></div>
        <div class="tools" style="margin-top:12px"><button class="btn primary" data-export>Download CSV</button></div></div>
      <div class="card"><h2>Import a spreadsheet</h2><p class="muted">Keep the id column. Only cells that differ are changed, and read-only columns (library, type, path) are ignored. You see every change before anything is saved.</p>
        <p class="muted small"><b>From Jellyfin:</b> a CSV from the Jellyfin Bulk Metadata plugin (Spreadsheet → Download CSV, with the Path column on) works here too. Each row is matched to a HallFlix title by its file, then its TMDb id, then show + season + episode, then title and year. Titles, sort titles, overviews, taglines, genres, tags, studios, ratings, scores, years, dates, TMDb ids and authors come across.</p>
        <label class="check"><input type="checkbox" data-blank> Blank cells clear the field (otherwise blank cells are skipped)</label>
        <label class="check"><input type="checkbox" data-ilock checked> Lock the fields that change</label>
        <label class="drop" style="margin-top:10px"><input type="file" accept=".csv,text/csv" hidden data-csv><b>Choose a CSV file</b><span class="muted small">or drop it here</span></label></div>`));
    const runImport = async (file) => {
      const text = await file.text(), blank = $('[data-blank]', main).checked ? '1' : '0', lock = $('[data-ilock]', main).checked ? '1' : '0';
      const res = await fetch(`/api/studio/meta/import?blank=${blank}`, { method: 'POST', body: text, credentials: 'same-origin' });
      const r = await res.json(); if (!res.ok) return k.fail(new Error(r.error));
      const jf = r.source === 'jellyfin' ? (() => {
        const m = r.matched, found = m.path + m.tmdb + m.episode + m.title;
        return html`<p class="muted small"><b>From Jellyfin:</b> ${found} of ${plural(r.rows, 'row')} matched to HallFlix titles (${m.path} by file, ${m.tmdb} by TMDb id, ${m.episode} by episode, ${m.title} by title).${r.unknown ? ` ${plural(r.unknown, 'row')} matched nothing here and ${r.unknown === 1 ? 'is' : 'are'} skipped.` : ''}</p>
          ${r.missed?.length ? html`<details><summary class="muted small">Rows with no match</summary><div class="small" style="max-height:200px;overflow:auto">${r.missed.map((x) => html`<div>${x.type ? html`<span class="muted">${x.type}</span> · ` : ''}${x.series ? `${x.series} S${x.season}E${x.episode} · ` : ''}${x.name}${x.path ? html` <span class="muted">${x.path}</span>` : ''}</div>`)}</div></details>` : ''}`;
      })() : '';
      k.dialog(`Import ${file.name}`, html`<p><b>${plural(r.items, 'title')}</b> change (${plural(r.changes, 'field')})${r.errors ? html`, <span class="bad">${plural(r.errors, 'problem')}</span>` : ''}${r.unknown && !jf ? html`<span class="muted"> · ${plural(r.unknown, 'row')} with an id HallFlix doesn't know</span>` : ''}.</p>${jf}${r.planned.length ? diffTable(r.planned) : html`<p class="muted">Nothing would change.</p>`}`,
        { ok: r.items ? `Apply to ${plural(r.items, 'title')}` : '', wide: true, onOk: async () => {
          const a = await (await fetch(`/api/studio/meta/import?apply=1&blank=${blank}&lock=${lock}`, { method: 'POST', body: text, credentials: 'same-origin' })).json();
          toast(a.saved ? `Changed ${plural(a.saved.items, 'title')}` : 'Nothing changed');
        } });
      $('.dialog', $('#modal')).style.width = 'min(1000px, 100%)';
    };
    const zone = $('.drop', main);
    $('[data-csv]', main).onchange = (e) => e.target.files[0] && runImport(e.target.files[0]);
    zone.addEventListener('dragover', (e) => e.preventDefault()); zone.addEventListener('drop', (e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) runImport(f); });
    $('[data-export]', main).onclick = async () => {
      const scope = $('[name=scope]:checked', main).value, columns = $$('[data-cols] input:checked', main).map((x) => x.value);
      const body = { columns, ids: scope === 'sel' ? [...st.picked] : undefined, filter: scope === 'filter' ? st.filter : {} };
      const res = await fetch('/api/studio/meta/export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), credentials: 'same-origin' });
      if (!res.ok) return k.fail(new Error((await res.json()).error));
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(await res.blob()), download: `hallflix-metadata-${new Date().toISOString().slice(0, 10)}.csv` });
      a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    };
  };

  // ----- history
  const drawHistory = async () => {
    const list = await api('GET', '/api/studio/meta/history');
    main.innerHTML = String(frame(html`<div class="card"><h2>Recent changes</h2><p class="muted small">The last 50 batches, with every value before and after. Undo puts the old values back (and can itself be undone).</p>
      ${list.length ? list.map((h) => html`<div class="row" data-h="${h.id}"><div class="grow"><b>${h.label}${h.undone ? html` <span class="pill">Undone</span>` : ''}</b><span>${ago(h.created_at)} · ${plural(h.items, 'title')} · ${plural(h.n, 'change')}</span></div>
        <div class="tools"><button class="btn sm" data-hview>See changes</button><button class="btn sm" data-hundo ${h.undone ? raw('disabled') : ''}>Undo</button></div></div>`) : html`<p class="muted">No changes yet.</p>`}</div>`));
    main.onclick = async (e) => {
      const row = e.target.closest('[data-h]'); if (!row) return;
      const id = row.dataset.h;
      if (e.target.closest('[data-hview]')) {
        const h = await api('GET', `/api/studio/meta/history/${id}`);
        const byItem = new Map(); for (const c of h.changes) { if (!byItem.has(c.id)) byItem.set(c.id, { title: c.title, changes: [] }); byItem.get(c.id).changes.push(c); }
        k.dialog(h.label, diffTable([...byItem.values()]), { ok: '', wide: true });
        $('.dialog', $('#modal')).style.width = 'min(1000px, 100%)';
      }
      if (e.target.closest('[data-hundo]')) {
        const pv = await api('POST', `/api/studio/meta/history/${id}/undo?preview=1`);
        k.confirmBox('Undo this change?', `Puts back ${plural(pv.changes, 'value')} on ${plural(pv.items, 'title')}.`, 'Undo', async () => { await api('POST', `/api/studio/meta/history/${id}/undo`); toast('Undone'); drawHistory(); });
      }
    };
  };

  const draw = () => ({ find: drawFind, values: drawValues, sheet: drawSheet, history: drawHistory }[st.tab])().catch(k.fail);
  main.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-mt]'); if (t) { st.tab = t.dataset.mt; main.onclick = null; main.onchange = null; return draw(); }
    if (st.tab !== 'find') return;
    const b = e.target.closest('button,input[type=checkbox]');
    if (!b) return;
    try {
      if (b.matches('[data-morefilters]')) { st.more = !st.more; return drawFind(false); }
      if (b.matches('[data-pick]')) {
        const i = +b.closest('[data-row]').dataset.row, r = st.rows[i];
        const range = e.shiftKey && st.last != null ? st.rows.slice(Math.min(st.last, i), Math.max(st.last, i) + 1) : [r];
        for (const x of range) b.checked ? st.picked.add(x.id) : st.picked.delete(x.id);
        st.last = i; return redrawTable();
      }
      if (b.matches('[data-selpage]')) { const all = st.rows.every((r) => st.picked.has(r.id)); for (const r of st.rows) all ? st.picked.delete(r.id) : st.picked.add(r.id); return redrawTable(); }
      if (b.matches('[data-selmatches]')) { const r = await api('POST', '/api/studio/meta/search', { ...st.filter, idsOnly: true }); for (const id of r.ids) st.picked.add(id); toast(`Selected ${plural(r.ids.length, 'title')}`); return redrawTable(); }
      if (b.matches('[data-selclear]')) { st.picked.clear(); return redrawTable(); }
      if (b.matches('[data-page]')) { st.offset = Math.max(0, st.offset + +b.dataset.page * 100); await search(); return redrawTable(); }
      if (b.matches('[data-open]')) return openItem(+b.dataset.open);
      if (b.matches('[data-quick]')) { st.ops.push(...structuredClone(QUICK[+b.dataset.quick][1])); redrawOps(); $(`[data-op="${st.ops.length - 1}"] input[type=text]`, main)?.focus(); return; }
      if (b.matches('[data-addop]')) { st.ops.push({ op: 'add', field: 'tags', value: '' }); return redrawOps(); }
      if (b.matches('[data-delop]')) { st.ops.splice(+b.closest('[data-op]').dataset.op, 1); return redrawOps(); }
      if (b.matches('[data-preview]')) return preview();
      if (b.matches('[data-refresh]')) return k.confirmBox(`Refresh ${plural(st.picked.size, 'title')} from TMDb?`, 'HallFlix looks each movie and show up on TMDb again and fills in anything that isn’t locked. Locked fields keep your edits.', 'Refresh', async () => { const r = await api('POST', '/api/studio/meta/refresh', { ids: [...st.picked] }); toast(`Refreshing ${plural(r.libraries, 'library', 'libraries')} in the background`); });
    } catch (err) { k.fail(err); }
  });
  main.addEventListener('change', (e) => {
    if (st.tab !== 'find') return;
    const ff = e.target.closest('select[data-ff]');
    if (ff) { st.filter[ff.dataset.ff] = ff.value; st.offset = 0; return drawFind(); }
    const o = e.target.closest('[data-o]');
    if (o) { const i = +o.closest('[data-op]').dataset.op; st.ops[i][o.dataset.o] = o.type === 'checkbox' ? o.checked : o.value; if (['field', 'op'].includes(o.dataset.o)) redrawOps(); }
    const op = e.target.closest('[data-opt]'); if (op) st.options[op.dataset.opt] = op.checked;
  });
  main.addEventListener('input', (e) => { const o = e.target.closest('input[type=text][data-o]'); if (o && st.tab === 'find') st.ops[+o.closest('[data-op]').dataset.op][o.dataset.o] = o.value; });
  await draw();
}

// =====================================================================================
// Parental controls (Content Guard)
// =====================================================================================
const GUARD_PRESETS = [
  ['Young children', { name: 'Young children', blockRatings: ['PG-13', 'R', 'NC-17', 'TV-14', 'TV-MA', 'NR', 'Unrated'], blockGenres: ['Horror'], hideUnrated: true }],
  ['Older kids', { name: 'Older kids', blockRatings: ['R', 'NC-17', 'TV-MA'], blockGenres: [], hideUnrated: false }],
  ['Teens', { name: 'Teens', blockRatings: ['NC-17'], blockTags: ['adult*'] }],
  ['Only what I tag', { name: 'Only tagged titles', allowTags: ['kids'] }],
];
export async function guard(main, k) {
  let G, dirty = false;
  const load = async () => { G = await api('GET', '/api/studio/guard'); };
  const avatar = (p) => html`<span class="avatar sm" style="${p.color ? `background:${p.color}` : ''}">${p.avatar ? html`<img src="${p.avatar}" alt="">` : p.name[0].toUpperCase()}</span>`;
  const ruleCard = (r, i) => html`<section class="card guard" data-rule="${i}">
    <div class="slot-head"><div class="grow"><input type="text" class="title-in" data-g="name" value="${r.name}" aria-label="Rule set name"></div>
      <div class="tools"><label class="check"><input type="checkbox" data-g="enabled" ${r.enabled !== false ? 'checked' : ''}> On</label><button class="btn sm" data-gpreview>Preview hidden titles</button><button class="btn sm danger" data-gdel>Delete</button></div></div>
    <div class="f"><span>Applies to</span><div class="checks">${G.profiles.map((p) => html`<label class="check pchip"><input type="checkbox" data-gp="${p.id}" ${(r.profiles || []).includes(p.id) ? 'checked' : ''}> ${avatar(p)} ${p.name}${p.is_admin ? html` <small class="muted">(admin)</small>` : ''}</label>`)}</div></div>
    <div class="f"><span>Hide titles tagged</span>${chipsIn(`t${i}`, r.blockTags, G.tags.map((x) => x.t), 'e.g. Grown-up, Horror*')}</div>
    <div class="f"><span>Hide genres</span>${chipsIn(`g${i}`, r.blockGenres, G.genres.map((x) => x.g), 'e.g. Horror')}</div>
    <div class="f"><span>Hide ratings</span>${chipsIn(`r${i}`, r.blockRatings, [...new Set([...G.ratings.map((x) => x.r), 'G', 'PG', 'PG-13', 'R', 'NC-17', 'TV-Y', 'TV-Y7', 'TV-G', 'TV-PG', 'TV-14', 'TV-MA'])], 'e.g. R, TV-MA')}</div>
    <div class="f"><span>Only show titles tagged</span>${chipsIn(`a${i}`, r.allowTags, G.tags.map((x) => x.t), 'Leave empty to allow everything else')}</div>
    <label class="check"><input type="checkbox" data-g="hideUnrated" ${r.hideUnrated ? 'checked' : ''}> Also hide movies and shows that have no rating</label>
    <div class="gprev" hidden></div></section>`;
  const collect = () => G.rules.map((r, i) => {
    const el = $(`[data-rule="${i}"]`, main);
    return { ...r, name: $('[data-g=name]', el).value, enabled: $('[data-g=enabled]', el).checked, hideUnrated: $('[data-g=hideUnrated]', el).checked,
      profiles: $$('[data-gp]:checked', el).map((x) => +x.dataset.gp), blockTags: readChips(el, `t${i}`), blockGenres: readChips(el, `g${i}`), blockRatings: readChips(el, `r${i}`), allowTags: readChips(el, `a${i}`) };
  });
  const draw = () => {
    main.innerHTML = String(html`${k.head('Parental controls', 'Rule sets hide titles from the profiles you choose, by tag, genre or rating. Seasons and episodes follow their show, issues follow their series, and songs follow their album. The server enforces it in every app: hidden titles never appear in rows, grids or search, and can’t be opened or played even with a direct link.',
      html`<button class="btn primary" data-gsave ${dirty ? '' : raw('disabled')}>${dirty ? 'Save changes' : 'Saved'}</button>`)}
      <div class="card"><h2>Add a rule set</h2><div class="tools">${GUARD_PRESETS.map(([n], i) => html`<button class="btn sm" data-gadd="${i}">${n}</button>`)}<button class="btn sm" data-gadd="-1">Empty</button></div>
        <p class="muted small" style="margin-top:8px">Matching ignores capitals, and * is a wildcard (Horror* also hides “Horror Comedy”). Tip: tag the show, not each episode. Tags are set on the Metadata page.</p></div>
      ${G.rules.length ? G.rules.map(ruleCard) : html`<div class="card"><p class="muted">No rule sets yet, so every profile sees everything.</p></div>`}
      <div class="card"><h2>Check a title</h2><p class="muted small">See what a profile can see, and which rule hides a title. Uses the saved rules.</p>
        <div class="imgrow" style="margin-top:10px"><select data-tp style="width:auto">${G.profiles.map((p) => html`<option value="${p.id}">${p.name}</option>`)}</select><input type="text" data-tq placeholder="Search a title or episode"><button class="btn" data-tgo>Check</button></div><div data-tout></div></div>`);
    wireChips(main, mark);
  };
  const mark = () => { dirty = true; const b = $('[data-gsave]', main); if (b) { b.disabled = false; b.textContent = 'Save changes'; } };
  main.addEventListener('input', (e) => { if (e.target.closest('[data-rule]') && !e.target.closest('[data-chips]')) mark(); });
  main.addEventListener('change', (e) => { if (e.target.closest('[data-rule]') && !e.target.closest('[data-chips]')) mark(); });
  main.addEventListener('click', async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    try {
      if (b.matches('[data-gadd]')) { if (G.rules.length) G.rules = collect(); const p = +b.dataset.gadd; G.rules.push({ name: 'New rule set', enabled: true, profiles: [], blockTags: [], blockGenres: [], blockRatings: [], allowTags: [], hideUnrated: false, ...(p >= 0 ? structuredClone(GUARD_PRESETS[p][1]) : {}) }); dirty = true; draw(); $(`[data-rule="${G.rules.length - 1}"]`, main).scrollIntoView({ behavior: 'smooth' }); }
      if (b.matches('[data-gdel]')) { const i = +b.closest('[data-rule]').dataset.rule; G.rules = collect(); k.confirmBox(`Delete “${G.rules[i].name}”?`, 'Its profiles see everything this rule set hid, once you save.', 'Delete', () => { G.rules.splice(i, 1); dirty = true; draw(); }); }
      if (b.matches('[data-gsave]')) { const r = await api('PUT', '/api/studio/guard', { rules: collect() }); G.rules = r.rules; dirty = false; toast('Saved. It applies straight away.'); draw(); }
      if (b.matches('[data-gpreview]')) {
        const box = $('.gprev', b.closest('[data-rule]')), i = +b.closest('[data-rule]').dataset.rule;
        box.hidden = false; box.innerHTML = '<p class="muted">Checking…</p>';
        const r = await api('POST', '/api/studio/guard/preview', { rule: collect()[i] });
        const counts = Object.entries(r.counts).map(([kd, n]) => `${n} ${({ movie: 'movies', show: 'shows', episode: 'episodes', season: 'seasons', book: 'books', comic: 'issues', series: 'comic series', album: 'albums', track: 'songs', artist: 'artists' })[kd] || kd}`).join(', ');
        box.innerHTML = String(html`<h3 style="margin:12px 0 6px">${r.total ? `Hides ${counts}` : 'Hides nothing'}</h3>${r.items.length ? html`<div class="gl">${r.items.map((x) => html`<div class="row"><div class="grow"><b>${x.title}${x.year ? html` <small class="muted">(${x.year})</small>` : ''}</b><span>${x.why}</span></div></div>`)}</div>` : ''}`);
      }
      if (b.matches('[data-tgo]')) {
        const r = await api('GET', `/api/studio/guard/test?profile=${$('[data-tp]', main).value}&q=${encodeURIComponent($('[data-tq]', main).value)}`);
        $('[data-tout]', main).innerHTML = String(html`<p class="muted small" style="margin:10px 0">${r.applies.length ? `${r.profile} follows: ${r.applies.join(', ')}` : `No rule set applies to ${r.profile}, so everything is visible.`}</p>
          ${r.items.map((x) => html`<div class="row"><div class="grow"><b>${x.show_title ? `${x.show_title} · ` : ''}${x.title}</b><span>${x.visible ? 'Visible' : x.why}</span></div><span class="pill ${x.visible ? 'ok' : 'bad'}">${x.visible ? 'Visible' : 'Hidden'}</span></div>`)}
          ${!r.items.length ? html`<p class="muted">No titles match.</p>` : ''}`);
      }
    } catch (err) { k.fail(err); }
  });
  main.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches('[data-tq]')) $('[data-tgo]', main).click(); });
  await load(); draw();
}

// =====================================================================================
// Pre-rolls
// =====================================================================================
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const PRESET_ICON = { halloween: '🎃', thanksgiving: '🦃', christmas: '🎄', newyear: '🎆', valentines: '💘', july4: '🎇', weekend: '🍿', latenight: '🌙' };
export async function prerolls(main, k) {
  let P, R = null, tab = 'overview';
  const load = async () => { [P, R] = await Promise.all([api('GET', '/api/studio/prerolls'), api('GET', '/api/studio/prerolls/reach?limit=24').catch(() => null)]); };
  // Posters of the titles a rule or tag group can play before.
  const posters = (list) => html`<div class="reach">${list.map((t) => html`<div class="reach-t" data-rt="${String(t.title).toLowerCase()}" title="${t.title}${t.year ? ` (${t.year})` : ''}${t.genres?.length ? ` · ${t.genres.join(', ')}` : ''}">${t.poster ? html`<img src="${t.poster}" alt="" loading="lazy">` : html`<span class="reach-blank">${t.kind === 'show' ? '📺' : '🎬'}</span>`}<span>${t.title}</span></div>`)}</div>`;
  const seeAll = async (list, title) => {
    const r = await api('GET', `/api/studio/prerolls/reach?list=${encodeURIComponent(list)}`);
    const d = k.dialog(title, html`<input type="search" data-rq placeholder="Find a title in this list" style="margin-bottom:10px">${r.titles.length ? posters(r.titles) : html`<p class="muted">No titles.</p>`}`, { ok: '', wide: true });
    $('[data-rq]', d.el).oninput = (e) => { const q = e.target.value.trim().toLowerCase(); for (const x of $$('[data-rt]', d.el)) x.hidden = q && !x.dataset.rt.includes(q); };
  };
  // Watch clips right here, one after another, at the volume they'd play at.
  const preview = (clips, title, after = '') => {
    const d = k.dialog(title, html`<div class="pv"><video controls autoplay playsinline></video><p class="small" data-pvnow></p></div>`, { ok: '', wide: true });
    const v = $('video', d.el), now = $('[data-pvnow]', d.el);
    v.tabIndex = 0; v.focus(); // so Escape closes it
    let i = 0, cur = null;
    const next = () => {
      if (i >= clips.length) { v.removeAttribute('src'); v.load(); v.hidden = !!after; now.textContent = after || 'That’s the end.'; return; }
      cur = clips[i++];
      v.src = `/api/file/${cur.id}`; v.volume = cur.volume ?? 1;
      now.textContent = `${clips.length > 1 ? `${i} of ${clips.length}: ` : ''}${cur.title}${cur.volume != null ? ` · at ${Math.round(cur.volume * 100)}% volume` : ''}`;
      v.play().catch(() => {});
    };
    v.onended = next;
    v.onerror = () => { if (!v.getAttribute('src')) return; now.textContent = `“${cur.title}” can’t play in this browser. It still plays in HallFlix, which converts it on the fly.`; setTimeout(next, 3000); };
    next();
  };
  // Tags a clip probably wants, from words in its name: "halloween_bump_02" → halloween.
  const suggestFor = (c, pool) => {
    const name = String(c.title).toLowerCase(), words = name.split(/[^a-z0-9]+/).filter((w) => w.length > 2);
    return pool.filter((t) => !c.tags.includes(t) && (name.includes(t) || words.some((w) => w.length >= 4 && (t.startsWith(w) || (w.startsWith(t) && t.length >= 4))))).slice(0, 3);
  };
  const libName = (id) => P.libraries.find((l) => l.id === +id)?.name || 'a removed library';
  // A rule as one sentence: "Before Horror movies in any library from Oct 1 to Oct 31, play 1 clip tagged “halloween”."
  const list = (a, word = 'or') => (a.length <= 1 ? String(a[0] ?? '') : `${a.slice(0, -1).join(', ')} ${word} ${a.at(-1)}`);
  const allTags = () => [...new Set(P.clips.flatMap((c) => c.tags))].sort();
  const whatText = (m = {}) => {
    const kind = m.kinds?.length === 1 ? (m.kinds[0] === 'movie' ? 'movies' : 'episodes') : '';
    let t = m.genres?.length ? `${list(m.genres)} ${kind || 'titles'}` : kind || 'any title';
    if (m.ratings?.length) t += ` rated ${list(m.ratings)}`;
    if (m.studios?.length) t += ` from ${list(m.studios)}`;
    if (m.title) t += ` with “${m.title}” in the title`;
    return t;
  };
  const whereText = (m = {}) => (m.libraries?.length ? `in ${list(m.libraries.map(libName))}` : 'in any library');
  const whenText = (m = {}) => {
    const b = [];
    if (m.from && m.to) b.push(`from ${k.niceDate(m.from)} to ${k.niceDate(m.to)}`);
    if (m.days?.length) b.push(`on ${list(m.days.map((x) => DAYS[x]), 'and')}`);
    if (m.timeFrom && m.timeTo) b.push(`between ${m.timeFrom} and ${m.timeTo}`);
    return b.length ? b.join(', ') : 'at any time';
  };
  const clipsText = (r) => {
    const n = r.count || 1, c = n === 1 ? 'clip' : 'clips', sel = r.clips || {};
    if (sel.mode === 'tag') return `${n} ${c} tagged “${sel.tag}”`;
    if (sel.mode === 'match' && sel.on?.length === 1 && sel.on[0] === 'tags') return `${n} ${c} whose tag matches one of the title’s tags`;
    if (sel.mode === 'match') return `${n} ${c} tagged with the title’s ${list((sel.on?.length ? sel.on : ['genres']).map((x) => ({ genres: 'genre', studios: 'studio', ratings: 'rating', tags: 'tags' })[x]))}`;
    if (sel.mode === 'pick') return `${n} of ${plural(sel.ids?.length || 0, 'chosen clip')}`;
    if (sel.untaggedOnly) return `${n} everyday ${c} (no tag)`;
    return `${n} ${c} from all clips`;
  };
  const describe = (r) => {
    const m = r.match || {};
    const where = m.libraries?.length ? ` ${whereText(m)}` : '', when = whenText(m) === 'at any time' ? '' : ` ${whenText(m)}`;
    return `Before ${whatText(m)}${where}${when}, play ${clipsText(r)}${m.stop ? ', instead of the rules below' : ''}.`;
  };
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const autoName = (r) => (r.clips?.mode === 'tag' && r.clips.tag ? cap(r.clips.tag) : r.match?.genres?.length ? `${list(r.match.genres)} clips` : r.clips?.mode === 'match' && r.clips.on?.length === 1 && r.clips.on[0] === 'tags' ? 'Clips matching the title’s tags' : r.clips?.mode === 'match' ? 'Clips that fit the title' : r.clips?.untaggedOnly ? 'Everyday clips' : 'Any clip');
  const tabsHtml = () => html`<div class="tabs" data-ptabs>${[['overview', 'Overview'], ['general', 'General'], ['rules', 'Rules and schedules'], ['clips', 'Clips'], ['coverage', 'Coverage'], ['test', 'Test'], ['activity', 'Activity'], ['backup', 'Backup']].map(([id, n]) => html`<button data-pt="${id}" class="${tab === id ? 'on' : ''}">${n}</button>`)}</div>`;
  const frame = (inner, tools = '') => html`${k.head('Pre-rolls', 'Short clips (studio logos, bumpers, seasonal intros) that play before a movie or episode, the same way on every device.', tools)}${tabsHtml()}${inner}`;
  const health = () => html`<div class="card"><h2>Health check</h2>${P.health.map((h) => html`<div class="row"><span class="dot ${h.level}"></span><div class="grow"><span style="white-space:normal;color:var(--text)">${h.text}</span></div>${h.fix === 'libraries' ? html`<a class="btn sm" href="#libraries">Open Libraries</a>` : ''}</div>`)}</div>`;

  const drawOverview = () => {
    const s = P.settings, on = P.clips.filter((c) => !c.off).length;
    main.innerHTML = String(frame(html`<div class="grid"><div class="stat"><span class="muted">Pre-rolls</span><b>${s.enabled ? 'On' : 'Off'}</b><span class="muted small">Up to ${plural(s.max, 'clip')} per title</span></div>
        <div class="stat"><span class="muted">Clips</span><b>${on}</b><span class="muted small">${P.clips.length - on ? `${P.clips.length - on} switched off` : 'all switched on'}</span></div>
        <div class="stat"><span class="muted">Rules</span><b>${P.rules.filter((r) => r.enabled).length}</b><span class="muted small">${P.rules.length - P.rules.filter((r) => r.enabled).length ? `${P.rules.length - P.rules.filter((r) => r.enabled).length} off` : 'all on'}</span></div>
        ${R?.total ? html`<button class="stat statlink" data-pt="coverage"><span class="muted">Coverage</span><b>${Math.round((R.classes.matched.count / R.total) * 100)}%</b><span class="muted small">of titles get a clip chosen for them</span></button>` : ''}
        <div class="stat"><span class="muted">How often</span><b style="font-size:19px">${s.everyMinutes ? `Once per ${s.everyMinutes >= 60 ? `${s.everyMinutes / 60} h` : `${s.everyMinutes} min`}` : 'Every title'}</b><span class="muted small">${s.order === 'random' ? 'Random order' : 'Shuffled like a deck'}</span></div></div>
      ${health()}
      <div class="card"><h2>Shuffle rounds</h2><p class="muted small">With shuffle on, every clip a rule can play gets a turn before any repeats.</p>
        ${P.rules.map((r) => html`<div class="row"><div class="grow"><b>${r.name}</b><span>${P.decks[r.id] ? `${P.decks[r.id].played} of ${P.decks[r.id].of} played this round` : 'Nothing played yet'}</span></div></div>`)}
        <div class="tools" style="margin-top:10px"><button class="btn sm" data-resetdecks>Start every round over</button></div></div>`));
  };
  const drawGeneral = () => {
    const s = P.settings;
    const zones = (() => { try { return Intl.supportedValuesOf('timeZone'); } catch { return []; } })();
    main.innerHTML = String(frame(html`<div class="card" data-settings><h2>General</h2>
      <label class="check"><input type="checkbox" data-s="enabled" ${s.enabled ? 'checked' : ''}> Play pre-rolls</label>
      <div class="f"><span>Most clips per title</span><span class="rangewrap"><input type="range" min="0" max="6" step="1" data-s="max" value="${s.max}"><output>${s.max}</output></span></div>
      <label class="check"><input type="checkbox" data-s="onResume" ${s.onResume ? 'checked' : ''}> Also play them when resuming part-way through</label>
      <div class="f"><span>Order</span><select data-s="order"><option value="shuffle" ${s.order !== 'random' ? 'selected' : ''}>Shuffle: every clip once before any repeats</option><option value="random" ${s.order === 'random' ? 'selected' : ''}>Random each time</option></select></div>
      <div class="f"><span>How often</span><select data-s="everyMinutes">${[[0, 'Before every title'], [15, 'At most once every 15 minutes'], [30, 'At most once every 30 minutes'], [60, 'At most once an hour'], [120, 'At most once every 2 hours'], [240, 'At most once every 4 hours'], [1440, 'At most once a day']].map(([v, n]) => html`<option value="${v}" ${+s.everyMinutes === v ? 'selected' : ''}>${n}</option>`)}</select></div>
      <p class="muted small" style="margin-left:140px">Per profile. Handy for binge-watching: the first episode gets a pre-roll, the next few don't.</p>
      <div class="f"><span>Skip clips longer than</span><select data-s="maxSeconds">${[[0, 'No limit'], [30, '30 seconds'], [60, '1 minute'], [120, '2 minutes'], [300, '5 minutes']].map(([v, n]) => html`<option value="${v}" ${+s.maxSeconds === v ? 'selected' : ''}>${n}</option>`)}</select></div>
      <label class="check"><input type="checkbox" data-s="evenVolume" ${s.evenVolume ? 'checked' : ''}> Even out the volume: play pre-rolls at the same loudness as the movie or episode after them</label>
      <div class="f" ${s.evenVolume ? '' : 'hidden'} data-offset><span>Pre-roll level</span><select data-s="volumeOffset">${[[-6, 'Quieter than the movie'], [-3, 'A little quieter'], [0, 'Same as the movie'], [3, 'A little louder'], [6, 'Louder than the movie']].map(([v, n]) => html`<option value="${v}" ${+s.volumeOffset === v ? 'selected' : ''}>${n}</option>`)}</select></div>
      <p class="muted small" style="margin-left:140px" ${s.evenVolume ? '' : 'hidden'} data-offset>Each clip, the ident and each title are measured once in the background. Loud clips are turned down to match; a clip quieter than the movie plays at full volume. Clips not measured yet play as they are.</p>
      <div class="f"><span>Profiles that skip pre-rolls</span><div class="checks">${P.profiles.map((p) => html`<label class="check"><input type="checkbox" data-skip="${p.id}" ${s.skipProfiles.includes(p.id) ? 'checked' : ''}> ${p.name}</label>`)}</div></div>
      <div class="f"><span>Time zone for schedules</span><select data-s="tz"><option value="">The NAS clock</option>${zones.map((z) => html`<option ${s.tz === z ? 'selected' : ''}>${z}</option>`)}</select></div></div>`));
    const save = k.debounce(async () => {
      const el = $('[data-settings]', main);
      const b = { enabled: $('[data-s=enabled]', el).checked, max: +$('[data-s=max]', el).value, onResume: $('[data-s=onResume]', el).checked, order: $('[data-s=order]', el).value,
        everyMinutes: +$('[data-s=everyMinutes]', el).value, maxSeconds: +$('[data-s=maxSeconds]', el).value, tz: $('[data-s=tz]', el).value, evenVolume: $('[data-s=evenVolume]', el).checked, volumeOffset: +$('[data-s=volumeOffset]', el).value, skipProfiles: $$('[data-skip]:checked', el).map((x) => +x.dataset.skip) };
      try { const r = await api('PUT', '/api/studio/prerolls/settings', b); P.settings = r.settings; toast('Saved', 1000); } catch (e) { k.fail(e); }
    }, 350);
    main.oninput = (e) => {
      if (e.target.type === 'range') e.target.nextElementSibling.textContent = e.target.value;
      if (e.target.dataset.s === 'evenVolume') for (const x of $$('[data-offset]', main)) x.hidden = !e.target.checked;
      if (e.target.closest('[data-settings]')) save();
    };
  };
  const drawRules = () => {
    main.innerHTML = String(frame(html`<div class="card"><h2>Start from a preset</h2><div class="tools">${Object.entries(P.presets).map(([id, p]) => html`<button class="btn sm" data-preset="${id}">${PRESET_ICON[id] || ''} ${p.name}</button>`)}<button class="btn sm" data-preset="cinema">🎬 Cinema line-up</button></div>
        <p class="muted small" style="margin-top:8px">Seasonal presets play clips tagged for the season (for example “halloween”) and replace the everyday clips while they're on. The cinema line-up plays a clip tagged “logo”, then one that fits the title, then one tagged “feature”. Tag clips on the Clips tab.</p></div>
      <div class="card"><h2>Rules</h2><p class="muted small" style="margin-bottom:6px">Rules run from top to bottom until the clip limit is reached.</p>
        ${P.rules.length ? P.rules.map((r, i) => html`<div class="row rule-row ${r.enabled ? '' : 'off'}" data-id="${r.id}"><span class="rule-no">${i + 1}</span><div class="grow"><span class="rule-sentence">${describe(r)}</span><span class="muted small">${r.name}${r.enabled ? '' : ' · off'}${r.enabled && R ? html` · <button class="linkbtn" data-reach="rule:${r.id}" data-reachname="${r.name}">can play before ${plural(R.rules[r.id] || 0, 'title')}</button>` : ''}</span></div>
          <div class="tools">${i ? html`<button class="btn sm" data-up title="Run earlier">↑</button>` : ''}<button class="btn sm" data-edit>Edit</button><button class="btn sm danger" data-del>Delete</button></div></div>`)
        : html`<p class="muted">${P.clips.length ? 'No rules yet, so nothing plays.' : 'Add a “Pre-roll clips” library first.'}</p>`}
        <div class="tools" style="margin-top:10px"><button class="btn primary" data-new>New rule</button></div></div>`));
  };
  const ruleForm = (r, start = null) => {
    const v = structuredClone(r || start || { name: '', enabled: true, count: 1, clips: { mode: 'all' }, match: {} });
    const m = v.match; for (const key of ['kinds', 'libraries', 'genres', 'ratings', 'studios', 'days']) m[key] ||= [];
    v.clips.ids ||= []; v.clips.on ||= ['genres'];
    const tags = allTags();
    const boxes = (key, list, label = (x) => x, cur = []) => html`<div class="checks">${list.map((x) => html`<label class="check"><input type="checkbox" data-multi="${key}" value="${x}" ${cur.map(String).includes(String(x)) ? 'checked' : ''}> ${label(x)}</label>`)}</div>`;
    const libs = P.libraries.filter((l) => !['prerolls', 'books', 'comics', 'music'].includes(l.kind));
    const mode = v.clips.mode === 'all' && v.clips.untaggedOnly ? 'untagged' : v.clips.mode === 'match' && v.clips.on.length === 1 && v.clips.on[0] === 'tags' ? 'titletags' : v.clips.mode;
    // Each underlined part of the sentence opens its panel just below the sentence.
    const panels = [];
    const slot = (id, inner) => { panels.push(html`<div class="slotpanel" data-panel="${id}" hidden>${inner}</div>`); return html`<button type="button" class="slot" data-open="${id}" data-sum="${id}"></button>`; };
    // The rule reads as one sentence; each underlined part opens to change it.
    const d = k.dialog(r ? `Edit “${r.name}”` : 'New pre-roll rule', html`<p class="muted small">Click an underlined part to change it.</p>
      <div class="sentence">Before
        ${slot('what', html`<div class="f"><span>Type</span>${boxes('match.kinds', ['movie', 'episode'], (x) => (x === 'movie' ? 'Movies' : 'Episodes'), m.kinds)}</div>
          ${P.genres.length ? html`<div class="f"><span>Genre</span>${boxes('match.genres', P.genres, undefined, m.genres)}</div>` : ''}
          ${P.ratings.length ? html`<div class="f"><span>Rating</span>${boxes('match.ratings', P.ratings, undefined, m.ratings)}</div>` : ''}
          ${P.studios.length ? html`<div class="f"><span>Studio or network</span>${boxes('match.studios', P.studios.slice(0, 60), undefined, m.studios)}</div>` : ''}
          <label class="f"><span>Title contains</span><input type="text" data-r="title" value="${m.title || ''}" placeholder="e.g. Star Wars"></label>`)}
        ${libs.length > 1 ? slot('where', html`<div class="f"><span>Library</span>${boxes('match.libraries', libs.map((l) => l.id), libName, m.libraries)}</div>`) : ''}
        ${slot('when', html`<label class="check"><input type="checkbox" data-r="dated" ${m.from && m.to ? 'checked' : ''}> Only between two dates each year</label><div data-show="dated">${k.dates('f', 'From', m.from)}${k.dates('t', 'To', m.to)}</div>
          <div class="f"><span>Days</span>${boxes('match.days', [0, 1, 2, 3, 4, 5, 6], (x) => DAYS[x], m.days)}</div>
          <div class="f"><span>Hours</span><span class="imgrow"><input type="time" data-r="timeFrom" value="${m.timeFrom || ''}" style="width:auto"> to <input type="time" data-r="timeTo" value="${m.timeTo || ''}" style="width:auto"><span class="muted small">Overnight works (22:00 to 04:00)</span></span></div>`)},
        play <select class="inl" data-r="count">${[1, 2, 3, 4, 5, 6].map((n) => html`<option value="${n}" ${+v.count === n ? 'selected' : ''}>${n === 1 ? '1 clip' : `${n} clips`}</option>`)}</select>
        <select class="inl" data-r="mode">${[['all', 'from all clips'], ['untagged', 'from everyday clips (no tag)'], ['tag', 'tagged'], ['titletags', 'whose tag matches the title’s tags'], ['match', 'tagged with the title’s genre'], ['pick', 'that I pick']].map(([x, n]) => html`<option value="${x}" ${mode === x ? 'selected' : ''}>${n}</option>`)}</select>
        <span data-show="tag">${tags.length ? html`<select class="inl" data-r="tag">${tags.map((t) => html`<option ${v.clips.tag === t ? 'selected' : ''}>${t}</option>`)}</select>` : html`<span class="muted small">(no tags yet: tag clips on the Clips tab)</span>`}</span>
        <span data-show="match">${slot('on', html`<p class="muted small">A clip plays when one of its tags is the same word as the title's:</p>${boxes('clips.on', ['genres', 'studios', 'ratings', 'tags'], (x) => ({ genres: 'Genre (a “horror” clip before horror films)', studios: 'Studio or network (“pixar”, “hbo”)', ratings: 'Rating (“pg”, “tv-ma”)', tags: 'Tags you gave the title in Metadata (“birthday”, “marvel”)' })[x], v.clips.on)}`)}</span>
        <span data-show="titletags" class="muted small">(a clip tagged “birthday” plays before titles you tagged “birthday” in Metadata)</span>
        <span data-show="pick">${slot('pick', boxes('clips.ids', P.clips.map((c) => c.id), (id) => P.clips.find((c) => c.id === id).title, v.clips.ids))}</span>.
      </div>${panels}
      <label class="check"><input type="checkbox" data-r="stop" ${m.stop ? 'checked' : ''}> When this plays something, skip the rules below it <span class="muted small">(seasonal clips replace the everyday ones)</span></label>
      <label class="check"><input type="checkbox" data-r="enabled" ${v.enabled ? 'checked' : ''}> Rule is on</label>
      <label class="f" style="margin-top:10px"><span>Name <span class="muted small">(optional)</span></span><input type="text" data-r="name" value="${v.name}" placeholder="Named for you if left empty"></label>`,
    { wide: true, onOk: async (el) => {
      const out = readRule(el);
      if ((out.match.timeFrom && !out.match.timeTo) || (!out.match.timeFrom && out.match.timeTo)) throw new Error('Give both a start and an end time');
      if (out.clips.mode === 'tag' && !out.clips.tag) throw new Error('Tag some clips on the Clips tab first, or choose other clips');
      if (out.clips.mode === 'pick' && !out.clips.ids.length) throw new Error('Pick at least one clip');
      if (!out.name) out.name = autoName(out);
      if (!r) out.position = (P.rules.at(-1)?.position ?? 0) + 1;
      await api('POST', '/api/studio/prerolls/rules', out); toast('Rule saved'); await refresh();
    } });
    const readRule = (el) => {
      const g = (x) => $(`[data-r="${x}"]`, el);
      const multi = (key) => $$(`[data-multi="${key}"]:checked`, el).map((x) => (/ids|libraries|days/.test(key) ? +x.value : x.value));
      const md = g('mode').value;
      return { ...v, name: g('name').value.trim(), enabled: g('enabled').checked, count: +g('count').value, stop: g('stop').checked,
        clips: { mode: md === 'untagged' ? 'all' : md === 'titletags' ? 'match' : md, untaggedOnly: md === 'untagged' || undefined, tag: g('tag')?.value || '', ids: multi('clips.ids'), on: md === 'titletags' ? ['tags'] : multi('clips.on') },
        match: { kinds: multi('match.kinds'), libraries: multi('match.libraries'), genres: multi('match.genres'), studios: multi('match.studios'), ratings: multi('match.ratings'), days: multi('match.days'),
          title: g('title').value.trim() || undefined, timeFrom: g('timeFrom').value || undefined, timeTo: g('timeTo').value || undefined, stop: g('stop').checked,
          ...(g('dated').checked ? { from: k.readDate(el, 'f'), to: k.readDate(el, 't') } : {}) } };
    };
    const sync = () => {
      const o = readRule(d.el), md = $('[data-r=mode]', d.el).value;
      for (const s of $$('[data-show]', d.el)) s.hidden = s.dataset.show === 'dated' ? !$('[data-r=dated]', d.el).checked : md !== s.dataset.show;
      const set = (id, text) => { const el = $(`[data-sum="${id}"]`, d.el); if (el) el.textContent = text; };
      set('what', whatText(o.match)); set('where', whereText(o.match)); set('when', whenText(o.match));
      set('pick', o.clips.ids.length ? plural(o.clips.ids.length, 'clip') : 'choose clips…');
      set('on', `(${list((o.clips.on.length ? o.clips.on : ['genres']).map((x) => ({ genres: 'genre', studios: 'studio', ratings: 'rating', tags: 'tags' })[x]), 'or')})`);
      $('[data-r=name]', d.el).placeholder = `Named for you: ${autoName(o)}`;
    };
    // One panel open at a time; clicking its part again closes it.
    d.el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-open]'); if (!b) return;
      const open = !b.classList.contains('on');
      for (const x of $$('[data-open]', d.el)) x.classList.toggle('on', open && x === b);
      for (const x of $$('[data-panel]', d.el)) x.hidden = !(open && x.dataset.panel === b.dataset.open);
    });
    d.el.addEventListener('input', sync); d.el.addEventListener('change', sync); sync();
  };
  let clipFilter = '', clipSel = new Set();
  const drawClips = () => {
    const tags = allTags();
    const count = (t) => P.clips.filter((c) => c.tags.includes(t)).length;
    const isFolder = (t) => P.clips.some((c) => c.folderTags.includes(t)) && !P.clips.some((c) => c.ownTags.includes(t));
    const everyday = P.clips.filter((c) => !c.tags.length).length;
    const shown = P.clips.filter((c) => (clipFilter === '' ? true : clipFilter === '-' ? !c.tags.length : c.tags.includes(clipFilter)));
    const suggest = [...new Set([...tags, ...P.genres.map((g) => g.toLowerCase()), 'logo', 'feature', ...Object.values(P.presets).map((x) => x.tag)])];
    const group = clipFilter && clipFilter !== '-' ? R?.groups.find((g) => g.tag === clipFilter) : null;
    const groupCard = clipFilter && clipFilter !== '-' && R ? html`<div class="card"><h2>Where “${clipFilter}” clips play</h2>
      ${group ? html`<p class="muted small">They can play before <b style="color:var(--text)">${plural(group.count, 'title')}</b> of ${R.total}, through ${list(group.rules.map((x) => `“${x}”`), 'and')}${group.when.length ? html`, only ${list(group.when.map(([f, t]) => `${k.niceDate(f)} to ${k.niceDate(t)}`))}` : ''}.</p>
        ${posters(group.titles)}${group.count > group.titles.length ? html`<div class="tools" style="margin-top:10px"><button class="btn sm" data-reach="tag:${clipFilter}" data-reachname="Titles “${clipFilter}” clips play before">See all ${group.count}</button></div>` : ''}`
      : html`<p class="muted">No rule plays “${clipFilter}” clips yet, so they only play from rules that use all clips.</p><div class="tools" style="margin-top:10px"><button class="btn sm primary" data-newfor="${clipFilter}">Make a rule for “${clipFilter}”</button></div>`}</div>` : '';
    const untagged = P.clips.filter((c) => !c.tags.length);
    const banner = clipFilter === '' && untagged.length && tags.length ? html`<div class="card notice"><b>${plural(untagged.length, 'clip')} ${untagged.length > 1 ? 'aren’t' : 'isn’t'} tagged yet.</b> <span class="muted">Untagged clips are everyday clips: they only play from rules that use all clips or everyday clips.</span> <button class="btn sm" data-tf="-">Show ${untagged.length > 1 ? 'them' : 'it'}</button></div>` : '';
    main.innerHTML = String(frame(html`${banner}<div class="card"><h2>Pre-roll tags</h2>
      <p class="muted small">Tags here are only for pre-rolls: rules use them to choose clips, and they don't show up anywhere else in HallFlix. A clip's sub-folder names count as tags too (📁). Clips with no tag are your everyday clips.</p>
      <div class="tagbar">
        <button class="tagpill ${clipFilter === '' ? 'on' : ''}" data-tf="">All clips <b>${P.clips.length}</b></button>
        <button class="tagpill ${clipFilter === '-' ? 'on' : ''}" data-tf="-">Not tagged (everyday) <b>${everyday}</b></button>
        ${tags.map((t) => html`<span class="tagpill-wrap"><button class="tagpill ${clipFilter === t ? 'on' : ''}" data-tf="${t}">${isFolder(t) ? '📁 ' : ''}${t} <b>${count(t)}</b></button>${isFolder(t) ? '' : html`<button class="tagx" data-tren="${t}" title="Rename “${t}”">✎</button><button class="tagx" data-tdel="${t}" title="Delete “${t}”">×</button>`}</span>`)}
      </div></div>${groupCard}
      <div class="card"><div class="clips-head"><h2>Clips ${clipFilter ? html`<span class="muted">· ${clipFilter === '-' ? 'not tagged' : clipFilter}</span>` : ''} (${shown.length})</h2>
        <input type="search" data-cq placeholder="Find a clip" style="width:200px;margin-left:auto">
        <label class="check"><input type="checkbox" data-selall ${shown.length && shown.every((c) => clipSel.has(c.id)) ? 'checked' : ''}> Select all</label></div>
      <div class="bulkbar" ${clipSel.size ? '' : 'hidden'}><b data-selcount>${plural(clipSel.size, 'clip')} selected</b>
        <input type="text" data-btag placeholder="Tag" list="ptags" style="width:180px"><datalist id="ptags">${suggest.map((t) => html`<option value="${t}">`)}</datalist>
        <button class="btn sm primary" data-badd>Add tag</button><button class="btn sm" data-brem>Remove tag</button><button class="btn sm" data-bnone>Clear selection</button></div>
      <div class="clips">${shown.map((c) => html`<div class="clip ${c.off ? 'off' : ''} ${clipSel.has(c.id) ? 'sel' : ''}" data-clip="${c.id}">
        <div class="clip-media"><label class="clip-pick"><input type="checkbox" data-pick ${clipSel.has(c.id) ? 'checked' : ''} aria-label="Select ${c.title}"><img src="/api/studio/prerolls/clips/${c.id}/still.jpg" alt="" loading="lazy" onerror="this.style.visibility='hidden'"></label><button class="clip-play" data-preview="${c.id}" title="Preview ${c.title}" aria-label="Preview ${c.title}">▶</button></div>
        <div class="grow"><b>${c.title}</b><span class="muted small">${k.mins(c.runtime_s)}${P.settings.evenVolume && c.lufs != null ? ` · ${Math.round(c.lufs)} LUFS` : ''} · ${c.plays ? `played ${plural(c.plays, 'time')}, last ${ago(c.last_played)}` : 'not played yet'}</span>
          <div class="cliptags">${c.folderTags.map((t) => html`<span class="chip fixed" title="From its folder">📁 ${t}</span>`)}${chipsIn(`c${c.id}`, c.ownTags, suggest, c.tags.length ? 'Add a tag' : 'Everyday clip · add a tag')}</div>
          ${suggestFor(c, suggest).length ? html`<div class="suggest"><span class="muted small">Suggested:</span>${suggestFor(c, suggest).map((t) => html`<button class="suggbtn" data-sugg="${t}">+ ${t}</button>`)}</div>` : ''}</div>
        <label class="check"><input type="checkbox" data-on ${c.off ? '' : 'checked'}> On</label></div>`)}
      <p class="muted" data-cnone hidden>No clip by that name.</p>
      ${!P.clips.length ? html`<p class="muted">No clips found. <a href="#libraries">Add a pre-roll library</a>.</p>` : !shown.length ? html`<p class="muted">No clips here.</p>` : ''}</div></div>`));
    const saveTags = k.debounce(async (el) => { const id = el.dataset.clip; try { const r = await api('PUT', `/api/studio/prerolls/clips/${id}`, { tags: readChips(el, `c${id}`) }); const c = P.clips.find((x) => x.id === +id); Object.assign(c, { tags: r.tags, ownTags: r.tags.filter((t) => !c.folderTags.includes(t)) }); toast('Tags saved', 1000); } catch (e) { k.fail(e); } }, 400);
    for (const el of $$('[data-clip]', main)) wireChips(el, () => saveTags(el));
    $('[data-cq]', main).oninput = (e) => {
      const q = e.target.value.trim().toLowerCase(); let n = 0;
      for (const el of $$('[data-clip]', main)) { el.hidden = q && !P.clips.find((c) => c.id === +el.dataset.clip).title.toLowerCase().includes(q); n += !el.hidden; }
      $('[data-cnone]', main).hidden = n > 0;
    };
    const bulk = () => { const b = $('.bulkbar', main); b.hidden = !clipSel.size; $('[data-selcount]', main).textContent = `${plural(clipSel.size, 'clip')} selected`; };
    main.onchange = async (e) => {
      if (e.target.matches('[data-pick]')) { const el = e.target.closest('[data-clip]'), id = +el.dataset.clip; if (e.target.checked) clipSel.add(id); else clipSel.delete(id); el.classList.toggle('sel', e.target.checked); return bulk(); }
      if (e.target.matches('[data-selall]')) { for (const c of shown) if (e.target.checked) clipSel.add(c.id); else clipSel.delete(c.id); return drawClips(); }
      if (!e.target.matches('[data-on]')) return;
      const el = e.target.closest('[data-clip]'); el.classList.toggle('off', !e.target.checked);
      try { await api('PUT', `/api/studio/prerolls/clips/${el.dataset.clip}`, { off: !e.target.checked }); toast(e.target.checked ? 'Clip on' : 'Clip off', 1000); } catch (err) { k.fail(err); }
    };
  };
  const clipTools = async (b) => {
    if (b.matches('[data-tf]')) { clipFilter = b.dataset.tf; return drawClips(); }
    if (b.matches('[data-preview]')) { const c = P.clips.find((x) => x.id === +b.dataset.preview); return preview([c], c.title); }
    if (b.matches('[data-sugg]')) {
      const id = +b.closest('[data-clip]').dataset.clip, tag = b.dataset.sugg;
      await api('POST', '/api/studio/prerolls/tags', { action: 'add', tag, clips: [id] }); toast(`Tagged “${tag}”`, 1200); return refresh();
    }
    if (b.matches('[data-newfor]')) return ruleForm(null, { name: '', enabled: true, count: 1, clips: { mode: 'tag', tag: b.dataset.newfor }, match: {} });
    if (b.matches('[data-bnone]')) { clipSel = new Set(); return drawClips(); }
    if (b.matches('[data-badd], [data-brem]')) {
      const tag = $('[data-btag]', main).value.trim().toLowerCase();
      if (!tag) return toast('Type a tag first');
      await api('POST', '/api/studio/prerolls/tags', { action: b.matches('[data-badd]') ? 'add' : 'remove', tag, clips: [...clipSel] });
      toast(b.matches('[data-badd]') ? `Tagged ${plural(clipSel.size, 'clip')} “${tag}”` : `Took “${tag}” off ${plural(clipSel.size, 'clip')}`);
      return refresh();
    }
    if (b.matches('[data-tren]')) {
      const from = b.dataset.tren, used = P.rules.filter((r) => r.clips?.mode === 'tag' && r.clips.tag === from).length;
      k.dialog(`Rename “${from}”`, html`<label class="f"><span>New name</span><input type="text" data-newtag value="${from}"></label>${used ? html`<p class="muted small">${plural(used, 'rule')} using it will follow the new name.</p>` : ''}`,
        { onOk: async (el) => { const to = $('[data-newtag]', el).value.trim().toLowerCase(); if (!to || to === from) return; await api('POST', '/api/studio/prerolls/tags', { action: 'rename', tag: from, to }); if (clipFilter === from) clipFilter = to; toast(`Renamed to “${to}”`); await refresh(); } });
      return;
    }
    if (b.matches('[data-tdel]')) {
      const t = b.dataset.tdel, used = P.rules.filter((r) => r.clips?.mode === 'tag' && r.clips.tag === t).length;
      k.confirmBox(`Delete the tag “${t}”?`, `It comes off ${plural(count(t), 'clip')}. The clips stay.${used ? ` ${plural(used, 'rule')} use${used === 1 ? 's' : ''} it and would then play nothing.` : ''}`, 'Delete', async () => { await api('POST', '/api/studio/prerolls/tags', { action: 'delete', tag: t }); if (clipFilter === t) clipFilter = ''; await refresh(); });
      return;
    }
    return false;
  };
  const count = (t) => P.clips.filter((c) => c.tags.includes(t)).length;
  const drawTest = () => {
    const now = new Date(Date.now() - new Date().getTimezoneOffset() * 60e3).toISOString().slice(0, 16);
    main.innerHTML = String(frame(html`<div class="card"><h2>What would play?</h2><p class="muted small">Pick a movie or episode, and optionally who's watching and when (handy for checking a Christmas schedule in July). Nothing is counted as played.</p>
      <div class="f"><span>Title</span><span class="imgrow"><input type="text" data-tq placeholder="Search movies and episodes" list="tdl" autocomplete="off"><datalist id="tdl"></datalist></span></div>
      <div class="f"><span>Who's watching</span><select data-tprof><option value="">Nobody in particular</option>${P.profiles.map((p) => html`<option value="${p.id}">${p.name}</option>`)}</select></div>
      <div class="f"><span>When</span><input type="datetime-local" data-tat value="${now}" style="width:auto"></div>
      <label class="check"><input type="checkbox" data-tres> Resuming part-way through</label>
      <div class="tools" style="margin-top:10px"><button class="btn primary" data-trun>Test</button></div><div data-tout></div></div>`));
    // Every title the search has offered, by its label. Picking a suggestion puts its label in the box, which is not
    // itself searchable ("Title (2020)"), so a picked label is looked up here instead of searched for again.
    let found = [];
    const seen = new Map();
    const search = async (text) => { found = await api('GET', `/api/studio/prerolls/find?q=${encodeURIComponent(text)}`).catch(() => []); for (const x of found) seen.set(x.label, x); return found; };
    $('[data-tq]', main).oninput = k.debounce(async (e) => {
      const text = e.target.value.trim();
      if (!text || seen.has(text)) return;
      await search(text);
      $('#tdl').innerHTML = String(html`${found.map((x) => html`<option value="${x.label}">`)}`);
    }, 250);
    $('[data-trun]', main).onclick = async () => {
      const label = $('[data-tq]', main).value.trim();
      let hitItem = seen.get(label);
      if (!hitItem && label) hitItem = (await search(label))[0]; // typed but not picked: the best match for what's typed
      if (!hitItem) return toast(label ? `Nothing found for “${label}”` : 'Search for a movie or episode first');
      $('[data-tq]', main).value = hitItem.label;
      try {
        const r = await api('POST', '/api/studio/prerolls/test', { itemId: hitItem.id, profileId: +$('[data-tprof]', main).value || null, at: $('[data-tat]', main).value, resume: $('[data-tres]', main).checked });
        $('[data-tout]', main).innerHTML = String(html`<h3 style="margin:16px 0 6px">${r.title}</h3><p class="muted small">${[r.facts.genres.join(', '), r.facts.studios.slice(0, 3).join(', '), r.facts.rating, r.facts.tags?.length ? `Tags: ${r.facts.tags.join(', ')}` : ''].filter(Boolean).join(' · ') || 'No genre, studio, rating or tags'}</p>
          ${r.clips.length ? html`<ol class="tl">${r.clips.map((c) => html`<li><b>${c.title}</b> <span class="muted">· ${k.mins(c.seconds)} · from “${c.rule}”${c.volume != null ? ` · at ${Math.round(c.volume * 100)}% volume` : ''}</span></li>`)}<li class="muted">then the title</li></ol><div class="tools"><button class="btn sm" data-pvline>▶ Preview the line-up</button></div>` : html`<p><b>No pre-roll would play.</b></p>`}
          <h3 style="margin:14px 0 6px">Why</h3>${r.log.map((x) => html`<div class="row"><div class="grow">${x.rule ? html`<b>${x.rule}</b>` : ''}<span style="white-space:normal">${x.note}</span></div></div>`)}`);
        const pv = $('[data-pvline]', main); if (pv) pv.onclick = () => preview(r.clips, `Before ${r.title}`, `Then: ${r.title}`);
      } catch (e) { k.fail(e); }
    };
  };
  const drawCoverage = () => {
    if (!R) { main.innerHTML = String(frame(html`<div class="card"><p class="muted">Coverage couldn’t be worked out right now.</p></div>`)); return; }
    const c = R.classes, pct = (n) => (R.total ? (n / R.total) * 100 : 0);
    const hasMatch = P.rules.some((r) => r.enabled && r.clips?.mode === 'match');
    const tagSet = new Set(allTags());
    const block = (key, title, text) => html`<div class="card"><h2>${title} <span class="muted">(${c[key].count})</span></h2><p class="muted small">${text}</p>
      ${c[key].count ? html`${posters(c[key].titles)}${c[key].count > c[key].titles.length ? html`<div class="tools" style="margin-top:10px"><button class="btn sm" data-reach="${key}" data-reachname="${title}">See all ${c[key].count}</button></div>` : ''}` : html`<p class="muted">None.</p>`}</div>`;
    main.innerHTML = String(frame(html`<div class="card"><h2>Who gets a pre-roll</h2><p class="muted small">Every movie and show, checked against your rules by what it is: genre, studio, rating, type and library. Dates and hours are left aside, since they change through the year.</p>
        <div class="covbar"><span class="m" style="width:${pct(c.matched.count)}%"></span><span class="g" style="width:${pct(c.general.count)}%"></span><span class="n" style="width:${pct(c.none.count)}%"></span></div>
        <div class="covkey"><span><i class="m"></i>Clip chosen for it: <b>${c.matched.count}</b></span><span><i class="g"></i>Only general clips: <b>${c.general.count}</b></span><span><i class="n"></i>Nothing plays: <b>${c.none.count}</b></span></div></div>
      ${R.gaps.length ? html`<div class="card"><h2>Where a tagged clip would help most</h2><p class="muted small">Genres of titles that don’t get a clip chosen for them.${hasMatch ? ' A clip tagged with the genre’s name would cover them.' : ''}</p>
        ${R.gaps.map((g) => html`<div class="row"><div class="grow"><b>${g.genre}</b><span>${plural(g.count, 'title')} ${tagSet.has(g.genre.toLowerCase()) ? html`· you have “${g.genre.toLowerCase()}” clips, but no rule matches them to these titles` : html`· no clip tagged “${g.genre.toLowerCase()}”`}</span></div></div>`)}
        ${hasMatch ? '' : html`<div class="tools" style="margin-top:10px"><button class="btn sm primary" data-matchrule>Add a rule: play a clip tagged with the title’s genre</button></div>`}</div>` : ''}
      ${block('none', 'Nothing plays before these', 'No rule fits them. Add a rule for them, or one that plays before any title.')}
      ${block('general', 'Only general clips play before these', 'They get clips from rules that use all clips or everyday clips, but nothing chosen for them.')}`));
  };
  const drawActivity = async () => {
    const list = await api('GET', '/api/studio/prerolls/activity');
    main.innerHTML = String(frame(html`<div class="card"><h2>Recent pre-rolls</h2>${list.length ? html`<div class="tablewrap"><table class="mt"><thead><tr><th>When</th><th>Who</th><th>Clip</th><th>Before</th><th>Rule</th></tr></thead><tbody>
      ${list.map((x) => html`<tr><td>${ago(x.played_at)}</td><td>${x.profile || '—'}</td><td>${x.clip || '(removed)'}</td><td>${x.item || '(removed)'}</td><td>${x.rule || ''}</td></tr>`)}</tbody></table></div>` : html`<p class="muted">Nothing has played yet.</p>`}</div>`));
  };
  const drawBackup = () => {
    main.innerHTML = String(frame(html`<div class="card"><h2>Backup</h2><p class="muted">Save every pre-roll setting and rule to a file, or restore one. Libraries and profiles are matched by name, so a backup works on another HallFlix too.</p>
      <div class="tools" style="margin-top:12px"><a class="btn primary" href="/api/studio/prerolls/backup">Download backup</a><label class="btn">Restore from a file<input type="file" accept=".json,application/json" hidden data-restore></label></div></div>`));
    $('[data-restore]', main).onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return;
      let data; try { data = JSON.parse(await f.text()); } catch { return toast('That file isn’t a backup'); }
      k.confirmBox('Restore this backup?', `Replaces your ${plural(P.rules.length, 'rule')} with the ${plural(data.rules?.length || 0, 'rule')} in the file.`, 'Restore', async () => { const r = await api('POST', '/api/studio/prerolls/backup', data); toast(`Restored ${plural(r.rules, 'rule')}`); await refresh(); });
    };
  };
  const draw = () => { main.oninput = null; main.onchange = null; return ({ overview: drawOverview, general: drawGeneral, rules: drawRules, clips: drawClips, coverage: drawCoverage, test: drawTest, activity: drawActivity, backup: drawBackup }[tab])(); };
  const refresh = async () => { await load(); await draw(); };
  main.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-pt]'); if (t) { tab = t.dataset.pt; return refresh(); }
    const b = e.target.closest('button'); if (!b) return;
    try {
      if (b.matches('[data-reach]')) return seeAll(b.dataset.reach, b.dataset.reachname || 'Titles');
      if (b.matches('[data-matchrule]')) { await api('POST', '/api/studio/prerolls/rules', { name: 'Clips that fit the title', enabled: true, count: 1, clips: { mode: 'match', on: ['genres'] }, match: {}, position: (P.rules[0]?.position ?? 1) - 1 }); toast('Rule added. Tag clips with genre names (for example “comedy”) to use it.', 5000); return refresh(); }
      if (tab === 'clips' && (await clipTools(b)) !== false) return;
      if (b.matches('[data-resetdecks]')) { await api('POST', '/api/studio/prerolls/decks/reset'); toast('Every round starts over'); return refresh(); }
      if (b.matches('[data-preset]')) { const r = await api('POST', '/api/studio/prerolls/presets', { preset: b.dataset.preset }); toast(`Added ${plural(r.created, 'rule')}. Tag clips “${r.tags.join('”, “')}” to use ${r.created > 1 ? 'them' : 'it'}.`, 5000); return refresh(); }
      if (b.matches('[data-new]')) return ruleForm(null);
      const row = b.closest('[data-id]'); if (!row) return;
      const r = P.rules.find((x) => x.id === +row.dataset.id);
      if (b.matches('[data-edit]')) ruleForm(r);
      if (b.matches('[data-del]')) k.confirmBox(`Delete ${r.name}?`, 'The rule is removed. The clips stay.', 'Delete', async () => { await api('DELETE', `/api/studio/prerolls/rules/${r.id}`); refresh(); });
      if (b.matches('[data-up]')) { const i = P.rules.indexOf(r); const order = [...P.rules]; [order[i - 1], order[i]] = [order[i], order[i - 1]]; for (const [n, x] of order.entries()) if (x.position !== n + 1) await api('POST', '/api/studio/prerolls/rules', { ...x, stop: x.match?.stop, position: n + 1 }); refresh(); }
    } catch (err) { k.fail(err); }
  });
  await refresh();
}
