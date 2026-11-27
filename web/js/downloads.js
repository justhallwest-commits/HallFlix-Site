// Downloads, from the website side: the Download buttons on title pages, the size chooser, and what is already saved.
// Only inside the HallFlix Android app (window.HallFlixNative), for profiles allowed to download (Studio → Profiles →
// Menu access). The app does the downloading and has the Downloads page itself, so it works with no connection.
import { $, $$, api, html, state, toast } from './core.js';

const N = () => window.HallFlixNative;
export const canDownload = () => !!N()?.download && !(state.boot?.access?.off || []).includes('download');
export const DL_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12m0 0-5-5m5 5 5-5M5 21h14"/></svg>';
const size = (n) => (!n ? '' : n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n >= 1e6 ? `${Math.round(n / 1e6)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);

/** What's saved on this phone: id → { state, pct }. */
export function saved() {
  const out = new Map();
  try { for (const d of JSON.parse(N().downloads()).items || []) out.set(+d.id, { state: d.state, pct: d.size ? (d.bytes || 0) / d.size : d.progress || 0 }); } catch { /* not in the app */ }
  return out;
}

export function openDownloads() { N()?.openDownloads?.(); }

/**
 * Save one or more titles (a film, an episode, a season, an album). Films and episodes ask which size first:
 * the original file, or a smaller copy the server makes.
 */
export async function download(ids, { title } = {}) {
  ids = ids.filter(Boolean);
  if (!ids.length || !canDownload()) return;
  let info;
  try { info = await api('GET', `/api/downloads/${ids[0]}`); } catch (e) { toast(e.message); return; }
  let quality = 'original';
  if (info.options.length > 1) { quality = await chooseSize(info, ids.length, title || info.title); if (!quality) return; }
  const have = saved();
  const todo = ids.filter((id) => !have.has(+id) || have.get(+id).state === 'failed');
  for (const id of todo) N().download(JSON.stringify({ itemId: +id, quality: String(quality) }));
  const what = todo.length === 1 ? (title || info.title) : `${todo.length} ${info.kind === 'track' ? 'songs' : info.kind === 'episode' ? 'episodes' : 'items'}`;
  toast(todo.length ? `Downloading ${what}. Find it under Downloads in the account menu.` : 'Already downloaded. Find it under Downloads in the account menu.', 5000);
  markSaved(document);
}

function chooseSize(info, count, title) {
  return new Promise((done) => {
    const back = document.activeElement;
    const box = document.createElement('div');
    box.className = 'confirm';
    const each = count > 1 ? ` each` : '';
    box.innerHTML = String(html`<div class="panel" role="dialog" aria-modal="true" aria-labelledby="dl-h">
      <h2 id="dl-h">Download ${title}${count > 1 ? ` (${count})` : ''}</h2>
      <p>Smaller copies use less space on your phone. Your server makes them first, which can take a few minutes${count > 1 ? ' each' : ''}.</p>
      <div class="choices">${info.options.map((o) => html`<button class="choice" data-q="${o.quality}"><b>${o.label}${o.size ? html` · ${o.estimate ? 'about ' : ''}${size(o.size)}${each}` : ''}</b><span>${o.detail || ''}</span></button>`)}</div>
      <div class="actions"><button class="btn" data-x>Cancel</button></div></div>`);
    const close = (q) => { box.remove(); back?.focus?.(); done(q); };
    box.onclick = (e) => {
      if (e.target === box || e.target.closest('[data-x]')) return close(null);
      const b = e.target.closest('[data-q]');
      if (b) close(b.dataset.q);
    };
    box.onkeydown = (e) => { if (e.key === 'Escape') close(null); };
    document.body.append(box);
    // A smaller copy is the sensible default on a phone.
    ($('[data-q="720"]', box) || $('[data-q]', box))?.focus();
  });
}

/** Show which Download buttons are already saved or on their way. */
export function markSaved(root) {
  if (!canDownload()) return;
  const have = saved();
  for (const b of $$('[data-dl]', root)) {
    const s = have.get(+b.dataset.dl);
    b.classList.toggle('on', !!s && s.state === 'done');
    b.classList.toggle('busy', !!s && s.state !== 'done' && s.state !== 'failed');
    const label = $('span', b);
    if (label) label.textContent = !s || s.state === 'failed' ? 'Download' : s.state === 'done' ? 'Downloaded' : `Downloading${s.pct > 0 ? ` ${Math.round(s.pct * 100)}%` : '…'}`;
    b.title = !s || s.state === 'failed' ? 'Download to watch offline' : s.state === 'done' ? 'Saved on this phone: open Downloads' : 'Downloading: open Downloads';
  }
}
// Progress from the app while a title page is open.
addEventListener('hallflix-downloads', () => markSaved(document));

/** A tap on a Download button: start it, or open Downloads if it's already saved or on its way. */
export function onDownloadClick(btn, opts) {
  const s = saved().get(+btn.dataset.dl);
  if (s && s.state !== 'failed') { openDownloads(); return; }
  download([+btn.dataset.dl], opts);
}
