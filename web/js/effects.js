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

let current = 'none', parts = [], rafId = 0, last = 0, paused = false;
export function pauseEffects(v) { paused = v; }
export function startEffect(name) {
  if (name === current) return;
  current = name; cancelAnimationFrame(rafId); parts = [];
  const canvas = document.getElementById('effects');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const fx = effects[name];
  if (!fx || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const size = () => { canvas.width = innerWidth; canvas.height = innerHeight; };
  size(); addEventListener('resize', size);
  const n = Math.round((fx.count || 40) * Math.min(1, innerWidth / 1280 + 0.35));
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
