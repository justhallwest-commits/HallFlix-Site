// The comics section: a library front page in the style of the big comic apps (a spotlight on what you're reading,
// Up next, new issues, a row per publisher, then every series with read-status filters), and the series page
// (how far you've got, issues in either order as a grid or a list, hide what you've read, mark read up to here).
import * as backdrop from './backdrop.js';
import { $, $$, api, html, raw, icons, toast } from './core.js';

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const bg = (u) => (u ? `background-image:url("${String(u).replace(/"/g, '%22')}")` : '');
const pct = (p) => (p && p.duration ? Math.round(Math.min(1, p.position / p.duration) * 100) : 0);
const num = (it) => (it.number != null ? `#${it.number}` : '');
const pref = (k, d) => { try { return localStorage.getItem(`hf_cx_${k}`) ?? d; } catch { return d; } };
const setPref = (k, v) => { try { localStorage.setItem(`hf_cx_${k}`, v); } catch { /* private mode */ } };
const STACK = raw('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="7" y="3" width="12" height="16" rx="1.5"/><path d="M4 7v12.5A1.5 1.5 0 0 0 5.5 21H15"/></svg>');
const MORE = raw('<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5.5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="18.5" cy="12" r="1.8"/></svg>');
const SORT = raw('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4v16M3.5 16.5 7 20l3.5-3.5M17 20V4M13.5 7.5 17 4l3.5 3.5"/></svg>');
const LIST = icons.list;
const GRID = raw('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/></svg>');

/** One issue: the cover, how far you've got, and its series and number underneath. */
export function issueCard(it, { series = true } = {}) {
  const p = it.progress, reading = p && !p.watched && p.position > 0;
  const top = series ? it.seriesTitle || it.title : num(it) || it.title;
  const sub = series ? [num(it), it.title !== `${it.seriesTitle} ${num(it)}` ? it.title : ''].filter(Boolean).join(' · ') : it.number != null && !/#\d/.test(it.title) ? it.title : plural(it.pages || 0, 'page');
  return html`<a class="card book k-comic cx-issue" href="#/read/${it.id}" data-id="${it.id}" title="${top} ${num(it)}">
    <div class="art"><div class="fallback">${top}<small>${num(it)}</small></div>
      ${it.poster ? html`<img loading="lazy" decoding="async" src="${it.poster}" alt="" onload="this.classList.add('in')" onerror="this.remove()">` : ''}
      ${reading ? html`<div class="bar"><i style="width:${pct(p)}%"></i></div>` : ''}${p?.watched ? html`<div class="seen">✓</div>` : ''}
      ${it.number != null ? html`<span class="cx-num">${num(it)}</span>` : ''}</div>
    <div class="cx-cap"><b>${top}</b><small>${reading ? `${pct(p)}% read` : sub}</small></div></a>`;
}

/** One series: covers stacked like a pile of issues, how many are unread, and a bar for how far through you are. */
export function seriesCard(it) {
  const total = it.count || 0, read = it.read || 0, started = read > 0 || (it.reading || 0) > 0;
  const unread = Math.max(0, total - read);
  const sub = !started ? plural(total, 'issue') : read >= total ? 'Finished' : `${read} of ${total} read`;
  return html`<a class="card book k-series cx-series ${total > 1 ? 'stacked' : ''}" href="#/title/${it.id}" data-id="${it.id}" title="${it.title}">
    ${total > 1 ? raw('<span class="cx-pile" aria-hidden="true"></span>') : ''}<div class="art"><div class="fallback">${it.title}${it.author ? html`<small>${it.author}</small>` : ''}</div>
      ${it.poster ? html`<img loading="lazy" decoding="async" src="${it.poster}" alt="" onload="this.classList.add('in')" onerror="this.remove()">` : ''}
      ${started && read < total ? html`<div class="bar"><i style="width:${(read / Math.max(1, total)) * 100}%"></i></div>` : ''}
      ${started && read >= total ? html`<div class="seen">✓</div>` : unread && started ? html`<span class="cx-badge" title="${unread} unread">${unread}</span>` : ''}</div>
    <div class="cx-cap"><b>${it.title}</b><small>${sub}${it.publisher ? ` · ${it.publisher}` : ''}</small></div></a>`;
}

