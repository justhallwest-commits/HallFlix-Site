// The player. Plays a queue (pre-rolls, then the title), keeping the next item loaded on a second
// video element so the switch from a pre-roll to the feature is instant.
import { $, $$, api, html, raw, esc, icons, fmtTime, emit, toast, state, themeNow, logoUrl } from './core.js';
import { identSound } from './feel.js';
import { pauseEffects } from './effects.js';

let capsCache;
export function caps() {
  if (capsCache) return capsCache;
  const v = document.createElement('video');
  const can = (t) => { try { return !!v.canPlayType(t).replace(/no/, ''); } catch { return false; } };
  const mse = (t) => { try { const M = window.ManagedMediaSource || window.MediaSource; return !!M && M.isTypeSupported(t); } catch { return false; } };
  const hevc = mse('video/mp4; codecs="hvc1.1.6.L120.90"') && can('video/mp4; codecs="hvc1.1.6.L120.90"');
  capsCache = {
    containers: ['mp4', ...(can('video/webm; codecs="vp9"') ? ['webm'] : [])],
    video: ['h264', ...(can('video/webm; codecs="vp9"') || can('video/mp4; codecs="vp09.00.10.08"') ? ['vp9'] : []), ...(hevc ? ['hevc'] : []), ...(can('video/mp4; codecs="av01.0.05M.08"') ? ['av1'] : [])],
    video10: hevc && mse('video/mp4; codecs="hvc1.2.4.L120.90"') ? ['hevc'] : [],
    audio: ['aac', 'mp3', ...(can('audio/webm; codecs="opus"') ? ['opus'] : []), ...(can('audio/flac') ? ['flac'] : []),
      ...(can('audio/mp4; codecs="ac-3"') ? ['ac3'] : []), ...(can('audio/mp4; codecs="ec-3"') ? ['eac3'] : [])],
    hlsHevc: hevc, audioSwitch: false, maxHeight: 0,
  };
  return capsCache;
}

let P = null;
const QUALITIES = [['auto', 'Original'], ['1080', '1080p'], ['720', '720p'], ['480', '480p']];

export function closePlayer({ silent = false } = {}) {
  if (!P) return;
  const p = P; P = null;
  p.closed = true;
  clearInterval(p.tick); clearTimeout(p.hideTimer); clearTimeout(p.seekTimer); clearInterval(p.countdown); clearInterval(p.glow); clearTimeout(p.thumbTimer);
  if (p.party) { try { p.party.es.close(); } catch { /* gone */ } }
  removeEventListener('keydown', p.onKey, true);
  report(p, false, true);
  for (const s of p.slots) teardown(s, true);
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  p.root.hidden = true; p.root.innerHTML = ''; p.root.className = '';
  document.body.classList.remove('locked');
  pauseEffects(false);
  if (!silent) emit('player:close', { itemId: p.itemId });
}
export const playerOpen = () => !!P;

function teardown(slot, final = false) {
  if (slot.hls) { try { slot.hls.destroy(); } catch { /* already gone */ } slot.hls = null; }
  if (slot.sid && final) { fetch(`/api/play/session/${slot.sid}`, { method: 'DELETE', keepalive: true, credentials: 'same-origin' }).catch(() => {}); slot.sid = null; }
  slot.video.removeAttribute('src');
  try { slot.video.load(); } catch { /* fine */ }
  slot.entry = null; slot.offset = 0; slot.kind = null; slot.retries = 0;
}

function report(p, ended = false, beacon = false) {
  const s = p.slots[p.active], e = s?.entry;
  if (!e || e.kind !== 'main' || !p.started) return;
  const body = JSON.stringify({ itemId: e.itemId, position: now(p), duration: duration(p), ended });
  fetch('/api/progress', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: beacon, credentials: 'same-origin' }).catch(() => {});
}

const now = (p) => { const s = p.slots[p.active]; return (s.offset || 0) + (s.video.currentTime || 0); };
function duration(p) {
  const s = p.slots[p.active];
  if (s.entry?.duration) return s.entry.duration;
  return Number.isFinite(s.video.duration) ? s.offset + s.video.duration : 0;
}

