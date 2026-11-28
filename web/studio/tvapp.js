// Studio → Fire TV app: design the Android/Fire TV app's native screens (home, library, title page).
// Settings live in theme.tvApp (checked by the theme contract); each library's tile picture, logo and brightness live in
// that library's look, the same ones the website's tiles use. The preview mimics the native screens at 960×540.

/** kit: the Studio's building blocks (html, api, toast, fail, merge, clone, bind, check, range, choose, text, image, $). */
export async function tvApp(main, kit) {
  const { html, raw, api, toast, fail, merge, clone, bind, check, range, choose, text, image, $ } = kit;
  main.className = 'split';
  main.innerHTML = String(html`<section class="controls"><div class="wait">Loading…</div></section><section class="preview tvp-pane"><div class="bar"></div><div class="stage tvp-stage"><div class="tvp-screen"></div></div></section>`);
  const [L, home] = await Promise.all([api('GET', '/api/studio/look'), api('GET', '/api/home?lite=1').catch(() => ({}))]);
  const D = L.defaults.tvApp;
  let theme = clone(L.theme || {});
  const form = { tvApp: merge(clone(D), theme.tvApp || {}), libs: Object.fromEntries(L.libraries.map((l) => [l.id, clone(l.look || {})])) };
  const box = $('.controls', main), screen = $('.tvp-screen', main), bar = $('.bar', main);
  let tab = 'home', dirty = false, detail = null, library = null;

  // The look the TV app actually uses: the everyday look plus the TV look's changes.
  const tvTheme = () => merge(merge(clone(L.defaults), theme), theme.devices?.tv || {});
  const isVid = (u) => /\.(mp4|webm|m4v|mov)(\?|$)/i.test(u || '');
  const pic = (u) => (u && !isVid(u) ? u : '');
  const tileArt = (t) => {
    const lk = form.libs[t.id] || {};
    if (form.tvApp.tiles.art === 'library') {
      if (pic(lk.tileBackground)) return lk.tileBackground;
      if (lk.tileUse !== 'artwork' && pic(lk.background)) return lk.background;
    }
    return t.backdrop || '';
  };

  const LIB_USE = [['', 'The library page’s background, if it has one'], ['artwork', 'New artwork from the library']];
  function controls() {
    const t = form.tvApp;
    const libs = home.libraries?.length ? home.libraries : L.libraries.map((l) => ({ id: l.id, name: l.name, kind: l.kind, backdrop: l.art }));
    box.innerHTML = String(html`
      <div class="card"><h2>Fire TV app</h2>
        <p class="muted small">How HallFlix looks on Fire TV and Android TV, where the app draws Home, the libraries and title pages itself so it stays quick on a Fire TV stick. Colours, the logo and the focus ring come from <a href="#look">Look and feel</a> (the 📺 TVs look when it has one). The preview uses your own titles. Changes reach the TV the next time the app opens.</p>
        <div class="row-btns"><button class="btn primary" data-save ${dirty ? '' : 'disabled'}>Save</button><button class="btn" data-undo ${dirty ? '' : 'disabled'}>Undo changes</button><button class="btn" data-reset>HallFlix defaults</button></div></div>

      <div class="card"><h2>Big picture</h2><p class="muted small">The large artwork at the top of Home, like the Jellyfin and Netflix TV apps.</p>
        ${check(form, 'tvApp.hero.show', 'Show the big picture')}
        ${t.hero.show ? html`
          ${check(form, 'tvApp.hero.follow', 'Follow the highlighted title (the picture changes as you move along the rows)')}
          ${range(form, 'tvApp.hero.height', 'Rows start at (% down the screen)', 30, 80, 1)}
          ${range(form, 'tvApp.hero.width', 'Picture width (% of the screen)', 40, 100, 1)}
          ${range(form, 'tvApp.hero.brightness', 'Picture brightness (%)', 30, 130, 5)}
          ${range(form, 'tvApp.hero.rotate', 'Next spotlight title every (seconds, 0 = never)', 0, 60, 1)}
          ${check(form, 'tvApp.hero.logos', 'Show title logos instead of names when there is one')}
          ${check(form, 'tvApp.hero.overview', 'Show the description')}` : ''}</div>

      <div class="card"><h2>Top menu</h2>
        ${check(form, 'tvApp.nav.show', 'Show the top menu (without it, the remote’s ☰ button opens the menu)')}
        ${t.nav.show ? html`
          ${check(form, 'tvApp.nav.libraries', 'A tab for each library')}${check(form, 'tvApp.nav.search', 'Search')}${check(form, 'tvApp.nav.myList', 'My List')}${check(form, 'tvApp.nav.upNext', 'Up next')}
          ${choose(form, 'tvApp.nav.align', 'Tabs', [['left', 'Next to the logo'], ['center', 'In the middle']])}
          ${range(form, 'tvApp.nav.logoHeight', 'Logo height', 16, 60, 1)}` : ''}</div>

      <div class="card"><h2>Library tiles</h2><p class="muted small">The row of libraries on Home. Where it sits among the rows is set in <a href="#home">Home screen</a>.</p>
        ${check(form, 'tvApp.tiles.show', 'Show the library tiles')}
        ${t.tiles.show ? html`
          ${text(form, 'tvApp.tiles.title', 'Row title', 'Libraries')}
          ${range(form, 'tvApp.tiles.width', 'Tile width', 120, 400, 2)}
          ${range(form, 'tvApp.tiles.height', 'Tile height', 60, 240, 2)}
          <div class="row-btns"><button class="btn sm" data-ratio="16:9">16:9</button><button class="btn sm" data-ratio="2:1">2:1</button><button class="btn sm" data-ratio="21:9">21:9</button><button class="btn sm" data-ratio="4:3">4:3</button><span class="muted small">Make the height fit the width</span></div>
          ${choose(form, 'tvApp.tiles.art', 'Tile pictures', [['library', 'Each library’s own picture (below), else new artwork'], ['newest', 'Always new artwork from the library']])}
          ${range(form, 'tvApp.tiles.brightness', 'Brightness (unless a library sets its own)', 30, 130, 5)}
          ${check(form, 'tvApp.tiles.names', 'Library names (hidden when a library has a logo)')}${check(form, 'tvApp.tiles.counts', 'How many titles, and how many are new')}
          <h3>Each library</h3><p class="muted small">The same pictures and logos the website’s tiles use, so one change updates both.</p>
          ${libs.map((l) => html`<details class="tvp-lib"><summary><span class="tvp-mini" style="background-image:url('${encodeURI(tileArt(l))}')"></span>${l.name}</summary>
            ${image(form, `libs.${l.id}.tileBackground`, 'Tile picture')}
            ${choose(form, `libs.${l.id}.tileUse`, 'Without a tile picture, use', LIB_USE)}
            ${image(form, `libs.${l.id}.logo`, 'Logo (a see-through PNG works best)')}
            ${image(form, `libs.${l.id}.background`, 'Library page background (also on the TV’s library page)')}
            ${range(form, `libs.${l.id}.tileBrightness`, 'Tile brightness (0 = use the setting above)', 0, 160, 5)}</details>`)}` : ''}</div>

      <div class="card"><h2>Rows and cards</h2>
        ${range(form, 'tvApp.rows.posterWidth', 'Poster width', 80, 200, 2)}
        ${range(form, 'tvApp.rows.wideWidth', 'Wide card width (Continue watching, episodes)', 140, 360, 2)}
        ${range(form, 'tvApp.rows.titleSize', 'Row title size', 12, 28, 1)}
        ${range(form, 'tvApp.rows.gap', 'Space between rows', 4, 48, 1)}
        ${choose(form, 'tvApp.rows.captions', 'Names on cards', [['auto', 'On wide cards only'], ['always', 'On every card'], ['never', 'Never (the artwork says it)']])}
        ${check(form, 'tvApp.rows.progress', 'Progress bars')}
        ${range(form, 'tvApp.cards.radius', 'Corner roundness', 0, 24, 1)}</div>

      <div class="card"><h2>Focus</h2><p class="muted small">How the highlighted card stands out when moving with the remote.</p>
        ${choose(form, 'tvApp.cards.focus', 'Ring colour', [['theme', 'As Look and feel → TVs says'], ['white', 'White'], ['accent', 'Accent colour'], ['none', 'No ring (it only grows)']])}
        ${range(form, 'tvApp.cards.ring', 'Ring thickness', 0, 8, 1)}
        ${range(form, 'tvApp.cards.scale', 'Grows to (%)', 100, 125, 1)}</div>

      <div class="card"><h2>Background</h2>
        ${choose(form, 'tvApp.background.use', 'Behind everything', [['color', 'The background colour'], ['image', 'The background picture from Look and feel']])}
        ${form.tvApp.background.use === 'image' ? html`${range(form, 'tvApp.background.dim', 'Darken it (%)', 0, 95, 5)}${pic(tvTheme().background?.image) ? '' : html`<p class="muted small">No background picture is set in Look and feel yet.</p>`}` : ''}</div>

      <div class="card"><h2>Title page</h2>
        ${check(form, 'tvApp.details.backdrop', 'Backdrop')}
        ${t.details.backdrop ? range(form, 'tvApp.details.brightness', 'Backdrop brightness (%)', 30, 130, 5) : ''}
        ${range(form, 'tvApp.details.overview', 'Description lines (0 = hide)', 0, 8, 1)}
        ${choose(form, 'tvApp.details.episodes', 'Episodes', [['stills', 'Pictures in a row'], ['list', 'A list']])}
        ${check(form, 'tvApp.details.similar', 'More like this')}</div>

      <div class="card"><h2>Library page</h2>
        ${range(form, 'tvApp.library.columns', 'Posters across (0 = as many as fit)', 0, 10, 1)}
        ${check(form, 'tvApp.library.background', 'The library’s own background behind the posters')}
        ${check(form, 'tvApp.library.names', 'Names under posters')}</div>`);
  }

  // ── The preview ──
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const url = (u) => (u ? `url('${encodeURI(u).replace(/'/g, '%27')}')` : 'none');
  function meta(it) {
    const p = [];
    if (it.show) p.push(`S${it.show.season} E${it.show.episode}`);
    if (it.year) p.push(it.year);
    if (it.rating) p.push(it.rating);
    if (it.runtime) { const m = Math.round(it.runtime / 60); p.push(m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`); }
    if (it.score) p.push(`★ ${(+it.score).toFixed(1)}`);
    return p.join('  ·  ');
  }
  const prog = (it) => { const p = it.progress; if (!p || p.watched || !p.duration || !p.position) return -1; return Math.max(0.02, Math.min(1, p.position / p.duration)); };

  function vars() {
    const tt = tvTheme(), c = tt.colors || {}, a = form.tvApp;
    const ringColor = (a.cards.focus === 'theme' ? (tt.tv?.focus === 'accent' ? 'accent' : 'white') : a.cards.focus) === 'accent' ? c.accent : '#fff';
    return [`--bg:${c.bg}`, `--sf:${c.surface}`, `--tx:${c.text}`, `--mu:${c.muted}`, `--ac:${c.accent}`, `--r:${a.cards.radius}px`,
      `--ring:${a.cards.focus === 'none' ? 0 : a.cards.ring}px`, `--ringc:${ringColor}`, `--zoom:${a.cards.scale / 100}`,
      `--pw:${a.rows.posterWidth}px`, `--ww:${a.rows.wideWidth}px`, `--rt:${a.rows.titleSize}px`, `--gap:${a.rows.gap}px`].join(';');
  }
  function card(it, shape, captions, focused, size = null) {
    const art = shape === 'wide' ? it.thumb || it.backdrop || it.still || it.poster : it.poster || it.backdrop;
    const name = it.show?.title || it.title || it.name || '';
    const p = form.tvApp.rows.progress ? prog(it) : -1;
    const dims = size ? `;width:${size[0]}px;height:${size[1]}px` : '';
    return `<div class="tvp-card ${shape}${focused ? ' on' : ''}" style="background-image:${url(art)}${dims}">${art ? '' : `<b>${esc(name)}</b>`}
      ${captions ? `<span class="cap">${esc(name)}${it.show ? ` · S${it.show.season} E${it.show.episode}` : ''}</span>` : ''}${p >= 0 ? `<i style="width:${p * 100}%"></i>` : ''}</div>`;
  }
  function tile(t, focused) {
    const a = form.tvApp.tiles, lk = form.libs[t.id] || {};
    const own = +lk.tileBrightness, bright = own >= 20 && own <= 160 ? own : a.brightness;
    const logo = pic(lk.logo);
    const lines = [a.names && !logo ? esc(t.name) : '', a.counts ? `${t.count ?? ''} titles${t.fresh ? ` · ${t.fresh} new` : ''}` : ''].filter(Boolean);
    return `<div class="tvp-card wide tile${focused ? ' on' : ''}" style="width:${a.width}px;height:${a.height}px">
      <span class="art" style="background-image:${url(tileArt(t))};filter:brightness(${bright / 100})"></span>${tileArt(t) ? '' : `<b>${esc(t.name)}</b>`}
      ${logo ? `<img class="lg" src="${esc(logo)}" style="bottom:${a.counts ? 30 : 12}px">` : ''}${lines.length ? `<span class="cap">${lines.join('<br>')}</span>` : ''}</div>`;
  }
  function background() {
    const a = form.tvApp, img = a.background.use === 'image' ? pic(tvTheme().background?.image) : '';
    return img ? `<div class="tvp-bg" style="background-image:${url(img)}"></div><div class="tvp-dim" style="opacity:${a.background.dim / 100}"></div>` : '';
  }
  function navBar() {
    const a = form.tvApp, tt = tvTheme();
    if (!a.nav.show) return '';
    const libs = (home.libraries?.length ? home.libraries : L.libraries).map((l) => l.name);
    const tabs = ['Home', ...(a.nav.libraries ? libs : []), ...(a.nav.search ? ['Search'] : []), ...(a.nav.myList ? ['My List'] : []), ...(a.nav.upNext ? ['Up next'] : [])];
    return `<div class="tvp-nav${a.nav.align === 'center' ? ' mid' : ''}"><img src="${esc(pic(tt.logo?.image) || '/assets/logo.png')}" style="height:${a.nav.logoHeight}px">
      <span class="tabs">${tabs.map((x, i) => `<span${i === 0 ? ' class="on"' : ''}>${esc(x)}</span>`).join('')}</span><span class="who">Jus</span></div>`;
  }

  function homeView() {
    const a = form.tvApp, spot = (home.spotlight || [])[0];
    const rowsTop = a.hero.show ? 540 * a.hero.height / 100 : a.nav.show ? 78 : 32;
    const heroH = Math.min(540, rowsTop * 1.32), heroW = 960 * a.hero.width / 100;
    const rows = [];
    const tiles = a.tiles.show ? home.libraries || [] : [];
    const list = home.rows || [];
    const at = home.layout?.tilesAt ?? 0;
    list.forEach((r, i) => { if (i === at && tiles.length) rows.push({ tiles: true }); if (r.items?.length) rows.push(r); });
    if (at >= list.length && tiles.length) rows.push({ tiles: true });
    let first = true;
    const rowHtml = rows.slice(0, 4).map((r) => {
      if (r.tiles) {
        const out = `<div class="tvp-row"><h4>${esc(a.tiles.title)}</h4><div class="cards">${tiles.map((t, i) => tile(t, !a.hero.show && first && i === 0)).join('')}</div></div>`;
        first = false; return out;
      }
      const shape = r.shape === 'wide' ? 'wide' : r.shape === 'square' ? 'square' : 'poster';
      const caps = a.rows.captions === 'always' || (a.rows.captions === 'auto' && (r.id === 'continue' || shape === 'wide'));
      const out = `<div class="tvp-row"><h4>${esc(r.title)}</h4><div class="cards">${r.items.slice(0, 10).map((it, i) => card(it, shape, caps, !a.hero.show && first && i === 0)).join('')}</div></div>`;
      first = false; return out;
    }).join('');
    const logo = a.hero.logos && spot?.logo;
    return `${background()}
      ${a.hero.show && spot ? `<div class="tvp-hero" style="width:${heroW}px;height:${heroH}px;background-image:${url(spot.backdrop)};filter:brightness(${a.hero.brightness / 100})"></div>
        <div class="tvp-fade" style="width:${heroW}px;height:${heroH}px"></div>${heroW < 960 ? `<div class="tvp-solid" style="width:${960 - heroW}px;height:${heroH}px"></div>` : ''}
        <div class="tvp-info" style="top:${a.nav.show ? 78 : 40}px">${logo ? `<img class="hl" src="${esc(spot.logo)}">` : `<h2>${esc(spot.title)}</h2>`}
          <p class="mt">${esc(meta(spot))}</p>${a.hero.overview ? `<p class="ov">${esc(spot.overview || '')}</p>` : ''}
          <div class="btns"><span class="b p on">${prog(spot) >= 0 ? 'Resume' : 'Play'}</span><span class="b">More info</span></div></div>` : ''}
      ${navBar()}
      <div class="tvp-rows" style="top:${rowsTop}px">${rowHtml || '<p class="tvp-empty">Your library is empty.</p>'}</div>`;
  }

  function libraryView() {
    const a = form.tvApp, lib = library;
    if (!lib) return `${background()}<p class="tvp-empty">Loading…</p>`;
    const lk = form.libs[lib.id] || {};
    const bg = a.library.background ? pic(lk.background) : '';
    const usable = 960 - 82, span = a.library.columns || Math.max(3, Math.floor(usable / (a.rows.posterWidth + 14))), w = usable / span - 14;
    return `${bg ? `<div class="tvp-bg" style="background-image:${url(bg)}"></div><div class="tvp-dim" style="opacity:${a.background.dim / 100}"></div>` : background()}
      <div class="tvp-libhead"><h2>${esc(lib.name)}</h2><span class="mu">${lib.total ?? ''} titles</span><span class="grow"></span><span class="b">Sort: A–Z</span><span class="b">Show: Everything</span></div>
      <div class="tvp-grid" style="grid-template-columns:repeat(${span}, ${w}px)">${(lib.items || []).slice(0, span * 3).map((it, i) => `<div>${card(it, 'poster', false, i === 0, [w, w * 1.5])}${a.library.names ? `<span class="nm">${esc(it.title)}</span>` : ''}</div>`).join('')}</div>`;
  }

  function detailView() {
    const a = form.tvApp, d = detail;
    if (!d) return `${background()}<p class="tvp-empty">Loading…</p>`;
    const isShow = d.kind === 'show';
    const p = isShow ? d.playProgress : d.progress;
    const started = p && !p.watched && p.position > 30;
    const label = isShow && d.playLabel ? ` ${d.playLabel}` : '';
    const season = (d.seasons || [])[0];
    const eps = (season?.episodes || []).slice(0, 6);
    return `${background()}${a.details.backdrop ? `<div class="tvp-hero" style="width:720px;height:432px;background-image:${url(d.backdrop || d.poster)};filter:brightness(${a.details.brightness / 100})"></div><div class="tvp-fade" style="width:720px;height:432px"></div>` : ''}
      <div class="tvp-detail">${d.logo ? `<img class="hl" src="${esc(d.logo)}">` : `<h2>${esc(d.title)}</h2>`}
        <p class="mt">${esc(meta(d))}</p>${(d.genres || []).length ? `<p class="mu sm">${esc(d.genres.slice(0, 4).join(' • '))}</p>` : ''}
        ${a.details.overview ? `<p class="ov" style="-webkit-line-clamp:${a.details.overview}">${esc(d.overview || '')}</p>` : ''}
        <div class="btns"><span class="b p on">${started ? 'Resume' : 'Play'}${esc(label)}</span>${started ? '<span class="b">From the beginning</span>' : ''}<span class="b">${d.inList ? '✓' : '+'} My List</span><span class="b">More</span></div>
        ${isShow && eps.length ? (a.details.episodes === 'list'
          ? `<div class="tvp-eplist">${eps.map((e) => `<div><b>${e.number}.  ${esc(e.title)}</b><span>${e.runtime ? Math.round(e.runtime / 60) + 'm' : ''}</span></div>`).join('')}</div>`
          : `<div class="cards eps">${eps.map((e) => `<div class="ep">${card(e, 'wide', false, false)}<b>${e.number}. ${esc(e.title)}</b></div>`).join('')}</div>`) : ''}
        ${a.details.similar && (d.similar || []).length ? `<h4>More like this</h4><div class="cards">${d.similar.slice(0, 8).map((it) => card(it, 'poster', false, false)).join('')}</div>` : ''}</div>`;
  }

  async function ensureData() {
    if (tab === 'title' && !detail) {
      const first = (home.spotlight || [])[0] || (home.rows || []).flatMap((r) => r.items || []).find((x) => x.kind === 'movie' || x.kind === 'show');
      detail = first ? await api('GET', `/api/items/${first.kind === 'episode' ? first.show?.id || first.id : first.id}`).catch(() => ({ title: first.title })) : { title: 'No titles yet' };
    }
    if (tab === 'library' && !library) {
      const lib = (home.libraries || []).find((l) => l.kind === 'movies' || l.kind === 'shows') || L.libraries.find((l) => l.kind === 'movies' || l.kind === 'shows');
      library = lib ? { ...lib, ...(await api('GET', `/api/library/${lib.id}?limit=40&offset=0&sort=title`).catch(() => ({}))) } : { name: 'No movie or show library', items: [] };
    }
  }
  async function preview() {
    bar.innerHTML = `<span class="seg">${[['home', 'Home'], ['library', 'Library'], ['title', 'Title page']].map(([id, n]) => `<button class="btn sm${tab === id ? ' primary' : ''}" data-tab="${id}">${n}</button>`).join('')}</span><span class="muted small">A close match for the Fire TV app, at a 1080p TV’s size. Moving around and the exact fonts are best judged on the TV.</span>`;
    screen.setAttribute('style', vars());
    screen.innerHTML = tab === 'home' ? homeView() : tab === 'library' ? libraryView() : detailView();
    fit();
    if ((tab === 'title' && !detail) || (tab === 'library' && !library)) { await ensureData(); preview(); }
  }
  // Scale the 960×540 TV screen to the space there is.
  const stage = $('.tvp-stage', main);
  function fit() { const s = Math.min(stage.clientWidth / 960, stage.clientHeight / 540) || 0.5; screen.style.transform = `scale(${s})`; }
  new ResizeObserver(fit).observe(stage);

  bar.addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) { tab = b.dataset.tab; preview(); } });
  const touched = (redraw) => { dirty = true; if (redraw) controls(); else for (const b of box.querySelectorAll('[data-save],[data-undo]')) b.disabled = false; preview(); };
  bind(box, form, (redraw) => touched(redraw));
  // A few switches show or hide other settings: redraw the form for those.
  box.addEventListener('change', (e) => { if (e.target.matches('[data-path$=".show"],[data-path$="background.use"],[data-path$="details.backdrop"]')) controls(); });
  box.addEventListener('click', async (e) => {
    const r = e.target.closest('[data-ratio]');
    if (r) { const [x, y] = r.dataset.ratio.split(':').map(Number); form.tvApp.tiles.height = Math.max(60, Math.min(240, Math.round(form.tvApp.tiles.width * y / x))); touched(true); return; }
    if (e.target.closest('[data-reset]')) { form.tvApp = clone(D); touched(true); toast('HallFlix’s Fire TV defaults. Save to keep them.'); return; }
    if (e.target.closest('[data-undo]')) { form.tvApp = merge(clone(D), theme.tvApp || {}); form.libs = Object.fromEntries(L.libraries.map((l) => [l.id, clone(l.look || {})])); dirty = false; controls(); preview(); return; }
    if (e.target.closest('[data-save]')) {
      try {
        const saved = await api('PUT', '/api/studio/theme', { theme: { ...theme, tvApp: form.tvApp } });
        if (saved?.theme) theme = saved.theme;
        form.tvApp = merge(clone(D), theme.tvApp || {});
        for (const l of L.libraries) {
          const now = form.libs[l.id] || {};
          if (JSON.stringify(now) !== JSON.stringify(l.look || {})) { await api('PUT', `/api/studio/libraries/${l.id}`, { look: now }); l.look = clone(now); }
        }
        dirty = false; controls(); preview();
        toast(saved?.problems?.length ? `Saved, with fixes: ${saved.problems.slice(0, 3).join('; ')}` : 'Saved. The Fire TV app uses it the next time it opens.', saved?.problems?.length ? 8000 : undefined);
      } catch (err) { fail(err); }
    }
  });
  controls();
  preview();
}
