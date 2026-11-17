// Ratings from IMDb, Rotten Tomatoes, Metacritic, Letterboxd and others: the strip on a title's page and the badge on cards.
// Each source gets a small mark in its own colour (not the services' logos), so they're easy to tell apart at a glance.
import { html, raw, state, api } from './core.js';

const SVG = (body, vb = '0 0 24 24') => `<svg viewBox="${vb}" aria-hidden="true">${body}</svg>`;
const MARKS = {
  imdb: { short: 'IMDb', cls: 'imdb', icon: SVG('<rect x="1" y="5" width="22" height="14" rx="3" fill="#f5c518"/><path d="M5 9v6M8 9v6l1.5-4L11 15V9M13 9v6h1.5a1.5 1.5 0 0 0 1.5-1.5v-3A1.5 1.5 0 0 0 14.5 9zM18 8.5V15m0-2.5a1.5 1.5 0 1 1 3 0V14a1 1 0 0 1-1 1h-.5a1.5 1.5 0 0 1-1.5-1.5" stroke="#000" stroke-width="1.3" fill="none" stroke-linecap="round"/>') },
  rt: { short: 'Tomatometer', cls: 'rt' },
  rtAudience: { short: 'Popcornmeter', cls: 'rta', icon: SVG('<path d="M6 9h12l-1.6 12H7.6z" fill="#fa320a"/><path d="M8.5 9 9.3 21M12 9v12M15.5 9l-.8 12" stroke="#fff" stroke-width="1"/><circle cx="8" cy="7" r="2.6" fill="#fff4d6"/><circle cx="12" cy="5.6" r="2.9" fill="#fff4d6"/><circle cx="16" cy="7" r="2.6" fill="#fff4d6"/>') },
  metacritic: { short: 'Metascore', cls: 'mc' },
  metacriticUser: { short: 'Metacritic users', cls: 'mc' },
  letterboxd: { short: 'Letterboxd', cls: 'lb', icon: SVG('<circle cx="5" cy="12" r="4.4" fill="#ff8000"/><circle cx="12" cy="12" r="4.4" fill="#00e054" fill-opacity=".9"/><circle cx="19" cy="12" r="4.4" fill="#40bcf4" fill-opacity=".9"/>') },
  trakt: { short: 'Trakt', cls: 'trakt', icon: SVG('<circle cx="12" cy="12" r="10" fill="#ed1c24"/><path d="m7.5 11.5 3 3 6-6" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>') },
  tmdb: { short: 'TMDb', cls: 'tmdb', icon: SVG('<rect x="1" y="6" width="22" height="12" rx="6" fill="url(#tmg)"/><defs><linearGradient id="tmg" x1="0" x2="1"><stop offset="0" stop-color="#90cea1"/><stop offset="1" stop-color="#01b4e4"/></linearGradient></defs><text x="12" y="15.2" font-size="7.5" font-weight="800" text-anchor="middle" fill="#0d253f" font-family="Arial,sans-serif">TMDB</text>') },
  mal: { short: 'MyAnimeList', cls: 'mal', icon: SVG('<rect x="1" y="5" width="22" height="14" rx="3" fill="#2e51a2"/><text x="12" y="15" font-size="7.5" font-weight="800" text-anchor="middle" fill="#fff" font-family="Arial,sans-serif">MAL</text>') },
  rogerebert: { short: 'Roger Ebert', cls: 'ebert', icon: SVG('<path d="M12 2.5l2.8 6 6.5.7-4.9 4.4 1.4 6.4L12 16.8 6.2 20l1.4-6.4L2.7 9.2l6.5-.7z" fill="#e9b43a"/>') },
};
// Tomatometer: red tomato when fresh (60% and up), green splat when rotten. Metacritic: green, yellow or red box.
const tomato = (v) => (v >= 60 ? SVG('<circle cx="12" cy="13.5" r="8.5" fill="#fa320a"/><path d="M12 5.5c-1-2-3-2.6-4.6-2M12 5.5c1.3-1.8 3.4-2 5-1.3M12 5.5V3" stroke="#00912d" stroke-width="2" stroke-linecap="round" fill="none"/>')
  : SVG('<path d="M4 9.5 8 11l1-5 3 4 3.5-4.5L16 11l4.5-1.2-2.7 4.4 3 3.3-4.6-.2-.7 4.7-3.5-3-3.4 3.4-.9-4.8L3 18l2.8-3.8z" fill="#0ac855"/>'));
const metaBox = (v, max) => { const n = max === 10 ? v * 10 : v; const c = n >= 61 ? '#00ce7a' : n >= 40 ? '#ffbd3f' : '#ff6874'; return SVG(`<rect x="2" y="2" width="20" height="20" rx="4" fill="${c}"/>`); };

export function icon(source, value, max) {
  if (source === 'rt') return tomato(value);
  if (source === 'metacritic' || source === 'metacriticUser') return metaBox(value, max);
  return MARKS[source]?.icon || SVG('<circle cx="12" cy="12" r="9" fill="currentColor" opacity=".55"/>');
}

const votes = (n) => (!n ? '' : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(n));

/** The row of ratings on a title's page: each mark, the score, and where it's from. Links open the source's page. */
export function strip(list) {
  if (!list?.length) return '';
  return html`<div class="ratings">${list.map((r) => {
    const inner = html`<span class="ico">${raw(icon(r.source, r.value, r.max))}</span><span class="v"><b>${r.display}</b><small>${MARKS[r.source]?.short || r.label}${r.votes ? ` · ${votes(r.votes)}` : ''}</small></span>`;
    return r.url ? html`<a class="rating r-${MARKS[r.source]?.cls || 'x'}" href="${r.url}" target="_blank" rel="noopener" title="${r.label}${r.from && r.from !== r.label ? ` (via ${r.from})` : ''}">${inner}</a>`
      : html`<span class="rating r-${MARKS[r.source]?.cls || 'x'}" title="${r.label}">${inner}</span>`;
  })}</div>`;
}

/** The small badge on a card, from the short copy of ratings the card carries. */
export function badge(it) {
  const cfg = state.boot?.media?.ratings;
  if (!it.ratings || !cfg || cfg.badge === 'none') return '';
  const key = cfg.badge === 'auto' ? (cfg.show || []).find((k) => it.ratings[k]) : cfg.badge;
  const r = key && it.ratings[key];
  if (!r) return '';
  const [v, max] = r;
  const txt = max === 100 ? (['rt', 'rtAudience', 'trakt'].includes(key) ? `${Math.round(v)}%` : String(Math.round(v))) : max === 4 ? `${v}/4` : Number(v).toFixed(1);
  return html`<span class="rbadge" title="${MARKS[key]?.short || key}">${raw(icon(key, v, max))}${txt}</span>`;
}

/** Ask for a title's ratings (looked up the first time, then kept). */
export const load = (id) => api('GET', `/api/ratings/${id}`);