const row = (title, items, card, id) => (items?.length ? html`<section class="row cx-row" data-row="${id}"><h2>${title}</h2>
  <button class="arrow l" hidden aria-label="Scroll left" tabindex="-1">‹</button><div class="scroller">${items.map((x) => card(x))}</div>
  <button class="arrow r" aria-label="Scroll right" tabindex="-1">›</button></section>` : '');

// ---------- the library front page ----------
export async function comicsLibrary(view, lib, lk, base, syncArrows) {
  const st = { status: pref('status', ''), publisher: '', sort: pref('sort', 'title'), genre: '', offset: 0, total: 0, done: false, loading: false };
  const d = await api('GET', `/api/comics/${lib.id}`);
  const spot = d.continue[0] || null;
  const hero = spot ? html`<section class="cx-hero"><div class="cx-hero-bg" style="${bg(spot.poster)}"></div>
      <a class="cx-hero-cover" href="#/read/${spot.id}" tabindex="-1"><img src="${spot.poster}" alt=""></a>
      <div class="cx-hero-info"><p class="cx-kicker">Continue reading</p><h1>${spot.seriesTitle} <span>${num(spot)}</span></h1>
        ${spot.title && spot.title !== `${spot.seriesTitle} ${num(spot)}` ? html`<p class="cx-sub">${spot.title}</p>` : ''}
        <div class="cx-progress"><div class="bar"><i style="width:${pct(spot.progress)}%"></i></div><span>Page ${Math.max(1, Math.floor(spot.progress.position))} of ${spot.progress.duration} · ${pct(spot.progress)}%</span></div>
        <div class="actions"><a class="btn primary" href="#/read/${spot.id}">${icons.book} Resume</a><a class="btn" href="#/title/${spot.seriesId}">${STACK} Series</a></div></div>
      ${d.upNext.length ? html`<aside class="cx-hero-next"><h3>Up next</h3>${d.upNext.slice(0, 3).map((x) => html`<a href="#/read/${x.id}" class="cx-mini"><img src="${x.poster}" alt="" loading="lazy"><span><b>${x.seriesTitle}</b><small>${[num(x), x.title !== `${x.seriesTitle} ${num(x)}` ? x.title : ''].filter(Boolean).join(' · ')}</small></span></a>`)}</aside>` : ''}</section>`
    : d.start ? html`<section class="cx-hero"><div class="cx-hero-bg" style="${bg(d.start.poster)}"></div>
      <a class="cx-hero-cover" href="#/title/${d.start.id}" tabindex="-1"><img src="${d.start.poster}" alt=""></a>
      <div class="cx-hero-info"><p class="cx-kicker">Start something new</p><h1>${d.start.title}</h1>${d.start.author ? html`<p class="cx-sub">by ${d.start.author}</p>` : ''}
        ${d.start.overview ? html`<p class="cx-over">${d.start.overview}</p>` : ''}
        <div class="actions"><a class="btn primary" href="#/title/${d.start.id}">${icons.book} Start reading</a><span class="cx-meta">${plural(d.start.count || 0, 'issue')}</span></div></div></section>` : '';
  view.innerHTML = String(html`<div class="page cx-lib">${hero}
    <div class="lib-head">${lk.logo ? html`<img class="lib-logo" src="${lk.logo}" alt="${lib.name}">` : html`<h1>${lib.name}</h1>`}
      <span class="count">${plural(d.totals.series, 'series', 'series')} · ${plural(d.totals.issues, 'issue')}${d.totals.read ? ` · ${d.totals.read} read` : ''}</span>${backdrop.button(lib)}</div>
    ${d.continue.length > 1 ? row('Continue reading', d.continue, issueCard, 'cx-continue') : ''}
    ${row('Up next', d.upNext, issueCard, 'cx-next')}
    ${row('New issues', d.recent, issueCard, 'cx-recent')}
    ${d.newSeries.length > 6 ? row('Recently added series', d.newSeries.slice(0, 18), seriesCard, 'cx-newseries') : ''}
    ${d.publishers.map((p) => row(p.name, p.items, seriesCard, `cx-pub-${p.name}`))}
    <section class="cx-all"><div class="cx-allhead"><h2>All series</h2><span class="count" data-allcount></span>
      <select data-csort aria-label="Sort">${[['title', 'A to Z'], ['updated', 'Recently updated'], ['read', 'Recently read'], ['year', 'Newest first']].map(([v, n]) => html`<option value="${v}" ${st.sort === v ? raw('selected') : ''}>${n}</option>`)}</select>
      <select data-cpub aria-label="Publisher" hidden></select></div>
      <div class="chips cx-status">${[['', 'All'], ['unread', 'Unread'], ['reading', 'In progress'], ['read', 'Finished']].map(([v, n]) => html`<button class="chip ${st.status === v ? 'on' : ''}" data-cstatus="${v}">${n}</button>`)}</div>
      <div class="chips cx-genres"></div><div class="grid cx-grid-all"></div><div class="cx-sentinel" style="height:1px"></div></section></div>`);
  for (const r of $$('.row', view)) syncArrows?.(r);

  const load = async (reset) => {
    if (st.loading || (!reset && st.done)) return;
    if (reset) { st.offset = 0; st.done = false; }
    st.loading = true;
    try {
      const qs = new URLSearchParams({ sort: st.sort, genre: st.genre, status: st.status, publisher: st.publisher, offset: String(st.offset), limit: '60' });
      const res = await api('GET', `/api/library/${lib.id}?${qs}`);
      const grid = $('.cx-grid-all', view);
      if (!grid) return;
      if (reset) {
        grid.innerHTML = '';
        $('[data-allcount]', view).textContent = plural(res.total, 'series', 'series');
        $('.cx-genres', view).innerHTML = res.genres.length > 1 ? String(html`<button class="chip ${st.genre ? '' : 'on'}" data-cgenre="">Every genre</button>${res.genres.map((g) => html`<button class="chip ${st.genre === g ? 'on' : ''}" data-cgenre="${g}">${g}</button>`)}`) : '';
        const pub = $('[data-cpub]', view);
        if (res.publishers?.length > 1 && !pub.options.length) { pub.innerHTML = String(html`<option value="">Every publisher</option>${res.publishers.map((p) => html`<option value="${p}">${p}</option>`)}`); pub.hidden = false; }
        if (!res.total) grid.innerHTML = String(html`<div class="empty"><p>${st.status === 'unread' ? 'You have started every series here.' : st.status === 'reading' ? 'Nothing in progress. Pick something and it will show up here.' : st.status === 'read' ? 'No finished series yet.' : 'Nothing here yet. If you just added this library, the first scan may still be running.'}</p></div>`);
      }
      grid.insertAdjacentHTML('beforeend', String(html`${res.items.map(seriesCard)}`));
      st.offset += res.items.length;
      st.done = st.offset >= res.total || !res.items.length;
    } catch (e) { toast(e.message); } finally { st.loading = false; }
  };
  await load(true);
  const io = new IntersectionObserver((en) => { if (en[0].isIntersecting) load(false); }, { rootMargin: '900px' });
  io.observe($('.cx-sentinel', view));
  const page = $('.cx-lib', view);
  page.addEventListener('click', (e) => {
    const s = e.target.closest('[data-cstatus]');
    if (s) { st.status = s.dataset.cstatus; setPref('status', st.status); for (const b of $$('[data-cstatus]', view)) b.classList.toggle('on', b === s); load(true); return; }
    const g = e.target.closest('[data-cgenre]');
    if (g) { st.genre = g.dataset.cgenre; for (const b of $$('[data-cgenre]', view)) b.classList.toggle('on', b === g); load(true); }
  });
  page.addEventListener('change', (e) => {
    if (e.target.matches('[data-csort]')) { st.sort = e.target.value; setPref('sort', st.sort); load(true); }
    if (e.target.matches('[data-cpub]')) { st.publisher = e.target.value; load(true); }
  });
}

