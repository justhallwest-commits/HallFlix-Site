// Pages for books, comics and music: title pages for a book, a comic series, an album and an artist, and the
// music library (albums, artists, songs).
import * as backdrop from './backdrop.js';
import { $, $$, api, html, raw, icons, state, fmtRuntime, fmtTime, toast, libTitle } from './core.js';
import { cardHtml, syncArrows } from './views.js';
import { musicHome } from './musichome.js';
import * as music from './music.js';
import * as comics from './comics.js';

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const bg = (u) => (u ? `background-image:url("${String(u).replace(/"/g, '%22')}")` : '');
const pct = (p) => (p && p.duration ? Math.round(Math.min(1, p.position / p.duration) * 100) : 0);

export async function playAlbum(id, { shuffle = false, from = 0 } = {}) {
  try { const d = await api('GET', `/api/items/${id}`); music.play(d.tracks, from, { shuffle, source: d.title }); } catch (e) { toast(e.message); }
}

const MORE = raw('<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5.5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="18.5" cy="12" r="1.7"/></svg>');
const RADIO = raw('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="2.2"/><path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4M4.9 4.9a10 10 0 0 0 0 14.2M19.1 4.9a10 10 0 0 1 0 14.2"/></svg>');
const HEART = raw('<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 20.5s-7.5-4.6-9.3-9.4C1.3 7.3 4 4 7.4 4c2 0 3.4 1.1 4.6 2.7C13.2 5.1 14.6 4 16.6 4 20 4 22.7 7.3 21.3 11.1 19.5 15.9 12 20.5 12 20.5z"/></svg>');
/** A list of songs: number (or an equaliser while it plays), title, artist, length, and a ⋯ menu. */
const trackList = (tracks, { showAlbum = false, discs = 1, unlist = false } = {}) => html`<ol class="tracks">${tracks.map((t, i) => html`
  ${discs > 1 && (i === 0 || tracks[i - 1].disc !== t.disc) ? html`<li class="disc">Disc ${t.disc}</li>` : ''}
  <li data-tid="${t.id}"><button data-track="${i}"><span class="tn"><span class="tnum">${showAlbum ? i + 1 : t.track || i + 1}</span><span class="eq" aria-hidden="true"><i></i><i></i><i></i></span></span>
    ${showAlbum && t.poster ? html`<img src="${t.poster}" alt="" loading="lazy">` : ''}
    <span class="tt"><b>${t.title}</b>${showAlbum || (t.author && t.author !== tracks.artist) ? html`<small>${[t.author, showAlbum ? t.album : ''].filter(Boolean).join(' · ')}</small>` : ''}</span>
    <span class="td">${fmtTime(t.runtime)}</span></button>${unlist ? html`<button class="t-more" data-unlist="${t.id}" aria-label="Remove ${t.title} from this list" title="Remove from this list">${icons.x}</button>` : ''}
    <button class="t-more" data-tmenu="${i}" aria-label="More for ${t.title}" title="Play next, add to queue, radio…">${MORE}</button></li>`)}</ol>`;

