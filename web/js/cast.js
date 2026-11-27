// "Play on TV": a phone or computer starts a film or episode on a HallFlix TV (the Fire TV / Android TV app, Roku, or
// HallFlix in a TV's browser) signed in as the same profile, then becomes its remote.
//
// TVs check in every few seconds while nothing is playing (POST /api/remote/state with tv: true and no itemId) and
// pick up a { cmd: 'start', itemId, value } command; while playing, the players report as before (player.js,
// PlayerActivity, Roku) under the same device id, so each TV shows once.
import { $, $$, api, html, state, toast, isTV } from './core.js';
import { deviceId, deviceName, playerOpen } from './player.js';

const TV_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="13" rx="2"/><path d="M8 21h8M12 18v3"/></svg>';
export const castIcon = TV_ICON;

// ---------- on a TV: listen for something to play ----------
let listening = 0;
export function initCast() {
  if (!isTV() || listening) return;
  const tick = async () => {
    // Not while a film plays (the player reports then), nor before anyone has signed in.
    if (!state.profile || state.preview || playerOpen() || state.nativePlaying) return;
    try {
      const r = await fetch('/api/remote/state', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device: deviceId(), name: deviceName(), tv: true }) });
      if (!r.ok) return;
      for (const c of (await r.json()).commands || []) if (c.cmd === 'start' && +c.itemId) startHere(c.itemId, c.value);
    } catch { /* offline for a moment */ }
  };
  listening = setInterval(tick, 4000);
  tick();
}

/** Start a title on this screen, from a phone's "Play on TV" (or the remote while something else plays). */
export function startHere(itemId, at = 0) {
  location.hash = `#/watch/${+itemId}${+at > 0 ? `?at=${Math.floor(+at)}` : ''}`;
}

// ---------- on a phone or computer: send something to a TV ----------
let pending = null;
/** The TV a title was just sent to, while it starts (the remote shows "Starting on …" until it reports). */
export const castPending = () => (pending && Date.now() < pending.until ? pending.name : null);
/** The HallFlix TVs on now, signed in as this profile. */
export async function tvs() {
  if (isTV()) return [];
  try { return (await api('GET', '/api/remote/devices')).filter((d) => d.tv && d.id !== deviceId()); } catch { return []; }
}

/** Start a title on a TV (asking which, if there are several), then open the remote. */
export async function castTo(itemId, { start } = {}) {
  const list = await tvs();
  if (!list.length) { toast(`No HallFlix TV signed in as ${state.profile.name} is on. Open HallFlix on the TV and try again.`, 6000); return; }
  const tv = list.length === 1 ? list[0] : await pick(list);
  if (!tv) return;
  try {
    await api('POST', '/api/remote/command', { device: tv.id, cmd: 'start', itemId, value: start || 0 });
    pending = { name: tv.name, until: Date.now() + 25000 };
    toast(`Starting on ${tv.name}…`);
    location.hash = '#/remote';
  } catch (e) { toast(e.message); }
}

function pick(list) {
  return new Promise((done) => {
    const back = document.activeElement;
    const box = document.createElement('div');
    box.className = 'confirm';
    box.innerHTML = String(html`<div class="panel" role="dialog" aria-modal="true" aria-labelledby="cast-h">
      <h2 id="cast-h">Play on which TV?</h2>
      <div class="choices">${list.map((d) => html`<button class="choice" data-tv="${d.id}"><b>${d.name}</b><span>${d.idle ? 'Ready' : `Playing ${d.title || 'something'} now; this replaces it`}</span></button>`)}</div>
      <div class="actions"><button class="btn" data-x>Cancel</button></div></div>`);
    const close = (tv) => { box.remove(); back?.focus?.(); done(tv); };
    box.onclick = (e) => {
      if (e.target === box || e.target.closest('[data-x]')) return close(null);
      const b = e.target.closest('[data-tv]');
      if (b) close(list.find((d) => d.id === b.dataset.tv));
    };
    box.onkeydown = (e) => { if (e.key === 'Escape') close(null); };
    document.body.append(box);
    $('[data-tv]', box)?.focus();
  });
}

/** The "Play on TV" button on a title's page, added once we know a TV is on. */
export async function addCastButton(sheet, itemId) {
  if (!itemId || isTV()) return;
  const list = await tvs();
  const actions = $('.actions', sheet);
  if (!list.length || !actions?.isConnected || $('[data-cast]', actions)) return;
  const btn = document.createElement('button');
  btn.className = 'btn';
  btn.dataset.cast = String(itemId);
  btn.title = list.length === 1 ? `Play on ${list[0].name}` : 'Play on a TV';
  btn.innerHTML = `${TV_ICON}<span>Play on TV</span>`;
  const after = $$('.btn', actions).find((b) => !b.classList.contains('primary') && !b.matches('[href*="?t=0"]'));
  actions.insertBefore(btn, after || null);
}
