// The music player: a queue that keeps playing while you browse, a bar along the bottom, and Now Playing.
// Now Playing takes its colours from the album art, and has time-synced lyrics that sweep across each line as it is
// sung (word by word when the lyrics have word timing), a full-screen lyrics view, a queue you can reorder, song
// radio, likes, volume and a sleep timer. Files the browser can play go straight from the NAS; the rest arrive as MP3.
import { canDownload, DL_ICON, download } from './downloads.js';
import { $, $$, api, html, raw, icons, fmtTime, toast } from './core.js';
import { tint } from './feel.js';

const S = {
  queue: [], order: [], at: -1, shuffle: false, repeat: 'off', offset: 0, audio: null, ctx: null, analyser: null, raf: 0, seeking: null,
  side: 'lyrics', line: -1, pre: null, source: '', liked: null, sleep: null, lrRaf: 0, userScrollAt: 0,
};
const bar = () => $('#nowbar');
const full = () => $('#nowplaying');
const tv = () => document.body.classList.contains('tv');
const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const cur = () => S.queue[S.order[S.at]];
const pref = (k, d) => { try { return localStorage.getItem(`hf_music_${k}`) ?? d; } catch { return d; } };
const setPref = (k, v) => { try { localStorage.setItem(`hf_music_${k}`, v); } catch { /* private mode */ } };
const SV = (d, fill = false) => raw(`<svg viewBox="0 0 24 24" fill="${fill ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`);
const I = {
  heart: SV('<path d="M12 20.5s-7.5-4.6-9.3-9.4C1.3 7.3 4 4 7.4 4c2 0 3.4 1.1 4.6 2.7C13.2 5.1 14.6 4 16.6 4 20 4 22.7 7.3 21.3 11.1 19.5 15.9 12 20.5 12 20.5z"/>'),
  heartOn: SV('<path d="M12 20.5s-7.5-4.6-9.3-9.4C1.3 7.3 4 4 7.4 4c2 0 3.4 1.1 4.6 2.7C13.2 5.1 14.6 4 16.6 4 20 4 22.7 7.3 21.3 11.1 19.5 15.9 12 20.5 12 20.5z"/>', true),
  lyrics: SV('<path d="M4 5h11M4 10h16M4 15h9M4 20h13"/>'), queue: SV('<path d="M4 6h12M4 12h12M4 18h8M18 15v6l4-3z"/>'),
  radio: SV('<circle cx="12" cy="12" r="2.2"/><path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4M4.9 4.9a10 10 0 0 0 0 14.2M19.1 4.9a10 10 0 0 1 0 14.2"/>'),
  moon: SV('<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"/>'), expand: SV('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'), shrink: SV('<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>'),
  more: SV('<circle cx="5.5" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="18.5" cy="12" r="1.6" fill="currentColor"/>'),
  grip: SV('<circle cx="9" cy="6" r="1.3" fill="currentColor"/><circle cx="15" cy="6" r="1.3" fill="currentColor"/><circle cx="9" cy="12" r="1.3" fill="currentColor"/><circle cx="15" cy="12" r="1.3" fill="currentColor"/><circle cx="9" cy="18" r="1.3" fill="currentColor"/><circle cx="15" cy="18" r="1.3" fill="currentColor"/>'),
  search: SV('<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>'), album: SV('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.5"/>'), artist: SV('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'),
  next: SV('<path d="M4 6h10M4 12h10M4 18h6M17 10v8M13 14h8"/>'),
};

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
  a.addEventListener('timeupdate', () => { if (S.seeking == null) progress(); sleepTick(); });
  a.addEventListener('ended', () => {
    if (S.sleep?.mode === 'song') { S.sleep = null; paintSleep(); paint(); toast('Sleep timer: goodnight'); return; }
    next(true);
  });
  a.addEventListener('play', () => { paint(); session(); lyricLoop(); toApp('playing'); });
  a.addEventListener('pause', () => { paint(); toApp('paused'); });
  a.addEventListener('seeked', () => toApp(a.paused ? 'paused' : 'playing'));
  a.addEventListener('loadedmetadata', () => toApp(a.paused ? 'paused' : 'playing'));
  a.addEventListener('volumechange', paintVolume);
  a.addEventListener('error', () => {
    const t = cur();
    if (!t || !a.getAttribute('src')) return;
    // The browser refused the file after all: ask the NAS for an MP3 instead.
    if (!a.src.includes('/api/audio/')) { t.codec = 'force-mp3'; load(time(), true); return; }
    toast(`Could not play ${t.title}`);
    next(true);
  });
  a.volume = Math.max(0, Math.min(1, +pref('volume', 1)));
  return a;
}

const time = () => S.offset + (S.audio?.currentTime || 0);

/**
 * The HallFlix Android app shows what is playing in a notification and on the lock screen, and keeps the music going
 * with the screen off. Its buttons call HallFlix.music.resume/pause/next/prev/seek/stop.
 */
function toApp(state) {
  const N = window.HallFlixNative;
  if (!N?.music) return;
  const t = cur();
  try {
    N.music(JSON.stringify(state === 'stopped' || !t ? { state: 'stopped' }
      : { state, title: t.title || '', artist: t.author || '', album: t.album || '', art: t.poster ? new URL(t.poster, location.href).href : '', position: time(), duration: length() }));
  } catch { /* the app is older than this page */ }
}
const length = () => cur()?.runtime || (Number.isFinite(S.audio?.duration) ? S.offset + S.audio.duration : 0);