// ---------- the series page ----------
export function seriesBody(d, close, listBtn, facts) {
  const issues = d.issues;
  const read = issues.filter((x) => x.progress?.watched).length;
  const next = issues.find((x) => x.id === d.next);
  const order = pref('order', 'asc'), layout = pref('layout', 'grid'), hideRead = pref('hideread', '0') === '1';
  const years = [...new Set(issues.map((x) => x.year).filter(Boolean))].sort();
  const yearText = years.length > 1 ? `${years[0]}–${years[years.length - 1]}` : years[0] || d.year || '';
  const list = (order === 'desc' ? [...issues].reverse() : issues).filter((x) => !(hideRead && x.progress?.watched));
  const issueRow = (x) => {
    const p = x.progress, reading = p && !p.watched && p.position > 0;
    return html`<div class="cx-irow ${x.id === d.focus ? 'focus' : ''} ${p?.watched ? 'done' : ''}" data-iss="${x.id}"><a href="#/read/${x.id}" class="cx-irow-main">
      <img src="${x.poster}" alt="" loading="lazy" onerror="this.style.visibility='hidden'"><span class="t"><b>${num(x) || x.title}</b><small>${[x.number != null && !/#\d/.test(x.title) ? x.title : '', plural(x.pages || 0, 'page'), x.year].filter(Boolean).join(' · ')}</small>
      ${reading ? html`<span class="bar"><i style="width:${pct(p)}%"></i></span>` : ''}</span>
      <span class="st">${p?.watched ? html`<span class="cx-done">${icons.check} Read</span>` : reading ? `${pct(p)}%` : html`<span class="cx-new">Unread</span>`}</span></a>
      <button class="cx-imore" data-imenu="${x.id}" aria-label="More for ${num(x) || x.title}">${MORE}</button></div>`;
  };
  const issueTile = (x) => html`<div class="cx-itile ${x.id === d.focus ? 'focus' : ''}" data-iss="${x.id}">${issueCard({ ...x, seriesTitle: d.title }, { series: false })}<button class="cx-imore" data-imenu="${x.id}" aria-label="More for ${num(x) || x.title}">${MORE}</button></div>`;
  return html`<div class="m-head book cx-shead">${close}<div class="m-bg" style="${bg(d.poster)}"></div>
      <div class="m-cover book ${issues.length > 1 ? 'cx-stackcover' : ''}">${d.poster ? html`<img src="${d.poster}" alt="">` : html`<span>${d.title}</span>`}</div>
      <div class="m-info"><p class="m-kind">Comic series${d.publisher ? ` · ${d.publisher}` : ''}</p><h1>${d.title}</h1>${d.author ? html`<p class="m-by">by ${d.author}</p>` : ''}
        <div class="meta"><span>${plural(issues.length, 'issue')}</span>${yearText ? html`<span>${yearText}</span>` : ''}${d.genres.slice(0, 3).map((g) => html`<span>${g}</span>`)}</div>
        ${read ? html`<div class="cx-progress"><div class="bar"><i style="width:${(read / issues.length) * 100}%"></i></div><span>${read === issues.length ? 'You have read every issue' : `${read} of ${issues.length} read`}</span></div>` : ''}
        <div class="actions">${next ? html`<a class="btn primary" href="#/read/${next.id}">${icons.book} ${d.resuming ? 'Continue' : read ? 'Read next' : 'Start reading'} ${num(next) || next.title}</a>` : ''}
          ${(d.resuming || read) && issues[0] && next?.id !== issues[0].id ? html`<a class="btn" href="#/read/${issues[0].id}">From ${num(issues[0]) || 'the start'}</a>` : ''}${listBtn}
          <button class="btn round" data-seen aria-label="${read === issues.length ? 'Mark all as unread' : 'Mark all as read'}" title="${read === issues.length ? 'Mark all as unread' : 'Mark all as read'}">${icons.eye}</button></div></div></div>
    <div class="body">${d.overview ? html`<p class="overview">${d.overview}</p>` : ''}${facts([['Writer', d.author], ['Publisher', d.publisher]])}
      <div class="cx-itools"><h3>Issues</h3>
        <button class="chip" data-iorder title="Change the order">${SORT} ${order === 'asc' ? 'First to latest' : 'Latest first'}</button>
        <button class="chip ${hideRead ? 'on' : ''}" data-ihide>${hideRead ? 'Showing unread only' : 'Hide read'}</button>
        <span class="cx-seg"><button class="chip ${layout === 'grid' ? 'on' : ''}" data-ilayout="grid" aria-label="Covers">${GRID}</button><button class="chip ${layout === 'list' ? 'on' : ''}" data-ilayout="list" aria-label="List">${LIST}</button></span></div>
      ${list.length ? (layout === 'list' ? html`<div class="cx-ilist">${list.map(issueRow)}</div>` : html`<div class="grid issues cx-igrid">${list.map(issueTile)}</div>`)
    : html`<div class="empty"><p>You have read every issue. ${raw('<button class="linkbtn" data-ihide>Show them all</button>')}</p></div>`}</div>`;
}

