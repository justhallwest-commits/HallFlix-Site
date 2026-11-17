// The personal hub, cast pages, previews on focus, the screensaver, signing a TV in from a phone, and the phone remote.
import { $, $$, api, html, raw, icons, state, themeNow, fmtTime, fmtRuntime, toast, avatarStyle, logoUrl } from './core.js';
import { cardHtml } from './views.js';

const tv = () => document.body.classList.contains('tv');
const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const bgUrl = (u) => `url("${String(u || '').replace(/"/g, '%22')}")`;
const local = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };

// ---------- My HallFlix ----------
export async function hub(view, rowHtml) {
  const d = await api('GET', '/api/me');
  const p = state.profile;
  view.innerHTML = String(html`<div class="page hub"><header class="hub-head"><div class="avatar big" style="${avatarStyle(p)}">${p.avatar ? html`<img src="${p.avatar}" alt="">` : p.name[0].toUpperCase()}</div>
      <div><h1>${d.name}</h1><p class="hub-totals">${[[d.totals.movies, 'movie', 'movies'], [d.totals.episodes, 'episode', 'episodes'], [d.totals.read, 'book or comic', 'books and comics']].filter(([n]) => n)
        .map(([n, one, many]) => html`<span><b>${n}</b> ${n === 1 ? one : many} finished</span>`)}</p>
        <div class="actions"><a class="btn" href="#/wrapped">Your year in review</a><a class="btn" href="#/remote">${icons.people} Remote</a></div></div></header>
    ${d.rows.length ? d.rows.map(rowHtml) : html`<div class="empty"><p>Start something and it will be waiting for you here: what you are watching and reading, your list, and the music you played.</p></div>`}
    ${d.playlists.length ? html`<section class="row"><h2>Playlists</h2><div class="hub-lists">${d.playlists.map((pl) => html`<a class="chip" href="#/playlist/${pl.id}">${pl.name} · ${pl.count}</a>`)}</div></section>` : ''}</div>`);
}

// ---------- cast and crew ----------
export async function person(view, name) {
  let d;
  try { d = await api('GET', `/api/person?name=${encodeURIComponent(name)}`); }
  catch (e) { view.innerHTML = String(html`<div class="page"><div class="empty"><h2>${name}</h2><p>${e.message}</p></div></div>`); return; }
  view.innerHTML = String(html`<div class="page person"><header class="person-head">${d.photo ? html`<img src="${d.photo}" alt="">` : html`<div class="ph">${d.name[0]}</div>`}
      <div><p class="m-kind">In your library</p><h1>${d.name}</h1><p class="count">${d.items.length} title${d.items.length === 1 ? '' : 's'}</p></div></header>
    <div class="person-list">${d.items.map((it) => html`<a class="person-item" href="#/title/${it.id}"><span class="still" style="background-image:${bgUrl(it.backdrop || it.poster)}"></span>
      <span class="t"><b>${it.title}</b><small>${[it.year, it.role ? `as ${it.role}` : ''].filter(Boolean).join(' · ')}</small></span></a>`)}</div></div>`);
}