function load(at = 0, play = true) {
  const t = cur(), a = audio();
  if (!t) return;
  if (playable(t)) { S.offset = 0; a.src = `/api/file/${t.id}`; if (at > 0) a.addEventListener('loadedmetadata', () => { a.currentTime = at; }, { once: true }); }
  else { S.offset = at; a.src = `/api/audio/${t.id}${at > 0 ? `?at=${Math.floor(at)}` : ''}`; }
  if (play) a.play().catch(() => paint());
  S.line = -1;
  render();
  markPlaying();
  if (at === 0) fetch('/api/progress', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ itemId: t.id }) }).catch(() => {});
  // Warm up the next song so the gap between tracks is as short as the browser allows.
  const nx = S.queue[S.order[S.at + 1]];
  if (nx && playable(nx)) { S.pre ||= new Audio(); S.pre.preload = 'auto'; S.pre.muted = true; if (!S.pre.src.endsWith(`/api/file/${nx.id}`)) S.pre.src = `/api/file/${nx.id}`; }
  lyricsFor(t).catch(() => {}); // fetch early so they are ready when the panel opens
}

// ---------- likes ----------
async function likedSet() {
  if (!S.liked) { try { S.liked = new Set(await api('GET', '/api/music/liked/ids')); } catch { S.liked = new Set(); } }
  return S.liked;
}
export const isLiked = (id) => !!S.liked?.has(+id);
export async function toggleLike(t) {
  const set = await likedSet(), on = !set.has(t.id);
  if (on) set.add(t.id); else set.delete(t.id);
  paintLikes();
  try { await api('POST', '/api/mylist', { itemId: t.id, on }); toast(on ? 'Added to Liked songs' : 'Removed from Liked songs', 1600); dispatchEvent(new Event('hallflix-playlists')); }
  catch (e) { if (on) set.delete(t.id); else set.add(t.id); paintLikes(); toast(e.message); }
}
function paintLikes() {
  const t = cur();
  for (const b of $$('[data-like]')) {
    const id = +b.dataset.like || t?.id, on = isLiked(id);
    b.classList.toggle('on', on); b.innerHTML = String(on ? I.heartOn : I.heart);
    b.setAttribute('aria-label', on ? 'Remove from Liked songs' : 'Add to Liked songs'); b.setAttribute('aria-pressed', String(on));
  }
}

// ---------- lyrics ----------
/** Lyrics services added by plugins in the browser: HallFlix.addLyricsProvider({ name, find(track) }). */
export const lyricsProviders = [];
async function lyricsFor(t) {
  if (t.lyrics !== undefined) return t.lyrics;
  t.lyrics = t.lyricsLoading ||= (async () => {
    let l = {};
    try { l = await api('GET', `/api/lyrics/${t.id}`); } catch { l = {}; }
    if (!l.synced && !l.plain && lyricsProviders.length) {
      for (const p of lyricsProviders) {
        try {
          const got = await p.find({ id: t.id, title: t.title, artist: t.author || '', album: t.album || '', duration: t.runtime || 0 });
          const lrc = Array.isArray(got?.synced) ? got.synced.map((x) => `[${fmtStamp(x.t)}]${x.text}`).join('\n') : got?.synced || got?.lrc;
          if (lrc || got?.plain) { l = await api('POST', `/api/lyrics/${t.id}`, { lrc, plain: got.plain, source: p.name }); break; }
        } catch (e) { console.warn('[lyrics]', p.name, e); }
      }
    }
    return l;
  })();
  t.lyrics = await t.lyrics;
  delete t.lyricsLoading;
  return t.lyrics;
}
const fmtStamp = (s) => { const m = Math.floor(s / 60); return `${String(m).padStart(2, '0')}:${(s - m * 60).toFixed(2).padStart(5, '0')}`; };
const lyricsShown = () => !full().hidden && (S.full || S.side === 'lyrics');
const lyricBox = () => (S.full ? $('#nowplaying .np-big') : $('#nowplaying .np-side'));

/** The lines to show, with a "♪ • • •" line for long instrumental gaps. */
function linesOf(l) {
  const out = [];
  const src = l.synced || [];
  if (src.length && src[0].t > 4) out.push({ t: 0, text: '', gap: true });
  src.forEach((x, i) => {
    out.push({ ...x, gap: !x.text });
    const nx = src[i + 1];
    if (x.text && nx && nx.t - x.t > 14) out.push({ t: x.t + Math.min(6, (nx.t - x.t) / 3), text: '', gap: true });
  });
  return out;
}
function lyricBar(t, l) {
  return html`<div class="np-lyrbar">${l.source ? html`<span class="np-src">Lyrics: ${l.source}</span>` : html`<span class="np-src"></span>`}
    ${l.synced ? html`<span class="np-off"><button data-lyr="earlier" title="Show the lyrics earlier" aria-label="Show the lyrics earlier">−</button><b data-offset>${offsetText(l.offset)}</b><button data-lyr="later" title="Show the lyrics later" aria-label="Show the lyrics later">+</button></span>` : ''}
    <button data-lyr="search" class="np-lbtn">${I.search} ${l.synced || l.plain ? 'Not right?' : 'Find lyrics'}</button></div>`;
}
const offsetText = (o) => (o ? `${o > 0 ? '+' : ''}${(+o).toFixed(1)}s` : 'In time');
async function drawLyrics() {
  const t = cur(), box = lyricBox();
  if (!t || !box) return;
  box.classList.add('np-lyrwrap');
  if (t.lyrics === undefined) box.innerHTML = '<p class="np-none np-pulse">Looking for lyrics…</p>';
  const l = await lyricsFor(t);
  if (cur() !== t || !lyricsShown() || !box.isConnected || box !== lyricBox()) return;
  S.line = -1;
  if (l.synced) {
    S.lines = linesOf(l);
    box.innerHTML = String(html`<ol class="np-lyrics synced ${l.words ? 'words' : ''}">${S.lines.map((x, i) => html`<li class="${x.gap ? 'gap' : ''}"><button data-line="${i}" tabindex="${x.gap ? -1 : 0}">${x.gap ? raw('<span class="dots"><i></i><i></i><i></i></span>')
      : x.words ? html`<span class="ln">${x.words.map((w) => html`<span class="w">${w.text}</span>`)}</span>` : html`<span class="ln">${x.text}</span>`}</button></li>`)}</ol>${lyricBar(t, l)}`);
  } else if (l.plain) {
    S.lines = null;
    box.innerHTML = String(html`<div class="np-lyrics plain">${l.plain}</div>${lyricBar(t, l)}`);
  } else {
    S.lines = null;
    box.innerHTML = String(html`<div class="np-nolyrics"><p class="np-none">No lyrics found for this song yet.</p>
      <div class="np-lacts"><button class="btn small" data-lyr="search">${I.search} Search for lyrics</button><button class="btn small" data-lyr="paste">Paste lyrics</button></div>
      <p class="np-hint">HallFlix looks for a .lrc or .txt file with the same name next to the song, the song's own tags, then the lyrics services set up in the Studio.</p></div>`);
  }
  lyricLoop(true);
}