/** Clicks on the series page that belong to the comics tools. Returns true when it handled one. */
export async function seriesClick(e, d, redraw) {
  const t = e.target;
  if (t.closest('[data-iorder]')) { setPref('order', pref('order', 'asc') === 'asc' ? 'desc' : 'asc'); redraw(); return true; }
  if (t.closest('[data-ihide]')) { setPref('hideread', pref('hideread', '0') === '1' ? '0' : '1'); redraw(); return true; }
  const lay = t.closest('[data-ilayout]');
  if (lay) { setPref('layout', lay.dataset.ilayout); redraw(); return true; }
  const m = t.closest('[data-imenu]');
  if (m) { e.preventDefault(); e.stopPropagation(); menu(m, d, redraw); return true; }
  const act = t.closest('[data-iact]');
  if (act) {
    e.preventDefault();
    const id = +act.dataset.id, i = d.issues.findIndex((x) => x.id === id), how = act.dataset.iact;
    const ids = how === 'upto' ? d.issues.slice(0, i + 1).map((x) => x.id) : how === 'from' ? d.issues.slice(i).map((x) => x.id) : [id];
    const watched = how === 'read' || how === 'upto';
    $('.cx-menu')?.remove();
    try {
      await api('POST', '/api/watched', { itemIds: ids, watched });
      toast(how === 'upto' ? `Marked ${plural(ids.length, 'issue')} as read` : how === 'from' ? `Marked ${plural(ids.length, 'issue')} as unread` : watched ? 'Marked as read' : 'Marked as unread');
      redraw(true);
    } catch (err) { toast(err.message); }
    return true;
  }
  if (!t.closest('.cx-menu')) $('.cx-menu')?.remove();
  return false;
}

