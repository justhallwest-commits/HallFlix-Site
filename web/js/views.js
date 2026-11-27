// Screens: first-run setup, sign-in, home, libraries, search and the title sheet.
import { $, $$, api, html, raw, esc, icons, state, applyLook, styleLogin, logoUrl, libraryLook, avatarStyle, fmtRuntime, toast, emit, on, themeNow, libTitle, tvPic, pic, wide } from './core.js';
import * as browse from './browse.js';
import * as feel from './feel.js';
import * as media from './media.js';
import * as more from './more.js';
import { addCastButton, castTo } from './cast.js';
import { canDownload, DL_ICON, download, markSaved, onDownloadClick, openDownloads } from './downloads.js';
import * as comics from './comics.js';
import * as profileEdit from './profile.js';
import * as ratings from './ratings.js';
import * as backdrop from './backdrop.js';
import { startLoginMusic, fadeOutLoginMusic, musicNow } from './loginmusic.js';
/** How the welcome ident sounds: its own audio, silent with the sign-in music carrying on, or silent. */
export const splashAudio = (S = {}) => (['own', 'music', 'silent'].includes(S.audio) ? S.audio : S.sound === false ? 'silent' : 'own');
import { initRows } from './rows.js';
import { effectsOff, startEffect } from './effects.js';

export const extraRows = []; // rows added by plugins through HallFlix.addHomeRow()
const app = () => $('#app');
const view = () => $('#view');
let base = null, stale = false, heroTimer = 0;
export const hasBase = () => !!base && !!view();
export const markStale = () => { stale = true; };
export const isStale = () => stale;

// ---------- pieces ----------
const metaLine = (it, extra = []) => html`<div class="meta">
  ${it.score ? html`<span class="score">★ ${it.score.toFixed(1)}</span>` : ''}${it.year ? html`<span>${it.year}</span>` : ''}
  ${it.rating ? html`<span class="tag">${it.rating}</span>` : ''}${it.kind === 'movie' && it.runtime ? html`<span>${fmtRuntime(it.runtime)}</span>` : ''}
  ${extra.map((x) => html`<span>${x}</span>`)}${(it.genres || []).slice(0, 3).map((g) => html`<span>${g}</span>`)}</div>`;

export const NOUN = { movies: ['movie', 'movies'], shows: ['show', 'shows'], books: ['book', 'books'], comics: ['series', 'series'], music: ['album', 'albums'] };
const plural = (n, [one, many]) => `${n} ${n === 1 ? one : many}`;
const SHELF = new Set(['book', 'comic', 'series', 'album', 'artist']);

/** Cards for books, comics, albums and artists: their own shapes and lines under the title. */
function shelfCard(it, read = false) {
  const square = it.kind === 'album' || it.kind === 'artist';
  const reading = (it.kind === 'book' || it.kind === 'comic') && it.progress && !it.progress.watched;
  const pct = reading && it.progress.duration ? Math.min(100, (it.progress.position / it.progress.duration) * 100) : 0;
  const sub = it.kind === 'series' ? plural(it.count || 0, ['issue', 'issues']) : it.kind === 'artist' ? plural(it.count || 0, ['album', 'albums'])
    : it.kind === 'album' ? [it.author, it.year].filter(Boolean).join(' · ') : it.kind === 'comic' && it.number != null ? `#${it.number}` : it.author || it.year || '';
  const href = reading && read ? `#/read/${it.id}` : `#/title/${it.id}`; // only Continue reading jumps straight into the book
  return html`<a class="card ${square ? 'square' : 'book'} k-${it.kind}" href="${href}" data-id="${it.id}" title="${it.title}">
    <div class="art"><div class="fallback">${it.title}${it.author && it.kind !== 'album' ? html`<small>${it.author}</small>` : ''}</div>
      ${it.poster ? html`<img loading="lazy" decoding="async" src="${it.poster}"${pic(it.poster)} alt="" onload="this.classList.add('in')" onerror="this.remove()">` : ''}
      ${it.kind === 'album' ? html`<button class="playdot" data-playalbum="${it.id}" aria-label="Play ${it.title}" tabindex="-1"><span>${icons.play}</span></button>` : ''}
      <div class="label">${it.title}<small>${sub}</small></div>
      ${pct ? html`<div class="bar"><i style="width:${pct}%"></i></div>` : ''}${it.progress?.watched ? html`<div class="seen">✓</div>` : ''}</div></a>`;
}

export function cardHtml(it, { wide = false, read = false } = {}) {
  if (SHELF.has(it.kind)) return shelfCard(it, read);
  const ep = it.kind === 'episode';
  const art = wide || ep ? it.thumb || it.backdrop || it.poster : it.poster;
  const pct = it.progress && !it.progress.watched && it.progress.duration ? Math.min(100, (it.progress.position / it.progress.duration) * 100) : 0;
  const left = pct ? `${fmtRuntime(it.progress.duration - it.progress.position)} left` : '';
  const title = ep ? it.show.title : it.title;
  const sub = ep ? `S${it.show.season} E${it.show.episode} · ${it.title}` : wide ? left || it.year || '' : [it.year, it.rating].filter(Boolean).join(' · ');
  return html`<a class="card ${wide || ep ? 'wide' : ''}" href="#/${wide || ep ? 'watch' : 'title'}/${it.id}" data-id="${it.id}" title="${title}">
    <div class="art"><div class="fallback">${title}</div>
      ${art ? html`<img loading="lazy" decoding="async" src="${art}"${pic(art, 'wide')} alt="" onload="this.classList.add('in')">` : ''}
      ${wide || ep ? html`<div class="playdot"><span>${icons.play}</span></div>` : ratings.badge(it)}
      <div class="label">${title}<small>${sub}${ep && left ? ` · ${left}` : ''}</small></div>
      ${pct ? html`<div class="bar"><i style="width:${pct}%"></i></div>` : ''}${it.progress?.watched ? html`<div class="seen">✓</div>` : ''}</div></a>`;
}

const rowHtml = (r) => html`<section class="row ${r.shape === 'wide' ? 'keep' : ''} ${r.shape === 'square' ? 'squares' : ''} ${r.shape === 'ranked' ? 'ranked' : ''}" data-row="${r.id}">
  <h2>${r.title}${r.library ? html`<a href="#/library/${r.library}">See all ›</a>` : ''}</h2>
  <button class="arrow l" hidden aria-label="Scroll left" tabindex="-1">‹</button>
  <div class="scroller">${r.items.map((it, i) => (r.shape === 'ranked' ? html`<div class="rank"><span class="num" aria-hidden="true">${i + 1}</span>${cardHtml(it)}</div>` : cardHtml(it, { wide: r.shape === 'wide', read: r.id === 'reading' })))}</div>
  <button class="arrow r" aria-label="Scroll right" tabindex="-1">›</button></section>`;