// ---------- preview on focus ----------
const detail = new Map();
let pvTimer = 0, pv = null;
export const previewsOn = () => themeNow()?.previews !== false && local('hf_previews', '1') !== '0';
export const setPreviews = (on) => { try { localStorage.setItem('hf_previews', on ? '1' : '0'); } catch { /* private mode */ } };
function closePreview() { clearTimeout(pvTimer); if (pv) { pv.remove(); pv = null; } }
async function openPreview(cardEl) {
  const id = +cardEl.dataset.id;
  if (!id || !cardEl.isConnected || !cardEl.matches(':hover')) return;
  let d = detail.get(id);
  if (!d) { try { d = await api('GET', `/api/items/${id}`); detail.set(id, d); if (detail.size > 60) detail.delete(detail.keys().next().value); } catch { return; } }
  if (!cardEl.isConnected || !cardEl.matches(':hover') || !['movie', 'show'].includes(d.kind)) return;
  closePreview();
  const r = cardEl.getBoundingClientRect();
  const w = Math.min(420, Math.max(320, r.width * 1.9)), left = Math.max(12, Math.min(innerWidth - w - 12, r.left + r.width / 2 - w / 2));
  const resume = d.kind === 'movie' ? d.progress : d.playProgress;
  const resuming = resume && !resume.watched && resume.position > 20;
  pv = document.createElement('div');
  pv.className = 'preview-pop';
  pv.style.cssText = `left:${left}px;width:${w}px;top:${Math.max(70, Math.min(innerHeight - 340, r.top + r.height / 2 - 170)) + scrollY}px;transform-origin:${r.left + r.width / 2 - left}px 50%`;
  pv.innerHTML = String(html`<a class="pp-art" href="#/title/${d.id}" style="background-image:${bgUrl(d.backdrop || d.poster)}" tabindex="-1">${d.logo ? html`<img src="${d.logo}" alt="">` : ''}</a>
    <div class="pp-body"><div class="actions"><a class="btn primary small" href="#/watch/${d.playId || ''}">${icons.play} ${resuming ? 'Resume' : 'Play'}${d.kind === 'show' && d.playLabel ? ` ${d.playLabel}` : ''}</a>
        <a class="btn small" href="#/title/${d.id}">${icons.info} More</a><button class="btn round small ${d.inList ? 'on' : ''}" data-pp-list aria-label="My List">${d.inList ? icons.check : icons.plus}</button></div>
      <b>${d.title}</b><p class="meta">${d.score ? html`<span class="score">★ ${d.score.toFixed(1)}</span>` : ''}${d.year ? html`<span>${d.year}</span>` : ''}${d.rating ? html`<span class="tag">${d.rating}</span>` : ''}
        ${d.kind === 'movie' && d.runtime ? html`<span>${fmtRuntime(d.runtime)}</span>` : d.seasons ? html`<span>${d.seasons.length} season${d.seasons.length === 1 ? '' : 's'}</span>` : ''}</p>
      <p class="pp-over">${d.tagline || d.overview || ''}</p><p class="pp-genres">${(d.genres || []).slice(0, 3).join(' · ')}</p></div>`);
  document.body.append(pv);
  pv.addEventListener('mouseleave', closePreview);
  pv.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-pp-list]');
    if (b) { e.preventDefault(); d.inList = !d.inList; b.classList.toggle('on', d.inList); b.innerHTML = String(d.inList ? icons.check : icons.plus); await api('POST', '/api/mylist', { itemId: d.id, on: d.inList }).catch(() => {}); toast(d.inList ? 'Added to My List' : 'Removed from My List'); return; }
    if (e.target.closest('a')) closePreview();
  });
  // A muted trailer takes over the picture after a moment.
  if (d.trailer && /^[\w-]{6,20}$/.test(d.trailer) && themeNow()?.heroMotion === 'trailer' && !navigator.connection?.saveData) {
    pvTimer = setTimeout(() => {
      if (!pv) return;
      const f = document.createElement('div'); f.className = 'pp-video';
      f.innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${d.trailer}?autoplay=1&mute=1&controls=0&playsinline=1&rel=0&iv_load_policy=3&disablekb=1&start=8" allow="autoplay; encrypted-media" tabindex="-1" aria-hidden="true" title=""></iframe>`;
      $('.pp-art', pv).append(f);
      setTimeout(() => f.classList.add('on'), 2400);
    }, 1400);
  }
}
function initPreviews() {
  addEventListener('pointerover', (e) => {
    if (e.pointerType === 'touch' || tv() || calm() || !previewsOn() || !$('#player').hidden) return;
    const c = e.target.closest?.('.row .card[href^="#/title/"]:not(.book):not(.square), .grid .card[href^="#/title/"]:not(.book):not(.square)');
    if (pv && (pv.contains(e.target) || c === pv.from)) return;
    clearTimeout(pvTimer);
    if (pv && !pv.contains(e.target)) closePreview();
    if (c && !c.closest('.surprise, .coll-list, .sheet')) pvTimer = setTimeout(() => openPreview(c).then(() => { if (pv) pv.from = c; }), 900);
  }, { passive: true });
  addEventListener('scroll', closePreview, { passive: true, capture: true });
  addEventListener('hashchange', closePreview);
  addEventListener('keydown', closePreview);
}

