// Seasonal effects: a light particle layer over the whole app. Plugins can add their own with
// HallFlix.registerEffect(name, { count, spawn(w, h), step(p, dt, w, h), draw(ctx, p) }).
const TAU = Math.PI * 2;
const rnd = (a, b) => a + Math.random() * (b - a);
const fall = (speed, sway) => (p, dt, w, h) => {
  p.t += dt; p.y += p.v * speed * dt; p.x += Math.sin(p.t * p.f) * sway * dt; p.r += p.spin * dt;
  if (p.y > h + 30) { p.y = -30; p.x = rnd(0, w); }
};
const base = (w, h) => ({ x: rnd(0, w), y: rnd(-h, h), v: rnd(0.5, 1.4), f: rnd(0.4, 1.6), t: rnd(0, 10), r: rnd(0, TAU), spin: rnd(-1.5, 1.5), s: rnd(0.6, 1.3) });
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export const effects = {
  snow: { count: 70, spawn: base, step: fall(46, 22), draw(c, p) { c.globalAlpha = 0.55 + 0.3 * Math.sin(p.t); c.fillStyle = '#fff'; c.beginPath(); c.arc(p.x, p.y, 1.6 * p.s + 0.6, 0, TAU); c.fill(); } },
  embers: { count: 46, spawn: (w, h) => ({ ...base(w, h), y: rnd(0, h * 1.4) }),
    step(p, dt, w, h) { p.t += dt; p.y -= p.v * 38 * dt; p.x += Math.sin(p.t * p.f) * 16 * dt; if (p.y < -20) { p.y = h + 20; p.x = rnd(0, w); } },
    draw(c, p) { const a = 0.35 + 0.35 * Math.sin(p.t * 3); c.globalAlpha = a; c.fillStyle = '#ff8a3d'; c.shadowColor = '#ff5a1f'; c.shadowBlur = 10; c.beginPath(); c.arc(p.x, p.y, 1.4 * p.s, 0, TAU); c.fill(); c.shadowBlur = 0; } },
  hearts: { count: 26, spawn: (w, h) => ({ ...base(w, h), y: rnd(0, h * 1.4) }),
    step(p, dt, w, h) { p.t += dt; p.y -= p.v * 30 * dt; p.x += Math.sin(p.t * p.f) * 20 * dt; if (p.y < -30) { p.y = h + 30; p.x = rnd(0, w); } },
    draw(c, p) { const s = 7 * p.s; c.globalAlpha = 0.5; c.fillStyle = css('--accent') || '#ff4d7e'; c.beginPath(); c.moveTo(p.x, p.y + s * 0.9);
      c.bezierCurveTo(p.x - s * 1.6, p.y - s * 0.3, p.x - s * 0.7, p.y - s * 1.3, p.x, p.y - s * 0.4); c.bezierCurveTo(p.x + s * 0.7, p.y - s * 1.3, p.x + s * 1.6, p.y - s * 0.3, p.x, p.y + s * 0.9); c.fill(); } },
  leaves: { count: 28, spawn: (w, h) => ({ ...base(w, h), hue: rnd(12, 42) }), step: fall(54, 46),
    draw(c, p) { c.save(); c.translate(p.x, p.y); c.rotate(p.r); c.globalAlpha = 0.75; c.fillStyle = `hsl(${p.hue} 82% 48%)`; c.beginPath(); c.ellipse(0, 0, 8 * p.s, 3.6 * p.s, 0, 0, TAU); c.fill(); c.restore(); } },
  confetti: { count: 60, spawn: (w, h) => ({ ...base(w, h), hue: rnd(0, 360) }), step: fall(80, 36),
    draw(c, p) { c.save(); c.translate(p.x, p.y); c.rotate(p.r); c.globalAlpha = 0.85; c.fillStyle = `hsl(${p.hue} 90% 60%)`; c.fillRect(-4 * p.s, -2 * p.s, 8 * p.s, 4 * p.s * Math.abs(Math.cos(p.t * 3))); c.restore(); } },
  stars: { count: 80, spawn: (w, h) => ({ ...base(w, h), y: rnd(0, h) }), step(p, dt) { p.t += dt; },
    draw(c, p) { c.globalAlpha = 0.15 + 0.6 * Math.abs(Math.sin(p.t * p.f)); c.fillStyle = '#fff'; c.beginPath(); c.arc(p.x, p.y, 1.1 * p.s, 0, TAU); c.fill(); } },
  bats: { count: 9, spawn: (w, h) => ({ ...base(w, h), y: rnd(0, h * 0.55), dir: Math.random() < 0.5 ? -1 : 1 }),
    step(p, dt, w) { p.t += dt; p.x += p.dir * p.v * 70 * dt; p.y += Math.sin(p.t * 2 * p.f) * 22 * dt; if (p.x > w + 50) p.x = -50; if (p.x < -50) p.x = w + 50; },
    draw(c, p) { const s = 9 * p.s, flap = Math.sin(p.t * 12) * 0.6; c.save(); c.translate(p.x, p.y); c.globalAlpha = 0.6; c.fillStyle = '#0b0610'; c.strokeStyle = 'rgba(160,90,220,0.35)'; c.beginPath();
      c.moveTo(0, 0); c.quadraticCurveTo(-s, -s * (1 + flap), -s * 2.4, -s * 0.2 * (1 + flap)); c.quadraticCurveTo(-s * 1.2, s * 0.2, 0, s * 0.5);
      c.quadraticCurveTo(s * 1.2, s * 0.2, s * 2.4, -s * 0.2 * (1 + flap)); c.quadraticCurveTo(s, -s * (1 + flap), 0, 0); c.fill(); c.stroke(); c.restore(); } },
};