const isVid = (u) => /\.(mp4|webm|m4v|mov)(\?|$)/i.test(u || '');
// Where each place puts the covers on the tile: [across, down], 0 = left/top, 1 = right/bottom.
const TILE_POS = { center: 'center', top: 'center top', bottom: 'center bottom', left: 'left center', right: 'right center' };
/** The still picture on a library's Home tile (a tile background that is a video plays on the tile instead). */
function tileBg(lk, artwork) {
  // On a TV a custom picture comes as a tile-sized still (a full-size upload is heavy for a Fire TV Stick).
  if (lk.tileBackground && !isVid(lk.tileBackground)) return tvPic(lk.tileBackground, 800);
  if (lk.tileUse !== 'artwork' && lk.background && !isVid(lk.background)) return tvPic(lk.background, 800);
  return artwork;
}
const PLACES = { br: [1, 1], mr: [1, 0.5], tr: [1, 0], bc: [0.5, 1], tc: [0.5, 0], tl: [0, 0], bl: [0, 1], ml: [0, 0.5], mc: [0.5, 0.5] };
/** Where the logo (or name) sits on a library tile and how big it is, set up in Studio → Look and feel (whole app, then each library). */
function logoStyle(lk) {
  const c = { place: 'bl', size: 100, x: 0, y: 0, count: 'yes', ...(themeNow()?.tileLogo || {}), ...(lk.tileLogo || {}) };
  // "free": dragged into place in the Studio. fx/fy say where on the tile (0–100% across and down); the logo leans
  // toward that side, so it never runs off the edge.
  const free = c.place === 'free' && Number.isFinite(+c.fx) && Number.isFinite(+c.fy);
  const [ax, ay] = free ? [Math.max(0, Math.min(100, +c.fx)) / 100, Math.max(0, Math.min(100, +c.fy)) / 100] : PLACES[c.place] || PLACES.bl;
  const k = Math.max(30, Math.min(300, +c.size || 100)) / 100;
  const nx = free ? 0 : Math.max(-45, Math.min(45, +c.x || 0)), ny = free ? 0 : Math.max(-45, Math.min(45, +c.y || 0));
  const style = `--tl-ax:${ax.toFixed(3)};--tl-ay:${ay.toFixed(3)};--tl-x:${nx}%;--tl-y:${ny}%;--tl-k:${k};--tl-maxw:${Math.round(Math.max(30, Math.min(94, 58 * Math.max(1, k))))}%`;
  return { style, align: ax < 0.34 ? 'start' : ax > 0.66 ? 'end' : 'center', count: c.count !== 'no' };
}
/** The covers on a library tile, set up in Studio → Look and feel (whole app, then each library). */
function coversHtml(posters, lk) {
  const c = { show: 'yes', place: 'br', size: 56, count: 3, style: 'angled', x: 0, y: 0, ...(themeNow()?.tileCovers || {}), ...(lk.tileCovers || {}) };
  const list = (posters || []).slice(0, Math.max(1, Math.min(3, +c.count || 3)));
  if (c.show === 'no' || !list.length) return '';
  const [ax, ay] = PLACES[c.place] || PLACES.br;
  const step = c.style === 'fan' ? 0.12 : 0.24; // how far each cover sits from the next, as a share of the stack's width
  const ar = (2 / 3) / (1 - step * (list.length - 1));
  const style = `--ar:${ar.toFixed(3)};--ax:${ax};--ay:${ay};--cov-h:${Math.max(20, Math.min(100, +c.size || 56))}%;--cov-x:${Math.max(-40, Math.min(40, +c.x || 0))}%;--cov-y:${Math.max(-40, Math.min(40, +c.y || 0))}%;--n:${list.length}`;
  return html`<span class="tile-stack st-${['angled', 'flat', 'fan'].includes(c.style) ? c.style : 'angled'}" style="${style}">${list.map((p, i) => html`<img src="${p}"${pic(p)} alt="" loading="lazy" decoding="async" style="--i:${i}">`)}</span>`;
}
let lastTiles = null;
// A new look (from the Studio's live preview, or a season starting) redraws the library tiles on Home.
on('look', () => { const el = $('.libs-wrap'); if (el && lastTiles) { el.outerHTML = String(tilesHtml(lastTiles)); syncArrows(...$$('.libs-wrap')); } });
function tilesHtml(list) {
  if (!list?.length) return '';
  lastTiles = list;
  // "One row you scroll sideways" (Studio → Home page): the tiles become a row like the others, with arrows on computers.
  const row = themeNow()?.homeTiles?.layout === 'row';
  return html`<div class="libs-wrap${row ? ' as-row' : ''}">${row ? html`<button class="arrow l" hidden aria-label="Scroll left" tabindex="-1">‹</button>` : ''}<section class="libs${row ? ' scroller' : ''}" data-count="${list.length}">${list.map((l) => {
    const lk = libraryLook(l.id);
    // The tile's picture is its own: the tile background if one is set, else (unless the tile is told to use the library's
    // artwork) the library page's background, else the newest artwork in the library.
    const bg = tileBg(lk, l.backdrop);
    const style = [bg ? `--tile-bg:url("${String(bg).replace(/"/g, '%22')}")` : '', lk.accent ? `--tile-accent:${lk.accent}` : '', TILE_POS[lk.tilePos] ? `--tile-pos:${TILE_POS[lk.tilePos]}` : ''].filter(Boolean).join(';');
    const [one, many] = NOUN[l.kind] || ['title', 'titles'];
    const noun = l.count === 1 ? one : many;
    // A video plays on the tile while it is pointed at or in focus: the library's own tile video, or its background video.
    const video = isVid(lk.tileVideo) ? lk.tileVideo : isVid(lk.tileBackground) ? lk.tileBackground : lk.tileUse !== 'artwork' && !lk.tileBackground && isVid(lk.background) ? lk.background : '';
    // The slab carries the tile's thickness and 3D turn; the tile inside holds the layers that move at different depths.
    const bright = Number.isFinite(+lk.tileBrightness) && +lk.tileBrightness > 0 ? `;--tile-bright:${Math.max(20, Math.min(160, +lk.tileBrightness)) / 100}` : '';
    return html`<div class="tile-slab"><a class="lib-tile" href="#/library/${l.id}" style="${style}${bright}" aria-label="${l.name}, ${l.count} ${noun}" ${video ? raw(`data-video="${esc(video)}"`) : ''}>
      <span class="tile-fill"></span><span class="tile-art"></span>
      ${coversHtml(l.posters, lk)}
      ${(() => { const ls = logoStyle(lk); return html`<span class="tile-text placed ${lk.logo ? 'has-logo' : ''}" data-align="${ls.align}" style="${ls.style}">${lk.logo ? html`<img class="tile-logo" src="${lk.logo}" alt="">` : html`<b class="tile-name">${l.name}</b>`}
        ${ls.count ? html`<span class="tile-count">${l.count} ${noun}${l.fresh ? html`<em>${l.fresh} new</em>` : ''}</span>` : ''}</span>`; })()}
      <span class="tile-sweep"></span><span class="tile-shine"></span><span class="tile-ring"></span></a></div>`;
  })}</section>${row ? html`<button class="arrow r" aria-label="Scroll right" tabindex="-1">›</button>` : ''}</div>`;
}

function heroHtml(list) {
  if (!list.length) return '';
  return html`<section class="hero" data-count="${list.length}"><div class="bg"></div><div class="bg"></div><div class="content"></div>
    ${list.length > 1 ? html`<div class="dots">${list.map((_, i) => html`<button data-dot="${i}" aria-label="Spotlight ${i + 1}" tabindex="-1"></button>`)}</div>` : ''}</section>`;
}
function startHero(list) {
  clearInterval(heroTimer);
  const hero = $('.hero');
  if (!hero) return;
  let i = -1, layer = 0;
  const show = (n) => {
    i = (n + list.length) % list.length;
    const it = list[i], bgs = $$('.bg', hero);
    layer = 1 - layer;
    bgs[layer].style.backgroundImage = `url("${wide(it.backdrop)}")`;
    // Restart the fade on the next frame instead of forcing a layout now.
    const next = bgs[layer]; next.classList.remove('on'); bgs[1 - layer].classList.remove('on');
    requestAnimationFrame(() => requestAnimationFrame(() => next.classList.add('on')));
    const c = $('.content', hero);
    const hadFocus = c.contains(document.activeElement);
    c.classList.remove('swap');
    c.innerHTML = String(html`${it.logo ? html`<img class="logo-art banner-logo" src="${it.logo}" alt="${it.title}">` : html`<h1>${it.title}</h1>`}
      ${metaLine(it)}<p class="overview">${it.tagline || it.overview || ''}</p>
      <div class="actions"><a class="btn primary" href="#/watch/${it.kind === 'movie' ? it.id : ''}" data-play="${it.id}">${icons.play} Play</a>
      <a class="btn" href="#/title/${it.id}">${icons.info} More info</a></div>`);
    requestAnimationFrame(() => requestAnimationFrame(() => c.classList.add('swap')));
    if (hadFocus) $('.btn.primary', c)?.focus();
    $$('.dots button', hero).forEach((d, k) => d.classList.toggle('on', k === i));
    hero.dataset.showing = it.id;
    // Fetch the next title's picture now, so it is ready when the banner moves on (no picture popping in mid-fade).
    const nx = list[(i + 1) % list.length];
    if (nx && nx !== it) { const pre = new Image(); pre.decoding = 'async'; pre.src = wide(nx.backdrop); }
    feel.tint(hero, it.backdrop); feel.wash(it.backdrop); feel.queueTrailer(hero, it);
  };
  hero.show = show;
  show(0);
  if (list.length > 1) heroTimer = setInterval(() => { if (document.body.classList.contains('tv') && performance.now() - (window.hfLastKey || 0) < 12000) return; /* TVs: the banner never changes while you are moving around */ if (feel.trailerPlaying() && (hero.beats = (hero.beats || 0) + 1) < 5) return; hero.beats = 0; if (!hero.matches(':hover') && !hero.contains(document.activeElement) && !document.hidden && !$('#overlay').childElementCount && $('#player').hidden && !$('.surprise')) show(i + 1); }, 9000);
}

/** Show or hide each row's arrows. All the measuring happens before any change, so the page is laid out once, not once per row. */
export function syncArrows(...rows) {
  // A whole page of rows waits until it has been drawn, so measuring it costs nothing and never delays the first paint.
  if (rows.length > 1 && !syncArrows.now) { requestAnimationFrame(() => setTimeout(() => { syncArrows.now = true; syncArrows(...rows.filter((r) => r.isConnected)); syncArrows.now = false; }, 0)); return; }
  const seen = rows.map((row) => { const sc = $('.scroller', row); return sc && [row, sc.scrollLeft, sc.clientWidth, sc.scrollWidth]; }).filter(Boolean);
  for (const [row, left, width, full] of seen) {
    const l = $('.arrow.l', row), r = $('.arrow.r', row);
    if (l) l.hidden = left < 10;
    if (r) r.hidden = left + width > full - 10;
  }
}

// ---------- shell ----------
// Which sidebar icon each kind of library uses (TV).
const KIND_ICON = { movies: 'film', shows: 'tv', books: 'book', comics: 'comic', music: 'music', audiobooks: 'book' };

/** Whether a menu feature is on for this profile (an admin can turn features off per profile in Studio → Profiles). */
export const can = (key) => !(state.boot?.access?.off || []).includes(key);

export function shell() {
  const p = state.profile;
  app().innerHTML = String(html`
    <header class="nav"><a class="logo" href="#/" aria-label="Home"><img data-site-logo src="${logoUrl()}" alt="${themeNow()?.siteName || 'HallFlix'}"></a>
      <nav class="links"><a href="#/" data-nav="home"><i class="ico">${icons.home}</i><span>Home</span></a>${state.libraries.map((l) => html`<a href="#/library/${l.id}" data-nav="library-${l.id}"><i class="ico">${KIND_ICON[l.kind] ? icons[KIND_ICON[l.kind]] : icons.film}</i><span>${l.name}</span></a>`)}${can('timeline') ? html`<a href="#/timeline" data-nav="timeline"><i class="ico">${icons.clock}</i><span>Timeline</span></a>` : ''}${can('me') ? html`<a href="#/me" data-nav="me"><i class="ico">${icons.user}</i><span>My HallFlix</span></a>` : ''}</nav>
      ${can('surprise') ? html`<button class="btn round navbtn" data-surprise aria-label="Surprise me" title="Surprise me">${icons.dice}</button>` : ''}
      ${can('search') ? html`<div class="search"><i class="ico" aria-hidden="true">${icons.search}</i><input type="search" placeholder="Titles, people, genres" aria-label="Search" autocomplete="off">${browse.canListen() ? html`<button class="mic" data-mic aria-label="Search by voice" title="Search by voice">${icons.mic}</button>` : ''}</div>` : html`<div class="search-gap"></div>`}
      <button class="avatar" style="${avatarStyle(p)}" aria-label="Profile menu" data-menu>${p.avatar ? html`<img src="${p.avatar}" alt="" style="width:100%;height:100%;border-radius:8px;object-fit:cover">` : p.name[0].toUpperCase()}</button>
    </header><main id="view"></main>`);
  initRows();
  addEventListener('scroll', () => $('.nav')?.classList.toggle('solid', scrollY > 30), { passive: true });
  let timer;
  $('.search input')?.addEventListener('input', (e) => {
    clearTimeout(timer);
    const qv = e.target.value.trim();
    timer = setTimeout(() => { location.hash = qv ? `#/search/${encodeURIComponent(qv)}` : '#/'; }, 160);
  });
  app().addEventListener('click', onClick);
  // Rows scrolled sideways update their arrows at most once a frame.
  const moved = new Set(); let frame = 0;
  app().addEventListener('scroll', (e) => {
    const row = e.target.closest?.('.row, .libs-wrap');
    if (!row) return;
    moved.add(row);
    frame ||= requestAnimationFrame(() => { frame = 0; syncArrows(...moved); moved.clear(); });
  }, { capture: true, passive: true });
  app().addEventListener('change', (e) => {
    if (e.target.matches('[data-sort]')) { base.sort = e.target.value; loadLibrary(true); }
    if (e.target.matches('[data-decade]')) { base.decade = e.target.value; loadLibrary(true); }
    if (e.target.matches('[data-cert]')) { base.cert = e.target.value; loadLibrary(true); }
  });
}

