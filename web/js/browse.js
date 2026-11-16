// More ways to find something: the mood dial, Surprise Me, the timeline, collections, the year in review
// and voice search.
import { $, $$, api, html, raw, icons, state, fmtRuntime, toast } from './core.js';
import { cardHtml } from './views.js';
import { tint, sound } from './feel.js';

const bgUrl = (u) => `url("${String(u || '').replace(/"/g, '%22')}")`;

// ---------- mood dial ----------
export const moodBar = (moods, current) => (!moods?.length ? '' : html`<div class="moods" role="group" aria-label="Mood">
  <button class="mood ${current ? '' : 'on'}" data-mood="">Everything</button>
  ${moods.map((m) => html`<button class="mood ${current === m.id ? 'on' : ''}" data-mood="${m.id}">${m.name}</button>`)}
  <button class="mood surprise-btn" data-surprise>${icons.dice} Surprise me</button></div>`);

// ---------- collections on Home ----------
export const collectionsRow = (list) => (!list?.length ? '' : html`<section class="row keep" data-row="collections"><h2>Collections</h2>
  <button class="arrow l" hidden aria-label="Scroll left" tabindex="-1">‹</button>
  <div class="scroller">${list.map((c) => html`<a class="coll-card" href="#/collection/${c.id}" style="--tile-bg:${bgUrl(c.backdrop)}" aria-label="${c.name}, ${c.count} titles">
    <span class="tile-art"></span>${c.logo ? html`<img class="tile-logo" src="${c.logo}" alt="">` : html`<b>${c.name}</b>`}<small>${c.count} title${c.count === 1 ? '' : 's'}</small></a>`)}</div>
  <button class="arrow r" aria-label="Scroll right" tabindex="-1">›</button></section>`);

export async function collection(view, id) {
  const c = await api('GET', `/api/collections/${id}`);
  const next = c.items.find((it) => it.kind === 'movie' && !it.progress?.watched);
  const mins = c.items.reduce((a, it) => a + (it.kind === 'movie' ? it.runtime || 0 : 0), 0);
  view.innerHTML = String(html`<div class="coll" style="--tile-bg:${bgUrl(c.backdrop)}"><div class="coll-top"><div class="coll-in">
      ${c.logo ? html`<img class="logo-art" src="${c.logo}" alt="${c.name}">` : html`<h1>${c.name}</h1>`}
      <p class="meta"><span>${c.items.length} title${c.items.length === 1 ? '' : 's'}</span>${mins ? html`<span>${fmtRuntime(mins)} in all</span>` : ''}</p>
      ${c.description ? html`<p class="overview">${c.description}</p>` : ''}
      ${next ? html`<div class="actions"><a class="btn primary" href="#/watch/${next.id}">${icons.play} ${c.items[0] === next ? 'Start with' : 'Continue with'} ${next.title}</a></div>` : ''}
    </div></div>
    <ol class="coll-list">${c.items.map((it, i) => html`<li><span class="n">${i + 1}</span>${cardHtml(it)}<div class="t"><b>${it.title}</b>
      <small>${[it.year, it.kind === 'movie' ? fmtRuntime(it.runtime) : 'Show', it.progress?.watched ? 'Watched' : ''].filter(Boolean).join(' · ')}</small><p>${it.overview || ''}</p></div></li>`)}</ol></div>`);
  tint($('.coll', view), c.backdrop);
}

