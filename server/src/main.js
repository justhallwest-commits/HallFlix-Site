// Entry point. `node src/main.js server` runs the site; `node src/main.js transcoder` runs the video worker;
// `node src/main.js theme-schema` regenerates docs/theme.schema.json.
const mode = process.argv[2] || 'server';
process.on('unhandledRejection', (e) => console.error('[unhandled]', e));
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => process.exit(0));

if (mode === 'transcoder') {
  const { startTranscoder } = await import('./transcoder.js');
  await startTranscoder();
} else if (mode === 'server') {
  const { startServer } = await import('./server.js');
  await startServer();
} else if (mode === 'theme-schema') {
  // Regenerate docs/theme.schema.json from the theme contract (server/src/themespec.js).
  const fs = await import('node:fs');
  const { themeFileSchema } = await import('./themespec.js');
  const out = new URL('../../docs/theme.schema.json', import.meta.url);
  fs.writeFileSync(out, JSON.stringify(themeFileSchema(), null, 2) + '\n');
  console.log(`Wrote ${out.pathname}`);
} else {
  console.error(`Unknown mode "${mode}". Use "server", "transcoder" or "theme-schema".`);
  process.exit(1);
}