// ---------- screensaver ----------
let idleTimer = 0, saver = null, saverTick = 0;
function stopSaver() { if (!saver) return false; clearInterval(saverTick); saver.remove(); saver = null; return true; }
async function startSaver() {
  const mode = themeNow()?.screensaver || 'tv';
  if (saver || mode === 'off' || (mode === 'tv' && !tv()) || !state.profile || state.preview || document.hidden) return;
  if (!$('#player').hidden || !$('#reader').hidden || document.body.classList.contains('music-on') && !tv() || $('.confirm, .surprise')) return arm();
  let list;
  try { list = (await api('GET', '/api/screensaver')).filter((x) => x.image); } catch { return; }
  if (list.length < 2) return;
  saver = document.createElement('div');
  saver.className = 'saver';
  saver.innerHTML = String(html`<div class="sv-bg"></div><div class="sv-bg"></div><div class="sv-info"><img src="${logoUrl()}" alt=""><b></b><small></small></div><div class="sv-clock"></div>`);
  document.body.append(saver);
  let i = -1, layer = 0;
  const next = () => {
    i = (i + 1) % list.length; layer = 1 - layer;
    const bgs = $$('.sv-bg', saver), it = list[i];
    bgs[layer].style.backgroundImage = bgUrl(it.image); bgs[layer].classList.add('on'); bgs[1 - layer].classList.remove('on');
    $('.sv-info b', saver).textContent = it.title || '';
    $('.sv-info small', saver).textContent = it.sub || '';
    $('.sv-clock', saver).textContent = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  };
  next();
  saverTick = setInterval(next, 12000);
}
function arm() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(startSaver, 5 * 60e3);
}
function initSaver() {
  for (const ev of ['keydown', 'pointerdown', 'pointermove', 'wheel', 'touchstart']) {
    addEventListener(ev, (e) => { if (stopSaver() && ev === 'keydown') { e.preventDefault(); e.stopImmediatePropagation(); } arm(); }, { capture: true, passive: ev !== 'keydown' });
  }
  arm();
}
export const _startSaver = startSaver; // for the Studio preview and tests

// ---------- sign a TV in from a phone ----------
function loadQr() {
  return new Promise((resolve) => {
    if (window.qrcode) return resolve(window.qrcode);
    const s = document.createElement('script'); s.src = '/vendor/qrcode.js'; s.onload = () => resolve(window.qrcode); s.onerror = () => resolve(null); document.head.append(s);
  });
}
/** The TV side: show a code and wait for a phone to approve it. `back` returns to the ordinary sign-in. */
export async function pairScreen(box, back) {
  let p;
  try { p = await api('POST', '/api/pair'); } catch (e) { toast(e.message); return back(); }
  const link = `${location.origin}/#/pair/${p.code}`;
  const qr = await loadQr();
  let svg = '';
  if (qr) { const q = qr(0, 'M'); q.addData(link); q.make(); svg = q.createSvgTag({ cellSize: 6, margin: 2, scalable: true }); }
  box.innerHTML = String(html`<img class="brand" src="${logoUrl()}" alt=""><h1>Sign in with your phone</h1>
    <div class="pair"><div class="pair-qr">${raw(svg)}</div><ol><li>Point your phone's camera at the code.</li><li>Sign in to HallFlix on the phone if it asks.</li><li>Tap <b>Sign in this screen</b>.</li></ol></div>
    <p class="pair-code">No camera? Open HallFlix on your phone and go to <b>${location.host}/#/pair/${p.code}</b></p>
    <button class="linkbtn" data-back>Use a password instead</button>`);
  let stop = false;
  $('[data-back]', box).onclick = () => { stop = true; back(); };
  $('[data-back]', box).focus();
  const until = Date.now() + p.expiresIn * 1000;
  while (!stop && Date.now() < until && box.isConnected) {
    await new Promise((r) => setTimeout(r, 2000));
    if (stop || !box.isConnected) return;
    try {
      const r = await api('GET', `/api/pair/${p.code}?secret=${encodeURIComponent(p.secret)}`);
      if (r.status === 'approved') { location.hash = '#/'; location.reload(); return; }
    } catch { break; }
  }
  if (!stop && box.isConnected) pairScreen(box, back); // the code ran out: show a fresh one
}
/** The phone side: confirm which screen is being signed in. */
export async function pairApprove(view, code) {
  let info;
  try { info = await api('GET', `/api/pair/${encodeURIComponent(code)}/info`); }
  catch (e) { view.innerHTML = String(html`<div class="page"><div class="empty"><h2>That code is no longer good</h2><p>${e.message}</p></div></div>`); return; }
  view.innerHTML = String(html`<div class="page"><div class="pair-ok"><h1>Sign in this screen?</h1>
    <p>A ${info.device} is asking to sign in as <b>${state.profile.name}</b>. Only continue if that screen is in front of you.</p>
    <div class="actions"><button class="btn primary" data-yes>Sign in this screen</button><a class="btn" href="#/">Cancel</a></div></div></div>`);
  $('[data-yes]', view).onclick = async (e) => {
    e.target.disabled = true;
    try { await api('POST', `/api/pair/${encodeURIComponent(code)}/approve`); view.querySelector('.pair-ok').innerHTML = String(html`<h1>Done</h1><p>The ${info.device} is signing in now.</p><div class="actions"><a class="btn primary" href="#/">Back to HallFlix</a></div>`); }
    catch (err) { toast(err.message); e.target.disabled = false; }
  };
}