async function onClick(e) {
  const t = e.target;
  const arrow = t.closest('.arrow');
  if (arrow) { const sc = $('.scroller', arrow.parentElement); sc.scrollBy({ left: (arrow.classList.contains('l') ? -1 : 1) * sc.clientWidth * 0.86 }); return; }
  const dot = t.closest('[data-dot]');
  if (dot) { $('.hero').show(+dot.dataset.dot); return; }
  const play = t.closest('[data-play]');
  if (play && !play.getAttribute('href').match(/\d+$/)) { // a show: ask which episode is next
    e.preventDefault();
    try { const d = await api('GET', `/api/items/${play.dataset.play}`); location.hash = `#/watch/${d.playId}`; } catch (err) { toast(err.message); }
    return;
  }
  const chip = t.closest('.chip[data-genre]');
  if (chip) { base.genre = chip.dataset.genre || ''; loadLibrary(true); return; }
  const tab = t.closest('[data-tab]');
  if (tab && base?.name === 'library') { base.tab = tab.dataset.tab; try { sessionStorage.setItem(`hf_tab_${base.arg}`, base.tab); } catch { /* fine */ } await show('library', base.arg); scrollTo(0, 0); return; }
  const sg = t.closest('[data-seegenre]');
  if (sg && base?.name === 'library') { e.preventDefault(); Object.assign(base, { tab: 'browse', genre: sg.dataset.seegenre, status: '', decade: '', cert: '', letter: '' }); await show('library', base.arg); scrollTo(0, 0); return; }
  const fb = t.closest('[data-status],[data-letter],[data-size],[data-clearf]');
  if (fb && base?.name === 'library') {
    if (fb.dataset.size) { try { localStorage.setItem('hf_cardsize', fb.dataset.size); } catch { /* fine */ } const g = $('.grid'); if (g) g.className = `grid size-${fb.dataset.size}`; for (const b of $$('[data-size]')) b.classList.toggle('on', b === fb); return; }
    if (fb.matches('[data-clearf]')) Object.assign(base, { genre: '', status: '', decade: '', cert: '', letter: '' });
    else if (fb.dataset.status != null) base.status = fb.dataset.status;
    else base.letter = fb.dataset.letter;
    for (const b of $$('[data-status]')) b.classList.toggle('on', b.dataset.status === base.status);
    if (!$('.grid')) { const v = view().querySelector('.empty.grid'); if (v) v.outerHTML = `<div class="grid size-${cardSize()}"></div>`; }
    loadLibrary(true);
    return;
  }
  const pa = t.closest('[data-playalbum]');
  if (pa) { e.preventDefault(); e.stopPropagation(); media.playAlbum(+pa.dataset.playalbum); return; }
  if (t.closest('[data-surprise]')) { browse.surprise(base?.mood ? { mood: base.mood } : {}); return; }
  if (t.closest('[data-mic]')) { browse.listen($('.search input')); return; }
  if (t.closest('[data-dismiss]')) { const a = t.closest('.announce'); try { sessionStorage.setItem('hf_ann', a.textContent); } catch { /* fine */ } a.remove(); return; }
  const mood = t.closest('[data-mood]');
  if (mood && base?.name === 'home') { base.mood = mood.dataset.mood; for (const b of $$('.mood[data-mood]')) b.classList.toggle('on', b === mood); await drawRows(); return; }
  if (t.closest('[data-menu]')) { toggleMenu(); return; }
  if (!t.closest('.menu')) $('.menu')?.remove();
  const act = t.closest('[data-do]')?.dataset.do;
  if (act === 'signout' || act === 'switch') { await api('POST', '/api/logout'); location.hash = '#/'; location.reload(); }
  if (act === 'server') window.HallFlixNative?.changeServer();
  if (act === 'nativetv') { window.HallFlixNative?.setNativeTv?.(true); $('.menu')?.remove(); location.hash = '#/'; dispatchEvent(new Event('hallflix-native-closed')); return; }
  if (act === 'downloads') { $('.menu')?.remove(); openDownloads(); return; }
  if (act === 'fx') {
    try { localStorage.setItem('hf_fx', effectsOff() ? 'on' : 'off'); } catch { /* private mode */ }
    $('.menu')?.remove();
    const t = themeNow() || {};
    startEffect(effectsOff() ? 'none' : t.effect || 'none', t.effectDensity);
    toast(effectsOff() ? 'Seasonal effects off on this device' : 'Seasonal effects on'); return;
  }
  if (act === 'previews') { more.setPreviews(!more.previewsOn()); $('.menu')?.remove(); toast(more.previewsOn() ? 'Previews on' : 'Previews off'); }
  if (act === 'sounds') { feel.setSounds(!feel.soundsOn()); $('.menu')?.remove(); toast(feel.soundsOn() ? 'Sounds on' : 'Sounds off'); }
  if (act === 'profile') { $('.menu')?.remove(); profileEdit.editProfile(); return; }

}

function toggleMenu() {
  if ($('.menu')) return $('.menu').remove();
  const p = state.profile;
  $('.nav').insertAdjacentHTML('beforeend', String(html`<div class="menu"><div class="who">Signed in as <b>${p.name}</b></div>
    ${can('editProfile') ? html`<button data-do="profile">Edit profile</button>` : ''}<button data-do="switch">Switch profile</button>${p.admin ? html`<a href="/studio">Open the Studio</a><a href="/studio#profiles">Manage profiles</a>` : ''}
    ${can('me') ? html`<a href="#/me">My HallFlix</a>` : ''}${can('remote') ? html`<a href="#/remote">Remote for another screen</a>` : ''}${can('wrapped') ? html`<a href="#/wrapped">Your year in review</a>` : ''}
    ${themeNow()?.previews !== false && !document.body.classList.contains('tv') ? html`<button data-do="previews">${more.previewsOn() ? 'Turn previews off' : 'Turn previews on'}</button>` : ''}${themeNow()?.effect && themeNow().effect !== 'none' && !document.body.classList.contains('tv') ? html`<button data-do="fx">${effectsOff() ? 'Turn seasonal effects on' : 'Turn seasonal effects off'}</button>` : ''}${feel.soundsAvailable() ? html`<button data-do="sounds">${feel.soundsOn() ? 'Turn sounds off' : 'Turn sounds on'}</button>` : ''}
    ${canDownload() ? html`<button data-do="downloads">Downloads</button>` : ''}${window.HallFlixNative ? html`<button data-do="server">Change server</button>` : ''}${window.HallFlixNative?.setNativeTv && document.body.classList.contains('tv') && !window.HallFlixNative.nativeTvOn?.() ? html`<button data-do="nativetv">Use the fast TV screens</button>` : ''}<button data-do="signout">Sign out</button></div>`));
  $('.menu button').focus();
  for (const a of $$('.menu a')) a.addEventListener('click', () => $('.menu')?.remove());
}