// ---------- timeline ----------
const ERA = (d) => (d < 1960 ? 'mono' : d < 1980 ? 'grain' : d < 1990 ? 'vhs' : d < 2000 ? 'crt' : 'clean');
export async function timeline(view, arg) {
  const { decades } = await api('GET', '/api/timeline');
  if (!decades.length) { view.innerHTML = '<div class="page"><div class="empty"><h2>Nothing to place on a timeline yet</h2><p>Titles appear here once they have a release year.</p></div></div>'; return; }
  const max = Math.max(...decades.map((d) => d.count));
  let cur = decades.some((d) => d.decade === +arg) ? +arg : decades[decades.length - 1].decade;
  view.innerHTML = String(html`<div class="page timeline"><div class="lib-head"><h1>Timeline</h1><span class="count"></span></div>
    <div class="decades" role="tablist">${decades.map((d) => html`<button role="tab" data-decade="${d.decade}" style="--h:${Math.max(12, Math.round((d.count / max) * 100))}%">
      <i></i><b>${d.decade}s</b><small>${d.count}</small></button>`)}</div><div class="years"></div></div>`);
  const load = async (decade) => {
    cur = decade;
    for (const b of $$('.decades button', view)) { b.classList.toggle('on', +b.dataset.decade === cur); b.setAttribute('aria-selected', +b.dataset.decade === cur); }
    const d = await api('GET', `/api/timeline/${cur}`);
    if (!view.isConnected) return;
    const years = [...new Set(d.items.map((x) => x.year))];
    $('.count', view).textContent = `${d.items.length} from the ${cur}s`;
    const page = $('.timeline', view);
    page.className = `page timeline era-${ERA(cur)}`;
    $('.years', view).innerHTML = String(html`${years.map((y) => html`<section class="year"><h2>${y}</h2><div class="grid">${d.items.filter((x) => x.year === y).map((it) => cardHtml(it))}</div></section>`)}`);
    history.replaceState(null, '', `#/timeline/${cur}`);
  };
  view.querySelector('.decades').onclick = (e) => { const b = e.target.closest('[data-decade]'); if (b) load(+b.dataset.decade); };
  await load(cur);
}

// ---------- year in review ----------
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export async function wrapped(view, arg) {
  const w = await api('GET', `/api/wrapped${+arg ? `?year=${+arg}` : ''}`);
  const total = w.movies + w.episodes;
  if (!total && w.hours < 0.1) {
    view.innerHTML = String(html`<div class="page"><div class="empty"><h2>${w.year} is still a blank page</h2><p>Watch something and your year in review starts filling in.</p>
      ${w.year > 2000 ? html`<p><a class="btn" href="#/wrapped/${w.year - 1}">See ${w.year - 1}</a></p>` : ''}</div></div>`);
    return;
  }
  const peak = Math.max(1, ...w.months);
  const days = w.hours / 24;
  view.innerHTML = String(html`<div class="wrapped">
    <div class="w-wall">${w.posters.map((p, i) => html`<img src="${p}" alt="" style="--i:${i}">`)}</div>
    <section class="w-hero"><p class="w-kicker">${w.name}'s ${w.year} on HallFlix</p>
      <h1><span class="w-num" data-to="${w.hours}">${w.hours}</span> hours watched</h1>
      <p class="w-sub">${days >= 1 ? `That is ${days.toFixed(1)} days of screen time` : `That is ${Math.round(w.hours * 60)} minutes`}, across ${w.movies} movie${w.movies === 1 ? '' : 's'} and ${w.episodes} episode${w.episodes === 1 ? '' : 's'}.</p></section>
    <section class="w-grid">
      ${w.genres.length ? html`<div class="w-card"><h2>Your genres</h2><ol class="w-bars">${w.genres.map((g) => html`<li style="--w:${Math.round((g.count / w.genres[0].count) * 100)}%"><span>${g.name}</span><b>${g.count}</b></li>`)}</ol></div>` : ''}
      ${w.shows.length ? html`<div class="w-card"><h2>Shows you stayed with</h2><div class="w-shows">${w.shows.map((s) => html`<a href="#/title/${s.id}">${s.poster ? html`<img src="${s.poster}" alt="">` : ''}<b>${s.title}</b><small>${s.episodes} episode${s.episodes === 1 ? '' : 's'}</small></a>`)}</div></div>` : ''}
      <div class="w-card"><h2>Month by month</h2><div class="w-months">${w.months.map((n, i) => html`<div class="${w.busiest === i + 1 ? 'top' : ''}" title="${MONTHS[i]}: ${n}"><i style="height:${Math.round((n / peak) * 100)}%"></i><span>${MONTHS[i][0]}</span></div>`)}</div>
        ${w.busiest ? html`<p>${MONTHS[w.busiest - 1]} was your biggest month.</p>` : ''}</div>
      ${w.longest ? html`<div class="w-card"><h2>Longest sit</h2><a class="w-long" href="#/title/${w.longest.id}">${w.longest.poster ? html`<img src="${w.longest.poster}" alt="">` : ''}<div><b>${w.longest.title}</b><small>${fmtRuntime(w.longest.minutes * 60)}</small></div></a></div>` : ''}
      ${w.first ? html`<div class="w-card"><h2>How the year opened</h2><p class="w-first">${w.first.title}</p><p>${new Date(w.first.date).toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}</p></div>` : ''}
    </section>
    <p class="w-foot"><a class="btn" href="#/wrapped/${w.year - 1}">${w.year - 1}</a>${w.year < new Date().getFullYear() ? html`<a class="btn" href="#/wrapped/${w.year + 1}">${w.year + 1}</a>` : ''}</p></div>`);
  // The headline number counts up once.
  const n = $('.w-num', view), to = w.hours;
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const t0 = performance.now();
    const step = (t) => { const k = Math.min(1, (t - t0) / 1100); n.textContent = (to * (1 - (1 - k) ** 3)).toFixed(to >= 100 ? 0 : 1); if (k < 1 && n.isConnected) requestAnimationFrame(step); else n.textContent = to; };
    requestAnimationFrame(step);
  }
}

