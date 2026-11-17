// HallFlix sounds: built-in packs drawn with the Web Audio API, and any sound swapped for an uploaded file.
// Used by the app (feel.js) and by the Studio, which plays each one as a test. Nothing here touches the page.

/** Every sound the app makes, with the words the Studio shows for it. */
export const EVENTS = [
  ['move', 'Moving between items', 'Each step with the arrow keys or the remote, and pointing at a button'],
  ['select', 'Choosing something', 'Pressing a button or a link'],
  ['open', 'Opening a title', 'A title page opening'],
  ['back', 'Going back', 'Leaving a title page'],
  ['signin', 'Signing in', 'When a profile signs in'],
  ['toast', 'A message', 'The small messages at the bottom of the screen'],
  ['ident', 'The ident', 'The logo card before a movie or episode (plays even when navigation sounds are off)'],
];

/** The built-in packs. Each is a set of short sketches for `tone()`; anything a pack leaves out falls back to "soft". */
export const PACKS = {
  soft: {
    move: (t) => t(520, 60, { gain: 0.035 }),
    select: (t) => t(440, 90, { type: 'triangle', gain: 0.04, to: 700 }),
    open: (t) => t(300, 220, { gain: 0.045, to: 620 }),
    back: (t) => t(520, 140, { gain: 0.035, to: 260 }),
    signin: (t) => { t(392, 380, { gain: 0.04 }); t(523, 420, { gain: 0.035, delay: 0.09 }); t(784, 620, { gain: 0.03, delay: 0.18 }); },
    toast: (t) => { t(880, 120, { gain: 0.025 }); t(1320, 180, { gain: 0.02, delay: 0.07 }); },
  },
  arcade: {
    move: (t) => t(880, 45, { type: 'square', gain: 0.025 }),
    select: (t) => t(660, 90, { type: 'square', gain: 0.04, to: 1320 }),
    open: (t) => { t(523, 70, { type: 'square', gain: 0.03 }); t(784, 70, { type: 'square', gain: 0.03, delay: 0.07 }); t(1047, 120, { type: 'square', gain: 0.03, delay: 0.14 }); },
    back: (t) => t(660, 140, { type: 'square', gain: 0.03, to: 220 }),
    signin: (t) => [523, 659, 784, 1047].forEach((f, i) => t(f, 110, { type: 'square', gain: 0.03, delay: i * 0.08 })),
    toast: (t) => t(1568, 80, { type: 'square', gain: 0.02 }),
  },
  // Warm and low, like a theatre: soft thumps and a gentle swell.
  cinema: {
    move: (t) => t(180, 70, { gain: 0.06, lp: 900 }),
    select: (t) => { t(150, 160, { gain: 0.07, lp: 700, to: 110 }); t(600, 120, { type: 'triangle', gain: 0.018, lp: 2400, delay: 0.02 }); },
    open: (t) => { t(90, 700, { gain: 0.07, to: 180, lp: 600 }); t(440, 600, { type: 'triangle', gain: 0.02, delay: 0.25, lp: 1800 }); },
    back: (t) => t(220, 260, { gain: 0.05, to: 120, lp: 800 }),
    signin: (t) => { t(65, 1200, { gain: 0.08, to: 130, lp: 500 }); t(330, 900, { type: 'triangle', gain: 0.025, delay: 0.4, lp: 1600 }); t(494, 900, { type: 'triangle', gain: 0.02, delay: 0.55, lp: 1600 }); },
    toast: (t) => t(260, 200, { type: 'triangle', gain: 0.03, lp: 1400 }),
  },
  // Clear and bell-like: a glassy tap with a little shimmer on top.
  glass: {
    move: (t) => { t(1760, 90, { gain: 0.016 }); t(3520, 60, { gain: 0.006 }); },
    select: (t) => { t(1318, 260, { gain: 0.025 }); t(2637, 200, { gain: 0.009 }); },
    open: (t) => [1047, 1318, 1568].forEach((f, i) => t(f, 500, { gain: 0.02, delay: i * 0.06 })),
    back: (t) => [1568, 1175].forEach((f, i) => t(f, 300, { gain: 0.02, delay: i * 0.07 })),
    signin: (t) => [784, 988, 1175, 1568].forEach((f, i) => { t(f, 900, { gain: 0.02, delay: i * 0.09 }); t(f * 2, 500, { gain: 0.006, delay: i * 0.09 }); }),
    toast: (t) => t(2093, 260, { gain: 0.018 }),
  },
  // Futuristic: filtered sweeps and short data blips, made for the futuristic interface.
  scifi: {
    move: (t) => t(1200, 40, { type: 'sawtooth', gain: 0.012, lp: 2600, to: 1500 }),
    select: (t) => { t(400, 140, { type: 'sawtooth', gain: 0.02, lp: 1800, to: 1600 }); t(1600, 60, { gain: 0.02, delay: 0.12 }); },
    open: (t) => { t(120, 420, { type: 'sawtooth', gain: 0.025, lp: 1200, to: 900 }); t(1800, 90, { gain: 0.018, delay: 0.32 }); },
    back: (t) => t(1400, 220, { type: 'sawtooth', gain: 0.018, lp: 1600, to: 200 }),
    signin: (t) => { t(100, 900, { type: 'sawtooth', gain: 0.03, lp: 900, to: 1200 }); [1200, 1600, 2400].forEach((f, i) => t(f, 80, { gain: 0.016, delay: 0.6 + i * 0.07 })); },
    toast: (t) => { t(2000, 50, { gain: 0.016 }); t(2400, 50, { gain: 0.014, delay: 0.07 }); },
  },
};
export const PACK_NAMES = { off: 'Off', soft: 'Soft', arcade: 'Arcade', cinema: 'Cinema (warm and low)', glass: 'Glass (bell-like)', scifi: 'Sci-fi (sweeps and blips)', custom: 'Only my uploaded sounds' };