async function load(p, slot, entry, at = 0, forceStream = false) {
  const keepSid = slot.sid;
  teardown(slot);
  slot.entry = entry;
  const v = slot.video;
  const main = entry.kind === 'main';
  const direct = () => {
    slot.kind = 'direct'; slot.offset = 0; v.src = entry.url || `/api/file/${entry.itemId}`;
    if (at > 0) v.addEventListener('loadedmetadata', () => { try { v.currentTime = at; } catch { /* not seekable yet */ } }, { once: true });
  };
  const overrides = main && (p.quality !== 'auto' || p.audioSel != null);
  if (entry.mode === 'direct' && !overrides && !forceStream) { direct(); return; }
  const c = forceStream ? { ...caps(), containers: [] } : caps();
  const s = await api('POST', '/api/play/session', { itemId: entry.itemId, start: at, caps: c, replace: keepSid || undefined,
    audio: main && p.audioSel != null ? p.audioSel : undefined, quality: main ? p.quality : 'auto' });
  if (p.closed) { if (s.sid) fetch(`/api/play/session/${s.sid}`, { method: 'DELETE', keepalive: true }).catch(() => {}); return; }
  if (s.direct) { direct(); return; }
  slot.kind = 'hls'; slot.sid = s.sid; slot.offset = s.start;
  if (window.Hls && window.Hls.isSupported()) {
    const h = new window.Hls({ maxBufferLength: 40, maxMaxBufferLength: 90, backBufferLength: 60, startPosition: 0, enableWorker: true, lowLatencyMode: false });
    slot.hls = h;
    h.on(window.Hls.Events.ERROR, (_, d) => { if (d.fatal) recover(p, slot, d.details || d.type); });
    h.loadSource(s.url); h.attachMedia(v);
  } else if (v.canPlayType('application/vnd.apple.mpegurl')) { v.src = s.url; }
  else throw new Error('This browser cannot play streamed video.');
}

/** A stream failed (session expired, network blip, undecodable file): restart it where the viewer was. */
async function recover(p, slot, why) {
  if (p.closed || slot !== p.slots[p.active]) return;
  slot.retries = (slot.retries || 0) + 1;
  if (slot.retries > 3) return fail(p, `Playback stopped (${why}).`);
  const at = now(p), entry = slot.entry, retries = slot.retries;
  try { await load(p, slot, entry, at, slot.kind === 'direct'); slot.retries = retries; await play(p); } catch (e) { fail(p, e.message); }
}

function fail(p, message) {
  if (p.closed) return;
  p.root.classList.remove('waiting');
  $('.err', p.root)?.remove();
  p.root.insertAdjacentHTML('beforeend', String(html`<div class="err"><div><h2>Can't play this right now</h2><p>${message}</p><button class="btn primary" data-act="back">Go back</button></div></div>`));
  $('.err button', p.root).focus();
}

async function play(p) {
  const v = p.slots[p.active].video;
  try { await v.play(); p.root.classList.remove('blocked'); }
  catch (e) { if (e.name === 'NotAllowedError') p.root.classList.add('blocked'); }
}

async function startEntry(p, idx) {
  p.idx = idx;
  const entry = p.queue[idx];
  // The built-in ident plays right before the feature, after any pre-rolls.
  if (entry.kind === 'main' && p.wantIdent) { p.wantIdent = false; p.root.classList.remove('waiting', 'preroll'); p.root.classList.add('identing'); await ident(p); if (p.closed) return; }
  let slot = p.slots[p.active];
  const other = p.slots[1 - p.active];
  if (other.entry === entry) { // already loaded on the standby element: swap
    slot.video.pause(); slot.video.classList.add('standby');
    teardown(slot, true);
    p.active = 1 - p.active; slot = other; slot.video.classList.remove('standby');
  } else {
    p.root.classList.add('waiting');
    await load(p, slot, entry, entry.kind === 'main' ? entry.resumeAt || 0 : 0);
  }
  if (p.closed) return;
  p.root.classList.toggle('preroll', entry.kind === 'preroll');
  p.root.classList.toggle('identing', entry.kind === 'ident');
  $('.title', p.root).textContent = entry.kind === 'main' ? entry.title : '';
  $('.sub', p.root).textContent = entry.kind === 'main' ? entry.subtitle || '' : '';
  p.thumbs = null; p.creditsDone = false; $('.skipintro', p.root).hidden = true;
  $('[data-act=next]', p.root).hidden = !(entry.kind === 'main' && entry.next);
  p.cues = []; p.subSel = null; $('.subs', p.root).textContent = '';
  p.started = false;
  await play(p);
  if (entry.kind === 'main') { emit('player:start', { itemId: entry.itemId, title: entry.title }); mediaSession(p, entry); loadThumbs(p, entry, 0); partyReady(p); }
  // Get the next item ready while this one plays.
  const upcoming = p.queue[idx + 1];
  if (upcoming) {
    const standby = p.slots[1 - p.active];
    standby.video.classList.add('standby'); standby.video.muted = slot.video.muted; standby.video.volume = slot.video.volume;
    load(p, standby, upcoming, upcoming.kind === 'main' ? upcoming.resumeAt || 0 : 0).catch(() => { standby.entry = null; });
  }
}

