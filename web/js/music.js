// The music player: a queue that keeps playing while you browse, a bar along the bottom, and a full-screen
// Now Playing view with a visualiser. Files the browser can play go straight from the NAS; the rest arrive as MP3.
import { $, $$, api, html, icons, fmtTime, toast } from './core.js';
import { tint } from './feel.js';

const S = { queue: [], order: [], at: -1, shuffle: false, repeat: 'off', offset: 0, audio: null, ctx: null, analyser: null, raf: 0, seeking: null, side: 'queue', line: -1, pre: null };
const bar = () => $('#nowbar');
const full = () => $('#nowplaying');
const tv = () => document.body.classList.contains('tv');
const cur = () => S.queue[S.order[S.at]];

const probe = document.createElement('audio');
const MIME = { mp3: 'audio/mpeg', aac: 'audio/mp4; codecs="mp4a.40.2"', flac: 'audio/flac', opus: 'audio/ogg; codecs="opus"', vorbis: 'audio/ogg; codecs="vorbis"', alac: 'audio/mp4; codecs="alac"' };
function playable(t) {
  const c = String(t.codec || '').toLowerCase();
  if (c.startsWith('pcm_')) return !!probe.canPlayType('audio/wav');
  const m = MIME[c];
  return !!m && !!probe.canPlayType(m).replace('no', '');
}

function audio() {
  if (S.audio) return S.audio;
  const a = S.audio = new Audio();
  a.preload = 'auto';
  a.addEventListener('timeupdate', () => { if (S.seeking == null) progress(); lyricTick(); });
  a.addEventListener('ended', () => next(true));
  a.addEventListener('play', () => { paint(); session(); });
  a.addEventListener('pause', paint);
  a.addEventListener('error', () => {
    const t = cur();
    if (!t || !a.getAttribute('src')) return;
    // The browser refused the file after all: ask the NAS for an MP3 instead.
    if (!a.src.includes('/api/audio/')) { t.codec = 'force-mp3'; load(time(), true); return; }
    toast(`Could not play ${t.title}`);
    next(true);
  });
  try { a.volume = +(localStorage.getItem('hf_music_volume') ?? 1); } catch { /* private mode */ }
  return a;
}

const time = () => S.offset + (S.audio?.currentTime || 0);
const length = () => cur()?.runtime || (Number.isFinite(S.audio?.duration) ? S.offset + S.audio.duration : 0);

function load(at = 0, play = true) {
  const t = cur(), a = audio();
  if (!t) return;
  if (playable(t)) { S.offset = 0; a.src = `/api/file/${t.id}`; if (at > 0) a.addEventListener('loadedmetadata', () => { a.currentTime = at; }, { once: true }); }
  else { S.offset = at; a.src = `/api/audio/${t.id}${at > 0 ? `?at=${Math.floor(at)}` : ''}`; }
  if (play) a.play().catch(() => paint());
  render();
  if (at === 0) fetch('/api/progress', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ itemId: t.id }) }).catch(() => {});
  // Warm up the next song so the gap between tracks is as short as the browser allows.
  const nx = S.queue[S.order[S.at + 1]];
  if (nx && playable(nx)) { S.pre ||= new Audio(); S.pre.preload = 'auto'; S.pre.muted = true; if (!S.pre.src.endsWith(`/api/file/${nx.id}`)) S.pre.src = `/api/file/${nx.id}`; }
}