// Fireworks: a shell rises, bursts into sparks that fall and fade, then a new shell goes up somewhere else.
const shell = (w, h) => ({ x: rnd(w * 0.1, w * 0.9), y: h + rnd(10, 300), vy: rnd(-330, -250), top: rnd(h * 0.12, h * 0.45), hue: rnd(0, 360), sparks: null, wait: rnd(0, 2.5) });
Object.assign(effects, {
  snowflakes: { count: 26, spawn: base, step: fall(30, 26),
    draw(c, p) { const s = 7 * p.s + 3; c.save(); c.translate(p.x, p.y); c.rotate(p.r * 0.3); c.globalAlpha = 0.7; c.strokeStyle = '#fff'; c.lineWidth = 1.2; c.beginPath();
      for (let i = 0; i < 6; i++) { const a = (i * TAU) / 6, ca = Math.cos(a), sa = Math.sin(a); c.moveTo(0, 0); c.lineTo(ca * s, sa * s);
        const bx = ca * s * 0.6, by = sa * s * 0.6, b2 = s * 0.28; c.moveTo(bx, by); c.lineTo(bx + Math.cos(a + 0.7) * b2, by + Math.sin(a + 0.7) * b2); c.moveTo(bx, by); c.lineTo(bx + Math.cos(a - 0.7) * b2, by + Math.sin(a - 0.7) * b2); }
      c.stroke(); c.restore(); } },
  petals: { count: 34, spawn: (w, h) => ({ ...base(w, h), hue: rnd(320, 352), light: rnd(78, 90) }), step: fall(40, 52),
    draw(c, p) { c.save(); c.translate(p.x, p.y); c.rotate(p.r); c.scale(1, Math.abs(Math.cos(p.t * 1.7)) * 0.6 + 0.4); c.globalAlpha = 0.8; c.fillStyle = `hsl(${p.hue} 85% ${p.light}%)`;
      c.beginPath(); c.moveTo(0, -7 * p.s); c.quadraticCurveTo(6 * p.s, 0, 0, 7 * p.s); c.quadraticCurveTo(-6 * p.s, 0, 0, -7 * p.s); c.fill(); c.restore(); } },
  clovers: { count: 22, spawn: (w, h) => ({ ...base(w, h), four: Math.random() < 0.15 }), step: fall(44, 34),
    draw(c, p) { const s = 4.2 * p.s; c.save(); c.translate(p.x, p.y); c.rotate(p.r); c.globalAlpha = 0.8; c.fillStyle = p.four ? '#3ddc84' : '#22a55b';
      const n = p.four ? 4 : 3; for (let i = 0; i < n; i++) { c.rotate(TAU / n); c.beginPath(); c.arc(-s * 0.55, -s, s * 0.75, 0, TAU); c.arc(s * 0.55, -s, s * 0.75, 0, TAU); c.fill(); }
      c.strokeStyle = '#1b7f45'; c.lineWidth = 1.4; c.beginPath(); c.moveTo(0, 0); c.quadraticCurveTo(s * 0.6, s * 1.4, s * 0.3, s * 2.4); c.stroke(); c.restore(); } },
  eggs: { count: 14, spawn: (w, h) => ({ ...base(w, h), hue: rnd(0, 360), hue2: rnd(0, 360) }), step: fall(26, 20),
    draw(c, p) { const s = 8 * p.s; c.save(); c.translate(p.x, p.y); c.rotate(Math.sin(p.t * p.f) * 0.4); c.globalAlpha = 0.85;
      c.beginPath(); c.ellipse(0, 0, s * 0.75, s, 0, 0, TAU); c.fillStyle = `hsl(${p.hue} 70% 78%)`; c.fill(); c.clip();
      c.fillStyle = `hsl(${p.hue2} 75% 62%)`; c.fillRect(-s, -s * 0.18, s * 2, s * 0.3); c.fillStyle = '#fff'; for (let i = -1; i <= 1; i++) { c.beginPath(); c.arc(i * s * 0.38, s * 0.5, s * 0.1, 0, TAU); c.fill(); } c.restore(); } },
  fireflies: { count: 30, spawn: (w, h) => ({ ...base(w, h), y: rnd(h * 0.25, h), vx: rnd(-14, 14), vy: rnd(-10, 10) }),
    step(p, dt, w, h) { p.t += dt; p.vx += rnd(-20, 20) * dt; p.vy += rnd(-20, 20) * dt; p.vx *= 0.98; p.vy *= 0.98; p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.x < -10) p.x = w + 10; if (p.x > w + 10) p.x = -10; if (p.y < h * 0.15) p.vy += 8 * dt; if (p.y > h + 10) p.y = h * 0.3; },
    draw(c, p) { const a = Math.max(0, Math.sin(p.t * p.f * 1.4)) ** 2; if (a < 0.02) return; c.globalAlpha = a * 0.9; c.fillStyle = '#e8ff7a'; c.shadowColor = '#d4ff3d'; c.shadowBlur = 14; c.beginPath(); c.arc(p.x, p.y, 1.8 * p.s, 0, TAU); c.fill(); c.shadowBlur = 0; } },
  fireworks: { count: 5, spawn: (w, h) => ({ ...shell(w, h), y: rnd(h * 0.5, h), wait: rnd(0, 1.2) }), // the first shells start part-way up
    step(p, dt, w, h) {
      if (p.wait > 0) { p.wait -= dt; return; }
      if (!p.sparks) { p.y += p.vy * dt; if (p.y <= p.top) { const n = 46; p.sparks = Array.from({ length: n }, (_, i) => { const a = (i / n) * TAU + rnd(-0.05, 0.05), v = rnd(70, 150); return { x: p.x, y: p.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1 }; }); } return; }
      let alive = 0;
      for (const k of p.sparks) { k.vy += 70 * dt; k.vx *= 0.985; k.vy *= 0.985; k.x += k.vx * dt; k.y += k.vy * dt; k.life -= dt * 0.55; if (k.life > 0) alive++; }
      if (!alive) Object.assign(p, shell(w, h), { wait: rnd(0.3, 2) });
    },
    draw(c, p) {
      if (p.wait > 0) return;
      if (!p.sparks) { c.globalAlpha = 0.9; c.fillStyle = `hsl(${p.hue} 100% 80%)`; c.fillRect(p.x - 1, p.y, 2, 9); return; }
      c.fillStyle = `hsl(${p.hue} 100% 65%)`; c.shadowColor = c.fillStyle; c.shadowBlur = 8;
      for (const k of p.sparks) { if (k.life <= 0) continue; c.globalAlpha = Math.min(1, k.life); c.beginPath(); c.arc(k.x, k.y, 1.7, 0, TAU); c.fill(); }
      c.shadowBlur = 0;
    } },
});