/** Every frame while lyrics are on screen: which line is sung, and how far through it. */
function lyricLoop(force = false) {
  cancelAnimationFrame(S.lrRaf);
  const step = () => {
    const box = lyricBox();
    const lines = S.lines;
    if (!lines || !box || !lyricsShown()) return;
    const off = cur()?.lyrics?.offset || 0;
    const now = time() - off + 0.12;
    let i = -1;
    for (let k = 0; k < lines.length && lines[k].t <= now; k++) i = k;
    const rows = box.querySelectorAll('.np-lyrics.synced > li');
    if (i !== S.line || force) {
      force = false;
      rows.forEach((li, k) => { li.classList.toggle('now', k === i); li.classList.toggle('past', k < i); li.classList.toggle('next', k === i + 1); });
      S.line = i;
      if (Date.now() - S.userScrollAt > 3500) rows[Math.max(0, i)]?.scrollIntoView({ block: 'center', behavior: tv() || calm() ? 'auto' : 'smooth' });
    }
    // The sweep across the current line, and word by word when there is word timing.
    if (i >= 0 && rows[i]) {
      const ln = lines[i], end = lines[i + 1]?.t ?? ln.t + 5, f = Math.max(0, Math.min(1, (now - ln.t) / Math.max(0.3, end - ln.t)));
      rows[i].style.setProperty('--fill', `${(f * 100).toFixed(1)}%`);
      if (ln.words) {
        const ws = rows[i].querySelectorAll('.w');
        ln.words.forEach((w, k) => {
          const wEnd = ln.words[k + 1]?.t ?? end;
          ws[k]?.classList.toggle('sung', now >= wEnd);
          ws[k]?.classList.toggle('singing', now >= w.t && now < wEnd);
          if (now >= w.t && now < wEnd) ws[k].style.setProperty('--wf', `${Math.min(100, ((now - w.t) / Math.max(0.1, wEnd - w.t)) * 100).toFixed(0)}%`);
        });
      }
    }
    if (playing()) S.lrRaf = requestAnimationFrame(step);
  };
  step();
}

