// Screens: first-run setup, sign-in, home, libraries, search and the title sheet.
import { $, $$, api, html, raw, esc, icons, state, applyLook, logoUrl, libraryLook, avatarStyle, fmtRuntime, toast, emit } from './core.js';

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

export function cardHtml(it, { wide = false } = {}) {
  const ep = it.kind === 'episode';
  const art = wide || ep ? it.backdrop || it.poster : it.poster;
  const pct = it.progress && !it.progress.watched && it.progress.duration ? Math.min(100, (it.progress.position / it.progress.duration) * 100) : 0;
  const left = pct ? `${fmtRuntime(it.progress.duration - it.progress.position)} left` : '';
  const title = ep ? it.show.title : it.title;
  const sub = ep ? `S${it.show.season} E${it.show.episode} · ${it.title}` : wide ? left || it.year || '' : [it.year, it.rating].filter(Boolean).join(' · ');
  return html`<a class="card ${wide || ep ? 'wide' : ''}" href="#/${wide || ep ? 'watch' : 'title'}/${it.id}" data-id="${it.id}" title="${title}">
    <div class="art"><div class="fallback">${title}</div>
      ${art ? html`<img loading="lazy" decoding="async" src="${art}" alt="" onload="this.classList.add('in')">` : ''}
      ${wide || ep ? html`<div class="playdot"><span>${icons.play}</span></div>` : ''}
      <div class="label">${title}<small>${sub}${ep && left ? ` · ${left}` : ''}</small></div>
      ${pct ? html`<div class="bar"><i style="width:${pct}%"></i></div>` : ''}${it.progress?.watched ? html`<div class="seen">✓</div>` : ''}</div></a>`;
}

const rowHtml = (r) => html`<section class="row ${r.shape === 'wide' ? 'keep' : ''}" data-row="${r.id}">
  <h2>${r.title}${r.library ? html`<a href="#/library/${r.library}">See all ›</a>` : ''}</h2>
  <button class="arrow l" hidden aria-label="Scroll left" tabindex="-1">‹</button>
  <div class="scroller">${r.items.map((it) => cardHtml(it, { wide: r.shape === 'wide' }))}</div>
  <button class="arrow r" aria-label="Scroll right" tabindex="-1">›</button></section>`;

