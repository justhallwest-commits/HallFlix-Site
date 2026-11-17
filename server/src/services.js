// Small helpers shared by the services HallFlix asks for things it doesn't keep itself (ratings, subtitles).
import { cfg } from './config.js';

export const UA = `HallFlix/${cfg.version} (https://github.com/justhallwest-commits/HallFlix-Site)`;

/** A value deep in a JSON answer: "data.0.attributes.files". An empty path is the whole thing. */
export const dig = (obj, p) => (!p ? obj : String(p).split('.').reduce((a, k) => (a == null ? a : a[/^\d+$/.test(k) ? +k : k]), obj));

/** "https://x/{imdb}?s={season}" with the values filled in (and made safe for an address). */
export const fill = (tpl, vals) => String(tpl).replace(/\{(\w+)\}/g, (all, k) => (k in vals ? encodeURIComponent(vals[k] ?? '') : all));

export const cleanHeaders = (h) => Object.fromEntries(Object.entries(h && typeof h === 'object' ? h : {})
  .filter(([k, v]) => /^[\w-]{1,60}$/.test(k) && typeof v === 'string' && v.length < 2000));

export class ServiceError extends Error {
  constructor(message, status = 0) { super(message); this.status = status; }
}

/** GET (or POST) JSON from a service. 404 means "nothing here" and gives null. */
export async function getJson(url, { headers = {}, ms = 9000, method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(url, {
      method, signal: AbortSignal.timeout(ms),
      headers: { 'User-Agent': UA, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) { throw new ServiceError(e.name === 'TimeoutError' ? 'The service took too long to answer' : `Could not reach the service (${e.message})`); }
  if (res.status === 404) return null;
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { __text: text }; }
  if (res.status === 401 || res.status === 403) throw new ServiceError(data?.message || data?.Error || data?.error || 'The service did not accept the key', res.status);
  if (res.status === 429) throw new ServiceError('The service says too many requests today: try again later', 429);
  if (!res.ok) throw new ServiceError(data?.message || data?.error || `The service answered ${res.status}`, res.status);
  return data;
}

/** Raw bytes from a service (a subtitle file or a zip of them). */
export async function getBytes(url, { headers = {}, ms = 20000, max = 20e6 } = {}) {
  let res;
  try { res = await fetch(url, { signal: AbortSignal.timeout(ms), headers: { 'User-Agent': UA, ...headers } }); }
  catch (e) { throw new ServiceError(`Could not download the file (${e.message})`); }
  if (!res.ok) throw new ServiceError(`The download answered ${res.status}`, res.status);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > max) throw new ServiceError('That file is too large');
  return buf;
}

/** Keys and passwords never go back to the browser: it sees only that one is set. */
export const hideSecrets = (p) => {
  const out = { ...p };
  for (const k of ['apiKey', 'password']) if (k in out) { out[`${k}Set`] = !!out[k]; out[k] = ''; }
  return out;
};
/** A secret left blank in the Studio keeps the one already saved; "clear" removes it. */
export const keepSecret = (incoming, saved, k) => (incoming[`${k}Clear`] ? '' : String(incoming[k] || '').trim() || saved?.[k] || '');
