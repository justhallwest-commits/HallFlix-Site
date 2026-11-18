// The app's pages (index.html, the Studio's) with every script and style given a version from its contents:
// - an import map points each module at "/js/x.js?v=<hash>", so browsers can keep modules for good and only fetch the
//   ones that changed after an update (instead of asking about every file on every visit);
// - modulepreload links list the modules the page needs straight away, so they download side by side rather than one
//   import at a time.
// Browsers without import maps still work: they fetch the modules by their plain names, as before.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const versions = new Map(); // file → { key, v }
function version(file) {
  try {
    const st = fs.statSync(file);
    const key = `${st.size}:${st.mtimeMs}`;
    const hit = versions.get(file);
    if (hit?.key === key) return hit.v;
    const v = crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex').slice(0, 10);
    versions.set(file, { key, v });
    return v;
  } catch { return null; }
}

const IMPORT = /(?:^|[;\n}])\s*(?:import|export)\s+(?:[^'"`;]*?\s+from\s+)?['"]([^'"]+\.js)['"]/g;
/** The modules an entry module loads straight away (not the ones it loads later with import()). */
function staticGraph(webDir, entry) {
  const seen = new Set();
  const walk = (url) => {
    if (seen.has(url)) return;
    const file = path.join(webDir, url);
    let src;
    try { src = fs.readFileSync(file, 'utf8'); } catch { return; }
    seen.add(url);
    for (const m of src.matchAll(IMPORT)) {
      const spec = m[1];
      if (!spec.startsWith('.') && !spec.startsWith('/')) continue;
      walk(path.posix.resolve(path.posix.dirname(url), spec));
    }
  };
  walk(entry);
  return [...seen];
}

function moduleFiles(webDir) {
  const out = [];
  for (const dir of ['js', 'studio']) {
    let names = [];
    try { names = fs.readdirSync(path.join(webDir, dir)); } catch { /* none */ }
    for (const n of names) if (n.endsWith('.js')) out.push(`/${dir}/${n}`);
  }
  return out;
}

/** The page at `rel` (e.g. /index.html) with versions filled in. */
export function versionedPage(webDir, rel) {
  let html = fs.readFileSync(path.join(webDir, rel), 'utf8');
  const v = (url) => { const h = version(path.join(webDir, url)); return h ? `${url}?v=${h}` : url; };
  const map = {};
  for (const url of moduleFiles(webDir)) map[url] = v(url);
  const entry = /<script type="module" src="([^"?]+)"/.exec(html)?.[1];
  const preload = entry ? staticGraph(webDir, entry).filter((u) => u !== entry).map((u) => `<link rel="modulepreload" href="${map[u] || v(u)}">`) : [];
  // Styles and classic scripts get their versions in place.
  html = html.replace(/(href|src)="(\/[^"?]+\.(?:css|js))"/g, (all, attr, url) => (url.startsWith('/vendor/') ? all : `${attr}="${map[url] || v(url)}"`));
  const head = `<script type="importmap">${JSON.stringify({ imports: map })}</script>\n${preload.join('\n')}`;
  return html.replace(/(<meta charset="[^"]*">)/i, `$1\n${head}`);
}