let ac = null, master = null;
const buffers = new Map(); // url → Promise<AudioBuffer|null>
/** The audio context, made (or woken) on first use. Browsers only let it start after a tap or key press. */
function ctx() {
  try {
    ac ||= new (window.AudioContext || window.webkitAudioContext)();
    if (!master) { master = ac.createDynamicsCompressor(); master.threshold.value = -10; master.connect(ac.destination); } // keeps loud uploads from clipping
    if (ac.state === 'suspended') ac.resume();
    return ac;
  } catch { return null; }
}

function tone(gainScale) {
  return (freq, ms, { type = 'sine', gain = 0.05, to = null, delay = 0, lp = 0 } = {}) => {
    const t = ac.currentTime + delay, o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + ms / 1000);
    const peak = Math.max(0.00011, gain * gainScale);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000);
    let node = o;
    if (lp) { const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp; node = o.connect(f); }
    node.connect(g).connect(master); o.start(t); o.stop(t + ms / 1000 + 0.02);
  };
}

/** The built-in ident sound: a low swell and a bright two-note chime. */
function identSynth(t) {
  t(70, 1500, { gain: 0.09, to: 140 });
  t(140, 1400, { type: 'triangle', gain: 0.03, to: 280 });
  t(784, 900, { gain: 0.05, delay: 0.75 });
  t(1175, 1200, { gain: 0.045, delay: 0.93 });
}

const files = new Map(); // url → Promise<ArrayBuffer|null>: fetched early, decoded once sound is allowed
function fetchFile(url) {
  if (!files.has(url)) {
    files.set(url, fetch(url, { credentials: 'same-origin' }).then((r) => (r.ok ? r.arrayBuffer() : null)).catch(() => null));
  }
  return files.get(url);
}
function load(url) {
  if (!buffers.has(url)) {
    buffers.set(url, fetchFile(url)
      .then((b) => (b ? new Promise((ok, bad) => ctx().decodeAudioData(b.slice(0), ok, bad)) : null))
      .catch(() => null)
      .then((buf) => { if (!buf) { buffers.delete(url); files.delete(url); } return buf; }));
  }
  return buffers.get(url);
}

/** What a theme says about one sound: its file, its volume and whether it is off. */
export function setting(theme, name) {
  const e = theme?.soundFx?.events?.[name] || {};
  return { url: typeof e.url === 'string' ? e.url : '', volume: Number.isFinite(+e.volume) ? Math.max(0, Math.min(1.5, +e.volume)) : 1, off: !!e.off };
}
const masterVolume = (theme) => (Number.isFinite(+theme?.soundFx?.volume) ? Math.max(0, Math.min(1, +theme.soundFx.volume)) : 0.8);

/** Fetch and decode the uploaded sounds ahead of time, so the first one plays without a gap. */
export function preload(theme) {
  for (const [n] of EVENTS) { const s = setting(theme, n); if (s.url && !s.off) fetchFile(s.url); }
}

let lastMove = 0;
/**
 * Play one sound as the theme describes it. `test` plays it even when the pack is off (the Studio's play buttons).
 * Returns false when nothing played.
 */
export function playSound(name, theme, { test = false } = {}) {
  const pack = theme?.sounds || 'off';
  const s = setting(theme, name);
  if (s.off || (!test && pack === 'off' && name !== 'ident')) return false;
  if (name === 'move' && !test) { const n = performance.now(); if (n - lastMove < 55) return false; lastMove = n; }
  // Browsers only allow sound after the first tap or key press; before that, stay quiet rather than queue it.
  if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return false;
  if (!ctx()) return false;
  const vol = masterVolume(theme) * s.volume;
  if (vol <= 0) return false;
  if (s.url) {
    load(s.url).then((buf) => {
      if (!buf) return;
      const src = ac.createBufferSource(), g = ac.createGain();
      src.buffer = buf; g.gain.value = vol;
      src.connect(g).connect(master); src.start();
    });
    return true;
  }
  if (name === 'ident') { identSynth(tone(vol / 0.8)); return true; }
  if (pack === 'custom' && !test) return false; // "only my uploaded sounds": nothing to play for this one
  const sketch = (PACKS[pack] || PACKS.soft)[name] || PACKS.soft[name];
  if (!sketch) return false;
  sketch(tone(vol / 0.8)); // the sketches are tuned for the default volume
  return true;
}
