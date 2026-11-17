// HallFlix web app entry: boot, routing, and the plugin API.
import { $, api, state, applyLook, on, emit, toast, html, raw } from './core.js';
import * as views from './views.js';
import { openPlayer, closePlayer, playerOpen } from './player.js';
import { initNav } from './nav.js';
import { effects, startEffect } from './effects.js';
import { initFeel } from './feel.js';
import { openReader, closeReader, readerOpen } from './reader.js';
import { initMusic, lyricsProviders } from './music.js';
import { initMore } from './more.js';

// What plugins can use. See docs/PLUGINS.md.
window.HallFlix = {
  on, api, toast, html, raw,
  get look() { return state.look; },
  get profile() { return state.profile; },
  get libraries() { return state.libraries; },
  registerEffect(name, def) { effects[name] = def; if (state.look?.theme?.effect === name) { startEffect('none'); startEffect(name); } },
  addHomeRow(def) { views.extraRows.push(def); views.markStale(); },
  navigate(hash) { location.hash = hash; },
  /** A lyrics service in the browser: { name, find(track) } resolving to { synced: "LRC text" | [{ t, text }], plain }. See docs/PLUGINS.md. */
  addLyricsProvider(p) { if (p && typeof p.find === 'function') lyricsProviders.push({ name: String(p.name || 'Plugin'), find: p.find }); },
};

let baseHash = null;
// The Android app's player closed: refresh Continue Watching and progress bars.
addEventListener('hallflix-native-closed', () => { views.markStale(); baseHash = null; route(); });
async function route() {
  const hash = location.hash || '#/';
  const [path, qs = ''] = hash.slice(1).split('?');
  const parts = path.split('/').filter(Boolean);
  if (parts[0] === 'watch' && +parts[1]) {
    views.closeTitle();
    views.markStale();
    const start = /(^|&)t=0/.test(qs) ? 0 : undefined;
    // Inside the HallFlix Android app, video plays in the app's own player.
    if (window.HallFlixNative) { window.HallFlixNative.play(JSON.stringify({ itemId: +parts[1], start: start ?? null })); history.back(); return; }
    await openPlayer(+parts[1], { start, cinema: /(^|&)night=1/.test(qs) });
    return;
  }
  if (parts[0] === 'read' && +parts[1]) { views.closeTitle(); if (playerOpen()) closePlayer(); views.markStale(); await openReader(+parts[1]); return; }
  if (readerOpen()) closeReader();
  if (parts[0] === 'party' && parts[1]) {
    views.closeTitle();
    try { const k = await api('GET', `/api/party/${encodeURIComponent(parts[1])}`); await openPlayer(k.itemId, { party: k.code, start: 0 }); }
    catch (e) { toast(e.message); location.hash = '#/'; }
    return;
  }
  if (playerOpen()) closePlayer();
  if (parts[0] === 'title' && +parts[1]) {
    if (!views.hasBase()) { baseHash = '#/'; await views.show('home'); }
    await views.title(+parts[1]);
    return;
  }
  views.closeTitle();
  if (hash !== baseHash || !views.hasBase() || views.isStale()) { baseHash = hash; await views.show(parts[0] || 'home', parts[1]); }
}

function loadPlugins(list) {
  for (const p of list || []) {
    for (const href of p.css) document.head.insertAdjacentHTML('beforeend', `<link rel="stylesheet" href="${href}" data-plugin="${p.id}">`);
    for (const src of p.js) { const s = document.createElement('script'); s.src = src; s.defer = true; s.dataset.plugin = p.id; document.head.append(s); }
  }
}

/** In the Studio's preview: draw the sign-in page as visitors see it, with this server's profiles. Nothing can sign in. */
async function signinPreview() {
  state.signinPreview = true;
  let profiles = [];
  try {
    const [st, list] = await Promise.all([api('GET', '/api/studio/settings'), api('GET', '/api/studio/profiles')]);
    if (st.showProfilesOnLogin !== false) profiles = (Array.isArray(list) ? list : list.profiles || []).map((p) => ({ id: p.id, name: p.name, avatar: p.avatar, color: p.color }));
  } catch { /* show the name-and-password form */ }
  for (const el of document.querySelectorAll('#player, .mini, .np, #overlay')) el.hidden = true;
  views.login({ ...state.boot, look: state.look, profiles });
}

async function boot() {
  const params = new URLSearchParams(location.search);
  if (/AFT|Android TV|GoogleTV|BRAVIA|SmartTV|Tizen|Web0S/i.test(navigator.userAgent) || params.has('tv')) document.body.classList.add('tv');
  initNav(); initFeel(); initMusic();
  let b;
  try { b = await api('GET', '/api/boot'); }
  catch (e) { $('#app').innerHTML = `<div class="login"><div class="box"><h1>HallFlix is starting…</h1><p style="color:var(--muted)">The server is not answering yet. This page will retry.</p></div></div>`; setTimeout(boot, 4000); return; }
  state.boot = b; state.profile = b.profile; state.libraries = b.libraries || [];
  applyLook(b.look, null);
  // The Studio shows this app in a frame and sends looks to it as they are edited, before anything is saved.
  if (params.has('preview')) {
    state.preview = true;
    addEventListener('message', (e) => {
      if (e.origin !== location.origin || !e.data) return;
      if (e.data.type === 'hallflix-look') applyLook(e.data.look, e.data.library ?? undefined);
      if (e.data.type === 'hallflix-go') {
        if (e.data.hash === '#/signin') signinPreview();
        else if (state.signinPreview) { location.hash = e.data.hash; location.reload(); } // back to the signed-in app
        else if (location.hash !== e.data.hash) location.hash = e.data.hash;
      }
      if (e.data.type === 'hallflix-show' && typeof e.data.selector === 'string') document.querySelector(e.data.selector)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
    parent?.postMessage({ type: 'hallflix-ready' }, location.origin);
  }
  if (b.setup) return views.setup();
  if (!b.profile) return views.login(b);
  loadPlugins(b.plugins);
  views.shell();
  initMore();
  on('signedout', () => location.reload());
  addEventListener('hashchange', route);
  await route();
  emit('ready', { profile: b.profile });
  // Pick up a season that starts while the app is open (and Studio changes) without a reload.
  setInterval(async () => {
    if (state.preview || playerOpen() || document.hidden) return;
    try { const fresh = await api('GET', '/api/boot'); if (JSON.stringify(fresh.look) !== JSON.stringify(state.boot.look)) { state.boot.look = fresh.look; applyLook(fresh.look); } } catch { /* offline */ }
  }, 10 * 60e3);
}

addEventListener('keydown', (e) => {
  if (e.defaultPrevented || playerOpen() || readerOpen()) return;
  if (e.key === 'Escape' && $('#overlay').childElementCount) { e.preventDefault(); history.back(); }
  if (e.key === '/' && !e.target.matches('input')) { e.preventDefault(); $('.search input')?.focus(); }
});

boot();
