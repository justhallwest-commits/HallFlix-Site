// Studio → Theme gallery: pick a look (everywhere, TVs only or phones only), a Fire TV layout, or something from the
// online gallery, in one click, with an Undo.

export async function galleryPage(main, { html, api, toast, fail, merge, clone }) {
  main.className = '';
  let tab = 'looks', data = null, before = null, beforeName = '';

  const swatch = (c = {}) => {
    const bg = c.bg || '#0a0814', sf = c.surface || '#16122b', tx = c.text || '#f4f2ff', ac = c.accent || '#35d0d0', a2 = c.accent2 || '#b344d6';
    return html`<div class="gal-prev" style="background:${bg};color:${tx}">
      <div class="gp-bar"><i style="background:${ac}"></i><span></span><span></span><span></span></div>
      <div class="gp-hero" style="background:linear-gradient(90deg, ${bg} 10%, transparent), linear-gradient(135deg, ${a2}, ${ac})"><b style="color:${tx}">Title</b><em style="background:${ac}"></em></div>
      <div class="gp-row">${[0, 1, 2, 3, 4].map((i) => html`<span style="background:${i === 0 ? ac : sf}"></span>`)}</div></div>`;
  };
  const tvPreview = (t = {}) => {
    const hero = t.hero?.show !== false, h = hero ? (t.hero?.height ?? 56) : 12;
    const pw = t.rows?.posterWidth ?? 122, tiles = t.tiles?.show !== false;
    return html`<div class="gal-prev tvl">${hero ? html`<div class="gp-hero" style="height:${h}%;width:${t.hero?.width ?? 72}%"></div>` : ''}
      <div class="gp-bar${t.nav?.align === 'center' ? ' mid' : ''}"><i></i><span></span><span></span><span></span></div>
      <div class="gp-rows" style="top:${h}%">${tiles ? html`<div class="gp-row">${[0, 1, 2].map(() => html`<span class="t" style="width:${(t.tiles?.width ?? 224) / 9}px;height:${(t.tiles?.height ?? 126) / 9}px"></span>`)}</div>` : ''}
        <div class="gp-row">${[0, 1, 2, 3, 4, 5, 6].map((i) => html`<span style="width:${pw / 7}px;height:${pw * 1.5 / 7}px${i === 0 ? ';outline:2px solid #fff' : ''}"></span>`)}</div></div></div>`;
  };

  async function load(refresh = false) {
    try { data = await api('GET', `/api/studio/gallery${refresh ? '?refresh=1' : ''}`); } catch (e) { fail(e); return; }
    draw();
  }

  function draw() {
    const d = data;
    main.innerHTML = String(html`<div class="card"><h2>Theme gallery</h2>
      <p class="muted small">Change the whole look of HallFlix in one click: everywhere, on TVs only, or on phones only. Your site name, logo, background and sign-in page stay as they are. Fine-tune afterwards in <a href="#look">Look and feel</a> and <a href="#tvapp">Fire TV app</a>.</p>
      ${before ? html`<p class="gal-undo">Now using <b>${beforeName}</b>. <button class="btn sm" data-undo>Undo</button></p>` : ''}
      <div class="row-btns">${[['looks', `Looks (${d.looks.length})`], ['tv', `Fire TV layouts (${d.tvLayouts.length})`], ['online', 'Online']].map(([k, n]) => html`<button class="btn sm${tab === k ? ' primary' : ''}" data-tab="${k}">${n}</button>`)}</div></div>
      ${tab === 'looks' ? html`<div class="gal-grid">${d.looks.map((p) => html`<div class="gal-card">${swatch(p.theme?.colors)}
          <div class="gal-body"><b>${p.name}</b><small class="muted">${p.from}</small><p class="muted small">${p.description || ''}</p>
          <div class="row-btns"><button class="btn sm primary" data-look="${p.id}" data-where="">Use everywhere</button><button class="btn sm" data-look="${p.id}" data-where="tv">TVs only</button><button class="btn sm" data-look="${p.id}" data-where="phone">Phones only</button></div></div></div>`)}</div>` : ''}
      ${tab === 'tv' ? html`<div class="gal-grid">${d.tvLayouts.map((l) => html`<div class="gal-card">${tvPreview(l.tvApp)}
          <div class="gal-body"><b>${l.name}</b><p class="muted small">${l.description}</p>
          <div class="row-btns"><button class="btn sm primary" data-layout="${l.id}">Use on Fire TV</button></div></div></div>`)}</div>` : ''}
      ${tab === 'online' ? html`<div class="card"><p class="muted small">Looks, Fire TV layouts and plugins shared in an online catalog. HallFlix reads it from
          <input type="text" class="gal-url" value="${d.catalogUrl}" spellcheck="false"> <button class="btn sm" data-url>Use this catalog</button> <button class="btn sm" data-refresh>Refresh</button></p>
          ${d.onlineError ? html`<p class="health-bad"><span>⚠️ ${d.onlineError}</span></p>` : ''}</div>
        <div class="gal-grid">${d.online.map((e) => html`<div class="gal-card">${e.preview ? html`<div class="gal-prev" style="background:#000 center/cover url('${encodeURI(e.preview)}')"></div>` : e.kind === 'tv' ? tvPreview(e.tvApp || {}) : swatch(e.colors || {})}
          <div class="gal-body"><b>${e.name}</b><small class="muted">${{ look: 'Look', plugin: 'Plugin', tv: 'Fire TV layout' }[e.kind]}${e.author ? ` · ${e.author}` : ''}</small><p class="muted small">${e.description}</p>
          <div class="row-btns">${e.kind === 'look' ? html`<button class="btn sm primary" data-online="${e.id}" data-where="">Use everywhere</button><button class="btn sm" data-online="${e.id}" data-where="tv">TVs only</button><button class="btn sm" data-online="${e.id}" data-where="phone">Phones only</button>`
            : e.kind === 'tv' ? html`<button class="btn sm primary" data-online="${e.id}">Use on Fire TV</button>`
            : html`<button class="btn sm primary" data-online="${e.id}">${e.installed ? 'Reinstall' : 'Install'}</button>`}</div></div></div>`)}</div>
        ${!d.online.length && !d.onlineError ? html`<p class="muted">The catalog is empty.</p>` : ''}` : ''}`);
  }

  // Apply a look: everywhere (keeping the site's own name, logo, background, sign-in page and device looks), or as a device's look.
  async function applyLook(name, t, where, presetId = null) {
    const L = await api('GET', '/api/studio/look');
    const current = L.theme || {};
    let theme;
    if (where) theme = { ...current, devices: { ...(current.devices || {}), [where]: { ...clone(t), ...(presetId ? { preset: presetId } : {}) } } };
    else {
      const keep = { siteName: current.siteName, logo: current.logo, background: current.background, login: current.login, devices: current.devices, tvApp: current.tvApp, splash: current.splash, ident: current.ident };
      theme = { ...merge(clone(L.defaults), clone(t)), ...Object.fromEntries(Object.entries(keep).filter(([, v]) => v !== undefined)), ...(presetId ? { preset: presetId } : {}) };
    }
    await save(name + (where ? ` (${where === 'tv' ? 'TVs' : 'phones'})` : ''), current, theme);
  }
  async function save(name, previous, theme) {
    const r = await api('PUT', '/api/studio/theme', { theme });
    before = previous; beforeName = name;
    toast(r?.problems?.length ? `Using ${name}, with fixes: ${r.problems.slice(0, 2).join('; ')}` : `Using ${name}. Every device picks it up the next time it opens.`);
    draw();
  }

  main.addEventListener('click', async (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    try {
      if (t.dataset.tab) { tab = t.dataset.tab; draw(); return; }
      if ('undo' in t.dataset) { await api('PUT', '/api/studio/theme', { theme: before }); toast('Back to the look you had before'); before = null; draw(); return; }
      if ('refresh' in t.dataset) { await load(true); return; }
      if ('url' in t.dataset) { await api('PUT', '/api/studio/gallery', { catalogUrl: main.querySelector('.gal-url').value }); await load(true); return; }
      if (t.dataset.look) { const p = data.looks.find((x) => x.id === t.dataset.look); await applyLook(p.name, p.theme, t.dataset.where, p.id); return; }
      if (t.dataset.layout) {
        const l = data.tvLayouts.find((x) => x.id === t.dataset.layout);
        const L = await api('GET', '/api/studio/look');
        await save(`${l.name} on Fire TV`, L.theme || {}, { ...(L.theme || {}), tvApp: merge(clone(L.defaults.tvApp), clone(l.tvApp)) });
        return;
      }
      if (t.dataset.online) {
        t.disabled = true;
        const entry = data.online.find((x) => x.id === t.dataset.online);
        const r = await api('POST', '/api/studio/gallery/install', { id: entry.id });
        if (r.kind === 'plugin') { toast(`Installed ${entry.name}. Turn it on in Plugins if it isn’t already.`); await load(); return; }
        if (r.kind === 'tv') { const L = await api('GET', '/api/studio/look'); await save(`${entry.name}`, L.theme || {}, { ...(L.theme || {}), tvApp: merge(clone(L.defaults.tvApp), r.tvApp) }); return; }
        await applyLook(r.name || entry.name, r.theme, t.dataset.where);
      }
    } catch (err) { t.disabled = false; fail(err); }
  });
  await load();
}
