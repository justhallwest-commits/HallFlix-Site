// Runs once when HallFlix starts. `HallFlix` is the plugin API (see docs/PLUGINS.md).
HallFlix.registerEffect('pixels', {
  count: 50,
  spawn: (w, h) => ({ x: Math.random() * w, y: Math.random() * h, v: 30 + Math.random() * 60, s: 3 + Math.random() * 4, hue: Math.random() < 0.5 ? 52 : 318 }),
  step(p, dt, w, h) { p.y += p.v * dt; if (p.y > h + 10) { p.y = -10; p.x = Math.random() * w; } },
  draw(ctx, p) { ctx.globalAlpha = 0.5; ctx.fillStyle = `hsl(${p.hue} 100% 60%)`; ctx.fillRect(Math.round(p.x), Math.round(p.y), p.s, p.s); },
});

HallFlix.on('player:ended', ({ itemId }) => console.log('[retro-arcade] finished', itemId));
