// HallFlix Downloads (built into the Android app; works offline).
// Lists what's saved on this phone, with progress while downloading, the space used and left, and Wi-Fi only.
// Films and episodes open in the app's own player (HallFlixNative.playOffline); music plays here, with the
// notification and lock-screen controls (HallFlixNative.music → MusicService, which calls window.HallFlix.music).
(() => {
  const N = window.HallFlixNative || {
    downloads: () => JSON.stringify({ items: [], used: 0, free: 0, wifiOnly: true }), deleteDownload() {}, setDownloadWifiOnly() {},
    playOffline() {}, goOnline() {}, music() {}, download() {}, saveReading() {},
  };
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const size = (n) => (!n ? '' : n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n >= 1e6 ? `${Math.round(n / 1e6)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);
  const VIDEO = new Set(['movie', 'episode', 'clip']);
  const ACTIVE = new Set(['preparing', 'downloading', 'paused']);
  let data = { items: [], used: 0, free: 0, wifiOnly: true };

  // ---------- the list ----------
  let timer = 0;
  function load() {
    try { data = JSON.parse(N.downloads()); } catch { data = { items: [], used: 0, free: 0, wifiOnly: true }; }
    draw();
    clearTimeout(timer);
    if (data.items.some((i) => ACTIVE.has(i.state))) timer = setTimeout(load, 2000);
  }
  addEventListener('hallflix-downloads', () => { clearTimeout(timer); timer = setTimeout(load, 150); });
  addEventListener('hallflix-native-closed', load); // back from the player: where it was stopped has changed

  const qualityName = (q) => (q === 'original' || !q ? 'Original' : `${q}p`);

  function status(it) {
    switch (it.state) {
      case 'preparing':
        if (it.progress > 0) return { text: `Your server is making a smaller copy… ${Math.round(it.progress * 100)}%`, p: it.progress };
        if (it.waiting > 0) return { text: `Waiting for your server (${it.waiting} ahead)` };
        return { text: 'Getting ready…' };
      case 'downloading': return { text: it.size ? `${size(it.bytes || 0)} of ${size(it.size)}` : 'Downloading…', p: it.size ? (it.bytes || 0) / it.size : 0 };
      case 'paused': return { text: `${it.why || 'Paused'} · ${size(it.bytes || 0)} of ${size(it.size)}`, p: it.size ? (it.bytes || 0) / it.size : 0 };
      case 'failed': return { text: it.error || 'The download failed', err: true };
      default: return null;
    }
  }

  function subtitle(it) {
    const m = it.meta || {};
    if (it.kind === 'episode' && m.show) return `S${m.show.season} E${m.show.episode} · ${it.title}`;
    if (it.kind === 'track') return [m.artist, m.album].filter(Boolean).join(' · ');
    if (it.kind === 'comic') return [it.read?.series?.title, it.read?.pages ? `${it.read.pages} pages` : ''].filter(Boolean).join(' · ');
    if (it.kind === 'book') return [m.author, it.read?.mode === 'pages' ? `${it.read.pages} pages` : 'Book'].filter(Boolean).join(' · ');
    return [m.year, m.runtime ? `${Math.round(m.runtime / 60)} min` : ''].filter(Boolean).join(' · ');
  }

  function itemHtml(it, { compact } = {}) {
    const st = status(it);
    const done = it.state === 'done';
    const playable = done && (VIDEO.has(it.kind) || it.kind === 'track' || it.kind === 'book' || it.kind === 'comic');
    const watched = done && it.kind !== 'track' && it.duration > 0 ? (it.watched && !it.position ? 1 : (it.position || 0) / it.duration) : 0;
    const name = it.kind === 'episode' && compact ? `E${it.meta?.show?.episode ?? ''} · ${it.title}` : it.title || 'Getting ready…';
    return `<div class="item ${it.kind === 'track' ? 'song' : ''}" data-id="${it.id}" ${playable ? 'data-play' : ''}>
      <div class="art" style="${it.posterUrl ? `background-image:url('${esc(it.posterUrl)}')` : ''}">${playable ? `<span class="play">${it.kind === 'book' || it.kind === 'comic' ? '📖' : '▶'}</span>` : ''}</div>
      <div class="t"><b>${esc(name)}</b>
        ${compact ? '' : `<span>${esc(subtitle(it))}</span>`}
        ${st ? `<span class="${st.err ? 'err' : ''}">${esc(st.text)}</span>${st.p != null ? `<div class="prog"><i style="width:${Math.round(st.p * 100)}%"></i></div>` : ''}`
          : `<span>${esc([size(it.size), VIDEO.has(it.kind) ? qualityName(it.quality) : ''].filter(Boolean).join(' · '))}</span>`}
        ${watched > 0.01 ? `<div class="watched"><i style="width:${Math.round(Math.min(1, watched) * 100)}%"></i></div>` : ''}
        ${it.state === 'failed' ? `<button class="btn" data-retry style="margin-top:6px">Try again</button>` : ''}
      </div>
      <button class="del" data-del aria-label="Delete ${esc(it.title)}" title="Delete">✕</button></div>`;
  }

  function draw() {
    const items = data.items || [];
    const pct = data.free + data.used > 0 ? data.used / (data.free + data.used) : 0;
    $('#space').innerHTML = `<div class="row"><span>${size(data.used) || '0 MB'} used by downloads</span><span>${size(data.free)} free</span></div>
      <div class="bar"><i style="width:${Math.max(1, Math.round(pct * 100))}%"></i></div>
      <label class="switch"><input type="checkbox" id="wifi" ${data.wifiOnly ? 'checked' : ''}> Download on Wi-Fi only</label>`;
    $('#online').hidden = false;
    if (!items.length) {
      $('#list').innerHTML = `<div class="empty"><b>Nothing downloaded yet</b>Tap Download on a movie, episode, song, album, book or comic in HallFlix, and it shows up here to enjoy without a connection.</div>`;
      return;
    }
    const by = (k) => items.filter((i) => k(i));
    const pending = by((i) => !i.kind);
    const movies = by((i) => i.kind === 'movie' || i.kind === 'clip');
    const eps = by((i) => i.kind === 'episode');
    const songs = by((i) => i.kind === 'track');
    const reading = by((i) => i.kind === 'book' || i.kind === 'comic');
    const out = [];
    if (pending.length) out.push(`<h2>Getting ready</h2>${pending.map((i) => itemHtml(i)).join('')}`);
    if (movies.length) out.push(`<h2>Movies</h2>${movies.sort((a, b) => a.title.localeCompare(b.title)).map((i) => itemHtml(i)).join('')}`);
    if (eps.length) {
      const shows = new Map();
      for (const e of eps) { const s = e.meta?.show || {}; const k = s.id || s.title; if (!shows.has(k)) shows.set(k, { title: s.title || 'Episodes', art: e.posterUrl, list: [] }); shows.get(k).list.push(e); }
      out.push(`<h2>Shows</h2>${[...shows.values()].map((g) => `<div class="group"><div class="ghead"><div class="art" style="${g.art ? `background-image:url('${esc(g.art)}')` : ''}"></div><b>${esc(g.title)}</b></div>
        ${g.list.sort((a, b) => (a.meta.show.season - b.meta.show.season) || (a.meta.show.episode - b.meta.show.episode)).map((e) => itemHtml(e, { compact: true })).join('')}</div>`).join('')}`);
    }
    if (songs.length) {
      const albums = new Map();
      for (const s of songs) { const m = s.meta || {}; const k = m.albumId || m.album; if (!albums.has(k)) albums.set(k, { id: k, title: m.album || 'Songs', artist: m.artist, art: s.posterUrl, list: [] }); albums.get(k).list.push(s); }
      out.push(`<h2>Music</h2>${[...albums.values()].map((g) => `<div class="group" data-album="${esc(g.id)}"><div class="ghead"><div class="art" style="${g.art ? `background-image:url('${esc(g.art)}')` : ''}"></div>
        <b>${esc(g.title)}${g.artist ? `<br><span style="color:var(--muted);font-weight:400;font-size:13px">${esc(g.artist)}</span>` : ''}</b><button class="btn primary" data-playalbum>Play</button></div>
        ${albumOrder(g.list).map((s) => itemHtml(s, { compact: true })).join('')}</div>`).join('')}`);
    }
    if (reading.length) out.push(`<h2>Books and comics</h2>${reading.map((i) => itemHtml(i)).join('')}`);
    $('#list').innerHTML = out.join('');
  }
  const albumOrder = (list) => list.slice().sort((a, b) => ((a.meta?.disc || 0) - (b.meta?.disc || 0)) || ((a.meta?.track || 0) - (b.meta?.track || 0)) || a.title.localeCompare(b.title));

  // ---------- taps ----------
  document.addEventListener('click', (e) => {
    const t = e.target;
    if (t.closest('#online')) { N.goOnline(); return; }
    const row = t.closest('[data-id]');
    const it = row && data.items.find((x) => String(x.id) === row.dataset.id);
    if (t.closest('[data-del]') && it) { confirmDelete(it); return; }
    if (t.closest('[data-retry]') && it) { N.download(JSON.stringify({ itemId: it.id, quality: it.quality || 'original' })); setTimeout(load, 300); return; }
    if (t.closest('[data-playalbum]')) {
      const g = t.closest('[data-album]');
      const list = albumOrder(data.items.filter((x) => x.kind === 'track' && x.state === 'done' && String(x.meta?.albumId || x.meta?.album) === g.dataset.album));
      if (list.length) playSongs(list, 0);
      return;
    }
    if (row && 'play' in row.dataset && it) {
      if (VIDEO.has(it.kind)) N.playOffline(it.id);
      else if (it.kind === 'book' || it.kind === 'comic') openReader(it);
      else if (it.kind === 'track') {
        const list = albumOrder(data.items.filter((x) => x.kind === 'track' && x.state === 'done' && (x.meta?.albumId || x.meta?.album) === (it.meta?.albumId || it.meta?.album)));
        playSongs(list, Math.max(0, list.findIndex((x) => x.id === it.id)));
      }
    }
  });
  document.addEventListener('change', (e) => { if (e.target.id === 'wifi') N.setDownloadWifiOnly(e.target.checked); });

  function confirmDelete(it) {
    const box = $('#confirm');
    box.innerHTML = `<div class="panel" role="alertdialog" aria-modal="true"><h3>Delete ${esc(it.title || 'this download')}?</h3>
      <p>It's removed from this phone${it.size ? `, freeing ${size(it.size)}` : ''}. You can download it again any time you're online.</p>
      <div class="actions"><button class="btn" data-no>Keep</button><button class="btn danger" data-yes>Delete</button></div></div>`;
    box.hidden = false;
    box.onclick = (e) => {
      if (e.target.closest('[data-yes]')) { if (song() && song().id === it.id) stopMusic(); N.deleteDownload(it.id); setTimeout(load, 200); }
      if (e.target === box || e.target.closest('[data-yes],[data-no]')) box.hidden = true;
    };
  }

  // ---------- music, offline ----------
  const audio = new Audio();
  let queue = [], at = -1;
  const song = () => queue[at];
  function playSongs(list, i) { queue = list; at = i; loadSong(); }
  function loadSong() {
    const s = song(); if (!s) return stopMusic();
    audio.src = s.url;
    audio.play().catch(() => {});
    $('#player').hidden = false;
    $('#np-title').textContent = s.title;
    $('#np-artist').textContent = [s.meta?.artist, s.meta?.album].filter(Boolean).join(' · ');
    $('#np-art').src = s.posterUrl || '';
  }
  function report(state) {
    const s = song();
    try {
      N.music(JSON.stringify(state === 'stopped' || !s ? { state: 'stopped' }
        : { state, title: s.title, artist: s.meta?.artist || '', album: s.meta?.album || '', art: s.posterPath || '', position: audio.currentTime || 0, duration: audio.duration || s.meta?.runtime || 0 }));
    } catch { /* older app */ }
  }
  function next() { if (at < queue.length - 1) { at++; loadSong(); } else { audio.pause(); audio.currentTime = 0; } }
  function prev() { if (audio.currentTime > 4 || at <= 0) audio.currentTime = 0; else { at--; loadSong(); } }
  function stopMusic() { audio.pause(); audio.removeAttribute('src'); audio.load(); queue = []; at = -1; $('#player').hidden = true; report('stopped'); }
  audio.addEventListener('play', () => { $('#np-play').textContent = '⏸'; report('playing'); });
  audio.addEventListener('pause', () => { $('#np-play').textContent = '▶'; report('paused'); });
  audio.addEventListener('seeked', () => report(audio.paused ? 'paused' : 'playing'));
  audio.addEventListener('loadedmetadata', () => { $('#np-seek').max = String(audio.duration || 1); report(audio.paused ? 'paused' : 'playing'); });
  audio.addEventListener('timeupdate', () => { if (!seeking) $('#np-seek').value = String(audio.currentTime); });
  audio.addEventListener('ended', next);
  let seeking = false;
  $('#np-seek').addEventListener('input', () => { seeking = true; });
  $('#np-seek').addEventListener('change', (e) => { audio.currentTime = +e.target.value; seeking = false; });
  $('#np-play').onclick = () => (audio.paused ? audio.play().catch(() => {}) : audio.pause());
  $('#np-next').onclick = next;
  $('#np-prev').onclick = prev;
  $('#np-close').onclick = stopMusic;
  // The notification and lock-screen buttons (MusicService) call these.
  window.HallFlix = { music: {
    resume: () => { if (song() && audio.paused) audio.play().catch(() => {}); },
    pause: () => audio.pause(),
    toggle: () => (audio.paused ? audio.play().catch(() => {}) : audio.pause()),
    next, prev, stop: stopMusic,
    seek: (t) => { audio.currentTime = Math.max(0, +t || 0); },
  } };
  // ---------- reading, offline ----------
  // Comics and PDFs: their pages as pictures (tap the sides or swipe; manga reads right to left).
  // EPUBs: chapter by chapter, from the book on the phone. Where you are is kept and synced like on the website:
  // page number for pages, chapter + fraction through it for EPUBs.
  let reader = null;
  function openReader(it) {
    const r = it.read || {};
    const box = document.createElement('div');
    box.className = 'reader';
    box.innerHTML = `<header class="rd-top"><button data-rd="close" aria-label="Back">‹</button><div class="rd-t"><b>${esc(it.title)}</b><span data-rd-where></span></div>
      ${r.mode === 'epub' ? '<button data-rd="smaller" aria-label="Smaller text">A−</button><button data-rd="bigger" aria-label="Bigger text">A+</button>' : ''}</header>
      <div class="rd-stage">${r.mode === 'epub' ? '<iframe sandbox="allow-same-origin" title="Book"></iframe>' : '<img alt="" draggable="false">'}</div>
      <footer class="rd-bottom">${r.mode === 'epub' ? '<button data-rd="prev">‹ Chapter</button><button data-rd="next">Chapter ›</button>'
        : `<input type="range" min="1" max="${r.pages || 1}" value="1" aria-label="Page" data-rd-range>`}</footer>`;
    document.body.append(box);
    document.body.classList.add('reading');
    reader = { it, box, r, page: 1, chapter: 0, frac: 0, size: +(localStorage.getItem('hf_offline_text') || 100) };
    const start = it.watched && !it.position ? 0 : +it.position || 0;
    if (r.mode === 'epub') { reader.chapter = Math.min(Math.floor(start), Math.max(0, (r.spine || []).length - 1)); reader.frac = start % 1; showChapter(); }
    else { reader.page = Math.max(1, Math.min(r.pages || 1, Math.round(start) || 1)); showPage(); }
  }
  function closeReader() { if (!reader) return; saveReading(true); reader.box.remove(); reader = null; document.body.classList.remove('reading'); load(); }
  let saveTimer = 0;
  function saveReading(now) {
    clearTimeout(saveTimer);
    const go = () => {
      if (!reader) return;
      const { r } = reader;
      const total = r.mode === 'epub' ? (r.spine || []).length : r.pages || 0;
      const pos = r.mode === 'epub' ? reader.chapter + Math.min(0.999, reader.frac) : reader.page;
      const finished = r.mode === 'epub' ? reader.chapter >= total - 1 && reader.frac > 0.97 : reader.page >= total;
      try { N.saveReading(reader.it.id, pos, total, finished); } catch { /* older app */ }
    };
    if (now) go(); else saveTimer = setTimeout(go, 800);
  }
  function showPage() {
    const { box, it, r } = reader;
    $('.rd-stage img', box).src = `${it.pagesBase}${reader.page}.jpg`;
    $('[data-rd-where]', box).textContent = `Page ${reader.page} of ${r.pages}`;
    $('[data-rd-range]', box).value = String(reader.page);
    // The next page is fetched ahead so turning is instant.
    if (reader.page < r.pages) new Image().src = `${it.pagesBase}${reader.page + 1}.jpg`;
    saveReading();
  }
  function turn(dir) {
    const { r } = reader;
    const step = r.rtl ? -dir : dir;
    const next = Math.max(1, Math.min(r.pages, reader.page + step));
    if (next !== reader.page) { reader.page = next; showPage(); }
  }
  function showChapter() {
    const { box, it, r } = reader;
    const spine = r.spine || [];
    const frame = $('iframe', box);
    const href = spine[reader.chapter] || '';
    frame.onload = () => {
      const doc = frame.contentDocument;
      if (!doc) return;
      const st = doc.createElement('style');
      st.textContent = `html { background: #0a0814; color: #ece9ff; } body { font-size: ${reader.size}%; line-height: 1.6; max-width: 40em; margin: 0 auto; padding: 18px 18px 60px; font-family: Georgia, serif; }
        img, svg { max-width: 100%; height: auto; } a { color: #35d0d0; }`;
      (doc.head || doc.documentElement).append(st);
      const sc = doc.scrollingElement || doc.documentElement;
      if (reader.frac > 0) sc.scrollTop = reader.frac * (sc.scrollHeight - sc.clientHeight);
      frame.contentWindow.addEventListener('scroll', () => { reader && (reader.frac = (sc.scrollTop / Math.max(1, sc.scrollHeight - sc.clientHeight))); saveReading(); }, { passive: true });
    };
    frame.src = it.epubBase + href.split('/').map(encodeURIComponent).join('/');
    const title = (r.toc || []).find((t) => t.href && href && t.href.split('#')[0] === href)?.title;
    $('[data-rd-where]', box).textContent = title || `Part ${reader.chapter + 1} of ${spine.length}`;
    saveReading();
  }
  function chapter(dir) {
    const n = reader.chapter + dir;
    if (n < 0 || n >= (reader.r.spine || []).length) return;
    reader.chapter = n; reader.frac = 0; showChapter();
  }
  document.addEventListener('click', (e) => {
    if (!reader) return;
    const b = e.target.closest('[data-rd]');
    if (b) {
      const a = b.dataset.rd;
      if (a === 'close') closeReader();
      else if (a === 'prev') chapter(-1);
      else if (a === 'next') chapter(1);
      else if (a === 'smaller' || a === 'bigger') { reader.size = Math.max(70, Math.min(200, reader.size + (a === 'bigger' ? 10 : -10))); localStorage.setItem('hf_offline_text', String(reader.size)); const f = reader.frac; reader.frac = f; showChapter(); }
      return;
    }
    if (reader.r.mode !== 'epub' && e.target.closest('.rd-stage')) {
      const x = e.clientX / innerWidth;
      if (x < 0.33) turn(-1); else if (x > 0.67) turn(1); else reader.box.classList.toggle('bare'); // the middle shows or hides the bars
    }
  }, true);
  document.addEventListener('input', (e) => { if (reader && e.target.matches('[data-rd-range]')) { reader.page = +e.target.value; showPage(); } });
  let sx = null;
  document.addEventListener('touchstart', (e) => { if (reader && reader.r.mode !== 'epub' && e.target.closest('.rd-stage')) sx = e.touches[0].clientX; }, { passive: true });
  document.addEventListener('touchend', (e) => { if (sx == null || !reader) return; const dx = e.changedTouches[0].clientX - sx; sx = null; if (Math.abs(dx) > 50) turn(dx < 0 ? 1 : -1); }, { passive: true });

  // Back closes the reader or the delete question first; otherwise the app goes back (to HallFlix, or closes).
  window.hallflixBack = () => {
    if (reader) { closeReader(); return true; }
    if (!$('#confirm').hidden) { $('#confirm').hidden = true; return true; }
    return null;
  };

  load();
})();