function advance(p) {
  if (p.idx + 1 < p.queue.length) return startEntry(p, p.idx + 1).catch((e) => fail(p, e.message));
  const entry = p.queue[p.idx];
  report(p, true);
  p.started = false;
  emit('player:ended', { itemId: entry.itemId });
  if (entry.next) { if ($('.upnext', p.root)) return goNext(p, entry.next); return upNext(p, entry.next, 8); }
  history.back();
}

/** Scrub previews: a sheet of small frames the server makes the first time a title plays. */
async function loadThumbs(p, entry, tries) {
  if (p.closed || p.queue[p.idx] !== entry) return;
  try {
    const t = await api('GET', `/api/thumbs/${entry.itemId}`);
    if (p.closed || p.queue[p.idx] !== entry) return;
    if (t.ready) { new Image().src = t.url; p.thumbs = t; return; }
    if (!t.never && tries < 20) p.thumbTimer = setTimeout(() => loadThumbs(p, entry, tries + 1), 15e3);
  } catch { /* previews are a nicety */ }
}
function showThumb(p, t) {
  const el = $('.tip .thumb', p.root), th = p.thumbs;
  if (!th) { el.hidden = true; return; }
  const i = Math.max(0, Math.min(th.count - 1, Math.floor(t / th.every)));
  el.hidden = false;
  el.style.cssText = `width:${th.w}px;height:${th.h}px;background-image:url("${th.url}");background-size:${th.cols * th.w}px ${th.rows * th.h}px;background-position:-${(i % th.cols) * th.w}px -${Math.floor(i / th.cols) * th.h}px`;
}

/** Skip intro while the intro plays; offer the next episode as soon as the credits start. */
function checkMarks(p, t) {
  const e = p.slots[p.active].entry, m = e?.kind === 'main' ? e.marks : null;
  const btn = $('.skipintro', p.root);
  const inIntro = !!m && m.introEnd > 0 && t >= (m.introStart || 0) && t < m.introEnd - 1;
  if (btn.hidden === inIntro) { btn.hidden = !inIntro; if (inIntro && document.body.classList.contains('tv')) btn.focus(); }
  if (m?.credits > 0 && t >= m.credits && e.next && !p.creditsDone && !$('.upnext', p.root) && !p.party) { p.creditsDone = true; upNext(p, e.next, 12); }
}

async function mark(p, what) {
  const slot = p.slots[p.active], t = Math.round(now(p) * 10) / 10, e = slot.entry;
  const body = what === 'clear' ? { introStart: null, introEnd: null, credits: null } : { [what]: t };
  try {
    const r = await api('POST', `/api/studio/items/${e.itemId}/marks`, what === 'season' ? { season: true } : body);
    e.marks = r.marks;
    toast(what === 'season' ? `Copied to ${r.season} other episode${r.season === 1 ? '' : 's'} in this season` : what === 'clear' ? 'Marks cleared' : `${{ introStart: 'Intro starts', introEnd: 'Intro ends', credits: 'Credits start' }[what]} at ${fmtTime(t)}`);
  } catch (err) { toast(err.message); }
}