const isVid = (u) => /\.(mp4|webm|m4v|mov)(\?|$)/i.test(u || '');
function tilesHtml(list) {
  if (!list?.length) return '';
  return html`<section class="libs" data-count="${list.length}">${list.map((l) => {
    const lk = libraryLook(l.id);
    const bg = lk.background && !isVid(lk.background) ? lk.background : l.backdrop;
    const style = [bg ? `--tile-bg:url("${String(bg).replace(/"/g, '%22')}")` : '', lk.accent ? `--tile-accent:${lk.accent}` : ''].filter(Boolean).join(';');
    const noun = l.kind === 'movies' ? (l.count === 1 ? 'movie' : 'movies') : l.count === 1 ? 'show' : 'shows';
    return html`<a class="lib-tile" href="#/library/${l.id}" style="${style}" aria-label="${l.name}, ${l.count} ${noun}">
      <span class="tile-art"></span>
      ${l.posters.length ? html`<span class="tile-stack">${l.posters.map((p, i) => html`<img src="${p}" alt="" loading="lazy" style="--i:${i}">`)}</span>` : ''}
      <span class="tile-text">${lk.logo ? html`<img class="tile-logo" src="${lk.logo}" alt="">` : html`<b class="tile-name">${l.name}</b>`}
        <span class="tile-count">${l.count} ${noun}${l.fresh ? html`<em>${l.fresh} new</em>` : ''}</span></span>
      <span class="tile-sweep"></span></a>`;
  })}</section>`;
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
    bgs[layer].style.backgroundImage = `url("${it.backdrop}")`;
    bgs[layer].classList.remove('on'); void bgs[layer].offsetWidth; bgs[layer].classList.add('on'); bgs[1 - layer].classList.remove('on');
    const c = $('.content', hero);
    const hadFocus = c.contains(document.activeElement);
    c.classList.remove('swap');
    c.innerHTML = String(html`${it.logo ? html`<img class="logo-art" src="${it.logo}" alt="${it.title}">` : html`<h1>${it.title}</h1>`}
      ${metaLine(it)}<p class="overview">${it.tagline || it.overview || ''}</p>
      <div class="actions"><a class="btn primary" href="#/watch/${it.kind === 'movie' ? it.id : ''}" data-play="${it.id}">${icons.play} Play</a>
      <a class="btn" href="#/title/${it.id}">${icons.info} More info</a></div>`);
    void c.offsetWidth; c.classList.add('swap');
    if (hadFocus) $('.btn.primary', c)?.focus();
    $$('.dots button', hero).forEach((d, k) => d.classList.toggle('on', k === i));
  };
  hero.show = show;
  show(0);
  if (list.length > 1) heroTimer = setInterval(() => { if (!hero.matches(':hover') && !hero.contains(document.activeElement) && !document.hidden && !$('#overlay').childElementCount && $('#player').hidden) show(i + 1); }, 9000);
}

function syncArrows(row) {
  const sc = $('.scroller', row);
  if (!sc) return;
  $('.arrow.l', row).hidden = sc.scrollLeft < 10;
  $('.arrow.r', row).hidden = sc.scrollLeft + sc.clientWidth > sc.scrollWidth - 10;
}

// ---------- shell ----------
export function shell() {
  const p = state.profile;
  app().innerHTML = String(html`
    <header class="nav"><a class="logo" href="#/" aria-label="Home"><img data-site-logo src="${logoUrl()}" alt="${state.look?.theme?.siteName || 'HallFlix'}"></a>
      <nav class="links"><a href="#/" data-nav="home">Home</a>${state.libraries.map((l) => html`<a href="#/library/${l.id}" data-nav="library-${l.id}">${l.name}</a>`)}<a href="#/list" data-nav="list">My List</a></nav>
      <div class="search"><input type="search" placeholder="Titles, people, genres" aria-label="Search" autocomplete="off"></div>
      <button class="avatar" style="${avatarStyle(p)}" aria-label="Profile menu" data-menu>${p.avatar ? html`<img src="${p.avatar}" alt="" style="width:100%;height:100%;border-radius:8px;object-fit:cover">` : p.name[0].toUpperCase()}</button>
    </header><main id="view"></main>`);
  addEventListener('scroll', () => $('.nav')?.classList.toggle('solid', scrollY > 30), { passive: true });
  let timer;
  $('.search input').addEventListener('input', (e) => {
    clearTimeout(timer);
    const qv = e.target.value.trim();
    timer = setTimeout(() => { location.hash = qv ? `#/search/${encodeURIComponent(qv)}` : '#/'; }, 280);
  });
  app().addEventListener('click', onClick);
  app().addEventListener('scroll', (e) => { const row = e.target.closest?.('.row'); if (row) syncArrows(row); }, true);
  app().addEventListener('change', (e) => { if (e.target.matches('[data-sort]')) { base.sort = e.target.value; loadLibrary(true); } });
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
  const chip = t.closest('.chip');
  if (chip) { base.genre = chip.dataset.genre || ''; loadLibrary(true); return; }
  if (t.closest('[data-menu]')) { toggleMenu(); return; }
  if (!t.closest('.menu')) $('.menu')?.remove();
  const act = t.closest('[data-do]')?.dataset.do;
  if (act === 'signout' || act === 'switch') { await api('POST', '/api/logout'); location.hash = '#/'; location.reload(); }
  if (act === 'server') window.HallFlixNative?.changeServer();
  if (act === 'password') {
    $('.menu')?.remove();
    const current = prompt('Current password'); if (current == null) return;
    const next = prompt('New password (at least 4 characters)'); if (next == null) return;
    try { await api('POST', '/api/password', { current, next }); toast('Password changed'); } catch (err) { toast(err.message); }
  }
}

function toggleMenu() {
  if ($('.menu')) return $('.menu').remove();
  const p = state.profile;
  $('.nav').insertAdjacentHTML('beforeend', String(html`<div class="menu"><div class="who">Signed in as <b>${p.name}</b></div>
    <button data-do="switch">Switch profile</button>${p.admin ? html`<a href="/studio">Open the Studio</a>` : ''}
    <button data-do="password">Change password</button>${window.HallFlixNative ? html`<button data-do="server">Change server</button>` : ''}<button data-do="signout">Sign out</button></div>`));
  $('.menu button').focus();
}