async function lyricAction(kind) {
  const t = cur();
  if (!t) return;
  const box = lyricBox();
  if (kind === 'earlier' || kind === 'later') {
    const l = await lyricsFor(t);
    l.offset = Math.round(((l.offset || 0) + (kind === 'later' ? 0.5 : -0.5)) * 10) / 10;
    $$('#nowplaying [data-offset]').forEach((b) => { b.textContent = offsetText(l.offset); });
    S.line = -1; lyricLoop(true);
    clearTimeout(S.offT);
    S.offT = setTimeout(() => api('PUT', `/api/lyrics/${t.id}/offset`, { offset: l.offset }).catch(() => {}), 600);
    return;
  }
  if (kind === 'paste') {
    box.innerHTML = String(html`<form class="np-paste"><p class="np-none">Paste lyrics for <b>${t.title}</b>. Time-synced lyrics in LRC form ([00:12.34] at the start of each line) will follow the music.</p>
      <textarea name="text" rows="10" placeholder="[00:12.34] First line…" aria-label="Lyrics"></textarea>
      <div class="np-lacts"><button class="btn primary small">Save</button><button class="btn small" type="button" data-lyr="back">Cancel</button></div></form>`);
    $('textarea', box).focus();
    $('form', box).onsubmit = async (e) => {
      e.preventDefault();
      const text = new FormData(e.target).get('text');
      try { t.lyrics = await api('POST', `/api/lyrics/${t.id}`, { lrc: text, source: 'Added by hand' }); toast('Lyrics saved'); drawLyrics(); } catch (err) { toast(err.message); }
    };
    return;
  }
  if (kind === 'back') { drawLyrics(); return; }
  if (kind === 'reset') {
    try { t.lyrics = await api('DELETE', `/api/lyrics/${t.id}`); toast('Looking again'); drawLyrics(); } catch (err) { toast(err.message); }
    return;
  }
  if (kind === 'search') {
    const q = `${t.author || ''} ${t.title}`.trim();
    box.innerHTML = String(html`<form class="np-search"><input name="q" value="${q}" aria-label="Search lyrics" autocomplete="off"><button class="btn small primary">${I.search} Search</button><button class="btn small" type="button" data-lyr="back">Back</button></form>
      <div class="np-results"><p class="np-none np-pulse">Searching…</p></div><div class="np-lacts np-foot"><button class="linkbtn" data-lyr="paste">Paste your own</button>${t.lyrics?.chosen ? html`<button class="linkbtn" data-lyr="reset">Go back to the automatic ones</button>` : ''}</div>`);
    const run = async (term) => {
      const out = $('.np-results', box);
      try {
        const d = await api('GET', `/api/lyrics/${t.id}/search?q=${encodeURIComponent(term)}`);
        if (!out.isConnected) return;
        S.results = d.results;
        out.innerHTML = String(d.results.length ? html`<ul class="np-res">${d.results.map((x, i) => {
          const off = d.duration && x.duration ? Math.round(x.duration - d.duration) : null;
          return html`<li><button data-pick="${i}"><b>${x.title || 'Untitled'}</b><small>${[x.artist, x.album, x.provider].filter(Boolean).join(' · ')}</small>
            <span class="np-tags">${x.synced ? html`<span class="on">Synced</span>` : x.instrumental ? html`<span>Instrumental</span>` : html`<span>Plain</span>`}${off != null ? html`<span class="${Math.abs(off) <= 2 ? 'on' : ''}">${Math.abs(off) <= 2 ? 'Same length' : `${off > 0 ? '+' : ''}${off}s`}</span>` : ''}</span>
            <em>${String(x.synced || x.plain || '').replace(/\[[^\]]*\]/g, '').split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 2).join(' / ')}</em></button></li>`;
        })}</ul>` : html`<p class="np-none">Nothing found${d.errors?.length ? ` (${d.errors.join('; ')})` : ''}. Try fewer words, or paste your own.</p>`);
      } catch (err) { out.innerHTML = String(html`<p class="np-none">${err.message}</p>`); }
    };
    $('form', box).onsubmit = (e) => { e.preventDefault(); run(new FormData(e.target).get('q')); };
    run(q);
  }
}
async function pickLyrics(i) {
  const t = cur(), x = S.results?.[i];
  if (!t || !x) return;
  try { t.lyrics = await api('POST', `/api/lyrics/${t.id}`, { lrc: x.synced, plain: x.synced ? undefined : x.plain, instrumental: x.instrumental && !x.synced && !x.plain, source: x.provider }); toast('Lyrics saved for this song'); drawLyrics(); }
  catch (err) { toast(err.message); }
}

// ---------- the queue ----------
function reorder(startAt) {
  S.order = S.queue.map((_, i) => i);
  if (S.shuffle) {
    for (let i = S.order.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [S.order[i], S.order[j]] = [S.order[j], S.order[i]]; }
    if (startAt != null) { S.order.splice(S.order.indexOf(startAt), 1); S.order.unshift(startAt); }
  }
}

/** Play a list of tracks, starting at `index`. `source` names where it came from ("Night Drive", "Neon Rain radio"). */
export function play(tracks, index = 0, { shuffle, source } = {}) {
  if (!tracks?.length) return;
  dispatchEvent(new Event('hallflix-music'));
  S.queue = tracks.map((t) => ({ ...t }));
  S.source = source || tracks[index]?.album || '';
  if (shuffle != null) S.shuffle = shuffle;
  reorder(S.shuffle ? (shuffle ? Math.floor(Math.random() * tracks.length) : index) : null);
  S.at = S.shuffle ? 0 : index;
  load(0);
}
/** Songs to play straight after the current one. */
export function playNext(tracks) {
  if (!cur()) return play(tracks, 0);
  const start = S.queue.length;
  S.queue.push(...tracks.map((t) => ({ ...t })));
  S.order.splice(S.at + 1, 0, ...tracks.map((_, k) => start + k));
  toast(tracks.length === 1 ? `${tracks[0].title} plays next` : `${tracks.length} songs play next`, 1800);
  queueChanged();
}
/** Songs to play after everything already queued. */
export function addToQueue(tracks) {
  if (!cur()) return play(tracks, 0);
  const start = S.queue.length;
  S.queue.push(...tracks.map((t) => ({ ...t })));
  S.order.push(...tracks.map((_, k) => start + k));
  toast(tracks.length === 1 ? `Added ${tracks[0].title} to the queue` : `Added ${tracks.length} songs to the queue`, 1800);
  queueChanged();
}
/** Radio from a song, artist, album or genre: keeps the current song playing and queues the mix after it. */
export async function startRadio(seed, { library, keep = true } = {}) {
  try {
    const d = await api('GET', `/api/radio?seed=${encodeURIComponent(seed)}${library ? `&library=${library}` : ''}`);
    if (!d.tracks.length) { toast('Nothing to play yet'); return; }
    const now = cur();
    if (keep && now && seed === `track:${now.id}`) {
      S.queue = [now, ...d.tracks.filter((t) => t.id !== now.id).map((t) => ({ ...t }))];
      S.order = S.queue.map((_, i) => i); S.at = 0; S.shuffle = false; S.source = d.title;
      queueChanged(); render(); toast(`${d.title}: ${d.tracks.length} songs`, 2000);
    } else { S.shuffle = false; play(d.tracks, 0, { source: d.title }); }
  } catch (e) { toast(e.message); }
}
function queueChanged() {
  const nx = S.queue[S.order[S.at + 1]];
  if (nx && playable(nx)) { S.pre ||= new Audio(); S.pre.preload = 'auto'; S.pre.muted = true; if (!S.pre.src.endsWith(`/api/file/${nx.id}`)) S.pre.src = `/api/file/${nx.id}`; }
  if (!full().hidden && !S.full && S.side === 'queue') drawSide();
  paintQueueCount();
}
function moveUpcoming(from, to) {
  const base = S.at + 1, list = S.order.splice(base + from, 1);
  S.order.splice(base + Math.max(0, Math.min(to, S.order.length - base)), 0, ...list);
  queueChanged();
}
function removeUpcoming(k) { S.order.splice(S.at + 1 + k, 1); queueChanged(); }
function clearUpcoming() { S.order.splice(S.at + 1); queueChanged(); toast('Queue cleared', 1400); }
const upcoming = () => S.order.slice(S.at + 1).map((i) => S.queue[i]);
function paintQueueCount() { for (const el of $$('[data-qcount]')) el.textContent = upcoming().length ? String(upcoming().length) : ''; }

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
  S.line = -1;
  progress(); lyricLoop(true);
}
function stop() {
  if (S.audio) { S.audio.pause(); S.audio.removeAttribute('src'); S.audio.load(); }
  S.queue = []; S.order = []; S.at = -1; S.sleep = null;
  closeFull();
  bar().hidden = true; document.body.classList.remove('has-nowbar');
  if ('mediaSession' in navigator) navigator.mediaSession.metadata = null;
  markPlaying();
  toApp('stopped');
}