function setNav(key) { for (const a of $$('.nav .links a')) a.classList.toggle('on', a.dataset.nav === key); }

// ---------- pages ----------
// Pages behind a menu feature: a profile with the feature turned off lands on Home instead.
const FEATURE_PAGE = { me: 'me', timeline: 'timeline', search: 'search', remote: 'remote', wrapped: 'wrapped', pair: 'remote' };
export async function show(name, arg) {
  if (FEATURE_PAGE[name] && !can(FEATURE_PAGE[name])) { location.replace('#/'); return; }
  if (name === 'library' && state.libraries.length && !state.libraries.some((l) => l.id === +arg)) { location.replace('#/'); return; }
  clearInterval(heroTimer);
  stale = false;
  const keepY = base && base.name === name && base.arg === arg ? scrollY : 0;
  feel.stopTrailer();
  if (name !== 'home') feel.wash(null);
  const same = base?.name === name && base?.arg === arg;
  const keepF = (k, d = '') => (same ? base[k] ?? d : d);
  base = { name, arg, sort: keepF('sort', 'title'), genre: keepF('genre'), status: keepF('status'), decade: keepF('decade'), cert: keepF('cert'), letter: keepF('letter'), tab: keepF('tab'), mood: name === 'home' ? base?.mood || '' : '' };
  const draw = async () => {
   try {
    if (name === 'library') await library(+arg);
    else if (name === 'me') { setNav('me'); applyLook(state.look, null); await more.hub(view(), rowHtml); syncArrows(...$$('.row')); }
    else if (name === 'person') { setNav(''); applyLook(state.look, null); await more.person(view(), decodeURIComponent(arg || '')); }
    else if (name === 'remote') { setNav(''); applyLook(state.look, null); await more.remote(view()); }
    else if (name === 'pair') { setNav(''); applyLook(state.look, null); await more.pairApprove(view(), arg || ''); }
    else if (name === 'playlist') { setNav(''); applyLook(state.look, null); await media.playlist(view(), arg === 'liked' ? 'liked' : +arg); }
    else if (name === 'search') await search(decodeURIComponent(arg || ''));
    else if (name === 'list') await myList();
    else if (name === 'timeline') { setNav('timeline'); applyLook(state.look, null); await browse.timeline(view(), arg); }
    else if (name === 'collection') { setNav(''); applyLook(state.look, null); await browse.collection(view(), +arg); }
    else if (name === 'wrapped') { setNav(''); applyLook(state.look, null); await browse.wrapped(view(), arg); }
    else await home();
   } catch (e) { view().innerHTML = String(html`<div class="page"><div class="empty"><h2>Something went wrong</h2><p>${e.message}</p></div></div>`); }
   scrollTo(0, keepY);
  };
  // Pages cross-fade into each other where the browser can do it cheaply; TVs and reduced-motion get a plain swap.
  const smooth = document.startViewTransition && !same && !document.body.classList.contains('tv') && !matchMedia('(prefers-reduced-motion: reduce)').matches && !state.preview;
  if (smooth) { try { await document.startViewTransition(draw).updateCallbackDone; } catch { /* drawn anyway */ } } else await draw();
  emit('route', { name, arg });
}

async function home() {
  setNav('home'); applyLook(state.look, null);
  const data = await api('GET', `/api/home${document.body.classList.contains('tv') ? '?lite=1' : ''}`);
  const rows = [...data.rows];
  for (const x of extraRows) {
    try { const items = typeof x.load === 'function' ? await x.load() : x.items; if (items?.length) rows.splice(Math.min(rows.length, x.position ?? rows.length), 0, { id: x.id, title: x.title, items, shape: x.shape }); }
    catch (e) { console.error('[plugin row]', x.id, e); }
  }
  if (!rows.length && !data.spotlight.length && !data.libraries?.length) {
    view().innerHTML = String(html`<div class="page"><div class="empty"><h2>Your library is empty</h2>
      <p>${state.profile.admin ? raw('Add your movie and show folders in the Studio and they will appear here as soon as the first scan finishes.<br><br><a class="btn primary" href="/studio#libraries">Open the Studio</a>') : 'Nothing has been added yet. Check back soon.'}</p></div></div>`);
    return;
  }
  base.home = { data, rows };
  let ann = data.announcement;
  try { if (ann && sessionStorage.getItem('hf_ann')?.startsWith(ann.text)) ann = null; } catch { /* fine */ }
  view().innerHTML = String(html`${heroHtml(data.spotlight)}<div class="${data.spotlight.length ? 'rows' : 'page'}">${browse.announcement(ann)}${browse.moodBar(data.moods, base.mood)}<div id="homerows"></div></div>`);
  startHero(data.spotlight);
  await drawRows();
}

/** The rows under the spotlight: the Studio's layout, or one mood's picks when the dial is turned. */
async function drawRows() {
  const box = $('#homerows');
  if (!box || !base.home) return;
  const { data, rows } = base.home;
  let out;
  if (base.mood) {
    let m;
    try { m = await api('GET', `/api/mood/${base.mood}`); } catch (e) { toast(e.message); return; }
    out = m.rows.length ? m.rows.map(rowHtml) : [html`<div class="empty"><p>Nothing in the library fits that mood yet.</p></div>`];
  } else {
    out = rows.map(rowHtml);
    const extra = [[data.layout?.collectionsAt ?? -1, browse.collectionsRow(data.collections)], [data.layout?.tilesAt ?? 0, tilesHtml(data.libraries)]];
    for (const [at, piece] of extra.sort((x, y) => y[0] - x[0])) if (at >= 0 && piece) out.splice(Math.min(at, out.length), 0, piece);
  }
  if (!$('#homerows')) return;
  box.innerHTML = String(html`${out}`);
  syncArrows(...$$('.row, .libs-wrap'));
}