// ---------- Surprise Me ----------
export function surprise(preset = {}) {
  $('.surprise')?.remove();
  const back = document.activeElement;
  const f = { kind: '', max: '', unwatched: '1', ...preset };
  const box = document.createElement('div');
  box.className = 'surprise';
  box.innerHTML = String(html`<div class="s-panel" role="dialog" aria-modal="true" aria-label="Surprise me">
    <button class="btn round close" data-x aria-label="Close">${icons.x}</button>
    <div class="s-filters">
      <button class="chip" data-f="kind" data-v="">Anything</button><button class="chip" data-f="kind" data-v="movie">Movies</button><button class="chip" data-f="kind" data-v="show">Shows</button>
      <span class="gap"></span><button class="chip" data-f="max" data-v="120">Under 2 hours</button><button class="chip" data-f="unwatched" data-v="1">Not watched yet</button></div>
    <div class="s-reel"><div class="s-strip"></div><div class="s-mark"></div></div>
    <div class="s-result" aria-live="polite"></div></div>`);
  const close = () => { box.remove(); back?.focus?.(); };
  const chips = () => { for (const c of $$('[data-f]', box)) c.classList.toggle('on', c.dataset.f === 'kind' ? f.kind === c.dataset.v : f[c.dataset.f] === c.dataset.v); };
  const spin = async () => {
    const strip = $('.s-strip', box), result = $('.s-result', box);
    result.innerHTML = '';
    let d;
    try { d = await api('GET', `/api/surprise?kind=${f.kind}&max=${f.max}&unwatched=${f.unwatched}${f.mood ? `&mood=${f.mood}` : ''}`); } catch (e) { toast(e.message); return; }
    if (!box.isConnected) return;
    if (!d.items.length) { strip.innerHTML = ''; result.innerHTML = String(html`<h2>Nothing fits those filters</h2><p>Loosen one and spin again.</p>`); return; }
    const pick = d.items[0];
    // The reel: every poster a few times over, ending on the pick.
    const reel = [];
    while (reel.length < 26) reel.push(...d.items.slice(1), d.items[0]);
    const list = [...reel.slice(-25), pick, ...d.items.slice(1, 4)];
    const at = 25;
    strip.style.transition = 'none'; strip.style.transform = 'translateX(0)';
    strip.innerHTML = String(html`${list.map((it, i) => html`<div class="s-poster ${i === at ? 'pick' : ''}" style="background-image:${bgUrl(it.poster)}"></div>`)}`);
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches || document.body.classList.contains('tv');
    const land = () => {
      const p = $('.s-poster.pick', strip), r = $('.s-reel', box);
      return -(p.offsetLeft + p.offsetWidth / 2 - r.clientWidth / 2);
    };
    void strip.offsetWidth;
    strip.style.transition = still ? 'none' : 'transform 2.6s cubic-bezier(.12,.75,.12,1)';
    strip.style.transform = `translateX(${land()}px)`;
    box.classList.remove('landed');
    const reveal = () => {
      if (!box.isConnected) return;
      box.classList.add('landed'); sound('open');
      tint($('.s-panel', box), pick.poster);
      result.innerHTML = String(html`<h2>${pick.title}</h2>
        <p class="meta">${pick.score ? html`<span class="score">★ ${pick.score.toFixed(1)}</span>` : ''}${pick.year ? html`<span>${pick.year}</span>` : ''}${pick.kind === 'movie' && pick.runtime ? html`<span>${fmtRuntime(pick.runtime)}</span>` : ''}${(pick.genres || []).slice(0, 3).map((g) => html`<span>${g}</span>`)}</p>
        <p class="overview">${pick.tagline || pick.overview || ''}</p>
        <div class="actions"><a class="btn primary" href="#/watch/${pick.kind === 'movie' ? pick.id : ''}" data-play="${pick.id}">${icons.play} Play</a>
          <a class="btn" href="#/title/${pick.id}">${icons.info} More info</a><button class="btn" data-spin>${icons.dice} Spin again</button></div>`);
      $('.btn.primary', result).focus();
    };
    if (still) reveal(); else setTimeout(reveal, 2650);
  };
  box.onclick = async (e) => {
    if (e.target === box || e.target.closest('[data-x]')) return close();
    const c = e.target.closest('[data-f]');
    if (c) { const k = c.dataset.f; f[k] = k === 'kind' ? c.dataset.v : f[k] === c.dataset.v ? '' : c.dataset.v; chips(); spin(); return; }
    if (e.target.closest('[data-spin]')) return spin();
    const play = e.target.closest('[data-play]');
    if (play) {
      if (!play.getAttribute('href').match(/\d+$/)) { e.preventDefault(); try { const d = await api('GET', `/api/items/${play.dataset.play}`); close(); location.hash = `#/watch/${d.playId}`; } catch (err) { toast(err.message); } return; }
      return close();
    }
    if (e.target.closest('a[href]')) close();
  };
  box.onkeydown = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  document.body.append(box);
  chips(); $('[data-x]', box).focus(); spin();
}