// ---------- volume and sleep timer ----------
function setVolume(v) {
  const a = audio();
  a.volume = Math.max(0, Math.min(1, v)); a.muted = false;
  setPref('volume', String(a.volume));
}
function paintVolume() {
  const v = S.audio ? (S.audio.muted ? 0 : S.audio.volume) : 1;
  for (const r of $$('[data-vol]')) { if (document.activeElement !== r) r.value = String(v); r.style.setProperty('--p', `${v * 100}%`); }
  for (const b of $$('[data-act=mute]')) b.innerHTML = String(v === 0 ? icons.mute : icons.vol);
}
const SLEEP = [[0, 'Off'], [15, '15 minutes'], [30, '30 minutes'], [45, '45 minutes'], [60, '1 hour'], ['song', 'End of this song']];
function setSleep(v) {
  if (!v) S.sleep = null;
  else if (v === 'song') S.sleep = { mode: 'song' };
  else S.sleep = { mode: 'time', until: Date.now() + v * 60e3 };
  paintSleep();
  toast(!v ? 'Sleep timer off' : v === 'song' ? 'Music stops at the end of this song' : `Music stops in ${v} minutes`, 1800);
}
function sleepTick() {
  if (S.sleep?.mode !== 'time') return;
  const left = S.sleep.until - Date.now();
  if (left <= 0 && !S.sleep.fading) {
    S.sleep.fading = true;
    const a = S.audio, from = a.volume;
    let k = 0;
    const fade = setInterval(() => { k++; a.volume = Math.max(0, from * (1 - k / 20)); if (k >= 20) { clearInterval(fade); a.pause(); a.volume = from; S.sleep = null; paintSleep(); toast('Sleep timer: goodnight'); } }, 200);
  }
  if (left > 0) paintSleep();
}
function paintSleep() {
  const label = !S.sleep ? '' : S.sleep.mode === 'song' ? 'End of song' : `${Math.max(1, Math.ceil((S.sleep.until - Date.now()) / 60e3))} min`;
  for (const b of $$('[data-act=sleep]')) { b.classList.toggle('on', !!S.sleep); const s = $('small', b); if (s) s.textContent = label; b.title = S.sleep ? `Sleep timer: ${label}` : 'Sleep timer'; }
}

// ---------- menus ----------
let menuEl = null;
function closeMenu() { menuEl?.remove(); menuEl = null; }
function popMenu(btn, body, onPick) {
  closeMenu();
  const m = menuEl = document.createElement('div');
  m.className = 'menu tk-menu';
  m.innerHTML = String(body);
  document.body.append(m);
  const r = btn.getBoundingClientRect(), w = m.offsetWidth, h = m.offsetHeight;
  m.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, r.right - w))}px`;
  m.style.top = `${r.bottom + h + 8 > innerHeight ? Math.max(8, r.top - h - 6) : r.bottom + 6}px`;
  m.addEventListener('click', (e) => { const b = e.target.closest('[data-m]'); if (b) { e.preventDefault(); e.stopPropagation(); const v = b.dataset.m; closeMenu(); onPick(v, b); } });
  m.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeMenu(); btn.focus(); } });
  $('button, a', m)?.focus();
}
/** The ⋯ menu for a song anywhere in HallFlix. */
export async function trackMenu(btn, t, { list } = {}) {
  await likedSet();
  const liked = isLiked(t.id);
  popMenu(btn, html`<div class="who">${t.title}<small>${[t.author, t.album].filter(Boolean).join(' · ')}</small></div>
    <button data-m="next">${I.next} Play next</button><button data-m="queue">${I.queue} Add to queue</button>
    <button data-m="radio">${I.radio} Start song radio</button><button data-m="like">${liked ? I.heartOn : I.heart} ${liked ? 'Remove from Liked songs' : 'Add to Liked songs'}</button>
    <button data-m="playlist">${icons.plus} Add to a playlist</button>${canDownload() ? html`<button data-m="download">${raw(DL_ICON)} Download</button>` : ''}
    ${t.albumId ? html`<a href="#/title/${t.albumId}" data-m="album">${I.album} Go to the album</a>` : ''}${t.artistId ? html`<a href="#/title/${t.artistId}" data-m="artist">${I.artist} Go to the artist</a>` : ''}
    ${list?.length > 1 ? html`<button data-m="allnext">${I.next} Play all ${list.length} next</button>` : ''}`, (v) => {
    if (v === 'next') playNext([t]);
    else if (v === 'queue') addToQueue([t]);
    else if (v === 'radio') startRadio(`track:${t.id}`, { keep: false });
    else if (v === 'like') toggleLike(t);
    else if (v === 'playlist') pickPlaylist([t.id]);
    else if (v === 'download') download([t.id], { title: t.title });
    else if (v === 'album') location.hash = `#/title/${t.albumId}`;
    else if (v === 'artist') location.hash = `#/title/${t.artistId}`;
    else if (v === 'allnext') playNext(list);
  });
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