async function library(id) {
  setNav(`library-${id}`); applyLook(state.look, id);
  const lib = state.libraries.find((l) => l.id === id);
  const lk = libraryLook(id);
  if (lib?.kind === 'music') return media.musicLibrary(view(), lib, lk, base);
  if (lib?.kind === 'comics') return comics.comicsLibrary(view(), lib, lk, base, syncArrows);
  if (lib?.kind === 'movies' || lib?.kind === 'shows') return videoLibrary(lib, lk);
  const sorts = lib?.kind === 'books' ? [['title', 'A to Z'], ['author', 'Author'], ['added', 'Recently added'], ['year', 'Newest first']]
    : lib?.kind === 'comics' ? [['title', 'A to Z'], ['added', 'Recently updated'], ['year', 'Newest first']]
      : [['title', 'A to Z'], ['added', 'Recently added'], ['year', 'Newest first'], ['score', 'Top rated']];
  view().innerHTML = String(html`<div class="page"><div class="lib-head">
      ${libTitle(lib, lk)}
      <span class="count"></span>${backdrop.button(lib)}
      <select data-sort aria-label="Sort">${sorts.map(([v, n]) => html`<option value="${v}">${n}</option>`)}</select>
    </div><div class="chips"></div><div class="grid"></div><div class="sentinel" style="height:1px"></div></div>`);
  $('[data-sort]').value = base.sort;
  await loadLibrary(true);
  const io = new IntersectionObserver((en) => { if (en[0].isIntersecting) loadLibrary(false); }, { rootMargin: '900px' });
  io.observe($('.sentinel'));
}
// ---------- movie and show libraries: "For you" (a spotlight and rows) and "Browse all" (filters and a grid) ----------
const TABS = [['home', 'For you'], ['browse', 'Browse all']];
const STATUS = [['', 'All'], ['unwatched', 'Unwatched'], ['inprogress', 'In progress'], ['watched', 'Watched']];
const VSORTS = [['title', 'A to Z'], ['added', 'Recently added'], ['released', 'Release date'], ['year', 'Newest first'], ['score', 'Top rated'], ['unseen', 'Unwatched first'], ['runtime', 'Shortest'], ['longest', 'Longest']];
const SIZES = [['s', 'Smaller'], ['m', 'Medium'], ['l', 'Bigger']];
const cardSize = () => { try { return localStorage.getItem('hf_cardsize') || 'm'; } catch { return 'm'; } };
async function videoLibrary(lib, lk) {
  if (!base.tab) { try { base.tab = sessionStorage.getItem(`hf_tab_${lib.id}`) || 'home'; } catch { base.tab = 'home'; } }
  const home = base.tab === 'home';
  const bar = html`<div class="vlib-bar">${libTitle(lib, lk)}
    <div class="tabs" role="tablist">${TABS.map(([k, n]) => html`<button role="tab" data-tab="${k}" aria-selected="${base.tab === k}" class="${base.tab === k ? 'on' : ''}">${n}</button>`)}</div>
    <span class="count"></span>${backdrop.button(lib)}</div>`;
  if (home) {
    let d;
    try { d = await api('GET', `/api/videos/${lib.id}${document.body.classList.contains('tv') ? '?lite=1' : ''}`); } catch (e) { toast(e.message); return; }
    if (base.name !== 'library' || +base.arg !== lib.id) return;
    if (!d.total) { base.tab = 'browse'; return videoLibrary(lib, lk); }
    view().innerHTML = String(html`<div class="vlib home ${d.spotlight.length ? 'has-hero' : ''}">${bar}${heroHtml(d.spotlight)}
      <div class="${d.spotlight.length ? 'rows' : 'page rows-plain'}">${d.rows.map((r) => (r.genre ? { ...r, title: raw(`${esc(r.title)} <button class="seeall" data-seegenre="${esc(r.genre)}">See all ›</button>`) } : r)).map(rowHtml)}</div></div>`);
    $('.vlib .count').textContent = plural(d.total, NOUN[lib.kind]);
    startHero(d.spotlight);
    syncArrows(...$$('.row'));
    return;
  }
  const size = cardSize();
  view().innerHTML = String(html`<div class="vlib browse page">${bar}
    <div class="filters">
      <div class="seg" role="group" aria-label="Watched">${STATUS.map(([v, n]) => html`<button data-status="${v}" class="${base.status === v ? 'on' : ''}">${n}</button>`)}</div>
      <select data-decade aria-label="Decade"><option value="">Any year</option></select>
      <select data-cert aria-label="Age rating"><option value="">Any rating</option></select>
      <select data-sort aria-label="Sort">${VSORTS.map(([v, n]) => html`<option value="${v}">${n}</option>`)}</select>
      <div class="seg sizes" role="group" aria-label="Card size">${SIZES.map(([v, n]) => html`<button data-size="${v}" class="${size === v ? 'on' : ''}" aria-label="${n}" title="${n}"><i class="sz-${v}"></i></button>`)}</div>
      <button class="linkbtn clearf" data-clearf hidden>Clear filters</button>
    </div>
    <div class="chips"></div>
    <div class="az" aria-label="Jump to letter"></div>
    <div class="grid size-${size}"></div><div class="sentinel" style="height:1px"></div></div>`);
  $('[data-sort]').value = VSORTS.some(([v]) => v === base.sort) ? base.sort : 'title';
  await loadLibrary(true);
  const io = new IntersectionObserver((en) => { if (en[0].isIntersecting) loadLibrary(false); }, { rootMargin: '900px' });
  io.observe($('.sentinel'));
}
const filtersOn = () => !!(base.genre || base.status || base.decade || base.cert || base.letter);

async function loadLibrary(reset) {
  if (base.name !== 'library' || base.loading) return;
  if (reset) { base.offset = 0; base.done = false; }
  if (base.done) return;
  base.loading = true;
  try {
    const f = new URLSearchParams({ sort: base.sort, genre: base.genre, offset: base.offset, limit: 72 });
    for (const k of ['status', 'decade', 'cert', 'letter']) if (base[k]) f.set(k, base[k]);
    const d = await api('GET', `/api/library/${base.arg}?${f}`);
    let grid = $('.grid');
    if (!grid) return;
    if (reset) {
      if (grid.classList.contains('empty')) { grid.outerHTML = `<div class="grid${d.facets ? ` size-${cardSize()}` : ''}"></div>`; grid = $('.grid'); }
      grid.innerHTML = '';
      $('.count').textContent = plural(d.total, NOUN[d.library.kind] || ['title', 'titles']);
      if (d.facets) {
        const fill = (sel, list, cur, label) => { const el = $(sel); if (!el) return; el.innerHTML = String(html`<option value="">${label}</option>${list.map((x) => html`<option value="${x}" ${String(cur) === String(x) ? raw('selected') : ''}>${sel === '[data-decade]' ? `${x}s` : x}</option>`)}`); el.hidden = list.length < 2 && !cur; };
        fill('[data-decade]', d.facets.decades, base.decade, 'Any year');
        fill('[data-cert]', d.facets.certs, base.cert, 'Any rating');
        const az = $('.az');
        if (az) az.innerHTML = String(html`${d.facets.letters.length > 4 ? html`<button data-letter="" class="${base.letter ? '' : 'on'}" aria-label="All letters">All</button>${d.facets.letters.map((l) => html`<button data-letter="${l}" class="${base.letter === l ? 'on' : ''}">${l}</button>`)}` : ''}`);
        $('[data-clearf]').hidden = !filtersOn();
      }
      $('.chips').innerHTML = String(html`<button class="chip ${base.genre ? '' : 'on'}" data-genre="">All</button>${d.genres.map((g) => html`<button class="chip ${base.genre === g ? 'on' : ''}" data-genre="${g}">${g}</button>`)}`);
      if (!d.total) grid.outerHTML = filtersOn() ? '<div class="empty grid"><p>Nothing matches those filters.</p><button class="btn" data-clearf>Clear filters</button></div>' : '<div class="empty grid"><p>Nothing here yet. If you just added this library, the first scan may still be running.</p></div>';
    }
    $('.grid')?.insertAdjacentHTML('beforeend', String(html`${d.items.map((it) => cardHtml(it))}`));
    base.offset += d.items.length;
    base.done = base.offset >= d.total || !d.items.length;
  } finally { base.loading = false; }
}

async function search(term) {
  setNav(''); applyLook(state.look, null);
  const input = $('.search input');
  if (input && document.activeElement !== input) input.value = term;
  if (!term.trim()) { // opened from the TV's Search button: ready to type
    view().innerHTML = String(html`<div class="page"><div class="lib-head"><h1>Search</h1></div><div class="empty"><p>Type a title, a person or a genre, or describe what you want, like “funny movies from the 90s under two hours”.</p></div></div>`);
    input?.focus();
    return;
  }
  const d = await api('GET', `/api/search?q=${encodeURIComponent(term)}`);
  view().innerHTML = String(html`<div class="page"><div class="lib-head"><h1>Results for “${term}”</h1></div>
    ${d.understood?.length ? html`<p class="understood">Showing ${d.understood.map((u) => html`<span class="chip on">${u}</span>`)}</p>` : ''}
    ${d.items.length ? html`<div class="grid">${d.items.map((it) => cardHtml(it))}</div>` : html`<div class="empty"><p>No titles, people or genres match that. You can also describe what you want, like “funny movies from the 90s under two hours”.</p></div>`}</div>`);
}

async function myList() {
  setNav('me'); applyLook(state.look, null);
  const d = await api('GET', '/api/home');
  const row = d.rows.find((r) => r.id === 'mylist');
  view().innerHTML = String(html`<div class="page"><div class="lib-head"><h1>My List</h1></div>
    ${row ? html`<div class="grid">${row.items.map((it) => cardHtml(it))}</div>` : html`<div class="empty"><p>Add titles with the + button and they will wait for you here.</p></div>`}</div>`);
}

// ---------- title sheet ----------
export function closeTitle() { const o = $('#overlay'); if (o.childElementCount) { o.innerHTML = ''; document.body.classList.remove('locked'); } }