/** One playlist (or Liked songs): its songs in order, with play, shuffle and delete. */
export async function playlist(view, id) {
  const liked = id === 'liked';
  const d = liked ? { name: 'Liked songs', ...(await api('GET', '/api/music/liked/songs')) } : await api('GET', `/api/playlists/${id}`);
  const total = d.tracks.reduce((a, t) => a + (t.runtime || 0), 0);
  const art = [...new Set(d.tracks.map((t) => t.poster).filter(Boolean))].slice(0, 4);
  view.innerHTML = String(html`<div class="page pl-page ${liked ? 'liked' : ''}"><header class="pl-head">${liked ? html`<div class="pl-art liked-art"><span>${HEART}</span></div>` : html`<div class="pl-art n${art.length}">${art.length ? art.map((a) => html`<img src="${a}" alt="">`) : html`<span>♪</span>`}</div>`}
      <div><p class="m-kind">${liked ? 'Your favourites' : 'Playlist'}</p><h1>${d.name}</h1><p class="count">${plural(d.tracks.length, 'song')}${total ? ` · ${fmtRuntime(total)}` : ''}</p>
        <div class="actions">${d.tracks.length ? html`<button class="btn primary" data-playall>${icons.play} Play</button><button class="btn" data-shuffle>${icons.shuffle} Shuffle</button>` : ''}${liked ? '' : html`<button class="btn" data-delpl>Delete playlist</button>`}</div></div></header>
    ${d.tracks.length ? trackList(d.tracks, { showAlbum: true, unlist: true }) : html`<div class="empty"><p>${liked ? 'Tap the heart on any song and it will be waiting here.' : 'No songs yet. Use ⋯ next to any song, or in Now Playing, to add it here.'}</p></div>`}</div>`);
  $('.pl-page', view).addEventListener('click', async (e) => {
    const t = e.target;
    const un = t.closest('[data-unlist]');
    if (un) {
      if (liked) await api('POST', '/api/mylist', { itemId: +un.dataset.unlist, on: false }).catch((err) => toast(err.message));
      else await api('POST', `/api/playlists/${id}/tracks`, { remove: [+un.dataset.unlist] }).catch((err) => toast(err.message));
      return playlist(view, id);
    }
    const tm = t.closest('[data-tmenu]');
    if (tm) { e.stopPropagation(); music.trackMenu(tm, d.tracks[+tm.dataset.tmenu], { list: d.tracks }); return; }
    const tr = t.closest('[data-track]');
    if (tr) return music.play(d.tracks, +tr.dataset.track, { source: d.name });
    if (t.closest('[data-playall]')) return music.play(d.tracks, 0, { shuffle: false, source: d.name });
    if (t.closest('[data-shuffle]')) return music.play(d.tracks, 0, { shuffle: true, source: d.name });
    if (t.closest('[data-delpl]')) {
      if (!confirm(`Delete the playlist “${d.name}”? The songs stay in your library.`)) return;
      try { await api('DELETE', `/api/playlists/${id}`); toast('Playlist deleted'); history.back(); } catch (err) { toast(err.message); }
    }
  });
}

