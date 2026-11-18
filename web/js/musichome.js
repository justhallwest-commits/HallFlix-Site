// The music front page, in the style of the big streaming apps: a greeting with quick tiles (Liked songs, Shuffle,
// your most played and the albums you play most), then Jump back in, New albums, Your top songs, mixes by genre,
// artists, Rediscover and Something different.
import { $$, api, html, raw, icons, state } from './core.js';
import { cardHtml } from './views.js';
import * as music from './music.js';

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const HEART = raw('<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 20.5s-7.5-4.6-9.3-9.4C1.3 7.3 4 4 7.4 4c2 0 3.4 1.1 4.6 2.7C13.2 5.1 14.6 4 16.6 4 20 4 22.7 7.3 21.3 11.1 19.5 15.9 12 20.5 12 20.5z"/></svg>');
const RADIO = raw('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="2.2"/><path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4M4.9 4.9a10 10 0 0 0 0 14.2M19.1 4.9a10 10 0 0 1 0 14.2"/></svg>');
const MORE = raw('<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5.5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="18.5" cy="12" r="1.7"/></svg>');
const hue = (s) => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
const greet = () => { const h = new Date().getHours(); return h < 5 ? 'Up late' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; };

const row = (title, body, id, sub = '') => (body ? html`<section class="row mh-row" data-row="${id}"><h2>${title}${sub ? html`<small>${sub}</small>` : ''}</h2>
  <button class="arrow l" hidden aria-label="Scroll left" tabindex="-1">‹</button><div class="scroller">${body}</div><button class="arrow r" aria-label="Scroll right" tabindex="-1">›</button></section>` : '');

export async function musicHome(box, lib, syncArrows) {
  const d = await api('GET', `/api/music/${lib.id}`);
  if (!box.isConnected) return;
  const hours = Math.round(d.totals.seconds / 360) / 10;
  const quick = [];
  if (d.liked) quick.push(html`<a class="mh-tile liked" href="#/playlist/liked"><span class="mh-tart">${HEART}</span><b>Liked songs</b><small>${plural(d.liked, 'song')}</small></a>`);
  quick.push(html`<button class="mh-tile shuf" data-mix="all"><span class="mh-tart">${icons.shuffle}</span><b>Shuffle all</b><small>${plural(d.totals.songs, 'song')}</small></button>`);
  if (d.top.length >= 3) quick.push(html`<button class="mh-tile top" data-mix="top"><span class="mh-tart">${RADIO}</span><b>Your most played</b><small>A mix of your favourites</small></button>`);
  for (const a of d.jumpBack.slice(0, 6 - quick.length)) quick.push(html`<a class="mh-tile" href="#/title/${a.id}"><span class="mh-tart">${a.poster ? html`<img src="${a.poster}" alt="" loading="lazy">` : '♪'}</span><b>${a.title}</b><small>${a.author || ''}</small><button class="mh-play" data-playalbum="${a.id}" aria-label="Play ${a.title}">${icons.play}</button></a>`);
  for (const a of d.recent.filter((x) => !d.jumpBack.some((j) => j.id === x.id)).slice(0, Math.max(0, 6 - quick.length))) quick.push(html`<a class="mh-tile" href="#/title/${a.id}"><span class="mh-tart">${a.poster ? html`<img src="${a.poster}" alt="" loading="lazy">` : '♪'}</span><b>${a.title}</b><small>${a.author || ''}</small><button class="mh-play" data-playalbum="${a.id}" aria-label="Play ${a.title}">${icons.play}</button></a>`);
  const top = d.top.slice(0, 12);
  box.innerHTML = String(html`<div class="mh">
    <section class="mh-hero"><h2>${greet()}${state.profile?.name ? `, ${state.profile.name}` : ''}</h2>
      <p class="mh-sum">${plural(d.totals.albums, 'album')} · ${plural(d.totals.artists, 'artist')} · ${plural(d.totals.songs, 'song')}${hours ? ` · ${hours} hours of music` : ''}</p>
      <div class="mh-quick">${quick}</div></section>
    ${d.jumpBack.length > 2 ? row('Jump back in', d.jumpBack.map((x) => cardHtml(x)), 'mh-jump') : ''}
    ${row('New albums', d.recent.map((x) => cardHtml(x)), 'mh-new')}
    ${top.length ? html`<section class="mh-topwrap"><h2>Your top songs<small>The last few months</small><button class="linkbtn" data-mix="top">Play them all</button></h2>
      <ol class="mh-top">${top.map((t, i) => html`<li data-tid="${t.id}"><button class="mh-tbtn" data-ttrack="${i}"><span class="mh-n">${i + 1}</span>${t.poster ? html`<img src="${t.poster}" alt="" loading="lazy">` : html`<i></i>`}
        <span class="mh-tt"><b>${t.title}</b><small>${[t.author, t.album].filter(Boolean).join(' · ')}</small></span><span class="eq" aria-hidden="true"><i></i><i></i><i></i></span></button>
        <button class="mh-tmore" data-tmenu="${i}" aria-label="More for ${t.title}">${MORE}</button></li>`)}</ol></section>` : ''}
    ${row('Mixes by genre', d.genres.map((g) => html`<button class="mh-mix" data-mix="genre:${g.name}" style="--h:${hue(g.name)}"><span class="mh-col n${Math.min(3, g.art.length)}">${g.art.slice(0, 3).map((a) => html`<img src="${a}" alt="" loading="lazy">`)}</span>
      <span class="mh-mixname"><b>${g.name}</b><small>Mix · ${plural(g.albums, 'album')}</small></span><span class="mh-mixplay">${icons.play}</span></button>`), 'mh-genres', 'Endless songs from one genre')}
    ${row('Artists', d.artists.map((a) => html`<div class="mh-artist">${cardHtml(a)}<button class="mh-radio" data-mix="artist:${a.id}" aria-label="${a.title} radio" title="${a.title} radio">${RADIO}</button></div>`), 'mh-artists')}
    ${row('Rediscover', d.rediscover.map((x) => cardHtml(x)), 'mh-redis', 'Albums you have not played in a while')}
    ${row('Something different', d.something.map((x) => cardHtml(x)), 'mh-diff', 'Albums you have never played')}
  </div>`);
  syncArrows?.(...$$('.row', box));
  box.onclick = (e) => {
    const mix = e.target.closest('[data-mix]');
    if (mix) { e.preventDefault(); music.startRadio(mix.dataset.mix, { library: lib.id, keep: false }); return; }
    const tt = e.target.closest('[data-ttrack]');
    if (tt) { music.play(top, +tt.dataset.ttrack, { source: 'Your top songs' }); return; }
    const tm = e.target.closest('[data-tmenu]');
    if (tm) { e.preventDefault(); e.stopPropagation(); music.trackMenu(tm, top[+tm.dataset.tmenu], { list: top }); }
  };
}