export async function title(id) {
  const o = $('#overlay');
  let d;
  try { d = await api('GET', `/api/items/${id}`); } catch (e) { toast(e.message); history.back(); return; }
  if (SHELF.has(d.kind)) { media.sheet(o, d, id); feel.grow($('.sheet', o)); feel.tint($('.sheet', o), d.poster); return; }
  const resume = d.kind === 'movie' ? d.progress : d.playProgress;
  const resuming = resume && !resume.watched && resume.position > 20;
  const playText = d.kind === 'show' ? `${resuming ? 'Resume' : 'Play'} ${d.playLabel || ''}` : resuming ? 'Resume' : 'Play';
  const left = resuming && resume.duration ? Math.max(0, resume.duration - resume.position) : 0;
  const pct = resuming && resume.duration ? Math.min(100, (resume.position / resume.duration) * 100) : 0;
  const langs = (list) => [...new Set((list || []).map((a) => langLabel(a.lang)).filter(Boolean))];
  const audio = langs(d.media?.audio), subs = langs([...(d.media?.subs || []), ...(d.media?.found || [])]);
  const ch = Math.max(0, ...(d.media?.audio || []).map((a) => a.channels || 0));
  const atmos = (d.media?.audio || []).some((a) => /truehd|atmos/i.test(`${a.codec} ${a.title || ''}`));
  const badges = [d.media?.quality === '4K' ? '4K' : d.media?.quality === 'HD' ? 'HD' : '', d.media?.hdr ? 'HDR' : '', atmos ? 'Atmos' : ch >= 8 ? '7.1' : ch >= 6 ? '5.1' : '', subs.length ? 'CC' : ''].filter(Boolean);
  const season = d.seasons?.find((s) => s.episodes.some((e) => e.id === (d.focus || d.playId))) || d.seasons?.find((s) => s.number > 0) || d.seasons?.[0];
  const tabs = [d.seasons ? ['episodes', 'Episodes'] : null, d.similar.length ? ['similar', 'More like this'] : null, ['details', 'Details']].filter(Boolean);
  const runtime = d.kind === 'movie' && d.runtime ? fmtRuntime(d.runtime) : '';
  const info = [
    ['Released', d.premiered ? new Date(`${d.premiered}T12:00:00`).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : d.year],
    ['Run time', runtime], ['Rated', d.rating], [d.kind === 'show' ? 'Network' : 'Studio', (d.studios || []).join(', ')],
    ['Seasons', d.seasons ? `${d.seasons.filter((x) => x.number > 0).length || d.seasons.length} (${d.episodeCount} episodes)` : ''], ['Genres', d.genres.join(', ')],
  ].filter(([, v]) => v);
  o.innerHTML = String(html`<article class="sheet" data-id="${d.id}">
    <button class="btn round close" data-x aria-label="Close">${icons.x}</button>
    <div class="top" style="${d.backdrop ? `background-image:url('${wide(d.backdrop)}')` : ''}"><div class="in">
      ${d.logo ? html`<img class="logo-art" src="${d.logo}" alt="${d.title}">` : html`<h1>${d.title}</h1>`}
      <div class="topmeta">${metaLine(d, [d.kind === 'show' ? `${d.seasons.length} season${d.seasons.length === 1 ? '' : 's'}` : ''].filter(Boolean))}
        ${badges.length ? html`<span class="badges">${badges.map((b) => html`<span class="fmt">${b}</span>`)}</span>` : ''}</div>
      <div class="actions">
        ${d.playId ? html`<a class="btn primary playbig ${pct ? 'resuming' : ''}" href="#/watch/${d.playId}">${icons.play}<span>${playText}${left ? html`<small>${fmtRuntime(left)} left</small>` : ''}</span>${pct ? html`<i class="pbar" style="--p:${pct}%"></i>` : ''}</a>` : ''}
        ${resuming ? html`<a class="btn" href="#/watch/${d.playId}?t=0">From the start</a>` : ''}
        <button class="btn round ${d.inList ? 'on' : ''}" data-list aria-label="My List" title="My List">${d.inList ? icons.check : icons.plus}</button>
        <button class="btn round" data-seen aria-label="Mark as watched" title="Mark as watched or unwatched">${icons.eye}</button>
        ${canDownload() && d.kind === 'movie' && d.playId ? html`<button class="btn dl" data-dl="${d.playId}">${raw(DL_ICON)}<span>Download</span></button>` : ''}
        ${d.trailer ? html`<a class="btn" target="_blank" rel="noopener" href="https://www.youtube.com/watch?v=${d.trailer}">${icons.trailer} Trailer</a>` : ''}
        ${d.kind === 'movie' && d.playId && !window.HallFlixNative ? html`<a class="btn" href="#/watch/${d.playId}?night=1" title="Dims the room, plays the opening and starts from the beginning">${raw(MOON)} Movie night</a>` : ''}
        ${state.profile.admin ? html`<span class="manage"><button class="btn round" data-manage aria-label="Remove or delete" title="Remove or delete" aria-haspopup="menu">${raw(TRASH)}</button></span>` : ''}
      </div></div></div>
    <div class="body">
      <div class="ratings-slot" aria-live="polite"></div>
      <div class="cols"><div>
        ${d.tagline ? html`<p class="tagline">${d.tagline}</p>` : ''}<p class="overview">${d.overview || 'No description yet.'}</p></div>
      <div class="facts">${d.people.length ? html`<div><b>Starring</b> ${d.people.slice(0, 4).map((x, i) => html`${i ? ', ' : ''}<a href="#/person/${encodeURIComponent(x.name)}">${x.name}</a>`)}</div>` : ''}
        ${d.genres.length ? html`<div><b>Genres</b> ${d.genres.slice(0, 3).map((g, i) => html`${i ? ', ' : ''}<span>${g}</span>`)}</div>` : ''}
        ${audio.length ? html`<div><b>Audio</b> ${audio.slice(0, 4).join(', ')}${audio.length > 4 ? ` +${audio.length - 4}` : ''}</div>` : ''}
        ${subs.length ? html`<div><b>Subtitles</b> ${subs.slice(0, 4).join(', ')}${subs.length > 4 ? ` +${subs.length - 4}` : ''}</div>` : ''}</div></div>
      ${d.people.length ? html`<h3 class="cast-h">Cast &amp; crew</h3>` : ''}
      ${d.people.length ? html`<div class="cast">${d.people.map((x) => html`<a href="#/person/${encodeURIComponent(x.name)}">${x.photo ? html`<img loading="lazy" decoding="async" src="${x.photo}"${pic(x.photo)} alt="">` : html`<div class="ph">${x.name.split(' ').map((w) => w[0]).slice(0, 2).join('')}</div>`}${x.name}<small>${x.role}</small></a>`)}</div>` : ''}
      <div class="stabs" role="tablist">${tabs.map(([k, n], i) => html`<button role="tab" data-stab="${k}" class="${i ? '' : 'on'}" aria-selected="${!i}">${n}</button>`)}</div>
      ${d.seasons ? html`<section class="spane" data-pane="episodes">
        ${d.seasons.length > 1 ? html`<div class="seasons" role="tablist">${d.seasons.map((s) => html`<button data-season="${s.id}" class="${s === season ? 'on' : ''}">${s.title}</button>`)}</div>` : ''}
        <div class="season-bar"><span class="muted season-info"></span><button class="linkbtn" data-seasonseen></button>${canDownload() ? html`<button class="linkbtn" data-dlseason>${raw(DL_ICON)} Download season</button>` : ''}</div>
        <div class="episodes"></div></section>` : ''}
      ${d.similar.length ? html`<section class="spane" data-pane="similar" ${tabs[0][0] === 'similar' ? '' : raw('hidden')}><div class="similar">${d.similar.map((it) => cardHtml(it))}</div></section>` : ''}
      <section class="spane details" data-pane="details" ${tabs[0][0] === 'details' ? '' : raw('hidden')}>
        <div class="dgrid">
          <div><h4>Information</h4><dl>${info.map(([k, v]) => html`<dt>${k}</dt><dd>${v}</dd>`)}</dl></div>
          <div><h4>Languages</h4><dl>${audio.length ? html`<dt>Audio</dt><dd>${audio.join(', ')}</dd>` : ''}<dt>Subtitles</dt><dd>${subs.length ? subs.join(', ') : 'None yet'}${state.boot?.media?.subtitles?.search ? html`<br><small class="muted">More can be found from the subtitles button while it plays.</small>` : ''}</dd></dl></div>
          <div><h4>Picture and sound</h4><dl>${d.media?.quality ? html`<dt>Video</dt><dd>${d.media.quality}${d.media.hdr ? ' · HDR' : ''}</dd>` : ''}${(d.media?.audio || []).slice(0, 4).map((a, i) => html`<dt>${i ? '' : 'Sound'}</dt><dd>${[langLabel(a.lang), String(a.codec || '').toUpperCase(), a.channels ? (a.channels >= 8 ? '7.1' : a.channels >= 6 ? '5.1' : a.channels === 2 ? 'Stereo' : a.channels === 1 ? 'Mono' : `${a.channels} ch`) : ''].filter(Boolean).join(' · ')}</dd>`)}</dl></div>
          <div class="dlinks"><h4>Elsewhere</h4><div class="links"></div></div>
        </div></section>
    </div></article>`);
  document.body.classList.add('locked');
  feel.grow($('.sheet', o)); feel.tint($('.sheet', o), d.backdrop || d.poster);
  // Ratings come a moment later (the first time, HallFlix asks the rating services).
  ratings.load(d.id).then((r) => {
    if (!o.contains($('.ratings-slot', o)) || $('.sheet', o)?.dataset.id !== String(d.id)) return;
    $('.ratings-slot', o).innerHTML = String(ratings.strip(r.ratings));
    const L = r.links || {};
    $('.dlinks .links', o).innerHTML = String(html`${[['IMDb', L.imdb], ['TMDb', L.tmdb], ['Letterboxd', L.letterboxd], ['Trakt', L.trakt]].filter(([, u]) => u).map(([n, u]) => html`<a class="btn sm" href="${u}" target="_blank" rel="noopener">${n} ↗</a>`)}`);
  }).catch(() => { /* no ratings */ });
  let cur = season;
  const eps = (s) => {
    cur = s;
    const watchedN = s.episodes.filter((e) => e.progress?.watched).length;
    $('.season-info', o).textContent = `${s.episodes.length} episode${s.episodes.length === 1 ? '' : 's'}${watchedN ? ` · ${watchedN === s.episodes.length ? 'all watched' : `${watchedN} watched`}` : ''}`;
    $('[data-seasonseen]', o).textContent = watchedN === s.episodes.length ? 'Mark season as unwatched' : 'Mark season as watched';
    $('.episodes', o).innerHTML = String(html`${s.episodes.map((e) => {
      const pct = e.progress && !e.progress.watched && e.progress.duration ? (e.progress.position / e.progress.duration) * 100 : 0;
      const next = e.id === d.playId;
      const aired = e.premiered ? new Date(`${e.premiered}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';
      return html`<div class="ep-wrap">${state.profile.admin ? html`<button class="ep-manage" data-remove="${e.id}" aria-label="Remove or delete episode ${e.number}" title="Remove or delete this episode">${raw(TRASH)}</button>` : ''}${canDownload() ? html`<button class="ep-dl" data-dl="${e.id}" aria-label="Download episode ${e.number}" title="Download to watch offline">${raw(DL_ICON)}<span hidden>Download</span></button>` : ''}<a class="episode ${e.id === (d.focus || d.playId) ? 'focus' : ''} ${e.progress?.watched ? 'watched' : ''}" href="#/watch/${e.id}"><div class="n">${e.number}</div>
        <div class="still">${e.still ? html`<img loading="lazy" src="${e.still}" alt="">` : ''}<span class="eplay">${icons.play}</span>${pct ? html`<div class="bar"><i style="width:${pct}%"></i></div>` : ''}${e.progress?.watched ? html`<div class="seen">✓</div>` : ''}</div>
        <div><div class="t"><span>${e.title}${next ? html` <em class="upnext-tag">${resuming ? 'Resume' : 'Up next'}</em>` : ''}</span><small>${fmtRuntime(e.runtime)}</small></div>
          <div class="epmeta">${[aired, e.score ? `★ ${e.score.toFixed(1)}` : ''].filter(Boolean).join(' · ')}</div><p>${e.overview || ''}</p></div></a></div>`; })}`);
    markSaved(o);
  };
  if (season) eps(season);
  o.onchange = null;
  const after = (removedId) => {
    markStale();
    if (removedId === d.id) { if (/^#\/title\//.test(location.hash)) history.back(); else closeTitle(); }
    else title(id);
  };
  o.onclick = async (e) => {
    if (e.target === o || e.target.closest('[data-x]')) { if (history.length > 1) history.back(); else location.hash = '#/'; return; }
    const st = e.target.closest('[data-stab]');
    if (st) { for (const b of $$('[data-stab]', o)) { b.classList.toggle('on', b === st); b.setAttribute('aria-selected', b === st); } for (const p of $$('.spane', o)) p.hidden = p.dataset.pane !== st.dataset.stab; return; }
    const sb = e.target.closest('[data-season]');
    if (sb) { for (const b of $$('[data-season]', o)) b.classList.toggle('on', b === sb); eps(d.seasons.find((x) => x.id === +sb.dataset.season)); return; }
    if (e.target.closest('[data-seasonseen]') && cur) {
      const all = cur.episodes.every((x) => x.progress?.watched);
      await api('POST', '/api/watched', { itemId: cur.id, watched: !all }).catch((err) => toast(err.message));
      toast(all ? `${cur.title} marked as unwatched` : `${cur.title} marked as watched`); markStale(); title(id);
      return;
    }
    const mg = e.target.closest('[data-manage]');
    if (mg) {
      const wrap = mg.parentElement, open = $('.mmenu', wrap);
      if (open) { open.remove(); return; }
      const season = d.seasons && d.seasons.length > 1 ? cur : null;
      wrap.insertAdjacentHTML('beforeend', String(html`<div class="mmenu" role="menu">
        <button role="menuitem" data-remove="${d.id}">${d.kind === 'show' ? 'This whole show' : 'This movie'}</button>
        ${season ? html`<button role="menuitem" data-remove="${season.id}">${season.title} only</button>` : ''}</div>`));
      $('.mmenu button', wrap).focus();
      return;
    }
    const rm = e.target.closest('[data-remove]');
    if (rm) { e.preventDefault(); $('.mmenu', o)?.remove(); removeDialog(+rm.dataset.remove, after); return; }
    const list = e.target.closest('[data-list]');
    if (list) {
      d.inList = !d.inList; list.classList.toggle('on', d.inList); list.innerHTML = d.inList ? icons.check : icons.plus;
      await api('POST', '/api/mylist', { itemId: d.id, on: d.inList }).catch((err) => toast(err.message));
      toast(d.inList ? 'Added to My List' : 'Removed from My List'); markStale();
    }
    const cast = e.target.closest('[data-cast]');
    if (cast) { castTo(+cast.dataset.cast); return; }
    const dl = e.target.closest('[data-dl]');
    if (dl) { e.preventDefault(); onDownloadClick(dl, { title: d.kind === 'movie' ? d.title : undefined }); return; }
    if (e.target.closest('[data-dlseason]') && cur) { download(cur.episodes.map((x) => x.id), { title: `${d.title} · ${cur.title}` }); return; }
    if (e.target.closest('[data-seen]')) {
      const all = d.kind === 'movie' ? !!d.progress?.watched : d.seasons.every((s) => s.episodes.every((x) => x.progress?.watched));
      await api('POST', '/api/watched', { itemId: d.id, watched: !all }).catch((err) => toast(err.message));
      toast(all ? 'Marked as unwatched' : 'Marked as watched'); markStale(); title(id);
    }
  };
  o.scrollTop = 0;
  ($('.episode.focus', o) && d.focus ? $('.episode.focus', o) : $('.btn.primary', o))?.focus({ preventScroll: !d.focus });
  addCastButton(o, d.playId); // "Play on TV", when a HallFlix TV signed in as this profile is on
  markSaved(o);
}

const LANG_NAMES = { en: 'English', eng: 'English', es: 'Spanish', spa: 'Spanish', fr: 'French', fre: 'French', fra: 'French', de: 'German', ger: 'German', deu: 'German', it: 'Italian', ita: 'Italian',
  ja: 'Japanese', jpn: 'Japanese', ko: 'Korean', kor: 'Korean', pt: 'Portuguese', por: 'Portuguese', 'pt-br': 'Portuguese (Brazil)', zh: 'Chinese', chi: 'Chinese', zho: 'Chinese', ru: 'Russian', rus: 'Russian',
  hi: 'Hindi', hin: 'Hindi', ar: 'Arabic', ara: 'Arabic', nl: 'Dutch', dut: 'Dutch', nld: 'Dutch', sv: 'Swedish', swe: 'Swedish', pl: 'Polish', pol: 'Polish', tr: 'Turkish', tur: 'Turkish' };
const langLabel = (l) => (!l || l === 'und' ? '' : LANG_NAMES[String(l).toLowerCase()] || String(l).toUpperCase());

// ---------- removing titles (admins) ----------
const MOON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>';
const TRASH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>';
const gb = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n >= 1e6 ? `${Math.round(n / 1e6)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);

