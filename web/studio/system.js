// Studio → Devices and Studio → Health.

const VIA = { tailscale: ['Tailscale', 'Straight from the NAS, through Tailscale (fastest)'], internet: ['Internet', 'Through new.hallflix.net and Cloudflare'], home: ['Home network', 'On the home network'], direct: ['Direct', 'Straight to the server'] };
const ICON = { tv: '📺', phone: '📱', tablet: '📱', computer: '💻', other: '🌐' };

function ago(t) {
  const s = (Date.now() - new Date(t)) / 1000;
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 86400 * 14) return `${Math.round(s / 86400)} days ago`;
  return new Date(t).toLocaleDateString();
}
const size = (b) => { if (!Number.isFinite(b)) return '—'; const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; } return `${b.toFixed(b >= 100 || i === 0 ? 0 : 1)} ${u[i]}`; };

export async function devicesPage(main, { html, api, toast, fail, confirmBox }) {
  main.className = '';
  let filter = '';
  async function draw() {
    let d;
    try { d = await api('GET', '/api/studio/devices'); } catch (e) { fail(e); return; }
    const list = d.devices.filter((x) => !filter || x.kind === filter || (filter === 'phone' && x.kind === 'tablet'));
    const counts = d.devices.reduce((a, x) => { a[x.kind === 'tablet' ? 'phone' : x.kind] = (a[x.kind === 'tablet' ? 'phone' : x.kind] || 0) + 1; return a; }, {});
    main.innerHTML = String(html`<div class="card"><h2>Devices</h2>
      <p class="muted small">Every phone, TV and browser signed in to HallFlix: what it is, which app version, how it connects, and when it was last used. Signing a device out makes it ask for the profile's password (or a phone sign-in) again.</p>
      <div class="row-btns">${[['', `All (${d.devices.length})`], ['tv', `TVs (${counts.tv || 0})`], ['phone', `Phones and tablets (${counts.phone || 0})`], ['computer', `Computers (${counts.computer || 0})`]].map(([k, n]) => html`<button class="btn sm${filter === k ? ' primary' : ''}" data-filter="${k}">${n}</button>`)}</div></div>
      <div class="card"><table class="tbl devices"><thead><tr><th></th><th>Device</th><th>Profile</th><th>App</th><th>Connects through</th><th>Last used</th><th>Signed in</th><th></th></tr></thead><tbody>
      ${list.map((x) => html`<tr>
        <td class="ico">${ICON[x.kind] || '🌐'}</td>
        <td><b>${x.label}</b>${x.current ? html` <span class="chip on">This browser</span>` : ''}${x.ip ? html`<br><small class="muted">${x.ip}</small>` : ''}</td>
        <td>${x.profile}</td>
        <td>${x.app ? html`${x.app}${d.newestApp && x.app !== d.newestApp ? html` <span class="chip warn" title="An older app: reinstall from /get/android">older</span>` : ''}` : html`<span class="muted">—</span>`}</td>
        <td>${x.via ? html`<span title="${VIA[x.via]?.[1] || ''}">${VIA[x.via]?.[0] || x.via}</span>` : html`<span class="muted">Not since this update</span>`}</td>
        <td>${ago(x.seen)}</td><td class="muted">${ago(x.signedIn)}</td>
        <td>${x.current ? '' : html`<button class="btn sm danger" data-out="${x.id}">Sign out</button>`}</td></tr>`)}
      </tbody></table>${list.length ? '' : html`<p class="muted">No devices here.</p>`}</div>`);
  }
  main.addEventListener('click', async (e) => {
    const f = e.target.closest('[data-filter]');
    if (f) { filter = f.dataset.filter; draw(); return; }
    const b = e.target.closest('[data-out]');
    if (!b) return;
    confirmBox('Sign this device out?', 'It will need to sign in again to use HallFlix.', 'Sign out', async () => {
      try { await api('POST', `/api/studio/devices/${b.dataset.out}/signout`); toast('Signed out'); draw(); } catch (err) { fail(err); }
    });
  });
  await draw();
}

