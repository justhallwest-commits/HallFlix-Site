// Entry point. `node src/main.js server` runs the site; `node src/main.js transcoder` runs the video worker.
const mode = process.argv[2] || 'server';
process.on('unhandledRejection', (e) => console.error('[unhandled]', e));
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => process.exit(0));

if (mode === 'transcoder') {
  const { startTranscoder } = await import('./transcoder.js');
  await startTranscoder();
} else if (mode === 'server') {
  const { startServer } = await import('./server.js');
  await startServer();
} else {
  console.error(`Unknown mode "${mode}". Use "server" or "transcoder".`);
  process.exit(1);
}