// ---------- phone as a remote ----------
let remoteTimer = 0;
export async function remote(view) {
  clearInterval(remoteTimer);
  view.innerHTML = String(html`<div class="page remote"><div class="lib-head"><h1>Remote</h1></div><div class="rm-list"></div></div>`);
  const box = $('.rm-list', view);
  let dragging = null;
  const send = (device, cmd, value) => api('POST', '/api/remote/command', { device, cmd, value }).catch((e) => toast(e.message));
  const draw = async () => {
    if (!box.isConnected) return clearInterval(remoteTimer);
    let list;
    try { list = await api('GET', '/api/remote/devices'); } catch { return; }
    if (dragging) return;
    box.innerHTML = String(list.length ? html`${list.map((d) => html`<section class="rm-card" data-device="${d.id}">
        <div class="rm-art" style="${d.art ? `background-image:${bgUrl(d.art)}` : ''}"></div>
        <p class="rm-where">${d.name}</p><h2>${d.title || 'Starting…'}</h2><p class="rm-sub">${d.subtitle || ''}</p>
        <div class="rm-seek"><span>${fmtTime(d.position)}</span><input type="range" min="0" max="${Math.max(1, Math.round(d.duration))}" value="${Math.round(d.position)}" aria-label="Seek"><span>${fmtTime(d.duration)}</span></div>
        <div class="rm-controls"><button data-cmd="skip" data-v="-10" aria-label="Back 10 seconds">${icons.rew}</button>
          <button class="rm-play" data-cmd="toggle" aria-label="${d.paused ? 'Play' : 'Pause'}">${d.paused ? icons.play : icons.pause}</button>
          <button data-cmd="skip" data-v="30" aria-label="Forward 30 seconds">${icons.fwd}</button></div>
        <div class="actions">${d.hasNext ? html`<button class="btn" data-cmd="next">${icons.next} Next episode</button>` : ''}<button class="btn" data-cmd="stop">Stop</button></div></section>`)}`
      : html`<div class="empty"><h2>Nothing is playing</h2><p>Start a movie or episode on a TV, computer or the HallFlix app signed in as ${state.profile.name}, and its controls appear here.</p></div>`);
  };
  box.addEventListener('click', (e) => { const b = e.target.closest('[data-cmd]'); if (!b) return; send(b.closest('[data-device]').dataset.device, b.dataset.cmd, +b.dataset.v || 0); setTimeout(draw, 700); });
  box.addEventListener('input', (e) => { if (e.target.matches('input[type=range]')) dragging = e.target; });
  box.addEventListener('change', (e) => { if (!e.target.matches('input[type=range]')) return; send(e.target.closest('[data-device]').dataset.device, 'seek', +e.target.value); dragging = null; setTimeout(draw, 900); });
  await draw();
  remoteTimer = setInterval(draw, 2000);
}
addEventListener('hashchange', () => { if (!/^#\/remote/.test(location.hash)) clearInterval(remoteTimer); });

export function initMore() { initPreviews(); initSaver(); }