function setNav(key) { for (const a of $$('.nav .links a')) a.classList.toggle('on', a.dataset.nav === key); }

// ---------- pages ----------
export async function show(name, arg) {
  clearInterval(heroTimer);
  stale = false;
  const keepY = base && base.name === name && base.arg === arg ? scrollY : 0;
  base = { name, arg, sort: base?.name === name && base?.arg === arg ? base.sort : 'title', genre: base?.name === name && base?.arg === arg ? base.genre : '' };
  try {
    if (name === 'library') await library(+arg);
    else if (name === 'search') await search(decodeURIComponent(arg || ''));
    else if (name === 'list') await myList();
    else await home();
  } catch (e) { view().innerHTML = String(html`<div class="page"><div class="empty"><h2>Something went wrong</h2><p>${e.message}</p></div></div>`); }
  scrollTo(0, keepY);
  emit('route', { name, arg });
}

async function home() {
  setNav('home'); applyLook(state.look, null);
  const data = await api('GET', '/api/home');
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
  view().innerHTML = String(html`${heroHtml(data.spotlight)}<div class="${data.spotlight.length ? 'rows' : 'page'}">${tilesHtml(data.libraries)}${rows.map(rowHtml)}</div>`);
  startHero(data.spotlight);
  for (const r of $$('.row')) syncArrows(r);
}