// ---------- lyrics ----------
async function lyricsFor(t) {
  if (t.lyrics === undefined) { try { t.lyrics = await api('GET', `/api/lyrics/${t.id}`); } catch { t.lyrics = {}; } }
  return t.lyrics;
}
async function drawSide() {
  const t = cur(), box = $('#nowplaying .np-side');
  if (!t || !box) return;
  for (const b of $$('#nowplaying [data-side]')) b.classList.toggle('on', b.dataset.side === S.side);
  if (S.side === 'queue') {
    const up = S.order.slice(S.at + 1, S.at + 30).map((i) => S.queue[i]);
    box.innerHTML = String(up.length ? html`<ol class="np-queue">${up.map((x, k) => html`<li><button data-jump="${S.at + 1 + k}"><b>${x.title}</b><small>${x.author || ''}</small><span>${fmtTime(x.runtime)}</span></button></li>`)}</ol>`
      : html`<p class="np-none">Nothing else is queued.</p>`);
    return;
  }
  box.innerHTML = '<p class="np-none">Looking for lyrics…</p>';
  const l = await lyricsFor(t);
  if (cur() !== t || S.side !== 'lyrics' || !box.isConnected) return;
  S.line = -1;
  box.innerHTML = String(l.synced ? html`<ol class="np-lyrics synced">${l.synced.map((x, i) => html`<li><button data-line="${i}">${x.text || '♪'}</button></li>`)}</ol>`
    : l.plain ? html`<div class="np-lyrics plain">${l.plain}</div>`
      : html`<p class="np-none">No lyrics for this song. Put a .lrc file with the same name next to the song on the NAS and they will show here, in time with the music.</p>`);
  lyricTick();
}
function lyricTick() {
  const list = cur()?.lyrics?.synced;
  if (!list || S.side !== 'lyrics' || full().hidden) return;
  const now = time() + 0.25;
  let i = -1;
  for (let k = 0; k < list.length && list[k].t <= now; k++) i = k;
  if (i === S.line) return;
  S.line = i;
  const rows = $$('#nowplaying .np-lyrics.synced li');
  rows.forEach((li, k) => { li.classList.toggle('now', k === i); li.classList.toggle('past', k < i); });
  rows[Math.max(0, i)]?.scrollIntoView({ block: 'center', behavior: tv() ? 'auto' : 'smooth' });
}

/** Choose a playlist for some songs, or start a new one. */
export async function pickPlaylist(ids) {
  let lists = [];
  try { lists = await api('GET', '/api/playlists'); } catch (e) { toast(e.message); return; }
  const back = document.activeElement;
  const box = document.createElement('div');
  box.className = 'confirm';
  box.innerHTML = String(html`<div class="panel" role="dialog" aria-modal="true" aria-labelledby="pl-h"><h2 id="pl-h">Add to a playlist</h2>
    <div class="pl-pick">${lists.map((p) => html`<button class="choice" data-pl="${p.id}"><b>${p.name}</b><span>${p.count} song${p.count === 1 ? '' : 's'}</span></button>`)}</div>
    <form class="pl-new"><input name="name" placeholder="New playlist name" maxlength="80" autocomplete="off" aria-label="New playlist name"><button class="btn primary">Create and add</button></form>
    <div class="actions"><button class="btn" data-x>Cancel</button></div></div>`);
  const close = () => { box.remove(); back?.focus?.(); };
  const add = async (id, name) => { try { await api('POST', `/api/playlists/${id}/tracks`, { add: ids }); toast(`Added to ${name}`); dispatchEvent(new Event('hallflix-playlists')); } catch (e) { toast(e.message); } close(); };
  box.onclick = (e) => {
    if (e.target === box || e.target.closest('[data-x]')) return close();
    const b = e.target.closest('[data-pl]');
    if (b) add(+b.dataset.pl, $('b', b).textContent);
  };
  $('form', box).onsubmit = async (e) => {
    e.preventDefault();
    const name = new FormData(e.target).get('name').trim();
    if (!name) return $('input', box).focus();
    try { const p = await api('POST', '/api/playlists', { name }); await add(p.id, p.name); } catch (err) { toast(err.message); }
  };
  box.onkeydown = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  document.body.append(box);
  ($('[data-pl]', box) || $('input', box)).focus();
}

function reorder(startAt) {
  S.order = S.queue.map((_, i) => i);
  if (S.shuffle) {
    for (let i = S.order.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [S.order[i], S.order[j]] = [S.order[j], S.order[i]]; }
    if (startAt != null) { S.order.splice(S.order.indexOf(startAt), 1); S.order.unshift(startAt); }
  }
}