// ---------- voice search ----------
const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
export const canListen = () => !!(window.HallFlixNative?.voice || Speech);
export function listen(input) {
  const put = (text) => { if (!text) return; input.value = text; input.dispatchEvent(new Event('input', { bubbles: true })); };
  if (window.HallFlixNative?.voice) { window.HallFlixNative.voice(); return; }
  if (!Speech) return;
  const rec = new Speech();
  rec.lang = navigator.language || 'en-US'; rec.interimResults = true; rec.maxAlternatives = 1;
  const btn = $('.search .mic');
  btn?.classList.add('on');
  rec.onresult = (e) => put([...e.results].map((r) => r[0].transcript).join(' '));
  rec.onerror = (e) => { if (e.error === 'not-allowed') toast('Allow the microphone to search by voice'); };
  rec.onend = () => btn?.classList.remove('on');
  try { rec.start(); } catch { btn?.classList.remove('on'); }
}
// The Android app hands back what it heard.
addEventListener('hallflix-voice', (e) => { const input = $('.search input'); if (input && e.detail) { input.value = e.detail; input.dispatchEvent(new Event('input', { bubbles: true })); } });

export const announcement = (a) => (!a?.text ? '' : html`<div class="announce">${/^(https?:\/\/|#\/|\/)/.test(a.link || '') ? html`<a href="${a.link}">${a.text}</a>` : html`<span>${a.text}</span>`}<button data-dismiss aria-label="Dismiss">${raw('&times;')}</button></div>`);