/** Songs on screen that are playing now get a moving equaliser. */
export function markPlaying() {
  const id = cur()?.id;
  for (const el of $$('[data-tid].playing')) if (+el.dataset.tid !== id) el.classList.remove('playing');
  if (id) for (const el of $$(`[data-tid="${id}"]`)) el.classList.add('playing');
}

// ---------- the bar along the bottom ----------
function render() {
  const t = cur();
  if (!t) return;
  const b = bar();
  b.hidden = false; document.body.classList.add('has-nowbar');
  b.innerHTML = String(html`<div class="nb-progress" data-seek><i></i></div>
    <button class="nb-art" data-open aria-label="Open Now Playing">${t.poster ? html`<img src="${t.poster}" alt="">` : html`<span>♪</span>`}</button>
    <div class="nb-textrow"><button class="nb-text" data-open><b>${t.title}</b><small>${[t.author, t.album].filter(Boolean).join(' · ')}</small></button><button class="nb-like" data-like="${t.id}"></button></div>
    <div class="nb-controls"><button data-act="prev" aria-label="Previous">${icons.rew}</button>
      <button class="nb-play" data-act="toggle" aria-label="Play or pause"></button>
      <button data-act="next" aria-label="Next">${icons.fwd}</button></div>
    <div class="nb-right"><span class="nb-time"></span>
      <button data-open="lyrics" aria-label="Lyrics" title="Lyrics">${I.lyrics}</button>
      <button data-open="queue" aria-label="Queue" title="Queue" class="nb-q">${I.queue}<small data-qcount></small></button>
      <span class="nb-vol"><button data-act="mute" aria-label="Mute">${icons.vol}</button><input type="range" min="0" max="1" step="0.01" data-vol aria-label="Volume"></span>
      <button class="nb-close" data-act="stop" aria-label="Stop and close">${icons.x}</button></div>`);
  tint(b, t.poster);
  paint(); progress(); paintVolume(); paintQueueCount();
  likedSet().then(paintLikes);
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
  if (a) a.textContent = fmtTime(t); if (z) z.textContent = `-${fmtTime(Math.max(0, len - t))}`;
}