/** Play a list of tracks, starting at `index`. */
export function play(tracks, index = 0, { shuffle } = {}) {
  if (!tracks?.length) return;
  dispatchEvent(new Event('hallflix-music'));
  S.queue = tracks.map((t) => ({ ...t }));
  if (shuffle != null) S.shuffle = shuffle;
  reorder(S.shuffle ? (shuffle ? Math.floor(Math.random() * tracks.length) : index) : null);
  S.at = S.shuffle ? 0 : index;
  load(0);
}
export const playing = () => !!S.audio && !S.audio.paused;

export function toggle() { const a = S.audio; if (!a || !cur()) return; if (a.paused) a.play().catch(() => {}); else a.pause(); }
export function next(auto = false) {
  if (!S.queue.length) return;
  if (auto && S.repeat === 'one') { load(0); return; }
  if (S.at + 1 < S.order.length) S.at++;
  else if (S.repeat === 'all' || !auto) { if (S.shuffle) reorder(); S.at = 0; }
  else { S.audio.pause(); S.audio.currentTime = 0; paint(); return; }
  load(0);
}
export function prev() {
  if (!S.queue.length) return;
  if (time() > 4 || S.at === 0) { seek(0); return; }
  S.at--; load(0);
}
export function seek(t) {
  const a = S.audio, track = cur();
  if (!a || !track) return;
  t = Math.max(0, Math.min(length() - 0.5, t));
  if (!a.src.includes('/api/audio/')) a.currentTime = t; else load(t, !a.paused);
  progress();
}
function stop() {
  if (S.audio) { S.audio.pause(); S.audio.removeAttribute('src'); S.audio.load(); }
  S.queue = []; S.order = []; S.at = -1;
  closeFull();
  bar().hidden = true; document.body.classList.remove('has-nowbar');
  if ('mediaSession' in navigator) navigator.mediaSession.metadata = null;
}

// ---------- the bar along the bottom ----------
function render() {
  const t = cur();
  if (!t) return;
  const b = bar();
  b.hidden = false; document.body.classList.add('has-nowbar');
  b.innerHTML = String(html`<div class="nb-progress" data-seek><i></i></div>
    <button class="nb-art" data-open aria-label="Open Now Playing">${t.poster ? html`<img src="${t.poster}" alt="">` : html`<span>♪</span>`}</button>
    <button class="nb-text" data-open><b>${t.title}</b><small>${[t.author, t.album].filter(Boolean).join(' · ')}</small></button>
    <div class="nb-controls"><button data-act="prev" aria-label="Previous">${icons.rew}</button>
      <button class="nb-play" data-act="toggle" aria-label="Play or pause"></button>
      <button data-act="next" aria-label="Next">${icons.fwd}</button></div>
    <span class="nb-time"></span><button class="nb-close" data-act="stop" aria-label="Stop and close">${icons.x}</button>`);
  tint(b, t.poster);
  paint(); progress();
  if (!full().hidden) drawFull();
}
function paint() {
  const p = playing();
  for (const el of $$('[data-act=toggle]')) { el.innerHTML = String(p ? icons.pause : icons.play); el.setAttribute('aria-label', p ? 'Pause' : 'Play'); }
  document.body.classList.toggle('music-on', p);
  if (S.ctx && p && S.ctx.state === 'suspended') S.ctx.resume();
}
function progress() {
  const len = length(), t = S.seeking ?? time(), pct = len ? Math.min(100, (t / len) * 100) : 0;
  const i = $('#nowbar .nb-progress i'); if (i) i.style.width = `${pct}%`;
  const tt = $('#nowbar .nb-time'); if (tt) tt.textContent = `${fmtTime(t)} / ${fmtTime(len)}`;
  const r = $('#nowplaying [data-range]');
  if (r && S.seeking == null) { r.max = String(Math.max(1, Math.round(len))); r.value = String(Math.round(t)); r.style.setProperty('--p', `${pct}%`); }
  const a = $('#nowplaying .np-t0'), z = $('#nowplaying .np-t1');
  if (a) a.textContent = fmtTime(t); if (z) z.textContent = fmtTime(len);
}

