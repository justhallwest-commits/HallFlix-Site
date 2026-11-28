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
  let tab = 'home', dirty = false, detail = null, library = null, openLib = null;

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

  // ── Where a library's logo (or name) sits on its tile: the same rules as the Fire TV app (TvLook.logoSpot) ──
  const PL = { tl: [0, 0], tc: [0.5, 0], tr: [1, 0], ml: [0, 0.5], mc: [0.5, 0.5], mr: [1, 0.5], bl: [0, 1], bc: [0.5, 1], br: [1, 1] };
  const logoConf = (t) => {
    const lk = form.libs[t.id] || {}, a = form.tvApp.tiles;
    let c = { place: 'bl', size: 100, x: 0, y: 0, count: 'yes' };
    c = a.logoFrom === 'tv' ? { ...c, ...a.logo } : { ...c, ...(tvTheme().tileLogo || {}), ...(lk.tileLogo || {}) };
    return { ...c, ...(lk.tvTileLogo || {}) };
  };
  const spotOf = (c) => {
    const free = c.place === 'free' && +c.fx >= 0 && +c.fy >= 0;
    const [ax, ay] = free ? [Math.min(1, +c.fx / 100), Math.min(1, +c.fy / 100)] : PL[c.place] || PL.bl;
    const nx = free ? 0 : Math.max(-45, Math.min(45, +c.x || 0)) / 100, ny = free ? 0 : Math.max(-45, Math.min(45, +c.y || 0)) / 100;
    return { ax, ay, nx, ny, k: Math.max(30, Math.min(300, +c.size || 100)) / 100, count: c.count !== 'no' };
  };
  /** The logo block on a tile of w×h: positioned with CSS variables so dragging can move it without redrawing. */
  function logoBlock(t, w, h, attrs = '') {
    const a = form.tvApp.tiles, lk = form.libs[t.id] || {}, sp = spotOf(logoConf(t)), logo = pic(lk.logo);
    const j = sp.ax < 0.34 ? 'start' : sp.ax > 0.66 ? 'end' : 'center';
    const name = !logo && a.names ? `<b style="font-size:${(18 * sp.k).toFixed(1)}px">${esc(t.name)}</b>` : '';
    const count = a.counts && sp.count ? `<small>${t.count ?? 12} titles${t.fresh ? ` · ${t.fresh} new` : ''}</small>` : '';
    return `<span class="blk" ${attrs} style="--ax:${sp.ax};--ay:${sp.ay};--nx:${sp.nx};--ny:${sp.ny};justify-items:${j};text-align:${j === 'start' ? 'left' : j === 'end' ? 'right' : 'center'}">${logo ? `<img src="${esc(logo)}" draggable="false" style="max-height:${(h * 0.3 * sp.k).toFixed(0)}px;max-width:${(w * Math.min(0.94, 0.58 * Math.max(1, sp.k))).toFixed(0)}px">` : ''}${name}${count}</span>`;
  }
  const shadeCss = (t) => {
    const sp = spotOf(logoConf(t)), a = form.tvApp.tiles.shade / 100;
    const dir = sp.ay > 0.66 ? 'to top' : sp.ay < 0.34 ? 'to bottom' : sp.ax < 0.34 ? 'to right' : sp.ax > 0.66 ? 'to left' : 'to top';
    return `linear-gradient(${dir}, rgba(0,0,0,${a}), rgba(0,0,0,${(a / 3).toFixed(2)}) 50%, transparent)`;
  };
  const FOCUS = { center: '50% 50%', top: '50% 0%', bottom: '50% 100%', left: '0% 50%', right: '100% 50%' };
  /** One library's tile at the TV's size, for the editors: drag the logo; the tile follows the library's picture rules. */
  function tileEditor(t, attrs) {
    const a = form.tvApp.tiles, lk = form.libs[t.id] || {};
    const own = +lk.tileBrightness, bright = own >= 20 && own <= 160 ? own : a.brightness;
    const zoom = Math.min(1, 320 / a.width);
    return `<div class="tve" style="width:${a.width}px;height:${a.height}px;zoom:${zoom.toFixed(3)}">
      <span class="art" style="background-image:${url(tileArt(t))};background-position:${FOCUS[lk.tilePos] || '50% 30%'};filter:brightness(${bright / 100})"></span>
      <span class="shade" style="background:${shadeCss(t)}"></span>${logoBlock(t, a.width, a.height, attrs)}</div>`;
  }

  const LIB_USE = [['', 'The library page’s background, if it has one'], ['artwork', 'New artwork from the library']];
  function controls() {
    const keep = box.scrollTop, keepPage = document.scrollingElement?.scrollTop || 0;
    requestAnimationFrame(() => { box.scrollTop = keep; if (document.scrollingElement) document.scrollingElement.scrollTop = keepPage; });
    const t = form.tvApp;
    const libs = home.libraries?.length ? home.libraries : L.libraries.map((l) => ({ id: l.id, name: l.name, kind: l.kind, backdrop: l.art }));
    box.innerHTML = String(html`
      <div class="card"><h2>Fire TV app</h2>
        <p class="muted small">Seasons (<a href="#seasons">Seasons</a>) change the TV too: a season’s colours, logo, background and library pictures show on the TV while it runs.</p><p class="muted small">How HallFlix looks on Fire TV and Android TV, where the app draws Home, the libraries and title pages itself so it stays quick on a Fire TV stick. Colours, the logo and the focus ring come from <a href="#look">Look and feel</a> (the 📺 TVs look when it has one). The preview uses your own titles. Changes reach the TV the next time the app opens.</p>
        <div class="row-btns"><button class="btn primary" data-save ${dirty ? '' : 'disabled'}>Save</button><button class="btn" data-undo ${dirty ? '' : 'disabled'}>Undo changes</button><button class="btn" data-reset>HallFlix defaults</button></div></div>

      <div class="card" data-card="hero"><h2>Big picture</h2><p class="muted small">The large artwork at the top of Home, like the Jellyfin and Netflix TV apps.</p>
        ${check(form, 'tvApp.hero.show', 'Show the big picture')}
        ${t.hero.show ? html`
          ${check(form, 'tvApp.hero.follow', 'Follow the highlighted title (the picture changes as you move along the rows)')}
          ${range(form, 'tvApp.hero.height', 'Rows start at (% down the screen; or drag the dashed line in the preview)', 30, 80, 1)}
          ${range(form, 'tvApp.hero.width', 'Picture width (% of the screen)', 40, 100, 1)}
          ${range(form, 'tvApp.hero.brightness', 'Picture brightness (%)', 30, 130, 5)}
          ${range(form, 'tvApp.hero.rotate', 'Next spotlight title every (seconds, 0 = never)', 0, 60, 1)}
          ${choose(form, 'tvApp.hero.text', 'Title and buttons', [['top', 'Near the top'], ['middle', 'In the middle'], ['bottom', 'Just above the rows']])}
          ${range(form, 'tvApp.hero.focusY', 'Which part of the picture shows (0 = top, 100 = bottom)', 0, 100, 5)}
          ${check(form, 'tvApp.hero.logos', 'Show title logos instead of names when there is one')}
          ${check(form, 'tvApp.hero.overview', 'Show the description')}` : ''}</div>

      <div class="card" data-card="nav"><h2>Top menu</h2>
        ${check(form, 'tvApp.nav.show', 'Show the top menu (without it, the remote’s ☰ button opens the menu)')}
        ${t.nav.show ? html`
          ${check(form, 'tvApp.nav.libraries', 'A tab for each library')}${check(form, 'tvApp.nav.search', 'Search')}${check(form, 'tvApp.nav.myList', 'My List')}${check(form, 'tvApp.nav.upNext', 'Up next')}
          ${choose(form, 'tvApp.nav.align', 'Tabs', [['left', 'Next to the logo'], ['center', 'In the middle']])}
          ${range(form, 'tvApp.nav.logoHeight', 'Logo height', 16, 60, 1)}` : ''}</div>

      <div class="card" data-card="tiles"><h2>Library tiles</h2><p class="muted small">The row of libraries on Home. Where it sits among the rows is set in <a href="#home">Home screen</a>.</p>
        ${check(form, 'tvApp.tiles.show', 'Show the library tiles')}
        ${t.tiles.show ? html`
          ${text(form, 'tvApp.tiles.title', 'Row title', 'Libraries')}
          ${range(form, 'tvApp.tiles.width', 'Tile width', 120, 400, 2)}
          ${range(form, 'tvApp.tiles.height', 'Tile height', 60, 240, 2)}
          <div class="row-btns"><button class="btn sm" data-ratio="16:9">16:9</button><button class="btn sm" data-ratio="2:1">2:1</button><button class="btn sm" data-ratio="21:9">21:9</button><button class="btn sm" data-ratio="4:3">4:3</button><span class="muted small">Make the height fit the width</span></div>
          ${choose(form, 'tvApp.tiles.art', 'Tile pictures', [['library', 'Each library’s own picture (below), else new artwork'], ['newest', 'Always new artwork from the library']])}
          ${range(form, 'tvApp.tiles.brightness', 'Brightness (unless a library sets its own)', 30, 130, 5)}
          ${range(form, 'tvApp.tiles.shade', 'Darken behind the logo (%)', 0, 90, 5)}
          <h3>Logos and names on the tiles</h3>
          <p class="muted small">Drag a logo on the preview’s tiles to move it for that library on the TV, or use the editors below.</p>
          ${choose(form, 'tvApp.tiles.logoFrom', 'Where they sit', [['site', 'As on the website (Look and feel → library tiles)'], ['tv', 'Their own place on the TV, for every library']])}
          ${t.tiles.logoFrom === 'tv' && libs[0] ? html`<div class="tve-wrap">${raw(tileEditor(libs[0], 'data-drag="global"'))}</div>
            ${range(form, 'tvApp.tiles.logo.size', 'Size (%)', 30, 300, 5)}
            ${choose(form, 'tvApp.tiles.logo.count', 'Title count under it', [['yes', 'Show'], ['no', 'Hide']])}` : ''}
          ${check(form, 'tvApp.tiles.videos', 'Play a library’s tile video on the highlighted tile (muted; a TV-sized copy is made for Fire TV)')}
          ${check(form, 'tvApp.tiles.names', 'Library names (hidden when a library has a logo)')}${check(form, 'tvApp.tiles.counts', 'How many titles, and how many are new')}
          <h3>Each library</h3><p class="muted small">The same pictures and logos the website’s tiles use, so one change updates both.</p>
          ${libs.map((l) => html`<details class="tvp-lib" data-lib="${l.id}" ${openLib === l.id ? 'open' : ''}><summary><span class="tvp-mini" style="background-image:url('${encodeURI(tileArt(l))}')"></span>${l.name}</summary>
            <div class="tve-wrap">${raw(tileEditor(l, `data-drag="lib" data-lib="${l.id}"`))}</div>
            <div class="tve-ctl">${(() => { const c = logoConf(l), sp = spotOf(c), mine = !!form.libs[l.id]?.tvTileLogo; return html`
              <label class="tl-size">Size <input type="range" min="30" max="300" step="5" value="${Math.round(sp.k * 100)}" data-tve-size="${l.id}"><output>${Math.round(sp.k * 100)}%</output></label>
              <label class="check sm"><input type="checkbox" data-tve-count="${l.id}" ${sp.count ? 'checked' : ''}> Title count</label>
              ${mine ? html`<button class="btn sm" data-tve-reset="${l.id}" title="Use the ${form.tvApp.tiles.logoFrom === 'tv' ? 'TV-wide' : 'website’s'} placement again">Reset</button><span class="muted small">Placed for the TV only</span>` : html`<span class="muted small">Drag the logo to place it on the TV only</span>`}`; })()}</div>
            ${choose(form, `libs.${l.id}.tilePos`, 'Which part of the picture shows (also on the website)', [['', 'Centre, a little high'], ['center', 'Centre'], ['top', 'Top'], ['bottom', 'Bottom'], ['left', 'Left'], ['right', 'Right']])}
            ${image(form, `libs.${l.id}.tileBackground`, 'Tile picture')}
            ${image(form, `libs.${l.id}.tileVideo`, 'Tile video (MP4 or WebM, plays when the tile is highlighted)')}
            ${choose(form, `libs.${l.id}.tileUse`, 'Without a tile picture, use', LIB_USE)}
            ${image(form, `libs.${l.id}.logo`, 'Logo (a see-through PNG works best)')}
            ${image(form, `libs.${l.id}.background`, 'Library page background (also on the TV’s library page)')}
            ${range(form, `libs.${l.id}.tileBrightness`, 'Tile brightness (0 = use the setting above)', 0, 160, 5)}</details>`)}` : ''}</div>

      <div class="card" data-card="rows"><h2>Rows and cards</h2>
        ${range(form, 'tvApp.rows.posterWidth', 'Poster width', 80, 200, 2)}
        ${range(form, 'tvApp.rows.wideWidth', 'Wide card width (Continue watching, episodes)', 140, 360, 2)}
        ${range(form, 'tvApp.rows.titleSize', 'Row title size', 12, 28, 1)}
        ${range(form, 'tvApp.rows.gap', 'Space between rows', 4, 48, 1)}
        ${choose(form, 'tvApp.rows.captions', 'Names on cards', [['auto', 'On wide cards only'], ['always', 'On every card'], ['never', 'Never (the artwork says it)']])}
        ${check(form, 'tvApp.rows.progress', 'Progress bars')}
        ${range(form, 'tvApp.cards.radius', 'Corner roundness', 0, 24, 1)}</div>

      <div class="card" data-card="focus"><h2>Focus</h2><p class="muted small">How the highlighted card stands out when moving with the remote.</p>
        ${choose(form, 'tvApp.cards.focus', 'Ring colour', [['theme', 'As Look and feel → TVs says'], ['white', 'White'], ['accent', 'Accent colour'], ['none', 'No ring (it only grows)']])}
        ${range(form, 'tvApp.cards.ring', 'Ring thickness', 0, 8, 1)}
        ${range(form, 'tvApp.cards.scale', 'Grows to (%)', 100, 125, 1)}</div>

      <div class="card" data-card="background"><h2>Background</h2>
        ${choose(form, 'tvApp.background.use', 'Behind everything', [['color', 'The background colour'], ['image', 'The background picture from Look and feel']])}
        ${form.tvApp.background.use === 'image' ? html`${range(form, 'tvApp.background.dim', 'Darken it (%)', 0, 95, 5)}${pic(tvTheme().background?.image) ? '' : html`<p class="muted small">No background picture is set in Look and feel yet.</p>`}` : ''}</div>

      <div class="card" data-card="details"><h2>Title page</h2>
        ${check(form, 'tvApp.details.backdrop', 'Backdrop')}
        ${t.details.backdrop ? range(form, 'tvApp.details.brightness', 'Backdrop brightness (%)', 30, 130, 5) : ''}
        ${range(form, 'tvApp.details.overview', 'Description lines (0 = hide)', 0, 8, 1)}
        ${choose(form, 'tvApp.details.episodes', 'Episodes', [['stills', 'Pictures in a row'], ['list', 'A list']])}
        ${check(form, 'tvApp.details.similar', 'More like this')}</div>

      <div class="card" data-card="library"><h2>Library page</h2>
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
  function card(it, shape, captions, focused, size = null, at = '') {
    const art = shape === 'wide' ? it.thumb || it.backdrop || it.still || it.poster : it.poster || it.backdrop;
    const name = it.show?.title || it.title || it.name || '';
    const p = form.tvApp.rows.progress ? prog(it) : -1;
    const dims = size ? `;width:${size[0]}px;height:${size[1]}px` : '';
    return `<div class="tvp-card ${shape}${focused ? ' on' : ''}" ${at} style="background-image:${url(art)}${dims}">${art ? '' : `<b>${esc(name)}</b>`}
      ${captions ? `<span class="cap">${esc(name)}${it.show ? ` · S${it.show.season} E${it.show.episode}` : ''}</span>` : ''}${p >= 0 ? `<i style="width:${p * 100}%"></i>` : ''}</div>`;
  }
  function tile(t, focused, first, at = '') {
    const a = form.tvApp.tiles, lk = form.libs[t.id] || {};
    const own = +lk.tileBrightness, bright = own >= 20 && own <= 160 ? own : a.brightness;
    return `<div class="tvp-card wide tile${focused ? ' on' : ''}" ${at} data-goto="tiles" data-lib="${t.id}" style="width:${a.width}px;height:${a.height}px">
      <span class="art" style="background-image:${url(tileArt(t))};background-position:${FOCUS[lk.tilePos] || '50% 30%'};filter:brightness(${bright / 100})"></span>${tileArt(t) ? '' : `<b>${esc(t.name)}</b>`}
      <span class="shade" style="background:${shadeCss(t)}"></span>${logoBlock(t, a.width, a.height, `data-drag="lib" data-lib="${t.id}" title="Drag to move the ${esc(t.name)} logo on the TV"`)}
      ${first ? '<span class="tvp-corner" title="Drag to resize the library tiles"></span>' : ''}</div>`;
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
    return `<div class="tvp-nav${a.nav.align === 'center' ? ' mid' : ''}" data-goto="nav"><img src="${esc(pic(tt.logo?.image) || '/assets/logo.png')}" style="height:${a.nav.logoHeight}px">
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
    shownRows = rows.map((r) => (r.tiles ? { tiles: true, items: tiles } : { items: r.items.slice(0, 20) }));
    const rowHtml = rows.map((r, ri) => {
      const at = (ci) => `data-r="${ri}" data-c="${ci}"`;
      if (r.tiles) return `<div class="tvp-row" data-goto="tiles"><h4>${esc(a.tiles.title)}</h4><div class="cards">${tiles.map((t, i) => tile(t, false, i === 0, at(i))).join('')}</div></div>`;
      const shape = r.shape === 'wide' ? 'wide' : r.shape === 'square' ? 'square' : 'poster';
      const caps = a.rows.captions === 'always' || (a.rows.captions === 'auto' && (r.id === 'continue' || shape === 'wide'));
      return `<div class="tvp-row" data-goto="rows"><h4>${esc(r.title)}</h4><div class="cards">${r.items.slice(0, 20).map((it, i) => card(it, shape, caps, false, null, at(i))).join('')}</div></div>`;
    }).join('');
    const logo = a.hero.logos && spot?.logo;
    return `${background()}
      ${a.hero.show && spot ? `<div class="tvp-hero" data-goto="hero" style="width:${heroW}px;height:${heroH}px;background-image:${url(spot.backdrop)};background-position:50% ${a.hero.focusY}%;filter:brightness(${a.hero.brightness / 100})"></div>
        <div class="tvp-fade" style="width:${heroW}px;height:${heroH}px"></div>${heroW < 960 ? `<div class="tvp-solid" style="width:${960 - heroW}px;height:${heroH}px"></div>` : ''}
        <div class="tvp-info tx-${a.hero.text}" data-goto="hero" style="--top:${a.nav.show ? 78 : 40}px;--rows:${rowsTop}px">${logo ? `<img class="hl" src="${esc(spot.logo)}">` : `<h2>${esc(spot.title)}</h2>`}
          <p class="mt">${esc(meta(spot))}</p>${a.hero.overview ? `<p class="ov">${esc(spot.overview || '')}</p>` : ''}
          <div class="btns"><span class="b p">${prog(spot) >= 0 ? 'Resume' : 'Play'}</span><span class="b">More info</span></div></div>` : ''}
      ${navBar()}
      <div class="tvp-rows" style="top:${rowsTop}px">${rowHtml || '<p class="tvp-empty">Your library is empty.</p>'}</div>
      ${a.hero.show ? `<div class="tvp-hh" style="top:${rowsTop}px" title="Drag to change where the rows start"><span>Rows start here · drag</span></div>` : ''}`;
  }

  // ── The preview as a TV: arrow keys move the highlight like the remote, rows scroll, the big picture follows ──
  let shownRows = [];
  let at = { r: -1, c: 0 }; // r = -1: the big picture's buttons
  function itemAt(r, c) { return shownRows[r]?.items?.[c]; }
  function showFocus(scroll = true) {
    if (tab !== 'home') return;
    const a = form.tvApp;
    const hasHero = a.hero.show && !!screen.querySelector('.tvp-info');
    if (at.r < 0 && !hasHero) at = { r: 0, c: 0 };
    for (const el of screen.querySelectorAll('.tvp-card.on, .b.on')) el.classList.remove('on');
    const btns = screen.querySelector('.tvp-info .btns');
    if (at.r < 0) {
      screen.querySelector('.tvp-info .b.p')?.classList.add('on');
      if (btns) btns.style.opacity = '';
      if (scroll) screen.querySelector('.tvp-rows')?.scrollTo({ top: 0, behavior: 'smooth' });
      heroFrom((home.spotlight || [])[0], false);
      return;
    }
    const el = screen.querySelector(`.tvp-card[data-r="${at.r}"][data-c="${at.c}"]`);
    if (!el) return;
    el.classList.add('on');
    if (btns) btns.style.opacity = '0';
    if (scroll) {
      // As on the TV: the focused row's top at the top of the rows, the focused card at the left edge.
      const rowsEl = screen.querySelector('.tvp-rows'), row = el.closest('.tvp-row'), cards = el.parentElement;
      rowsEl?.scrollTo({ top: row.offsetTop, behavior: 'smooth' });
      cards.scrollTo({ left: Math.max(0, el.offsetLeft - 48), behavior: 'smooth' });
    }
    if (a.hero.follow) heroFrom(itemAt(at.r, at.c), shownRows[at.r]?.tiles);
  }
  /** Show a title (or a library tile) in the big picture, as the TV does when following the highlight. */
  function heroFrom(it, isTile) {
    const info = screen.querySelector('.tvp-info'), hero = screen.querySelector('.tvp-hero');
    if (!it || !info || !hero) return;
    hero.style.backgroundImage = url(isTile ? tileArt(it) : it.backdrop || it.poster);
    const logo = form.tvApp.hero.logos && (isTile ? pic(form.libs[it.id]?.logo) : it.logo);
    const head = info.querySelector('.hl, h2');
    const fresh = logo ? Object.assign(document.createElement('img'), { className: 'hl', src: logo }) : Object.assign(document.createElement('h2'), { textContent: it.show?.title || it.title || it.name || '' });
    head?.replaceWith(fresh);
    fresh.addEventListener?.('load', clearRows);
    const mt = info.querySelector('.mt'); if (mt) mt.textContent = isTile ? `${it.count ?? ''} titles${it.fresh ? `  ·  ${it.fresh} new` : ''}` : meta(it);
    const ov = info.querySelector('.ov'); if (ov) ov.textContent = isTile ? '' : it.overview || '';
  }
  /**
   * Keep the rows clear of the big picture's text and buttons: if they'd overlap, the rows start lower (the TV app does
   * the same).
   */
  function clearRows() {
    const a = form.tvApp, info = screen.querySelector('.tvp-info'), rowsEl = screen.querySelector('.tvp-rows');
    if (!info || !rowsEl || a.hero.text === 'bottom') return;
    const sr = screen.getBoundingClientRect(), k = sr.height / 540 || 1;
    const bottom = (info.getBoundingClientRect().bottom - sr.top) / k;
    const set = 540 * a.hero.height / 100;
    const top = Math.max(set, Math.ceil(bottom + 10));
    rowsEl.style.top = `${top}px`;
    const hh = screen.querySelector('.tvp-hh');
    if (hh) { hh.style.top = `${top}px`; hh.querySelector('span').textContent = top > set ? 'Rows moved down to clear the buttons · drag' : 'Rows start here · drag'; }
  }
  screen.tabIndex = 0;
  screen.addEventListener('keydown', (e) => {
    if (tab !== 'home' || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    e.preventDefault();
    const n = shownRows.length;
    if (e.key === 'ArrowDown') at = at.r < n - 1 ? { r: at.r + 1, c: at.r < 0 ? 0 : Math.min(at.c, (shownRows[at.r + 1]?.items.length || 1) - 1) } : at;
    if (e.key === 'ArrowUp') at = at.r >= 0 ? { r: at.r - 1, c: at.r - 1 < 0 ? 0 : Math.min(at.c, (shownRows[at.r - 1]?.items.length || 1) - 1) } : at;
    if (e.key === 'ArrowRight' && at.r >= 0) at = { r: at.r, c: Math.min(at.c + 1, shownRows[at.r].items.length - 1) };
    if (e.key === 'ArrowLeft' && at.r >= 0) at = { r: at.r, c: Math.max(0, at.c - 1) };
    showFocus();
  });
  // The mouse wheel scrolls the rows up and down; over a row with Shift (or a sideways swipe), along it.
  screen.addEventListener('wheel', (e) => {
    const cards = e.target.closest('.cards'), rowsEl = screen.querySelector('.tvp-rows');
    if (!rowsEl) return;
    e.preventDefault();
    const k = screen.getBoundingClientRect().width / 960 || 1;
    if (cards && (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY))) cards.scrollLeft += (e.deltaX || e.deltaY) / k;
    else rowsEl.scrollTop += e.deltaY / k;
  }, { passive: false });

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
    bar.innerHTML = `<span class="seg">${[['home', 'Home'], ['library', 'Library'], ['title', 'Title page']].map(([id, n]) => `<button class="btn sm${tab === id ? ' primary' : ''}" data-tab="${id}">${n}</button>`).join('')}</span><span class="muted small">A close match for the Fire TV app. Click it and use the arrow keys like the remote; the wheel or dragging scrolls the rows (Shift + wheel along a row).</span>`;
    screen.setAttribute('style', vars());
    screen.innerHTML = tab === 'home' ? homeView() : tab === 'library' ? libraryView() : detailView();
    fit();
    if (tab === 'home') {
      requestAnimationFrame(() => { clearRows(); showFocus(false); });
      for (const img of screen.querySelectorAll('.tvp-info img')) img.addEventListener('load', clearRows);
    }
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
  // ── Editing on the preview and the tile editors: drag logos, the rows line and a tile's corner; click to find settings ──
  const libTarget = (id) => {
    const l = form.libs[id] || (form.libs[id] = {});
    if (!l.tvTileLogo) { const c = logoConf({ id }); l.tvTileLogo = { size: c.size, count: c.count }; }
    return l.tvTileLogo;
  };
  let drag = null;
  function startDrag(e, kind, el) {
    e.preventDefault();
    drag = { kind, el, x0: e.clientX, y0: e.clientY, moved: false, w0: form.tvApp.tiles.width, h0: form.tvApp.tiles.height };
    el.setPointerCapture?.(e.pointerId);
  }
  const onDown = (e) => {
    const blk = e.target.closest('.blk[data-drag]');
    if (blk) return startDrag(e, 'logo', blk);
    if (e.target.closest('.tvp-corner')) return startDrag(e, 'corner', e.target.closest('.tvp-corner'));
    if (e.target.closest('.tvp-hh')) return startDrag(e, 'rows', e.target.closest('.tvp-hh'));
    const g = e.target.closest('[data-goto]');
    if (g && screen.contains(g)) drag = { kind: 'click', el: g, x0: e.clientX, y0: e.clientY };
  };
  const onMove = (e) => {
    if (!drag) return;
    if (Math.abs(e.clientX - drag.x0) + Math.abs(e.clientY - drag.y0) > 3) drag.moved = true;
    if (!drag.moved) return;
    if (drag.kind === 'click') {
      // Dragging the preview scrolls it: along a row, and up and down through the rows.
      const k = screen.getBoundingClientRect().width / 960 || 1;
      const cards = drag.el.closest('.cards') || drag.el.querySelector?.('.cards'), rowsEl = screen.querySelector('.tvp-rows');
      const dx = e.clientX - (drag.px ?? drag.x0), dy = e.clientY - (drag.py ?? drag.y0);
      drag.px = e.clientX; drag.py = e.clientY; drag.panned = true;
      if (cards) cards.scrollLeft -= dx / k;
      if (rowsEl && screen.contains(drag.el)) rowsEl.scrollTop -= dy / k;
      return;
    }
    if (drag.kind === 'logo') {
      const r = drag.el.parentElement.getBoundingClientRect();
      const ax = Math.max(0, Math.min(1, ((e.clientX - r.left) / r.width - 0.06) / 0.88));
      const ay = Math.max(0, Math.min(1, ((e.clientY - r.top) / r.height - 0.09) / 0.82));
      for (const [k, v] of [['--ax', ax], ['--ay', ay], ['--nx', 0], ['--ny', 0]]) drag.el.style.setProperty(k, v);
      drag.spot = [Math.round(ax * 100), Math.round(ay * 100)];
    } else if (drag.kind === 'rows') {
      const r = screen.getBoundingClientRect();
      const pct = Math.max(30, Math.min(80, Math.round(((e.clientY - r.top) / r.height) * 100)));
      drag.pct = pct;
      drag.el.style.top = `${pct * 5.4}px`;
      const rows = screen.querySelector('.tvp-rows'); if (rows) rows.style.top = `${pct * 5.4}px`;
    } else if (drag.kind === 'corner') {
      const k = screen.getBoundingClientRect().width / 960;
      const w = Math.max(120, Math.min(400, Math.round((drag.w0 + (e.clientX - drag.x0) / k) / 2) * 2));
      const h = Math.max(60, Math.min(240, Math.round((drag.h0 + (e.clientY - drag.y0) / k) / 2) * 2));
      drag.size = [w, h];
      for (const t of screen.querySelectorAll('.tvp-card.tile')) { t.style.width = `${w}px`; t.style.height = `${h}px`; }
    }
  };
  const onUp = () => {
    const d = drag; drag = null;
    if (!d) return;
    if (d.panned) return;
    if (d.kind === 'click' || !d.moved) {
      // Clicking a card highlights it, as the remote would.
      const cardEl = d.el.closest?.('.tvp-card[data-r]') || (screen.contains(d.el) && document.elementFromPoint(d.x0, d.y0)?.closest('.tvp-card[data-r]'));
      if (cardEl) { at = { r: +cardEl.dataset.r, c: +cardEl.dataset.c }; showFocus(false); }
      screen.focus({ preventScroll: true });
      // A click: show the settings for what was clicked (and open that library's editor).
      const g = d.el.closest('[data-goto]') || d.el;
      const lib = d.el.closest('[data-lib]')?.dataset.lib;
      if (lib && g.dataset.goto === 'tiles') openLib = +lib;
      if (lib) controls();
      const card = box.querySelector(`[data-card="${g.dataset.goto}"]`);
      const target = (lib && box.querySelector(`details[data-lib="${lib}"]`)) || card;
      target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      card?.classList.add('flash'); setTimeout(() => card?.classList.remove('flash'), 1200);
      return;
    }
    if (d.kind === 'logo' && d.spot) {
      const o = d.el.dataset.drag === 'global' ? form.tvApp.tiles.logo : libTarget(d.el.dataset.lib);
      Object.assign(o, { place: 'free', fx: d.spot[0], fy: d.spot[1], x: 0, y: 0 });
      if (d.el.dataset.drag === 'lib') openLib = +d.el.dataset.lib;
    }
    if (d.kind === 'rows' && d.pct) form.tvApp.hero.height = d.pct;
    if (d.kind === 'corner' && d.size) [form.tvApp.tiles.width, form.tvApp.tiles.height] = d.size;
    touched(true);
  };
  for (const el of [screen, box]) el.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  // The per-library TV editors' size and count.
  box.addEventListener('input', (e) => {
    const sz = e.target.closest('[data-tve-size]');
    if (sz) { libTarget(sz.dataset.tveSize).size = +sz.value; sz.nextElementSibling.textContent = `${sz.value}%`; openLib = +sz.dataset.tveSize; touched(false); }
  });
  box.addEventListener('change', (e) => {
    const ct = e.target.closest('[data-tve-count]');
    if (ct) { libTarget(ct.dataset.tveCount).count = ct.checked ? 'yes' : 'no'; openLib = +ct.dataset.tveCount; touched(true); }
    if (e.target.matches('[data-path$="logoFrom"],[data-path$="tilePos"]')) controls();
  });
  box.addEventListener('click', (e) => {
    const rs = e.target.closest('[data-tve-reset]');
    if (rs) { delete form.libs[rs.dataset.tveReset].tvTileLogo; openLib = +rs.dataset.tveReset; touched(true); }
  });
  box.addEventListener('toggle', (e) => { const d = e.target.closest?.('details[data-lib]'); if (d?.open) openLib = +d.dataset.lib; }, true);
  controls();
  preview();
}