function menu(btn, d, redraw) {
  $('.cx-menu')?.remove();
  const id = +btn.dataset.imenu, x = d.issues.find((it) => it.id === id);
  if (!x) return;
  const i = d.issues.indexOf(x);
  const box = document.createElement('div');
  box.className = 'cx-menu menu';
  box.innerHTML = String(html`<div class="who">${num(x) || x.title}</div><a href="#/read/${x.id}">${icons.book} ${x.progress && !x.progress.watched && x.progress.position > 0 ? 'Continue' : 'Read'}</a>
    ${x.progress?.watched ? html`<button data-iact="unread" data-id="${id}">Mark as unread</button>` : html`<button data-iact="read" data-id="${id}">Mark as read</button>`}
    ${i > 0 ? html`<button data-iact="upto" data-id="${id}">Mark read up to here</button>` : ''}
    ${i < d.issues.length - 1 ? html`<button data-iact="from" data-id="${id}">Mark unread from here on</button>` : ''}`);
  btn.closest('.m-sheet').append(box);
  const r = btn.getBoundingClientRect(), host = btn.closest('.m-sheet').getBoundingClientRect();
  const above = host.bottom - r.bottom < 230;
  box.style.top = above ? `${r.top - host.top - 6}px` : `${r.bottom - host.top + 6}px`;
  if (above) box.style.transform = 'translateY(-100%)';
  box.style.left = `${Math.max(8, Math.min(host.width - 250, r.right - host.left - 240))}px`;
  $('button, a', box).focus();
}