// ---------- watch party ----------
function partySend(p, type, extra = {}) {
  if (!p.party || p.party.applying) return;
  api('POST', `/api/party/${p.party.code}/send`, { type, you: p.party.you, position: now(p), ...extra }).catch(() => {});
}
function partyUi(p) {
  const bar = $('.party', p.root), k = p.party;
  bar.hidden = !k;
  if (!k) return;
  const link = `${location.origin}/#/party/${k.code}`;
  bar.innerHTML = String(html`<span class="who">${icons.people} ${k.people.length} watching${k.people.length > 1 ? html` · ${k.people.join(', ')}` : ''}</span>
    <button class="btn small" data-act="partylink" data-link="${link}">Copy invite link</button>
    <span class="emoji">${['😂', '😮', '❤️', '👏', '😱'].map((x) => html`<button data-react="${x}" aria-label="React ${x}">${x}</button>`)}</span>`);
}
function partyJoin(p, code) {
  const es = new EventSource(`/api/party/${code}/events`, { withCredentials: true });
  p.party = { code, es, you: null, people: [state.profile.name], applying: false, ready: false, first: null };
  const apply = (fn) => { p.party.applying = true; try { fn(); } catch { /* not ready */ } setTimeout(() => { if (p.party) p.party.applying = false; }, 700); };
  es.onmessage = (ev) => {
    if (p.closed) return es.close();
    const m = JSON.parse(ev.data), v = p.slots[p.active].video;
    if (m.type === 'hello') { p.party.you = m.you; p.party.people = m.people; p.party.first = m.state; partyUi(p); partyReady(p); return; }
    if (m.type === 'people') { p.party.people = m.people; partyUi(p); if (m.joined) toast(`${m.joined} joined`); if (m.left) toast(`${m.left} left`); return; }
    if (m.type === 'react') { const r = document.createElement('span'); r.textContent = m.emoji; r.style.left = `${10 + Math.random() * 80}%`; $('.reactions', p.root).append(r); setTimeout(() => r.remove(), 2600); return; }
    if (!p.party.ready) return;
    if (m.type === 'pause') apply(() => { v.pause(); if (Math.abs(now(p) - m.position) > 1.5) seekTo(p, m.position, true); });
    if (m.type === 'play') apply(() => { if (Math.abs(now(p) - m.position) > 1.5) seekTo(p, m.position, true); play(p); });
    if (m.type === 'seek') apply(() => seekTo(p, m.position, true));
    if (m.by && m.type !== 'seek') toast(`${m.by} ${m.type === 'play' ? 'pressed play' : 'paused'}`, 1600);
  };
  es.onerror = () => { if (es.readyState === 2 && !p.closed) toast('The watch party ended'); };
}
/** Once the title is loaded and the room has said hello: a guest jumps to where the room is; the host announces. */
function partyReady(p) {
  const k = p.party;
  if (!k || k.ready || !k.you || p.slots[p.active].entry?.kind !== 'main') return;
  k.ready = true;
  const s = k.first;
  if (k.people.length > 1 && s && (s.position > 2 || s.playing)) {
    k.applying = true; seekTo(p, s.position, true);
    if (!s.playing) p.slots[p.active].video.pause();
    setTimeout(() => { if (p.party) p.party.applying = false; }, 900);
  } else partySend(p, p.slots[p.active].video.paused ? 'pause' : 'play');
}
async function partyStart(p) {
  if (p.party) return;
  const e = p.slots[p.active].entry;
  if (e?.kind !== 'main') return;
  try { const { code } = await api('POST', '/api/party', { itemId: e.itemId }); partyJoin(p, code); toast('Watch party started. Share the invite link.'); } catch (err) { toast(err.message); }
}

/** The built-in ident: the logo draws in with a chime, then the feature starts. */
function ident(p) {
  return new Promise((resolve) => {
    const el = document.createElement('div');
    el.className = 'ident';
    el.innerHTML = String(html`<div class="ident-ring"></div><img src="${logoUrl()}" alt=""><div class="ident-line"></div>`);
    p.root.append(el);
    identSound();
    const done = () => { el.classList.add('out'); setTimeout(() => { el.remove(); resolve(); }, 380); };
    const timer = setTimeout(done, 2500);
    el.onclick = () => { clearTimeout(timer); done(); };
  });
}

function upNext(p, next, seconds) {
  $('.upnext', p.root)?.remove();
  p.root.classList.add('show');
  p.root.insertAdjacentHTML('beforeend', String(html`<div class="upnext"><div class="img" style="background-image:url('${next.backdrop || next.poster || ''}')"></div>
    <div class="txt"><small>Up next · <span class="n">${seconds}</span></small><b>S${next.show?.season} E${next.show?.episode} · ${next.title}</b>
    <div class="actions"><button class="btn primary small" data-act="playnext">${icons.play} Play now</button><button class="btn small" data-act="cancelnext">Cancel</button></div></div></div>`));
  $('[data-act=playnext]', p.root).focus();
  let n = seconds;
  clearInterval(p.countdown);
  p.countdown = setInterval(() => {
    n -= 1;
    const el = $('.upnext .n', p.root);
    if (!el) return clearInterval(p.countdown);
    el.textContent = n;
    if (n <= 0) { clearInterval(p.countdown); goNext(p, next); }
  }, 1000);
}
function goNext(p, next) { clearInterval(p.countdown); history.replaceState(null, '', `#/watch/${next.id}`); openPlayer(next.id, { start: 0 }); }

function seekTo(p, t, remote = false) {
  const slot = p.slots[p.active], v = slot.video;
  const dur = duration(p);
  t = Math.max(0, Math.min(dur ? dur - 2 : t, t));
  p.pending = t;
  updateBar(p);
  if (!remote) partySend(p, 'seek', { position: t });
  clearTimeout(p.seekTimer);
  p.seekTimer = setTimeout(async () => {
    const target = p.pending; p.pending = null;
    if (slot.kind === 'direct') { v.currentTime = target; return; }
    const rel = target - slot.offset;
    const end = v.seekable.length ? v.seekable.end(v.seekable.length - 1) : 0;
    if (rel >= 0 && rel <= end - 1) { v.currentTime = rel; return; }
    p.root.classList.add('waiting');
    try { await load(p, slot, slot.entry, target); await play(p); } catch (e) { fail(p, e.message); }
  }, 260);
}