/** Each viewer can switch the moving effects off on their own device (profile menu); seasons still change the colours. */
export const effectsOff = () => { try { return localStorage.getItem('hf_fx') === 'off'; } catch { return false; } };
const DENSITY = { light: 0.5, normal: 1, heavy: 1.8 };
let density = 1;

let current = 'none', parts = [], rafId = 0, last = 0, paused = false;
export function pauseEffects(v) { paused = v; }
export function startEffect(name, how = 'normal') {
  if (effectsOff()) name = 'none';
  const k = DENSITY[how] || 1;
  if (name === current && k === density) return;
  density = k;
  current = name; cancelAnimationFrame(rafId); parts = [];
  const canvas = document.getElementById('effects');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const fx = effects[name];
  if (!fx || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const size = () => { canvas.width = innerWidth; canvas.height = innerHeight; };
  size(); addEventListener('resize', size);
  const n = Math.max(1, Math.round((fx.count || 40) * density * Math.min(1, innerWidth / 1280 + 0.35)));
  parts = Array.from({ length: n }, () => fx.spawn(canvas.width, canvas.height));
  last = performance.now();
  const frame = (now) => {
    if (current !== name) return;
    rafId = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000);
    if (now - last < 30) return; // ~30 fps is plenty and keeps TVs cool
    last = now;
    if (paused || document.hidden) { ctx.clearRect(0, 0, canvas.width, canvas.height); return; }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const p of parts) { fx.step(p, dt, canvas.width, canvas.height); ctx.globalAlpha = 1; fx.draw(ctx, p); }
  };
  rafId = requestAnimationFrame(frame);
}