async function library(id) {
  setNav(`library-${id}`); applyLook(state.look, id);
  const lib = state.libraries.find((l) => l.id === id);
  const lk = libraryLook(id);
  view().innerHTML = String(html`<div class="page"><div class="lib-head">
      ${lk.logo ? html`<img class="lib-logo" src="${lk.logo}" alt="${lib?.name || ''}">` : html`<h1>${lib?.name || 'Library'}</h1>`}
      <span class="count"></span>
      <select data-sort aria-label="Sort"><option value="title">A to Z</option><option value="added">Recently added</option><option value="year">Newest first</option><option value="score">Top rated</option></select>
    </div><div class="chips"></div><div class="grid"></div><div class="sentinel" style="height:1px"></div></div>`);
  $('[data-sort]').value = base.sort;
  await loadLibrary(true);
  const io = new IntersectionObserver((en) => { if (en[0].isIntersecting) loadLibrary(false); }, { rootMargin: '900px' });
  io.observe($('.sentinel'));
}
async function loadLibrary(reset) {
  if (base.name !== 'library' || base.loading) return;
  if (reset) { base.offset = 0; base.done = false; }
  if (base.done) return;
  base.loading = true;
  try {
    const d = await api('GET', `/api/library/${base.arg}?sort=${base.sort}&genre=${encodeURIComponent(base.genre)}&offset=${base.offset}&limit=72`);
    const grid = $('.grid');
    if (!grid) return;
    if (reset) {
      grid.innerHTML = '';
      $('.count').textContent = `${d.total} ${d.library.kind === 'movies' ? (d.total === 1 ? 'movie' : 'movies') : d.total === 1 ? 'show' : 'shows'}`;
      $('.chips').innerHTML = String(html`<button class="chip ${base.genre ? '' : 'on'}" data-genre="">All</button>${d.genres.map((g) => html`<button class="chip ${base.genre === g ? 'on' : ''}" data-genre="${g}">${g}</button>`)}`);
      if (!d.total) grid.outerHTML = '<div class="empty grid"><p>Nothing here yet. If you just added this library, the first scan may still be running.</p></div>';
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
  const d = await api('GET', `/api/search?q=${encodeURIComponent(term)}`);
  view().innerHTML = String(html`<div class="page"><div class="lib-head"><h1>Results for “${term}”</h1></div>
    ${d.items.length ? html`<div class="grid">${d.items.map((it) => cardHtml(it))}</div>` : html`<div class="empty"><p>No titles, people or genres match that.</p></div>`}</div>`);
}

async function myList() {
  setNav('list'); applyLook(state.look, null);
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
  const resume = d.kind === 'movie' ? d.progress : d.playProgress;
  const resuming = resume && !resume.watched && resume.position > 20;
  const playText = d.kind === 'show' ? `${resuming ? 'Resume' : 'Play'} ${d.playLabel || ''}` : resuming ? 'Resume' : 'Play';
  const audio = [...new Set((d.media?.audio || []).map((a) => a.lang).filter(Boolean))].join(', ');
  const season = d.seasons?.find((s) => s.episodes.some((e) => e.id === (d.focus || d.playId))) || d.seasons?.[0];
  o.innerHTML = String(html`<article class="sheet" data-id="${d.id}">
    <button class="btn round close" data-x aria-label="Close">${icons.x}</button>
    <div class="top" style="${d.backdrop ? `background-image:url('${d.backdrop}')` : ''}"><div class="in">
      ${d.logo ? html`<img class="logo-art" src="${d.logo}" alt="${d.title}">` : html`<h1>${d.title}</h1>`}
      <div class="actions">
        ${d.playId ? html`<a class="btn primary" href="#/watch/${d.playId}">${icons.play} ${playText}</a>` : ''}
        ${resuming ? html`<a class="btn" href="#/watch/${d.playId}?t=0">From the start</a>` : ''}
        <button class="btn round ${d.inList ? 'on' : ''}" data-list aria-label="My List" title="My List">${d.inList ? icons.check : icons.plus}</button>
        <button class="btn round" data-seen aria-label="Mark as watched" title="Mark as watched or unwatched">${icons.eye}</button>
        ${d.trailer ? html`<a class="btn" target="_blank" rel="noopener" href="https://www.youtube.com/watch?v=${d.trailer}">${icons.trailer} Trailer</a>` : ''}
        ${state.profile.admin ? html`<span class="manage"><button class="btn round" data-manage aria-label="Remove or delete" title="Remove or delete" aria-haspopup="menu">${raw(TRASH)}</button></span>` : ''}
      </div></div></div>
    <div class="body"><div class="cols"><div>
        ${metaLine(d, [d.kind === 'show' ? `${d.seasons.length} season${d.seasons.length === 1 ? '' : 's'}` : '', d.media?.quality, d.media?.hdr ? 'HDR' : ''].filter(Boolean))}
        ${d.tagline ? html`<p class="tagline">${d.tagline}</p>` : ''}<p class="overview">${d.overview || 'No description yet.'}</p></div>
      <div class="facts">${d.people.length ? html`<div><b>Cast:</b> ${d.people.slice(0, 4).map((x) => x.name).join(', ')}</div>` : ''}
        ${d.genres.length ? html`<div><b>Genres:</b> ${d.genres.join(', ')}</div>` : ''}${d.studios?.length ? html`<div><b>From:</b> ${d.studios.join(', ')}</div>` : ''}
        ${audio ? html`<div><b>Audio:</b> ${audio.toUpperCase()}</div>` : ''}${d.media?.subs?.length ? html`<div><b>Subtitles:</b> ${d.media.subs.length} track${d.media.subs.length === 1 ? '' : 's'}</div>` : ''}</div></div>
      ${d.seasons ? html`<h3>Episodes ${d.seasons.length > 1 ? html`<select data-season aria-label="Season">${d.seasons.map((s) => html`<option value="${s.id}" ${s === season ? raw('selected') : ''}>${s.title}</option>`)}</select>` : html`<small style="color:var(--muted);font-family:var(--font-body);font-size:14px;font-weight:500">${season?.title || ''}</small>`}</h3><div class="episodes"></div>` : ''}
      ${d.people.length > 4 ? html`<h3>Cast</h3><div class="cast">${d.people.map((x) => html`<div>${x.photo ? html`<img loading="lazy" src="${x.photo}" alt="">` : html`<div class="ph"></div>`}${x.name}<small>${x.role}</small></div>`)}</div>` : ''}
      ${d.similar.length ? html`<h3>More like this</h3><div class="similar">${d.similar.map((it) => cardHtml(it))}</div>` : ''}
    </div></article>`);
  document.body.classList.add('locked');
  const eps = (s) => {
    $('.episodes', o).innerHTML = String(html`${s.episodes.map((e) => {
      const pct = e.progress && !e.progress.watched && e.progress.duration ? (e.progress.position / e.progress.duration) * 100 : 0;
      return html`<div class="ep-wrap">${state.profile.admin ? html`<button class="ep-manage" data-remove="${e.id}" aria-label="Remove or delete episode ${e.number}" title="Remove or delete this episode">${raw(TRASH)}</button>` : ''}<a class="episode ${e.id === (d.focus || d.playId) ? 'focus' : ''}" href="#/watch/${e.id}"><div class="n">${e.number}</div>
        <div class="still">${e.still ? html`<img loading="lazy" src="${e.still}" alt="">` : ''}${pct ? html`<div class="bar"><i style="width:${pct}%"></i></div>` : ''}${e.progress?.watched ? html`<div class="seen">✓</div>` : ''}</div>
        <div><div class="t"><span>${e.title}</span><small>${fmtRuntime(e.runtime)}</small></div><p>${e.overview || ''}</p></div></a></div>`; })}`);
  };
  if (season) eps(season);
  o.onchange = (e) => { if (e.target.matches('[data-season]')) eps(d.seasons.find((s) => s.id === +e.target.value)); };
  const after = (removedId) => {
    markStale();
    if (removedId === d.id) { if (/^#\/title\//.test(location.hash)) history.back(); else closeTitle(); }
    else title(id);
  };
  o.onclick = async (e) => {
    if (e.target === o || e.target.closest('[data-x]')) { if (history.length > 1) history.back(); else location.hash = '#/'; return; }
    const mg = e.target.closest('[data-manage]');
    if (mg) {
      const wrap = mg.parentElement, open = $('.mmenu', wrap);
      if (open) { open.remove(); return; }
      const season = d.seasons && d.seasons.length > 1 ? d.seasons.find((s) => s.id === +($('[data-season]', o)?.value)) : null;
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
    if (e.target.closest('[data-seen]')) {
      const all = d.kind === 'movie' ? !!d.progress?.watched : d.seasons.every((s) => s.episodes.every((x) => x.progress?.watched));
      await api('POST', '/api/watched', { itemId: d.id, watched: !all }).catch((err) => toast(err.message));
      toast(all ? 'Marked as unwatched' : 'Marked as watched'); markStale(); title(id);
    }
  };
  o.scrollTop = 0;
  ($('.episode.focus', o) && d.focus ? $('.episode.focus', o) : $('.btn.primary', o))?.focus({ preventScroll: !d.focus });
}

// ---------- removing titles (admins) ----------
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
export function login(boot) {
  applyLook(boot.look, null);
  const tiles = boot.profiles?.length;
  const formFor = (p) => {
    $('.login .box').innerHTML = String(html`<img class="brand" src="${logoUrl()}" alt="">
      <form class="form">${p ? html`<h1 style="text-align:center;margin-bottom:6px">Hi, ${p.name}</h1>` : html`<label>Name<input name="name" autocomplete="username" required></label>`}
      <label>Password or PIN<input name="password" type="password" autocomplete="current-password" required></label>
      <div class="err"></div><button class="btn primary">Sign in</button></form>
      ${tiles ? html`<button class="linkbtn" data-back>Choose a different profile</button>` : ''}`);
    const form = $('.login form');
    $(p ? '[name=password]' : '[name=name]', form).focus();
    form.onsubmit = async (e) => {
      e.preventDefault();
      const f = new FormData(form);
      try { await api('POST', '/api/login', { profileId: p?.id, name: f.get('name'), password: f.get('password') }); location.hash = '#/'; location.reload(); }
      catch (err) { $('.err', form).textContent = err.message; $('[name=password]', form).select(); }
    };
    $('[data-back]')?.addEventListener('click', picker);
  };
  const picker = () => {
    $('.login .box').innerHTML = String(html`<img class="brand" src="${logoUrl()}" alt=""><h1>Who's watching?</h1>
      <div class="who">${boot.profiles.map((p) => html`<button data-p="${p.id}"><div class="avatar" style="${avatarStyle(p)}">${p.avatar ? html`<img src="${p.avatar}" alt="">` : p.name[0].toUpperCase()}</div>${p.name}</button>`)}</div>`);
    for (const b of $$('.who button')) b.onclick = () => formFor(boot.profiles.find((p) => p.id === +b.dataset.p));
    $('.who button')?.focus();
  };
  app().innerHTML = '<div class="login"><div class="box"></div></div>';
  if (tiles) picker(); else formFor(null);
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