function updateBar(p) {
  const slot = p.slots[p.active], v = slot.video;
  const dur = duration(p), t = p.pending ?? now(p);
  const pct = dur ? Math.min(100, (t / dur) * 100) : 0;
  $('.pos', p.root).style.width = `${pct}%`;
  $('.knob', p.root).style.left = `${pct}%`;
  let buf = 0;
  for (let i = 0; i < v.buffered.length; i++) if (v.buffered.start(i) <= v.currentTime + 1) buf = Math.max(buf, v.buffered.end(i));
  $('.buf', p.root).style.width = `${dur ? Math.min(100, ((slot.offset + buf) / dur) * 100) : 0}%`;
  $('.time', p.root).textContent = dur ? `${fmtTime(t)} / ${fmtTime(dur)}` : fmtTime(t);
  $('.pre .left', p.root).textContent = slot.entry?.kind === 'preroll' && dur ? `Your title starts in ${Math.max(0, Math.ceil(remainingPrerolls(p)))}s` : '';
  checkMarks(p, now(p));
  if (p.cues.length) {
    const tt = now(p);
    $('.subs', p.root).textContent = p.cues.filter((c) => tt >= c.a && tt <= c.z).map((c) => c.text).join('\n');
  }
}
function remainingPrerolls(p) {
  let left = Math.max(0, duration(p) - now(p));
  for (let i = p.idx + 1; i < p.queue.length; i++) if (p.queue[i].kind === 'preroll') left += p.queue[i].duration || 0;
  return left;
}

function parseVtt(text) {
  const sec = (s) => { const m = /(?:(\d+):)?(\d+):(\d+)[.,](\d+)/.exec(s); return m ? (+m[1] || 0) * 3600 + +m[2] * 60 + +m[3] + +`0.${m[4]}` : 0; };
  const cues = [];
  for (const block of text.replace(/\r/g, '').split(/\n\n+/)) {
    const lines = block.split('\n');
    const i = lines.findIndex((l) => l.includes('-->'));
    if (i < 0) continue;
    const [a, z] = lines[i].split('-->');
    cues.push({ a: sec(a), z: sec(z), text: lines.slice(i + 1).join('\n').replace(/<[^>]+>/g, '').replace(/\{\\[^}]*\}/g, '') });
  }
  return cues;
}

function showControls(p, ms = 3200) {
  p.root.classList.add('show');
  clearTimeout(p.hideTimer);
  p.hideTimer = setTimeout(() => { if (!$('.pmenu', p.root) && !$('.upnext', p.root)) p.root.classList.remove('show'); }, ms);
}

function menu(p, kind) {
  const open = $('.pmenu', p.root);
  const was = open?.dataset.kind;
  open?.remove();
  if (was === kind) return;
  const entry = p.slots[p.active].entry;
  let body;
  if (kind === 'audio') {
    const sel = p.audioSel ?? entry.audioIndex ?? 0;
    body = html`<h4>Audio</h4>${entry.audio.map((a) => html`<button data-audio="${a.index}" class="${a.index === sel ? 'on' : ''}">${a.label}</button>`)}`;
  } else if (kind === 'subs') {
    body = html`<h4>Subtitles</h4><button data-sub="" class="${p.subSel ? '' : 'on'}">Off</button>${entry.subs.map((s) => html`<button data-sub="${s.id}" class="${p.subSel === s.id ? 'on' : ''}">${s.label}</button>`)}`;
  } else {
    const m = entry.marks || {};
    body = html`<h4>Quality</h4>${QUALITIES.map(([k, label]) => html`<button data-q="${k}" class="${p.quality === k ? 'on' : ''}">${label}<span style="opacity:.6">${k === 'auto' ? entry.reason || '' : ''}</span></button>`)}
      ${state.profile?.admin ? html`<h4>Skip buttons (admin)</h4>
        <button data-mark="introStart">Intro starts here<span style="opacity:.6">${m.introEnd ? fmtTime(m.introStart || 0) : ''}</span></button>
        <button data-mark="introEnd">Intro ends here<span style="opacity:.6">${m.introEnd ? fmtTime(m.introEnd) : ''}</span></button>
        <button data-mark="credits">Credits start here<span style="opacity:.6">${m.credits ? fmtTime(m.credits) : ''}</span></button>
        ${entry.next || /S\d+ E\d+/.test(entry.subtitle || '') ? html`<button data-mark="season">Copy to the whole season</button>` : ''}
        ${m.introEnd || m.credits ? html`<button data-mark="clear">Clear marks</button>` : ''}` : ''}`;
  }
  p.root.insertAdjacentHTML('beforeend', `<div class="pmenu" data-kind="${kind}">${body}</div>`);
  $('.pmenu .on', p.root)?.focus();
}

