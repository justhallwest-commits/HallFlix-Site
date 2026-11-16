// TMDb lookups. Accepts either the short "API Key" or the long "API Read Access Token".
import { cfg } from './config.js';
import { getSetting } from './db.js';

export async function tmdbKey() { return (await getSetting('tmdbKey', '')) || ''; }

async function call(pathname, params = {}) {
  const key = await tmdbKey();
  if (!key) return null;
  const url = new URL(cfg.tmdbBase + pathname);
  for (const [k, v] of Object.entries(params)) if (v != null && v !== '') url.searchParams.set(k, v);
  const headers = { Accept: 'application/json' };
  if (key.startsWith('eyJ')) headers.Authorization = `Bearer ${key}`; else url.searchParams.set('api_key', key);
  for (let attempt = 0; attempt < 4; attempt++) {
    let res;
    try { res = await fetch(url, { headers, signal: AbortSignal.timeout(15e3) }); }
    catch (e) { if (attempt === 3) throw new Error(`TMDb unreachable: ${e.message}`); await sleep(1000 * (attempt + 1)); continue; }
    if (res.status === 429) { await sleep((+res.headers.get('retry-after') || 2) * 1000); continue; }
    if (res.status === 404) return null;
    if (res.status === 401) throw new Error('TMDb rejected the API key');
    if (!res.ok) { if (attempt === 3) throw new Error(`TMDb error ${res.status}`); await sleep(1000); continue; }
    return res.json();
  }
  return null;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function testKey() { return !!(await call('/configuration')); }

const ref = (p) => (p ? `tmdb:${p}` : null);
const norm = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

function best(results, title, year, titleKeys, dateKey) {
  if (!results?.length) return null;
  const want = norm(title);
  let top = null, topScore = -1;
  results.slice(0, 10).forEach((r, i) => {
    let score = 10 - i;
    if (titleKeys.some((k) => norm(r[k]) === want)) score += 20;
    const y = +String(r[dateKey] || '').slice(0, 4);
    if (year && y) score += y === year ? 15 : Math.abs(y - year) === 1 ? 6 : -8;
    if (score > topScore) { top = r; topScore = score; }
  });
  return top;
}

function pickLogo(images) {
  const logos = images?.logos || [];
  const en = logos.filter((l) => l.iso_639_1 === 'en');
  const pool = en.length ? en : logos.filter((l) => !l.iso_639_1);
  const png = pool.filter((l) => /\.png$/.test(l.file_path));
  return ref((png[0] || pool[0])?.file_path);
}
function pickTrailer(videos) {
  const list = (videos?.results || []).filter((v) => v.site === 'YouTube' && v.type === 'Trailer');
  return (list.find((v) => v.official) || list[0])?.key || null;
}
const people = (credits) => (credits?.cast || []).slice(0, 14).map((c) => ({ name: c.name, role: c.character || '', photo: ref(c.profile_path) }));

export async function matchMovie({ title, year, tmdbId }) {
  let id = tmdbId;
  if (!id) {
    let s = await call('/search/movie', { query: title, year, include_adult: 'false' });
    if (year && !s?.results?.length) s = await call('/search/movie', { query: title, include_adult: 'false' });
    id = best(s?.results, title, year, ['title', 'original_title'], 'release_date')?.id;
  }
  if (!id) return null;
  const d = await call(`/movie/${id}`, { append_to_response: 'credits,release_dates,images,videos', include_image_language: 'en,null' });
  if (!d) return null;
  const us = (d.release_dates?.results || []).find((r) => r.iso_3166_1 === 'US');
  return {
    tmdb_id: d.id, title: d.title, year: +String(d.release_date || '').slice(0, 4) || year || null,
    overview: d.overview || null, tagline: d.tagline || null, premiered: d.release_date || null,
    genres: (d.genres || []).map((g) => g.name), studios: (d.production_companies || []).slice(0, 3).map((c) => c.name),
    rating: us?.release_dates?.map((x) => x.certification).find(Boolean) || null, score: d.vote_average || null,
    people: people(d.credits), poster: ref(d.poster_path), backdrop: ref(d.backdrop_path),
    logo: pickLogo(d.images), trailer: pickTrailer(d.videos),
  };
}

export async function matchShow({ title, year, tmdbId }) {
  let id = tmdbId;
  if (!id) {
    let s = await call('/search/tv', { query: title, first_air_date_year: year, include_adult: 'false' });
    if (year && !s?.results?.length) s = await call('/search/tv', { query: title, include_adult: 'false' });
    id = best(s?.results, title, year, ['name', 'original_name'], 'first_air_date')?.id;
  }
  if (!id) return null;
  const d = await call(`/tv/${id}`, { append_to_response: 'content_ratings,credits,images,videos', include_image_language: 'en,null' });
  if (!d) return null;
  const us = (d.content_ratings?.results || []).find((r) => r.iso_3166_1 === 'US');
  return {
    tmdb_id: d.id, title: d.name, year: +String(d.first_air_date || '').slice(0, 4) || year || null,
    overview: d.overview || null, tagline: d.tagline || null, premiered: d.first_air_date || null,
    genres: (d.genres || []).map((g) => g.name), studios: (d.networks || []).slice(0, 3).map((c) => c.name),
    rating: us?.rating || null, score: d.vote_average || null,
    people: people(d.credits), poster: ref(d.poster_path), backdrop: ref(d.backdrop_path),
    logo: pickLogo(d.images), trailer: pickTrailer(d.videos),
    seasons: (d.seasons || []).map((s) => ({ season: s.season_number, title: s.name, overview: s.overview || null, poster: ref(s.poster_path) })),
  };
}

export async function seasonEpisodes(showTmdbId, season) {
  const d = await call(`/tv/${showTmdbId}/season/${season}`);
  if (!d) return null;
  return (d.episodes || []).map((e) => ({
    episode: e.episode_number, title: e.name, overview: e.overview || null,
    still: ref(e.still_path), premiered: e.air_date || null, score: e.vote_average || null,
  }));
}