export async function healthPage(main, { html, api, fail }) {
  main.className = '';
  async function draw() {
    let h;
    main.querySelector('[data-again]')?.setAttribute('disabled', '');
    try { h = await api('GET', '/api/studio/health'); } catch (e) { fail(e); return; }
    const up = h.uptime > 86400 ? `${Math.floor(h.uptime / 86400)} days` : h.uptime > 3600 ? `${Math.floor(h.uptime / 3600)} hours` : `${Math.floor(h.uptime / 60)} minutes`;
    const okBadge = (ok, yes = 'Working', no = 'Problem') => html`<span class="chip ${ok ? 'on' : ok === null ? '' : 'bad'}">${ok ? yes : ok === null ? 'Not set' : no}</span>`;
    // Libraries on the same drive share a line.
    const drives = [];
    for (const d of h.disks) {
      const same = drives.find((x) => !d.error && !x.error && x.total === d.total && Math.abs(x.free - d.free) < 64 * 1024 * 1024);
      if (same) same.labels.push(d.label); else drives.push({ ...d, labels: [d.label] });
    }
    const problems = [
      ...h.addresses.filter((a) => a.ok === false).map((a) => `${a.url} isn’t answering`),
      ...(h.transcoder.ok ? [] : ['The transcoder isn’t answering, so videos that need converting won’t play']),
      ...drives.filter((d) => !d.error && d.free / d.total < 0.05).map((d) => `Less than 5% space left on the drive with ${d.labels.join(', ')}`),
      ...h.libraries.filter((l) => l.missing).map((l) => `${l.name}: its folder ${l.path} can’t be found`),
      ...(h.tmdb ? [] : ['No TMDB key, so new titles won’t get artwork and details (Studio → Settings)']),
    ];
    main.innerHTML = String(html`<div class="card"><h2>Health</h2>
      <p class="muted small">HallFlix ${h.version} · running for ${up} · using ${size(h.memory)} of memory · database ${size(h.database)}</p>
      ${problems.length ? html`<div class="health-bad">${problems.map((p) => html`<p>⚠️ ${p}</p>`)}</div>` : html`<p class="health-good">✅ Everything looks fine.</p>`}
      <div class="row-btns"><button class="btn sm" data-again>Check again</button></div></div>

      <div class="card"><h2>Addresses</h2><p class="muted small">Checked from the server itself. A phone or TV on another network may see it differently: the Tailscale address needs the Tailscale app on the device.</p>
        <table class="tbl"><tbody>${h.addresses.map((a) => html`<tr><td><b>${a.url}</b></td><td>${okBadge(a.ok, 'Answers', 'Not answering')}</td><td class="muted">${a.ok ? `${a.ms} ms` : a.error || (a.status ? `answered ${a.status}` : '')}</td></tr>`)}</tbody></table></div>

      <div class="card"><h2>Storage</h2><table class="tbl"><tbody>${drives.map((d) => {
        const used = d.error ? 0 : 1 - d.free / d.total;
        return html`<tr><td><b>${d.labels.join(', ')}</b><br><small class="muted">${d.path}</small></td>
          <td style="width:40%">${d.error ? html`<span class="chip bad">${d.error}</span>` : html`<div class="meter"><i style="width:${Math.round(used * 100)}%;${used > 0.95 ? 'background:#e5484d' : used > 0.85 ? 'background:#f5a524' : ''}"></i></div>`}</td>
          <td class="muted">${d.error ? '' : `${size(d.free)} free of ${size(d.total)}`}</td></tr>`;
      })}</tbody></table></div>

      <div class="card"><h2>Libraries and scanning</h2>
        <p class="muted small">${h.counts.movies} movies · ${h.counts.shows} shows (${h.counts.episodes} episodes) · ${h.counts.books} books and comics · ${h.counts.tracks} songs</p>
        ${h.scan.running ? html`<p>Scanning <b>${h.scan.library}</b>: ${h.scan.phase} ${h.scan.total ? `${h.scan.done} of ${h.scan.total}` : ''}</p>` : html`<p class="muted small">${h.scan.finishedAt ? `Last scan finished ${ago(h.scan.finishedAt)}.` : 'No scan since HallFlix started.'}</p>`}
        ${h.scan.errors.length ? html`<details><summary>${h.scan.errors.length} file${h.scan.errors.length === 1 ? '' : 's'} couldn’t be read in the last scan</summary><ul class="small">${h.scan.errors.map((e) => html`<li>${e}</li>`)}</ul></details>` : ''}
        <table class="tbl"><tbody>${h.libraries.map((l) => html`<tr><td><b>${l.name}</b></td><td class="muted">${l.path}</td><td>${l.items} titles</td><td>${l.missing ? html`<span class="chip bad">Folder missing</span>` : ''}</td></tr>`)}</tbody></table></div>

      <div class="card"><h2>Transcoder</h2>
        ${h.transcoder.ok ? html`<p>${okBadge(true, 'Answering')} Converting with <b>${h.transcoder.hw === 'software' ? 'the processor' : h.transcoder.hw}</b>${h.transcoder.hw === 'software' ? '' : ' (hardware)'} · ${h.transcoder.sessions} stream${h.transcoder.sessions === 1 ? '' : 's'} converting now${h.transcoder.jobs ? ` · ${h.transcoder.jobs} download cop${h.transcoder.jobs === 1 ? 'y' : 'ies'} being made` : ''}</p>`
          : html`<p>${okBadge(false, '', 'Not answering')} ${h.transcoder.error}. Check that the hallflix-transcoder container is running.</p>`}</div>`);
  }
  main.addEventListener('click', (e) => { if (e.target.closest('[data-again]')) draw(); });
  await draw();
}