async function reloadAt(p) {
  const slot = p.slots[p.active], at = now(p);
  p.root.classList.add('waiting');
  try { await load(p, slot, slot.entry, at); await play(p); } catch (e) { fail(p, e.message); }
}

function mediaSession(p, entry) {
  if (!('mediaSession' in navigator)) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({ title: entry.title, artist: entry.subtitle || '', artwork: entry.backdrop ? [{ src: entry.backdrop }] : [] });
    navigator.mediaSession.setActionHandler('seekbackward', () => seekTo(p, now(p) - 10));
    navigator.mediaSession.setActionHandler('seekforward', () => seekTo(p, now(p) + 30));
    navigator.mediaSession.setActionHandler('nexttrack', entry.next ? () => goNext(p, entry.next) : null);
  } catch { /* not supported */ }
}

export async function openPlayer(itemId, opts = {}) {
  closePlayer({ silent: true });
  const root = $('#player');
  root.hidden = false; root.className = 'show waiting';
  document.body.classList.add('locked');
  pauseEffects(true);
  root.innerHTML = String(html`
    <canvas class="ambient" width="32" height="18" aria-hidden="true"></canvas>
    <video playsinline preload="auto"></video><video playsinline preload="auto" class="standby"></video>
    <div class="reactions" aria-hidden="true"></div>
    <div class="subs"></div>
    <div class="center"><div class="spinner"></div><button class="bigplay" data-act="toggle" aria-label="Play">${icons.play}</button></div>
    <div class="ui">
      <div class="bar-top"><button class="pbtn" data-act="back" aria-label="Back">${icons.back}</button><h2><span class="title"></span><small class="sub"></small></h2></div>
      <div class="bar-bottom">
        <div class="scrub" tabindex="0" role="slider" aria-label="Seek"><div class="track"><div class="buf"></div><div class="pos"></div></div><div class="knob"></div><div class="tip"><i class="thumb" hidden></i><span></span></div></div>
        <div class="controls">
          <button class="pbtn" data-act="toggle" aria-label="Play or pause"><span class="ico-play">${icons.play}</span></button>
          <button class="pbtn seekbtn" data-act="rew" aria-label="Back 10 seconds">${icons.rew}</button>
          <button class="pbtn seekbtn" data-act="fwd" aria-label="Forward 30 seconds">${icons.fwd}</button>
          <button class="pbtn hide-s" data-act="mute" aria-label="Mute"><span class="ico-vol">${icons.vol}</span></button>
          <input type="range" min="0" max="1" step="0.05" value="1" aria-label="Volume">
          <span class="time"></span><span class="spacer"></span>
          <button class="pbtn txt mainonly" data-act="next" hidden>${icons.next}<span class="hide-s">Next episode</span></button>
          ${window.EventSource ? html`<button class="pbtn mainonly hide-s" data-act="party" aria-label="Watch together" title="Watch together">${icons.people}</button>` : ''}
          <button class="pbtn mainonly" data-act="audio" aria-label="Audio">${icons.audio}</button>
          <button class="pbtn mainonly" data-act="subs" aria-label="Subtitles">${icons.cc}</button>
          <button class="pbtn mainonly" data-act="quality" aria-label="Quality">${icons.gear}</button>
          <button class="pbtn" data-act="full" aria-label="Full screen">${icons.full}</button>
        </div>
      </div>
    </div>
    <div class="pre"><span class="badge">PRE-ROLL</span><span class="left"></span></div>
    <button class="btn skip" data-act="skip">Skip ${icons.next}</button>
    <button class="btn skipintro" data-act="skipintro" hidden>Skip intro ${icons.next}</button>
    <div class="party" hidden></div>`);
  const vids = $$('video', root);
  const p = P = { root, itemId, queue: [], idx: 0, active: 0, quality: 'auto', audioSel: null, cues: [], subSel: null, pending: null, started: false, closed: false,
    slots: vids.map((video) => ({ video, hls: null, sid: null, entry: null, offset: 0, kind: null, retries: 0 })) };
  const saved = +localStorageGet('hf_volume', 1);
  for (const v of vids) v.volume = Number.isFinite(saved) ? saved : 1;
  $('input[type=range]', root).value = vids[0].volume;

  const activeVideo = () => p.slots[p.active].video;
  for (const slot of p.slots) {
    const v = slot.video, mine = () => slot === p.slots[p.active] && !p.closed;
    v.addEventListener('timeupdate', () => { if (mine()) { if (v.currentTime > 0.3) p.started = true; updateBar(p); } });
    v.addEventListener('waiting', () => mine() && root.classList.add('waiting'));
    for (const ev of ['playing', 'canplay', 'seeked']) v.addEventListener(ev, () => mine() && root.classList.remove('waiting'));
    v.addEventListener('play', () => { if (mine()) { root.classList.remove('paused'); $('.ico-play', root).innerHTML = icons.pause; showControls(p); if (p.party?.ready) partySend(p, 'play'); } });
    v.addEventListener('pause', () => { if (mine() && !v.ended) { root.classList.add('paused'); $('.ico-play', root).innerHTML = icons.play; report(p); if (p.party?.ready && !v.seeking) partySend(p, 'pause'); } });
    v.addEventListener('ended', () => mine() && advance(p));
    v.addEventListener('error', () => {
      if (!mine() || !v.error || !v.getAttribute('src')) return;
      // The browser refused a file it claimed to support: fall back to a repackaged stream.
      if (slot.kind === 'direct' && (slot.retries || 0) < 2) recover(p, slot, 'direct play failed');
      else if (slot.kind !== 'hls' || !slot.hls) fail(p, 'The video could not be decoded on this device.');
    });
  }

  const actions = {
    back: () => history.back(),
    toggle: () => { const v = activeVideo(); if (v.paused) play(p); else v.pause(); },
    rew: () => seekTo(p, (p.pending ?? now(p)) - 10), fwd: () => seekTo(p, (p.pending ?? now(p)) + 30),
    mute: () => { const m = !activeVideo().muted; for (const v of vids) v.muted = m; $('.ico-vol', root).innerHTML = m ? icons.mute : icons.vol; },
    full: () => { if (document.fullscreenElement) document.exitFullscreen(); else (root.requestFullscreen || root.webkitRequestFullscreen)?.call(root)?.catch?.(() => {}); },
    skip: () => advance(p), next: () => { const n = p.queue[p.idx].next; if (n) { report(p); goNext(p, n); } },
    audio: () => menu(p, 'audio'), subs: () => menu(p, 'subs'), quality: () => menu(p, 'quality'),
    playnext: () => goNext(p, p.queue[p.idx].next),
    cancelnext: () => { clearInterval(p.countdown); if (activeVideo().ended) history.back(); else $('.upnext', root)?.remove(); },
    skipintro: () => { const m = p.slots[p.active].entry?.marks; if (m?.introEnd) seekTo(p, m.introEnd); },
    party: () => partyStart(p),
    partylink: () => { const l = $('[data-act=partylink]', root).dataset.link; (navigator.clipboard?.writeText(l) || Promise.reject()).then(() => toast('Invite link copied'), () => prompt('Copy this invite link', l)); },
  };
  root.onclick = async (e) => {
    const b = e.target.closest('[data-act]');
    if (b) { e.stopPropagation(); actions[b.dataset.act]?.(); showControls(p); return; }
    const rx = e.target.closest('[data-react]');
    if (rx) { partySend(p, 'react', { emoji: rx.dataset.react }); return; }
    const m = e.target.closest('.pmenu button');
    if (m) {
      $('.pmenu', root)?.remove();
      if (m.dataset.mark) { await mark(p, m.dataset.mark); return; }
      if (m.dataset.audio != null) { p.audioSel = +m.dataset.audio; await reloadAt(p); }
      else if (m.dataset.q) { p.quality = m.dataset.q; await reloadAt(p); }
      else if (m.dataset.sub != null) {
        p.subSel = m.dataset.sub || null; p.cues = []; $('.subs', root).textContent = '';
        const s = p.slots[p.active].entry.subs.find((x) => x.id === p.subSel);
        if (s) { try { p.cues = parseVtt(await (await fetch(s.url, { credentials: 'same-origin' })).text()); } catch { toast('Could not load those subtitles'); } }
      }
      return;
    }
    if (e.target.closest('.pmenu, .scrub, .upnext, .err, .party, .ident')) return;
    if ($('.pmenu', root)) { $('.pmenu', root).remove(); return; }
    if (e.pointerType === 'touch' || matchMedia('(hover: none)').matches) { if (root.classList.contains('show')) root.classList.remove('show'); else showControls(p); return; }
    actions.toggle();
  };
  root.ondblclick = (e) => { if (!e.target.closest('.ui button, .scrub, .pmenu')) actions.full(); };
  root.onmousemove = () => showControls(p);
  $('input[type=range]', root).oninput = (e) => { for (const v of vids) { v.volume = +e.target.value; v.muted = false; } $('.ico-vol', root).innerHTML = icons.vol; localStorageSet('hf_volume', e.target.value); };

  const scrub = $('.scrub', root);
  const at = (e) => { const r = scrub.getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * duration(p); };
  scrub.onpointermove = (e) => { const tip = $('.tip', root); const r = scrub.getBoundingClientRect(); tip.style.left = `${Math.max(th(p), Math.min(r.width - th(p), e.clientX - r.left))}px`; $('span', tip).textContent = fmtTime(at(e)); showThumb(p, at(e)); if (scrub.classList.contains('drag')) { p.pending = at(e); updateBar(p); } };
  scrub.onpointerdown = (e) => { scrub.setPointerCapture(e.pointerId); scrub.classList.add('drag'); p.pending = at(e); updateBar(p); };
  scrub.onpointerup = (e) => { if (!scrub.classList.contains('drag')) return; scrub.classList.remove('drag'); seekTo(p, at(e)); };

  // Ambient glow: a soft, blurred copy of the picture fills any bars around it. Skipped on TVs.
  if (!document.body.classList.contains('tv') && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const cv = $('.ambient', root), ctx = cv.getContext('2d');
    p.glow = setInterval(() => { const v = activeVideo(); if (!v.paused && v.readyState >= 2 && !document.hidden) { try { ctx.drawImage(v, 0, 0, 32, 18); } catch { /* frame not ready */ } } }, 160);
  }

  p.onKey = (e) => {
    if (P !== p || e.target.matches?.('input[type=range]')) return;
    const k = e.key;
    const inMenu = e.target.closest?.('.pmenu, .upnext, .err');
    const pre = root.classList.contains('preroll');
    showControls(p);
    if (k === 'Escape' || k === 'Backspace' || k === 'BrowserBack' || k === 'GoBack') { e.preventDefault(); e.stopPropagation(); if ($('.pmenu', root)) $('.pmenu', root).remove(); else history.back(); return; }
    if (inMenu) return; // arrows and Enter drive the open menu through the normal focus rules
    const onControl = e.target.closest?.('.controls, .bar-top, .skip');
    if (k === ' ' || k === 'k' || k === 'MediaPlayPause') { e.preventDefault(); e.stopPropagation(); if (k === ' ' && onControl) { e.target.click(); return; } actions.toggle(); return; }
    if (k === 'MediaFastForward') { actions.fwd(); return; }
    if (k === 'MediaRewind') { actions.rew(); return; }
    if (k === 'f') return actions.full();
    if (k === 'm') return actions.mute();
    if (k === 'n') return actions.next();
    if ((k === 'ArrowLeft' || k === 'ArrowRight') && (!onControl || e.target === scrub)) {
      e.preventDefault(); e.stopPropagation();
      if (pre) { if (k === 'ArrowRight') actions.skip(); return; }
      if (k === 'ArrowLeft') actions.rew(); else actions.fwd();
      return;
    }
    if (k === 'Enter' && !onControl && e.target !== scrub) { e.preventDefault(); e.stopPropagation(); if (pre) actions.skip(); else actions.toggle(); }
  };
  addEventListener('keydown', p.onKey, true);
  p.tick = setInterval(() => {
    if (p.closed) return;
    p.beat = (p.beat || 0) + 1;
    if (p.beat % 10 === 0 && !activeVideo().paused) report(p);
    if (p.beat % 30 === 0) for (const s of p.slots) if (s.sid) fetch(`/api/play/ping/${s.sid}`, { method: 'POST', credentials: 'same-origin' }).catch(() => {});
  }, 1000);

  try {
    const { queue } = await api('POST', '/api/play', { itemId, caps: caps(), start: opts.start, prerolls: opts.party ? false : undefined });
    if (p.closed) return;
    p.queue = queue;
    if (opts.party) partyJoin(p, opts.party);
    const main = queue[queue.length - 1];
    const wantIdent = themeNow()?.ident?.enabled !== false && !opts.party && opts.start == null && !(main.resumeAt > 60) && !queue.some((q) => q.kind === 'ident') && !state.preview;
    p.wantIdent = wantIdent;
    await startEntry(p, 0);
  } catch (e) { fail(p, e.message); }
}

const th = (p) => (p.thumbs ? p.thumbs.w / 2 : 0);
function localStorageGet(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } }
function localStorageSet(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } }
addEventListener('pagehide', () => { if (P) report(P, false, true); });