/** Ask how to remove a title: forget it in HallFlix (files stay) or delete the files from the NAS. */
async function removeDialog(itemId, done) {
  let p;
  try { p = await api('GET', `/api/studio/items/${itemId}/remove`); } catch (e) { toast(e.message); return; }
  const back = document.activeElement;
  const box = document.createElement('div');
  box.className = 'confirm';
  const what = { movie: 'movie', show: 'show', season: 'season', episode: 'episode' }[p.kind];
  const show = (step) => {
    box.innerHTML = String(step === 'delete' ? html`<div class="panel danger" role="alertdialog" aria-modal="true" aria-labelledby="cf-h">
        <h2 id="cf-h">Delete ${p.title} from the NAS?</h2>
        <p>This permanently deletes ${p.files} file${p.files === 1 ? '' : 's'} (${gb(p.size)}). HallFlix cannot bring ${p.files === 1 ? 'it' : 'them'} back.</p>
        <ul class="paths">${p.targets.slice(0, 6).map((t) => html`<li>${t.folder ? 'Folder ' : ''}${t.path}</li>`)}${p.targets.length > 6 ? html`<li>and ${p.targets.length - 6} more</li>` : ''}</ul>
        <div class="actions"><button class="btn" data-back>Go back</button><button class="btn danger" data-go="delete">Delete ${p.files} file${p.files === 1 ? '' : 's'}</button></div></div>`
      : html`<div class="panel" role="dialog" aria-modal="true" aria-labelledby="cf-h">
        <h2 id="cf-h">Remove ${p.title}?</h2>
        <div class="choices">
          <button class="choice" data-go="hide"><b>Remove from HallFlix</b><span>The ${what} disappears for everyone. Its files stay on the NAS, and you can bring it back from Studio → Libraries.</span></button>
          <button class="choice ${p.canDelete ? '' : 'off'}" ${p.canDelete ? raw('data-step="delete"') : raw('aria-disabled="true"')}><b>Delete from the NAS</b>
            <span>${p.canDelete ? `Deletes ${p.files} file${p.files === 1 ? '' : 's'} (${gb(p.size)}) for good.` : 'Not available: HallFlix has read-only access to your media folder. The install guide explains how to allow deleting.'}</span></button>
        </div>
        <div class="actions"><button class="btn" data-x>Cancel</button></div></div>`);
    $('[data-go],[data-back]', box)?.focus();
  };
  const close = () => { box.remove(); back?.focus?.(); };
  box.onclick = async (e) => {
    if (e.target === box || e.target.closest('[data-x]')) return close();
    if (e.target.closest('[data-back]')) return show('choose');
    if (e.target.closest('[data-step]')) return show('delete');
    const go = e.target.closest('[data-go]');
    if (!go) return;
    for (const b of $$('button', box)) b.disabled = true;
    go.textContent = go.dataset.go === 'delete' ? 'Deleting…' : 'Removing…';
    try {
      const r = await api('POST', `/api/studio/items/${itemId}/${go.dataset.go}`, {});
      toast(go.dataset.go === 'delete' ? `Deleted ${r.title} from the NAS` : `Removed ${r.title} from HallFlix`);
      box.remove();
      done(itemId);
    } catch (err) { toast(err.message); show('choose'); }
  };
  box.onkeydown = (e) => { if (e.key === 'Escape' || e.key === 'Backspace' && e.target.tagName !== 'INPUT') { e.stopPropagation(); close(); } };
  document.body.append(box);
  show('choose');
}