// ---------- Now Playing ----------
function drawFull() {
  const t = cur(), f = full();
  if (!t) return;
  f.innerHTML = String(html`<div class="np-bg" style="${t.poster ? `background-image:url('${t.poster}')` : ''}"></div>
    <button class="btn round np-close" data-close aria-label="Close">${icons.back}</button>
    <div class="np-main">
      <div class="np-art">${t.poster ? html`<img src="${t.poster}" alt="">` : html`<span>♪</span>`}<canvas class="np-viz" width="600" height="120" aria-hidden="true"></canvas></div>
      <div class="np-info">
        <h1>${t.title}</h1>
        <p class="np-sub">${t.author ? html`<span>${t.author}</span>` : ''}${t.album ? html` · <a href="#/title/${t.albumId}" data-close>${t.album}</a>` : ''}</p>
        <div class="np-seek"><span class="np-t0"></span><input type="range" min="0" step="1" data-range aria-label="Seek"><span class="np-t1"></span></div>
        <div class="np-controls">
          <button class="np-mode ${S.shuffle ? 'on' : ''}" data-act="shuffle" aria-label="Shuffle" title="Shuffle">${icons.shuffle}</button>
          <button data-act="prev" aria-label="Previous">${icons.rew}</button>
          <button class="np-play" data-act="toggle" aria-label="Play or pause"></button>
          <button data-act="next" aria-label="Next">${icons.fwd}</button>
          <button class="np-mode ${S.repeat !== 'off' ? 'on' : ''}" data-act="repeat" aria-label="Repeat: ${S.repeat}" title="Repeat: ${S.repeat === 'one' ? 'this song' : S.repeat === 'all' ? 'all' : 'off'}">${icons.repeat}${S.repeat === 'one' ? html`<i>1</i>` : ''}</button>
        </div>
        <div class="np-tabs"><button data-side="queue">Up next</button><button data-side="lyrics">Lyrics</button><span></span><button data-addto="${t.id}" class="np-add">${icons.plus} Playlist</button></div>
        <div class="np-side"></div>
      </div></div>`);
  drawSide();
  tint(f, t.poster);
  paint(); progress();
  viz();
}
export function openFull() {
  if (!cur()) return;
  full().hidden = false; document.body.classList.add('locked');
  drawFull();
  $('#nowplaying [data-act=toggle]')?.focus();
}
function closeFull() {
  if (full().hidden) return;
  full().hidden = true; full().innerHTML = ''; cancelAnimationFrame(S.raf);
  if ($('#overlay').childElementCount === 0 && $('#player').hidden && $('#reader').hidden) document.body.classList.remove('locked');
}

/** Bars that move with the music, drawn only while Now Playing is open on a computer or phone. */
function viz() {
  cancelAnimationFrame(S.raf);
  const cv = $('#nowplaying .np-viz');
  if (!cv || tv() || matchMedia('(prefers-reduced-motion: reduce)').matches) { cv?.remove(); return; }
  try {
    if (!S.ctx) {
      S.ctx = new (window.AudioContext || window.webkitAudioContext)();
      const src = S.ctx.createMediaElementSource(audio());
      S.analyser = S.ctx.createAnalyser(); S.analyser.fftSize = 128; S.analyser.smoothingTimeConstant = 0.8;
      src.connect(S.analyser); S.analyser.connect(S.ctx.destination);
    }
    if (S.ctx.state === 'suspended') S.ctx.resume();
  } catch { cv.remove(); return; }
  const g = cv.getContext('2d'), data = new Uint8Array(S.analyser.frequencyBinCount);
  const accent = getComputedStyle(full()).getPropertyValue('--accent').trim() || '#35d0d0';
  const draw = () => {
    if (full().hidden || !cv.isConnected) return;
    S.analyser.getByteFrequencyData(data);
    g.clearRect(0, 0, cv.width, cv.height);
    full().style.setProperty('--beat', ((data[1] + data[2] + data[3]) / 765).toFixed(3)); // the low end moves the cover
    const n = 40, w = cv.width / n;
    g.fillStyle = accent;
    for (let i = 0; i < n; i++) {
      const v = data[Math.floor((i / n) * data.length * 0.8)] / 255;
      const h = Math.max(3, v * v * cv.height);
      g.globalAlpha = 0.35 + v * 0.65;
      g.fillRect(i * w + 2, cv.height - h, w - 4, h);
    }
    S.raf = requestAnimationFrame(draw);
  };
  draw();
}