// ---------- Now Playing ----------
S.full = pref('lyricsfull', '0') === '1';
function drawFull() {
  const t = cur(), f = full();
  if (!t) return;
  f.classList.toggle('lyrics-full', !!S.full);
  f.innerHTML = String(html`<div class="np-bg" style="${t.poster ? `background-image:url('${t.poster}')` : ''}"></div>
    <header class="np-top"><button class="btn round np-close" data-close aria-label="Close">${icons.back}</button>
      <div class="np-from">${S.source ? html`<small>Playing from</small><b>${S.source}</b>` : ''}</div>
      <button class="np-tool" data-act="sleep" aria-label="Sleep timer">${I.moon}<small></small></button>
      <button class="np-tool ${S.full ? 'on' : ''}" data-act="lyricsfull" aria-label="${S.full ? 'Leave full-screen lyrics' : 'Full-screen lyrics'}" title="${S.full ? 'Leave full-screen lyrics' : 'Full-screen lyrics'}">${S.full ? I.shrink : I.expand}</button></header>
    <div class="np-main">
      <div class="np-art">${t.poster ? html`<img src="${t.poster}" alt="">` : html`<span>♪</span>`}<canvas class="np-viz" width="600" height="120" aria-hidden="true"></canvas></div>
      <div class="np-info">
        <div class="np-head"><img class="np-thumb" src="${t.poster || ''}" alt="" ${t.poster ? '' : raw('hidden')}><div class="np-titles"><h1>${t.title}</h1>
          <p class="np-sub">${t.author ? (t.artistId ? html`<a href="#/title/${t.artistId}" data-close>${t.author}</a>` : html`<span>${t.author}</span>`) : ''}${t.album ? html` · <a href="#/title/${t.albumId}" data-close>${t.album}</a>` : ''}</p></div>
          <button class="np-heart" data-like="${t.id}"></button><button class="np-tool" data-tmenu aria-label="More for this song">${I.more}</button></div>
        <div class="np-seek"><span class="np-t0"></span><input type="range" min="0" step="1" data-range aria-label="Seek"><span class="np-t1"></span></div>
        <div class="np-controls">
          <button class="np-mode ${S.shuffle ? 'on' : ''}" data-act="shuffle" aria-label="Shuffle" title="Shuffle">${icons.shuffle}</button>
          <button data-act="prev" aria-label="Previous">${icons.rew}</button>
          <button class="np-play" data-act="toggle" aria-label="Play or pause"></button>
          <button data-act="next" aria-label="Next">${icons.fwd}</button>
          <button class="np-mode ${S.repeat !== 'off' ? 'on' : ''}" data-act="repeat" aria-label="Repeat: ${S.repeat}" title="Repeat: ${S.repeat === 'one' ? 'this song' : S.repeat === 'all' ? 'all' : 'off'}">${icons.repeat}${S.repeat === 'one' ? html`<i>1</i>` : ''}</button>
        </div>
        <div class="np-vol"><button data-act="mute" aria-label="Mute">${icons.vol}</button><input type="range" min="0" max="1" step="0.01" data-vol aria-label="Volume">
          <button class="np-chip" data-act="radio" title="A mix that starts from this song">${I.radio} Song radio</button></div>
        <div class="np-tabs"><button data-side="lyrics">${I.lyrics} Lyrics</button><button data-side="queue">${I.queue} Up next <small data-qcount></small></button><span></span></div>
        <div class="np-side"></div>
      </div>
      <section class="np-big" aria-label="Lyrics"></section></div>`);
  if (S.full) drawLyrics(); else drawSide();
  tint(f, t.poster);
  paint(); progress(); paintVolume(); paintSleep(); paintQueueCount();
  likedSet().then(paintLikes);
  viz();
  for (const box of [$('.np-side', f), $('.np-big', f)]) for (const ev of ['wheel', 'touchmove']) box?.addEventListener(ev, () => { S.userScrollAt = Date.now(); }, { passive: true });
}
function drawSide() {
  const box = $('#nowplaying .np-side');
  if (!box) return;
  for (const b of $$('#nowplaying [data-side]')) b.classList.toggle('on', b.dataset.side === S.side);
  box.classList.remove('np-lyrwrap');
  if (S.side === 'lyrics') return drawLyrics();
  const up = upcoming();
  box.innerHTML = String(html`<div class="np-qhead"><span>${S.source ? html`From <b>${S.source}</b>` : ''}</span>${up.length ? html`<button class="linkbtn" data-q="save">Save as playlist</button><button class="linkbtn" data-q="clear">Clear</button>` : ''}</div>
    ${up.length ? html`<ol class="np-queue">${up.slice(0, 200).map((x, k) => html`<li draggable="true" data-k="${k}" data-tid="${x.id}"><span class="grip" aria-hidden="true">${I.grip}</span>
      <button data-jump="${S.at + 1 + k}" class="np-qmain">${x.poster ? html`<img src="${x.poster}" alt="" loading="lazy">` : html`<i class="np-qart"></i>`}<span><b>${x.title}</b><small>${x.author || ''}</small></span><em>${fmtTime(x.runtime)}</em></button>
      <button class="np-qx" data-q="remove" data-k="${k}" aria-label="Remove ${x.title} from the queue">${icons.x}</button></li>`)}</ol>`
    : html`<p class="np-none">Nothing else is queued. Use ⋯ on any song to play it next, or start a song radio.</p>`}`);
}
export function openFull(side) {
  if (!cur()) return;
  if (side) { S.side = side; if (side === 'queue') S.full = false; }
  full().hidden = false; document.body.classList.add('locked');
  drawFull();
  $('#nowplaying [data-act=toggle]')?.focus();
}
function closeFull() {
  if (full().hidden) return;
  full().hidden = true; full().innerHTML = ''; cancelAnimationFrame(S.raf); cancelAnimationFrame(S.lrRaf);
  if ($('#overlay').childElementCount === 0 && $('#player').hidden && $('#reader').hidden) document.body.classList.remove('locked');
}

/** Bars that move with the music, drawn only while Now Playing is open on a computer or phone. */
function viz() {
  cancelAnimationFrame(S.raf);
  const cv = $('#nowplaying .np-viz');
  if (!cv || tv() || calm()) { cv?.remove(); return; }
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
  mute: () => { const a = audio(); if (a.muted || a.volume === 0) { a.muted = false; if (a.volume === 0) setVolume(0.6); } else a.muted = true; },
  radio: () => { const t = cur(); if (t) startRadio(`track:${t.id}`); },
  lyricsfull: () => { S.full = !S.full; setPref('lyricsfull', S.full ? '1' : '0'); if (!S.full && S.side !== 'queue') S.side = 'lyrics'; drawFull(); },
  sleep: (btn) => popMenu(btn, html`<div class="who">Sleep timer<small>${S.sleep ? 'On' : 'Stops the music after a while'}</small></div>${SLEEP.map(([v, n]) => html`<button data-m="${v}">${n}</button>`)}`, (v) => setSleep(v === 'song' ? 'song' : +v)),
};