/** The title page for a book, comic series, album or artist, drawn into the overlay. */
export function sheet(o, d, id) {
  const close = html`<button class="btn round close" data-x aria-label="Close">${icons.x}</button>`;
  const listBtn = html`<button class="btn round ${d.inList ? 'on' : ''}" data-list aria-label="My List" title="My List">${d.inList ? icons.check : icons.plus}</button>`;
  const facts = (rows) => html`<div class="facts">${rows.filter(([, v]) => v).map(([k, v]) => html`<div><b>${k}:</b> ${v}</div>`)}</div>`;
  let body = '';
  if (d.kind === 'book') {
    const p = d.progress, reading = p && !p.watched && p.position > 0;
    body = html`<div class="m-head book">${close}<div class="m-bg" style="${bg(d.poster)}"></div>
      <div class="m-cover book">${d.poster ? html`<img src="${d.poster}" alt="">` : html`<span>${d.title}</span>`}</div>
      <div class="m-info"><p class="m-kind">${d.format === 'pdf' ? 'PDF' : 'Book'}</p><h1>${d.title}</h1>${d.author ? html`<p class="m-by">by ${d.author}</p>` : ''}
        <div class="meta">${d.year ? html`<span>${d.year}</span>` : ''}${d.pages ? html`<span>${d.format === 'pdf' ? plural(d.pages, 'page') : plural(d.pages, 'chapter')}</span>` : ''}${d.genres.slice(0, 3).map((g) => html`<span>${g}</span>`)}</div>
        <div class="actions"><a class="btn primary" href="#/read/${d.id}">${icons.book} ${reading ? `Continue · ${pct(p)}%` : p?.watched ? 'Read again' : 'Read'}</a>${listBtn}
          <button class="btn round" data-seen aria-label="Mark as read" title="Mark as read or unread">${icons.eye}</button></div></div></div>
      <div class="body">${d.overview ? html`<p class="overview">${d.overview}</p>` : ''}${facts([['Author', d.author], ['Published', d.year], ['Publisher', d.publisher], ['Format', d.format?.toUpperCase()]])}
        ${d.more?.length ? html`<h3>More by ${d.author}</h3><div class="similar">${d.more.map((x) => cardHtml(x))}</div>` : ''}</div>`;
  } else if (d.kind === 'series') {
    body = comics.seriesBody(d, close, listBtn, facts);
  } else if (d.kind === 'album') {
    const total = d.tracks.reduce((a, t) => a + (t.runtime || 0), 0);
    body = html`<div class="m-head">${close}<div class="m-bg" style="${bg(d.poster)}"></div>
      <div class="m-cover square">${d.poster ? html`<img src="${d.poster}" alt="">` : html`<span>♪</span>`}</div>
      <div class="m-info"><p class="m-kind">Album</p><h1>${d.title}</h1><p class="m-by"><a href="#/title/${d.artistId}">${d.author}</a></p>
        <div class="meta">${d.year ? html`<span>${d.year}</span>` : ''}<span>${plural(d.tracks.length, 'song')}</span><span>${fmtRuntime(total)}</span>${d.genres.slice(0, 2).map((g) => html`<span>${g}</span>`)}</div>
        <div class="actions"><button class="btn primary" data-playall>${icons.play} Play</button><button class="btn" data-shuffle>${icons.shuffle} Shuffle</button>
          ${d.artistId ? html`<button class="btn" data-radio="artist:${d.artistId}" title="Songs by ${d.author} and artists like them">${RADIO} Radio</button>` : ''}${listBtn}</div></div></div>
      <div class="body">${trackList(Object.assign(d.tracks, { artist: d.author }), { discs: d.discs })}
        ${d.more?.length ? html`<h3>More by ${d.author}</h3><div class="similar squares">${d.more.map((x) => cardHtml(x))}</div>` : ''}</div>`;
  } else if (d.kind === 'artist') {
    body = html`<div class="m-head">${close}<div class="m-bg" style="${bg(d.poster)}"></div>
      <div class="m-cover round">${d.poster ? html`<img src="${d.poster}" alt="">` : html`<span>${d.title[0]}</span>`}</div>
      <div class="m-info"><p class="m-kind">Artist</p><h1>${d.title}</h1>
        <div class="meta"><span>${plural(d.albums.length, 'album')}</span><span>${plural(d.tracks.length, 'song')}</span></div>
        <div class="actions"><button class="btn primary" data-playall>${icons.play} Play</button><button class="btn" data-shuffle>${icons.shuffle} Shuffle</button><button class="btn" data-radio="artist:${d.id}">${RADIO} ${d.title} radio</button></div></div></div>
      <div class="body"><h3>Albums</h3><div class="similar squares">${d.albums.map((x) => cardHtml(x))}</div>
        <h3>Songs</h3>${trackList(d.tracks.slice(0, 50), { showAlbum: true })}</div>`;
  }
  o.innerHTML = String(html`<article class="sheet m-sheet k-${d.kind}" data-id="${d.id}">${body}</article>`);
  document.body.classList.add('locked');
  o.onchange = null;
  o.onclick = async (e) => {
    if (e.target === o || e.target.closest('[data-x]')) { if (history.length > 1) history.back(); else location.hash = '#/'; return; }
    if (d.kind === 'series') {
      const y = o.scrollTop;
      const redraw = async (fetch) => { const fresh = fetch ? await api('GET', `/api/items/${id}`) : d; sheet(o, fresh, id); o.scrollTop = y; };
      if (await comics.seriesClick(e, d, redraw)) return;
    }
    const tm = e.target.closest('[data-tmenu]');
    if (tm && d.tracks) { music.trackMenu(tm, d.tracks[+tm.dataset.tmenu], { list: d.tracks }); return; }
    const rd = e.target.closest('[data-radio]');
    if (rd) { music.startRadio(rd.dataset.radio, { keep: false }); return; }
    const tr = e.target.closest('[data-track]');
    if (tr) { music.play(d.tracks, +tr.dataset.track, { source: d.title }); return; }
    if (e.target.closest('[data-playall]')) { music.play(d.tracks, 0, { shuffle: false, source: d.title }); return; }
    if (e.target.closest('[data-shuffle]')) { music.play(d.tracks, 0, { shuffle: true, source: d.title }); return; }
    const pa = e.target.closest('[data-playalbum]');
    if (pa) { e.preventDefault(); e.stopPropagation(); playAlbum(+pa.dataset.playalbum); return; }
    const list = e.target.closest('[data-list]');
    if (list) {
      d.inList = !d.inList; list.classList.toggle('on', d.inList); list.innerHTML = String(d.inList ? icons.check : icons.plus);
      await api('POST', '/api/mylist', { itemId: d.id, on: d.inList }).catch((err) => toast(err.message));
      toast(d.inList ? 'Added to My List' : 'Removed from My List');
      return;
    }
    if (e.target.closest('[data-seen]')) {
      const all = d.kind === 'book' ? !!d.progress?.watched : d.issues.every((x) => x.progress?.watched);
      await api('POST', '/api/watched', { itemId: d.id, watched: !all }).catch((err) => toast(err.message));
      toast(all ? 'Marked as unread' : 'Marked as read');
      const fresh = await api('GET', `/api/items/${id}`); sheet(o, fresh, id);
    }
  };
  o.scrollTop = 0;
  ($('.issues .focus a, .cx-ilist .focus a', o) || $('.issues .focus', o) || $('.btn.primary', o))?.focus({ preventScroll: true });
}

