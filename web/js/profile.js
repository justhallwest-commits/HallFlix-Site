// Editing your own profile from the app: picture, name, colour, password, and signing out other devices.
import { $, $$, api, html, raw, state, toast, avatarStyle, applyLook } from './core.js';
import { editAvatar, saveAvatar } from './avatar.js';

export const COLORS = ['#35d0d0', '#2a6df4', '#6366f1', '#b344d6', '#ff4d7e', '#f43f5e', '#ff7a3d', '#e8b84a', '#84cc16', '#1ce783', '#14b8a6', '#94a3b8'];
export const avatarInner = (p) => (p.avatar ? html`<img src="${p.avatar}" alt="">` : String(p.name || '?')[0].toUpperCase());

/** Update every avatar of the signed-in profile already on screen. */
function refreshMine() {
  const p = state.profile;
  for (const el of $$('.nav [data-menu].avatar, .hub-head .avatar')) {
    el.setAttribute('style', avatarStyle(p));
    el.innerHTML = p.avatar ? String(html`<img src="${p.avatar}" alt="" style="width:100%;height:100%;border-radius:inherit;object-fit:cover">`) : p.name[0].toUpperCase();
  }
  applyLook();
}

export async function editProfile() {
  let me;
  try { me = await api('GET', '/api/profiles/me'); } catch (e) { toast(e.message); return; }
  const v = { name: me.name, color: me.color || '' };
  const wrap = document.createElement('div');
  wrap.className = 'confirm pf-edit';
  const draw = () => {
    wrap.innerHTML = String(html`<div class="panel" role="dialog" aria-modal="true" aria-label="Edit your profile"><h2>Your profile</h2>
      <div class="pf-top"><button class="pf-pic avatar" data-pic style="${avatarStyle({ ...me, color: v.color || me.color })}" aria-label="Change your picture">${avatarInner(me)}<span>Change</span></button>
        <div class="pf-fields"><label>Name<input data-name maxlength="40" value="${v.name}" autocomplete="nickname"></label>
          <div class="pf-colors" role="radiogroup" aria-label="Colour">${COLORS.map((c) => html`<button role="radio" aria-checked="${v.color === c}" aria-label="Colour ${c}" data-color="${c}" class="${v.color === c ? 'on' : ''}" style="background:${c}"></button>`)}</div>
          <p class="pf-hint">Your colour tints HallFlix while you're signed in${me.avatar ? '' : ', and fills your picture until you choose one'}.</p></div></div>
      <details class="pf-more"><summary>Change your password or PIN</summary>
        <div class="pf-pw"><label>Current<input type="password" data-cur autocomplete="current-password"></label><label>New (at least 4 characters)<input type="password" data-new autocomplete="new-password"></label>
          <button class="btn" data-pw>Change it</button></div></details>
      <div class="pf-dev"><span>${me.devices > 1 ? `Signed in on ${me.devices} devices` : 'Signed in on this device only'}</span>${me.devices > 1 ? html`<button class="linkbtn" data-others>Sign out the others</button>` : ''}</div>
      ${me.admin ? html`<p class="pf-hint"><a href="/studio#profiles">Manage every profile in the Studio ›</a></p>` : ''}
      <div class="err"></div>
      <div class="actions"><button class="btn primary" data-save>Save</button><button class="btn" data-close>Close</button></div></div>`);
    $('[data-name]', wrap).addEventListener('input', (e) => { v.name = e.target.value; });
  };
  const close = () => { wrap.remove(); removeEventListener('keydown', onKey, true); };
  const onKey = (e) => { if (e.key === 'Escape' && !$('.av-modal')) { e.preventDefault(); e.stopImmediatePropagation(); close(); } };
  addEventListener('keydown', onKey, true);
  draw();
  document.body.append(wrap);
  $('[data-pic]', wrap).focus();
  wrap.addEventListener('click', async (e) => {
    const t = e.target;
    if (t === wrap || t.closest('[data-close]')) return close();
    const c = t.closest('[data-color]');
    if (c) { v.color = c.dataset.color; for (const b of $$('[data-color]', wrap)) { b.classList.toggle('on', b === c); b.setAttribute('aria-checked', String(b === c)); } $('[data-pic]', wrap).setAttribute('style', avatarStyle({ ...me, color: v.color })); return; }
    if (t.closest('[data-pic]')) {
      const res = await editAvatar({ profile: me, title: 'Your picture' });
      if (!res) return;
      try { const p = await saveAvatar(me.id, res); me.avatar = p.avatar; state.profile.avatar = p.avatar; refreshMine(); draw(); toast(res.remove ? 'Picture removed' : 'Picture saved'); } catch (err) { toast(err.message); }
      return;
    }
    if (t.closest('[data-pw]')) {
      try { await api('POST', '/api/password', { current: $('[data-cur]', wrap).value, next: $('[data-new]', wrap).value }); toast('Password changed'); $('[data-cur]', wrap).value = ''; $('[data-new]', wrap).value = ''; }
      catch (err) { $('.err', wrap).textContent = err.message; }
      return;
    }
    if (t.closest('[data-others]')) {
      try { await api('POST', '/api/profiles/me/signout-others'); me.devices = 1; draw(); toast('Signed out everywhere else'); } catch (err) { toast(err.message); }
      return;
    }
    if (t.closest('[data-save]')) {
      try {
        const p = await api('PUT', '/api/profiles/me', { name: v.name, color: v.color || null });
        Object.assign(state.profile, { name: p.name, color: p.color }); me = { ...me, ...p };
        refreshMine(); toast('Saved'); close();
      } catch (err) { $('.err', wrap).textContent = err.message; }
    }
  });
}