export function initMusic() {
  addEventListener('click', (e) => {
    if (menuEl && !e.target.closest('.tk-menu')) closeMenu();
    const zone = e.target.closest('#nowbar, #nowplaying');
    if (!zone) return;
    const act = e.target.closest('[data-act]');
    if (act) { e.preventDefault(); actions[act.dataset.act]?.(act); return; }
    const like = e.target.closest('[data-like]');
    if (like) { const t = cur(); if (t) toggleLike(t); return; }
    if (e.target.closest('[data-tmenu]')) { const t = cur(); if (t) trackMenu(e.target.closest('[data-tmenu]'), t); return; }
    const jump = e.target.closest('[data-jump]');
    if (jump) { S.at = +jump.dataset.jump; load(0); return; }
    const q = e.target.closest('[data-q]');
    if (q) {
      if (q.dataset.q === 'remove') removeUpcoming(+q.dataset.k);
      else if (q.dataset.q === 'clear') clearUpcoming();
      else if (q.dataset.q === 'save') {
        const name = prompt('Name the playlist', S.source || 'My queue');
        if (name?.trim()) api('POST', '/api/music/queue-to-playlist', { name: name.trim(), ids: [cur().id, ...upcoming().map((x) => x.id)] }).then((p) => toast(`Saved as ${p.name}`), (err) => toast(err.message));
      }
      return;
    }
    const lyr = e.target.closest('[data-lyr]');
    if (lyr) { e.preventDefault(); lyricAction(lyr.dataset.lyr); return; }
    const pick = e.target.closest('[data-pick]');
    if (pick) { pickLyrics(+pick.dataset.pick); return; }
    const op = e.target.closest('[data-open]');
    if (op) { openFull(op.dataset.open || undefined); return; }
    const side = e.target.closest('[data-side]');
    if (side) { S.side = side.dataset.side; drawSide(); return; }
    const line = e.target.closest('[data-line]');
    if (line) { const l = S.lines?.[+line.dataset.line]; if (l) { S.userScrollAt = 0; seek(l.t + (cur()?.lyrics?.offset || 0)); } return; }
    if (e.target.closest('[data-close]')) { closeFull(); return; }
    const sk = e.target.closest('[data-seek]');
    if (sk) { const r = sk.getBoundingClientRect(); seek(((e.clientX - r.left) / r.width) * length()); }
  });
  addEventListener('click', (e) => { const b = e.target.closest('[data-addto]'); if (b) { e.preventDefault(); e.stopPropagation(); pickPlaylist(b.dataset.addto.split(',').map(Number)); } }, true);
  addEventListener('input', (e) => {
    if (e.target.matches('[data-vol]')) { setVolume(+e.target.value); return; }
    if (!e.target.matches('#nowplaying [data-range]')) return;
    S.seeking = +e.target.value; progress();
    e.target.style.setProperty('--p', `${(S.seeking / Math.max(1, +e.target.max)) * 100}%`);
  });
  addEventListener('change', (e) => { if (e.target.matches('#nowplaying [data-range]')) { const t = +e.target.value; S.seeking = null; seek(t); } });
  // Drag songs in the queue to reorder them.
  let dragK = null;
  addEventListener('dragstart', (e) => { const li = e.target.closest?.('#nowplaying .np-queue li'); if (!li) return; dragK = +li.dataset.k; li.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(dragK)); });
  addEventListener('dragover', (e) => { const li = e.target.closest?.('#nowplaying .np-queue li'); if (li && dragK != null) { e.preventDefault(); for (const x of $$('#nowplaying .np-queue li.over')) x.classList.remove('over'); li.classList.add('over'); } });
  addEventListener('drop', (e) => { const li = e.target.closest?.('#nowplaying .np-queue li'); if (li && dragK != null) { e.preventDefault(); moveUpcoming(dragK, +li.dataset.k); } dragK = null; });
  addEventListener('dragend', () => { dragK = null; for (const x of $$('#nowplaying .np-queue li.over, #nowplaying .np-queue li.dragging')) x.classList.remove('over', 'dragging'); });
  addEventListener('keydown', (e) => {
    if (full().hidden || $('.confirm')) return;
    if (menuEl && e.key === 'Escape') return;
    // Alt + ↑/↓ on a queued song moves it.
    const li = e.target.closest?.('#nowplaying .np-queue li');
    if (li && e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); const k = +li.dataset.k, to = k + (e.key === 'ArrowUp' ? -1 : 1); moveUpcoming(k, to); $(`#nowplaying .np-queue li[data-k="${Math.max(0, to)}"] .np-qmain`)?.focus(); return; }
    if (e.target.matches?.('input, textarea')) { if (e.key === 'Escape') { e.target.blur(); e.stopImmediatePropagation(); } return; }
    if (e.key === 'Escape' || e.key === 'Backspace' || e.key === 'GoBack') { e.preventDefault(); e.stopImmediatePropagation(); closeFull(); }
    else if ((e.key === ' ' || e.key === 'MediaPlayPause') && !e.target.matches('button')) { e.preventDefault(); toggle(); }
    else if (e.key === 'l' || e.key === 'L') actions.lyricsfull();
  }, true);
  // Video takes over the speakers.
  addEventListener('hallflix-video', () => { if (playing()) S.audio.pause(); closeFull(); });
  addEventListener('hashchange', () => { closeFull(); closeMenu(); });
  // Lists drawn later mark the song that is playing.
  let mt = 0;
  new MutationObserver(() => { clearTimeout(mt); mt = setTimeout(markPlaying, 60); }).observe(document.body, { childList: true, subtree: true });
  window.HallFlix && Object.assign(window.HallFlix, {
    music: { play, playNext, addToQueue, startRadio, toggle, next, prev, seek, stop,
      resume: () => { if (S.audio && cur() && S.audio.paused) S.audio.play().catch(() => {}); },
      pause: () => { if (S.audio && !S.audio.paused) S.audio.pause(); },
      get playing() { return playing(); }, get track() { return cur() || null; }, get queue() { return upcoming(); } },
    /** Add a lyrics service in the browser: { name, find(track) } resolving to { synced: "LRC text" | [{ t, text }], plain }. */
    addLyricsProvider(p) { if (p && typeof p.find === 'function') lyricsProviders.push({ name: String(p.name || 'Plugin'), find: p.find }); },
  });
}
export const hasQueue = () => !!cur();