// ---------- sign-in and first run ----------
// ── Which server the Android app connects to (sign-in screen) ──
// Only in the app (a browser is already at an address of its own choosing), and only in apps new enough to switch.
function serverInfo() {
  try { return window.HallFlixNative?.serverInfo ? JSON.parse(window.HallFlixNative.serverInfo()) : null; } catch { return null; }
}
const SERVER_MODES = { auto: 'Automatic', home: 'Home (Tailscale)', away: 'Internet' };
function serverLink() {
  const s = !state.signinPreview && serverInfo();
  if (!s) return '';
  const now = s.home ? 'Home (Tailscale)' : s.current.replace(/^https?:\/\//, '');
  return html`<button class="linkbtn" data-server>Server: ${now}${s.mode === 'auto' ? ' (auto)' : ''}</button>`;
}
function serverChooser(box, back) {
  const s = serverInfo();
  if (!s) return;
  const opt = (m, label, sub) => html`<button class="server-opt${s.mode === m ? ' on' : ''}" data-mode="${m}"><b>${label}${s.mode === m ? ' ✓' : ''}</b><small>${sub}</small></button>`;
  box.innerHTML = String(html`<h1 style="text-align:center">Connect to</h1>
    <div class="server-opts">
      ${opt('auto', SERVER_MODES.auto, `Home when it answers, otherwise ${s.away.replace(/^https?:\/\//, '')}`)}
      ${s.direct ? opt('home', SERVER_MODES.home, `${s.direct.replace(/^https?:\/\//, '')}: fastest, needs the Tailscale app connected`) : ''}
      ${opt('away', SERVER_MODES.away, `${s.away.replace(/^https?:\/\//, '')}: works anywhere`)}
      <button class="server-opt" data-other><b>Another address…</b><small>Type in a server address</small></button>
    </div>
    <div class="alt"><button class="linkbtn" data-back>Back</button></div>`);
  for (const b of box.querySelectorAll('[data-mode]')) {
    b.onclick = () => {
      if (b.dataset.mode === s.mode) { back(); return; }
      toast(`Connecting to ${SERVER_MODES[b.dataset.mode]}…`);
      window.HallFlixNative.useServer(b.dataset.mode);
    };
  }
  box.querySelector('[data-other]').onclick = () => window.HallFlixNative.changeServer();
  box.querySelector('[data-back]').onclick = back;
  box.querySelector(`[data-mode="${s.mode}"]`)?.focus();
}

export function login(boot) {
  applyLook(boot.look, null);
  const tiles = boot.profiles?.length;
  const preview = !!state.signinPreview; // drawn inside the Studio's live preview: nothing signs in
  const box = () => $('.login .box');
  const formFor = (p) => {
    box().innerHTML = String(html`<form class="form">${p ? html`<h1 style="text-align:center;margin-bottom:6px">Hi, ${p.name}</h1>` : html`<label>Name<input name="name" autocomplete="username" required></label>`}
      <label>Password or PIN<input name="password" type="password" autocomplete="current-password" ${preview ? '' : raw('required')}></label>
      <div class="err"></div><button class="btn primary">Sign in</button></form>
      <div class="alt">${tiles ? html`<button class="linkbtn" data-back>Choose a different profile</button>` : ''}<button class="linkbtn" data-pair data-default="Sign in with your phone instead">Sign in with your phone instead</button>${serverLink()}</div>
      <div class="signin-foot" hidden></div>`);
    styleLogin();
    $('[data-pair]').onclick = () => (preview ? toast('This is a preview') : more.pairScreen(box(), tiles ? picker : () => formFor(null)));
    const form = $('.login form');
    if (!preview) $(p ? '[name=password]' : '[name=name]', form).focus();
    form.onsubmit = async (e) => {
      e.preventDefault();
      if (preview) { toast('This is a preview: signing in is switched off here'); return; }
      const f = new FormData(form);
      try {
        await api('POST', '/api/login', { profileId: p?.id, name: f.get('name'), password: f.get('password') });
        feel.sound('signin');
        try { sessionStorage.setItem('hf_welcome', 'signin'); } catch { /* private mode */ }
        // The welcome ident can keep the sign-in music going (it picks up where it was after the page reloads);
        // otherwise the music bows out before the app loads.
        const S = themeNow()?.splash || {}, carry = S.video && S.when !== 'never' && S.when !== 'open' && splashAudio(S) === 'music' ? musicNow() : null;
        if (carry) { try { sessionStorage.setItem('hf_music_carry', JSON.stringify(carry)); } catch { /* private mode */ } }
        else await fadeOutLoginMusic();
        if (!/^#\/(party|pair)\//.test(location.hash)) location.hash = '#/';
        location.reload();
      }
      catch (err) { $('.err', form).textContent = err.message; $('[name=password]', form).select(); }
    };
    $('[data-back]')?.addEventListener('click', picker);
    $('[data-server]')?.addEventListener('click', () => serverChooser(box(), () => formFor(p)));
  };
  const picker = () => {
    box().innerHTML = String(html`<h1 data-login-title></h1>
      <div class="who">${boot.profiles.map((p) => html`<button data-p="${p.id}"><div class="avatar" style="${avatarStyle(p)}">${p.avatar ? html`<img src="${p.avatar}" alt="">` : p.name[0].toUpperCase()}</div>${p.name}</button>`)}</div>
      <div class="alt"><button class="linkbtn" data-manual>Sign in with name and password</button><button class="linkbtn" data-pair data-default="Sign in with your phone">Sign in with your phone</button>${serverLink()}</div>
      <div class="signin-foot" hidden></div>`);
    styleLogin();
    $('[data-manual]').onclick = () => formFor(null);
    $('[data-pair]').onclick = () => (preview ? toast('This is a preview') : more.pairScreen(box(), picker));
    $('[data-server]')?.addEventListener('click', () => serverChooser(box(), picker));
    for (const b of $$('.who button')) b.onclick = () => formFor(boot.profiles.find((p) => p.id === +b.dataset.p));
    if (!preview) $('.who button')?.focus();
  };
  // The logo sits outside the box, so it can go above it, inside its panel, in a corner, or nowhere.
  app().innerHTML = String(html`<div class="login signin"><div class="side-fade" aria-hidden="true"></div><div class="stack"><img class="brand" src="${logoUrl()}" alt=""><div class="box"></div></div></div>`);
  styleLogin();
  if (tiles) picker(); else formFor(null);
  startLoginMusic(themeNow(), { preview });
}

export function setup() {
  app().innerHTML = String(html`<div class="login"><div class="box"><img class="brand" src="/assets/logo.png" alt="HallFlix">
    <h1>Welcome. Let's set up HallFlix.</h1>
    <form class="form"><label>Your name<input name="name" required autocomplete="username"></label>
      <label>Password<input name="password" type="password" minlength="4" required autocomplete="new-password"></label>
      <label>TMDb API key (optional)<input name="tmdbKey" autocomplete="off" spellcheck="false"></label>
      <p class="hint">The key lets HallFlix fetch posters, backdrops and descriptions. Either the short “API Key” or the long “Read Access Token” works. You can add it later in the Studio.</p>
      <div class="err"></div><button class="btn primary">Create my profile</button></form></div></div>`);
  const form = $('form');
  $('[name=name]', form).focus();
  form.onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(form));
    try {
      const out = await api('POST', '/api/setup', f);
      if (out.tmdbOk === false) alert('Your profile was created, but TMDb did not accept that key. You can fix it in the Studio under Settings.');
      location.href = '/studio#libraries';
    } catch (err) { $('.err', form).textContent = err.message; }
  };
}