// ---------- the music library ----------
export async function musicLibrary(view, lib, lk, base) {
  base.view ||= 'home';
  if (!['title', 'artist', 'year', 'added'].includes(base.sort)) base.sort = 'artist';
  view.innerHTML = String(html`<div class="page music-lib"><div class="lib-head">
      ${libTitle(lib, lk)}<span class="count"></span>${backdrop.button(lib)}
      <div class="tabs-row">${[['home', 'Listen now'], ['albums', 'Albums'], ['artists', 'Artists'], ['songs', 'Songs'], ['playlists', 'Playlists']].map(([v, n]) => html`<button class="chip ${base.view === v ? 'on' : ''}" data-view="${v}">${n}</button>`)}</div>
      <select data-msort aria-label="Sort" ${base.view === 'albums' ? '' : raw('hidden')}>${[['artist', 'Artist'], ['title', 'A to Z'], ['year', 'Newest first'], ['added', 'Recently added']].map(([v, n]) => html`<option value="${v}" ${base.sort === v ? raw('selected') : ''}>${n}</option>`)}</select>
    </div><div class="chips"></div><div class="mbody"></div></div>`);
  const draw = async () => {
    const v = base.view, box = $('.mbody', view);
    box.onclick = null;
    if (v === 'home') {
      $('.count', view).textContent = ''; $('.chips', view).innerHTML = ''; $('[data-msort]', view).hidden = true;
      await musicHome(box, lib, syncArrows);
      return;
    }
    if (v === 'playlists') {
      const lists = await api('GET', '/api/playlists');
      if (!box.isConnected) return;
      $('.count', view).textContent = plural(lists.length, 'playlist'); $('.chips', view).innerHTML = ''; $('[data-msort]', view).hidden = true;
      box.innerHTML = String(html`<div class="grid squares pl-grid"><a class="card square pl-card" href="#/playlist/liked"><div class="art"><div class="pl-art liked-art"><span>${HEART}</span></div>
          <div class="label">Liked songs<small>Every song with a heart</small></div></div></a>${lists.map((p) => html`<a class="card square pl-card" href="#/playlist/${p.id}"><div class="art"><div class="pl-art n${p.art.length}">${p.art.length ? p.art.map((a) => html`<img src="${a}" alt="" loading="lazy">`) : html`<span>♪</span>`}</div>
          <div class="label">${p.name}<small>${plural(p.count, 'song')}</small></div></div></a>`)}
        <button class="card square pl-card pl-make" data-newpl><div class="art"><div class="pl-art"><span>+</span></div><div class="label">New playlist<small>Start an empty one</small></div></div></button></div>`);
      return;
    }
    const q = v === 'albums' ? `&sort=${base.sort}&genre=${encodeURIComponent(base.genre || '')}` : v === 'artists' ? '&sort=title' : '';
    const d = await api('GET', `/api/library/${lib.id}?view=${v}&limit=${v === 'songs' ? 500 : 200}${q}`);
    if (!box.isConnected) return;
    $('.count', view).textContent = v === 'albums' ? plural(d.total, 'album') : v === 'artists' ? plural(d.total, 'artist') : plural(d.total, 'song');
    $('.chips', view).innerHTML = v === 'albums' && d.genres.length ? String(html`<button class="chip ${base.genre ? '' : 'on'}" data-mgenre="">All</button>${d.genres.map((g) => html`<button class="chip ${base.genre === g ? 'on' : ''}" data-mgenre="${g}">${g}</button>`)}`) : '';
    $('[data-msort]', view).hidden = v !== 'albums';
    if (!d.total) { box.innerHTML = '<div class="empty"><p>No music here yet. If you just added this library, the first scan may still be running.</p></div>'; return; }
    if (v === 'songs') {
      box.tracks = d.items;
      box.innerHTML = String(html`<div class="actions song-actions"><button class="btn primary" data-allsongs>${icons.play} Play all</button><button class="btn" data-allshuffle>${icons.shuffle} Shuffle all</button>
        ${d.total > d.items.length ? html`<span class="muted">Showing the first ${d.items.length}</span>` : ''}</div>${trackList(d.items, { showAlbum: true })}`);
    } else box.innerHTML = String(html`<div class="grid squares">${d.items.map((x) => cardHtml(x))}</div>`);
  };
  view.querySelector('.music-lib').addEventListener('click', (e) => {
    const t = e.target;
    const tab = t.closest('[data-view]');
    if (tab) { base.view = tab.dataset.view; base.genre = ''; for (const b of $$('[data-view]', view)) b.classList.toggle('on', b === tab); draw(); return; }
    const g = t.closest('[data-mgenre]');
    if (g) { base.genre = g.dataset.mgenre; draw(); return; }
    const box = $('.mbody', view);
    const tm = t.closest('[data-tmenu]');
    if (tm && box.tracks) { music.trackMenu(tm, box.tracks[+tm.dataset.tmenu], { list: box.tracks }); return; }
    const tr = t.closest('[data-track]');
    if (tr && box.tracks) { music.play(box.tracks, +tr.dataset.track, { source: lib.name }); return; }
    if (t.closest('[data-newpl]')) {
      const name = prompt('Name the playlist');
      if (name?.trim()) api('POST', '/api/playlists', { name: name.trim() }).then((p) => { location.hash = `#/playlist/${p.id}`; }, (err) => toast(err.message));
      return;
    }
    if (t.closest('[data-allsongs]')) music.play(box.tracks, 0, { shuffle: false, source: lib.name });
    if (t.closest('[data-allshuffle]')) music.play(box.tracks, 0, { shuffle: true, source: lib.name });
  });
  $('[data-msort]', view).onchange = (e) => { base.sort = e.target.value; draw(); };
  await draw();
}