function session() {
  const t = cur();
  if (!t || !('mediaSession' in navigator)) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({ title: t.title, artist: t.author || '', album: t.album || '', artwork: t.poster ? [{ src: new URL(t.poster, location.href).href, sizes: '600x600', type: 'image/jpeg' }] : [] });
    navigator.mediaSession.setActionHandler('play', () => toggle());
    navigator.mediaSession.setActionHandler('pause', () => toggle());
    navigator.mediaSession.setActionHandler('previoustrack', () => prev());
    navigator.mediaSession.setActionHandler('nexttrack', () => next());
    navigator.mediaSession.setActionHandler('seekto', (d) => seek(d.seekTime));
  } catch { /* older browser */ }
}

const actions = {
  toggle, next: () => next(), prev, stop,
  shuffle: () => { S.shuffle = !S.shuffle; const keep = S.order[S.at]; reorder(S.shuffle ? keep : null); S.at = S.shuffle ? 0 : keep; drawFull(); toast(S.shuffle ? 'Shuffle on' : 'Shuffle off', 1400); },
  repeat: () => { S.repeat = { off: 'all', all: 'one', one: 'off' }[S.repeat]; drawFull(); },
};

export function initMusic() {
  addEventListener('click', (e) => {
    const zone = e.target.closest('#nowbar, #nowplaying');
    if (!zone) return;
    const act = e.target.closest('[data-act]');
    if (act) { e.preventDefault(); actions[act.dataset.act]?.(); return; }
    const jump = e.target.closest('[data-jump]');
    if (jump) { S.at = +jump.dataset.jump; load(0); return; }
    if (e.target.closest('[data-open]')) { openFull(); return; }
    const side = e.target.closest('[data-side]');
    if (side) { S.side = side.dataset.side; drawSide(); return; }
    const line = e.target.closest('[data-line]');
    if (line) { const l = cur()?.lyrics?.synced?.[+line.dataset.line]; if (l) seek(l.t); return; }
    if (e.target.closest('[data-close]')) { closeFull(); return; }
    const sk = e.target.closest('[data-seek]');
    if (sk) { const r = sk.getBoundingClientRect(); seek(((e.clientX - r.left) / r.width) * length()); }
  });
  addEventListener('click', (e) => { const b = e.target.closest('[data-addto]'); if (b) { e.preventDefault(); e.stopPropagation(); pickPlaylist(b.dataset.addto.split(',').map(Number)); } }, true);
  addEventListener('input', (e) => {
    if (!e.target.matches('#nowplaying [data-range]')) return;
    S.seeking = +e.target.value; progress();
    e.target.style.setProperty('--p', `${(S.seeking / Math.max(1, +e.target.max)) * 100}%`);
  });
  addEventListener('change', (e) => { if (e.target.matches('#nowplaying [data-range]')) { const t = +e.target.value; S.seeking = null; seek(t); } });
  addEventListener('keydown', (e) => {
    if (full().hidden || $('.confirm')) return;
    if (e.key === 'Escape' || (e.key === 'Backspace' && !e.target.matches?.('input')) || e.key === 'GoBack') { e.preventDefault(); e.stopImmediatePropagation(); closeFull(); }
    else if ((e.key === ' ' || e.key === 'MediaPlayPause') && !e.target.matches('button, input')) { e.preventDefault(); toggle(); }
  }, true);
  // Video takes over the speakers.
  addEventListener('hallflix-video', () => { if (playing()) S.audio.pause(); closeFull(); });
  addEventListener('hashchange', closeFull);
  window.HallFlix && Object.assign(window.HallFlix, { music: { play, toggle, next, prev, get playing() { return playing(); }, get track() { return cur() || null; } } });
}
export const hasQueue = () => !!cur();
