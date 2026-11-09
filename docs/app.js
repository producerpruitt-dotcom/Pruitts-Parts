// Pruitt's Parts — static site for GitHub Pages. Sign-in and storage: Firebase (free plan).
import { firebaseConfig } from './config.js';

const FB = 'https://www.gstatic.com/firebasejs/10.12.2';

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const KIND = { tool: 'Tool', part: 'Part', hardware: 'Hardware' };
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};

// ---------- state ----------
const S = {
  status: 'loading', // loading | setup | signedout | ready | error
  user: null, items: [], query: '', kind: '', place: null, offline: false,
};
let fb = null;        // firebase modules + instances
let itemsCol = null;  // users/{uid}/items
let unsubItems = null;

function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2800);
}
const newId = () => 'i' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const locLabel = (l) => [l.area, l.spot, l.bin].filter(Boolean).join(' › ');
const locKey = (l) => JSON.stringify([l.area || '', l.spot || '', l.bin || '']);
const clean = (v, max = 200) => String(v ?? '').trim().slice(0, max);
const now = () => new Date().toISOString();

// ---------- data ----------
function friendly(e) {
  const code = (e && e.code) || '';
  const map = {
    'auth/invalid-email': 'That email address doesn\'t look right.',
    'auth/missing-password': 'Enter your password.',
    'auth/invalid-credential': 'Email or password is incorrect.',
    'auth/wrong-password': 'Email or password is incorrect.',
    'auth/user-not-found': 'Email or password is incorrect.',
    'auth/email-already-in-use': 'There is already an account with that email. Tap "Sign in" below.',
    'auth/weak-password': 'Use a password with at least 8 characters.',
    'auth/too-many-requests': 'Too many tries. Wait a few minutes and try again.',
    'auth/network-request-failed': 'No internet connection. Check Wi-Fi and try again.',
    'permission-denied': 'Saving was refused. Sign out and sign back in, then try again.',
    'resource-exhausted': 'The free storage limit was reached for today. Try again tomorrow.',
    'unavailable': 'Can\'t reach the server. Changes will save when you\'re back online.',
  };
  return map[code] || (e && e.message) || 'Something went wrong. Try again.';
}

function validate(b) {
  const it = {
    name: clean(b.name), kind: KIND[b.kind] ? b.kind : 'part',
    qty: b.qty === '' || b.qty == null ? 1 : Number(b.qty),
    notes: clean(b.notes, 2000), area: clean(b.area, 80), spot: clean(b.spot, 80), bin: clean(b.bin, 80),
  };
  if (!it.name) throw new Error('Give the item a name.');
  if (!Number.isInteger(it.qty) || it.qty < 0 || it.qty > 1000000) throw new Error('Quantity must be a whole number, 0 or more.');
  if (!it.area && (it.spot || it.bin)) throw new Error('Fill in the Area too (for example Garage, Shop or Truck).');
  return it;
}

// Writes go to the phone's local copy at once and sync in the background, so they
// work in a garage with poor signal. A refusal from the server shows up as a toast.
const bg = (p) => p.catch((e) => toast(friendly(e)));

function saveItem(id, body) {
  const data = { ...validate(body), updated: now() };
  bg(fb.setDoc(fb.doc(itemsCol, id), data));
  return { id, ...data };
}

// ---------- search ----------
const stem = (t) => (t.length > 3 && /(ch|sh|x|ss)es$/.test(t)) ? t.slice(0, -2)
  : (t.length > 3 && t.endsWith('s') && !t.endsWith('ss')) ? t.slice(0, -1) : t;

export function search(items, q, kind) {
  const tokens = q.toLowerCase().split(/[\s,]+/).filter(Boolean).slice(0, 8).map(stem);
  let rows = items.filter((i) => !kind || i.kind === kind);
  if (!tokens.length) return rows.slice().sort((a, b) => (b.updated || '').localeCompare(a.updated || '')).slice(0, 50);
  rows = rows.filter((i) => {
    const hay = `${i.name} ${i.notes} ${i.area} ${i.spot} ${i.bin} ${i.kind}`.toLowerCase();
    return tokens.every((t) => hay.includes(t));
  });
  const full = tokens.join(' ');
  const score = (i) => {
    const n = i.name.toLowerCase();
    if (n.startsWith(full)) return 0;
    if (tokens.every((t) => n.includes(t))) return n.startsWith(tokens[0]) ? 1 : 2;
    return 3;
  };
  return rows.sort((a, b) => score(a) - score(b) || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

function locations() {
  const m = new Map();
  for (const i of S.items) {
    if (!i.area) continue;
    const k = locKey(i);
    if (!m.has(k)) m.set(k, { area: i.area, spot: i.spot || '', bin: i.bin || '', count: 0 });
    m.get(k).count++;
  }
  const cmp = (a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });
  return [...m.values()].sort((a, b) => cmp(a.area, b.area) || cmp(a.spot, b.spot) || cmp(a.bin, b.bin));
}

// ---------- pieces ----------
function locStrip(l, big) {
  if (!l || !l.area) return `<div class="loc none${big ? ' big' : ''}"><div><span class="lbl">Location</span><span class="val">Not set</span></div></div>`;
  const parts = [['Area', l.area], ['Spot', l.spot], ['Bin', l.bin]].filter(([, v]) => v);
  return `<div class="loc${big ? ' big' : ''}">${parts.map(([k, v]) => `<div><span class="lbl">${k}</span><span class="val">${esc(v)}</span></div>`).join('')}</div>`;
}
const card = (i) => `<a class="card" href="#item-${i.id}">
    <div class="card-head"><span class="card-name">${esc(i.name)}</span>
      <span class="qty${i.qty === 0 ? ' zero' : ''}">${i.qty === 0 ? 'Out' : 'Qty ' + i.qty}</span></div>
    <span class="kind">${KIND[i.kind] || ''}</span>${locStrip(i)}</a>`;

function datalists() {
  const uniq = (a) => [...new Set(a.filter(Boolean))].sort((x, y) => x.localeCompare(y));
  const opts = (a) => a.map((v) => `<option value="${esc(v)}">`).join('');
  return `<datalist id="dl-area">${opts(uniq(S.items.map((i) => i.area)))}</datalist>
    <datalist id="dl-spot">${opts(uniq(S.items.map((i) => i.spot)))}</datalist>
    <datalist id="dl-bin">${opts(uniq(S.items.map((i) => i.bin)))}</datalist>`;
}
const locFields = (l, p = '') => `<div class="loc-grid">
    <div><label class="lab" for="${p}area">Area</label><input class="input" id="${p}area" list="dl-area" value="${esc(l.area)}" placeholder="Garage" autocomplete="off"></div>
    <div><label class="lab" for="${p}spot">Spot</label><input class="input" id="${p}spot" list="dl-spot" value="${esc(l.spot)}" placeholder="Red toolbox" autocomplete="off"></div>
    <div><label class="lab" for="${p}bin">Bin / Drawer</label><input class="input" id="${p}bin" list="dl-bin" value="${esc(l.bin)}" placeholder="Drawer 2" autocomplete="off"></div>
  </div>${datalists()}`;

// Two-tap delete: a stray tap never deletes anything.
function armButton(btn, armedText, action) {
  let armed = false, t;
  const label = btn.textContent;
  btn.addEventListener('click', async () => {
    if (!armed) {
      armed = true; btn.classList.add('armed'); btn.textContent = armedText;
      t = setTimeout(() => { armed = false; btn.classList.remove('armed'); btn.textContent = label; }, 4000);
      return;
    }
    clearTimeout(t); btn.disabled = true; await action();
  });
}

// ---------- views ----------
const view = () => $('#view');
function setTab(tab) { document.querySelectorAll('[data-tab]').forEach((a) => a.classList.toggle('on', a.dataset.tab === tab)); }

function vSearch() {
  setTab('search');
  view().innerHTML = `${S.offline ? '<div class="sync">Offline — showing what\'s saved on this device.</div>' : ''}
    <div class="chips" id="chips">${[['', 'All'], ['tool', 'Tools'], ['part', 'Parts'], ['hardware', 'Hardware']]
    .map(([k, l]) => `<button class="chip${S.kind === k ? ' on' : ''}" data-kind="${k}">${l}</button>`).join('')}</div><div id="results"></div>`;
  $('#chips').addEventListener('click', (e) => {
    const b = e.target.closest('.chip'); if (!b) return;
    S.kind = b.dataset.kind;
    document.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c === b));
    results();
  });
  if (matchMedia('(min-width: 760px)').matches) $('#q').focus();
  results();
}

function results() {
  const box = $('#results'); if (!box) return;
  const q = S.query.trim();
  const rows = search(S.items, q, S.kind);
  if (!rows.length) {
    box.innerHTML = q
      ? `<div class="empty"><strong>Nothing matches “${esc(q)}”</strong>Try fewer words, or <a href="#add" id="addFromSearch">add it now</a>.</div>`
      : S.items.length
        ? '<div class="empty"><strong>None of this type yet</strong></div>'
        : `<div class="empty"><strong>Nothing logged yet</strong>Tap <b>Add</b> to log your first tool or part and where it's kept.<br>Then type in the search bar any time to find it.</div>`;
    const a = $('#addFromSearch'); if (a) a.addEventListener('click', () => store.set('pp.prefill', q));
    return;
  }
  box.innerHTML = `<h2>${q ? `${rows.length} result${rows.length === 1 ? '' : 's'}` : 'Recently updated'}</h2><div class="list">${rows.slice(0, 200).map(card).join('')}</div>`;
}

function missing() {
  view().innerHTML = '<div class="empty"><strong>That item isn\'t here anymore</strong><a href="#search">Back to search</a></div>';
}

function vItem(id) {
  setTab('');
  const it = S.items.find((i) => i.id === id);
  if (!it) return missing();
  view().innerHTML = `
    <a href="#search" class="back" id="back">‹ Back</a>
    <div class="kind">${KIND[it.kind] || ''}</div>
    <div class="detail-name">${esc(it.name)}</div>
    ${locStrip(it, true)}
    <div class="panel"><span class="lab">How many on hand</span>
      <div class="stepper"><button id="dec" aria-label="One less">−</button><span class="n" id="qty">${it.qty}</span><button id="inc" aria-label="One more">+</button></div></div>
    ${it.notes ? `<div class="panel"><span class="lab">Notes</span><div class="notes">${esc(it.notes)}</div></div>` : ''}
    <div class="row-btns">
      <a class="btn primary" href="#edit-${it.id}">Edit or move</a>
      ${it.area ? '<button class="btn" id="here">What else is here?</button>' : ''}
      <button class="btn danger" id="del">Delete</button>
    </div>`;
  $('#back').addEventListener('click', (e) => { if (history.length > 1) { e.preventDefault(); history.back(); } });
  let pending = it.qty, timer;
  const bump = (d) => {
    pending = Math.max(0, pending + d); $('#qty').textContent = pending;
    clearTimeout(timer);
    timer = setTimeout(() => { if (pending !== it.qty) bg(fb.updateDoc(fb.doc(itemsCol, it.id), { qty: pending, updated: now() })); }, 600);
  };
  $('#dec').addEventListener('click', () => bump(-1));
  $('#inc').addEventListener('click', () => bump(1));
  const here = $('#here');
  if (here) here.addEventListener('click', () => { S.place = { area: it.area, spot: it.spot || '', bin: it.bin || '' }; go('place'); });
  armButton($('#del'), 'Tap again to delete', () => {
    bg(fb.deleteDoc(fb.doc(itemsCol, it.id))); toast('Deleted ' + it.name); go('search');
  });
}

function vForm(id) {
  const editing = !!id;
  setTab(editing ? '' : 'add');
  const existing = editing ? S.items.find((i) => i.id === id) : null;
  if (editing && !existing) return missing();
  const last = store.get('pp.lastLoc', { area: '', spot: '', bin: '' });
  const prefill = store.get('pp.prefill', ''); store.set('pp.prefill', '');
  const it = existing || { name: prefill, kind: store.get('pp.lastKind', 'part'), qty: 1, notes: '', ...last };
  let kind = it.kind;
  view().innerHTML = `
    <h1>${editing ? 'Edit item' : 'Add an item'}</h1>
    <form id="f" novalidate>
      <div id="err"></div>
      <div class="field"><label class="lab" for="name">What is it?</label>
        <input class="input" id="name" maxlength="200" value="${esc(it.name)}" placeholder='e.g. 1/4" x 3" lag screws' autocomplete="off"></div>
      <div class="field"><span class="lab">Type</span>
        <div class="seg" id="seg">${Object.entries(KIND).map(([k, l]) => `<button type="button" data-kind="${k}" class="${kind === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>
      <div class="field"><span class="lab">Where is it kept?</span>${locFields(it)}
        <div class="hint">Area is the room or vehicle. Spot is the shelf, cabinet or box. Bin is optional.</div></div>
      <div class="field"><label class="lab" for="qtyIn">How many</label>
        <input class="input" id="qtyIn" type="number" inputmode="numeric" min="0" step="1" value="${it.qty}"></div>
      <div class="field"><label class="lab" for="notes">Notes <span class="muted">(optional)</span></label>
        <textarea class="input" id="notes" maxlength="2000" placeholder="Size, brand, model, what it fits">${esc(it.notes)}</textarea></div>
      ${editing ? '' : `<div class="field"><label class="check"><input type="checkbox" id="another"${store.get('pp.another', true) ? ' checked' : ''}>Add another to the same spot after saving</label></div>`}
      <button class="btn primary block" type="submit" id="save">${editing ? 'Save changes' : 'Save item'}</button>
      ${editing ? `<a class="btn block" href="#item-${id}">Cancel</a>` : ''}
    </form>`;
  $('#seg').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    kind = b.dataset.kind; document.querySelectorAll('#seg button').forEach((x) => x.classList.toggle('on', x === b));
  });
  if (!it.name && matchMedia('(min-width: 760px)').matches) $('#name').focus();
  $('#f').addEventListener('submit', (e) => {
    e.preventDefault();
    const body = { name: $('#name').value, kind, qty: $('#qtyIn').value, notes: $('#notes').value, area: $('#area').value, spot: $('#spot').value, bin: $('#bin').value };
    let saved;
    try { saved = saveItem(editing ? id : newId(), body); }
    catch (err) { $('#err').innerHTML = `<div class="error">${esc(err.message)}</div>`; return; }
    store.set('pp.lastLoc', { area: saved.area, spot: saved.spot, bin: saved.bin }); store.set('pp.lastKind', kind);
    const where = saved.area ? ' → ' + locLabel(saved) : '';
    if (editing) { toast('Saved' + where); go('item-' + id); return; }
    const another = $('#another').checked; store.set('pp.another', another);
    toast('Saved ' + saved.name + where);
    if (another) {
      $('#name').value = ''; $('#notes').value = ''; $('#qtyIn').value = 1; $('#err').innerHTML = '';
      $('#name').focus();
    } else go('item-' + saved.id);
  });
}

function vLocations() {
  setTab('locations');
  const locs = locations();
  if (!locs.length) { view().innerHTML = '<h1>Locations</h1><div class="empty"><strong>No locations yet</strong>They appear here as soon as you add an item and say where it\'s kept.</div>'; return; }
  const byArea = new Map();
  locs.forEach((l) => { if (!byArea.has(l.area)) byArea.set(l.area, []); byArea.get(l.area).push(l); });
  view().innerHTML = `<h1>Locations</h1><div id="locList">${[...byArea].map(([area, rows]) => `<h2>${esc(area)}</h2><div class="list">${rows.map((l) =>
    `<button class="card loc-row" data-k="${esc(locKey(l))}"><span class="card-name">${esc([l.spot, l.bin].filter(Boolean).join(' › ') || 'Anywhere in ' + l.area)}</span>
      <span class="count">${l.count} item${l.count === 1 ? '' : 's'} ›</span></button>`).join('')}</div>`).join('')}</div>`;
  $('#locList').addEventListener('click', (e) => {
    const b = e.target.closest('.loc-row'); if (!b) return;
    const [area, spot, bin] = JSON.parse(b.dataset.k); S.place = { area, spot, bin }; go('place');
  });
}

async function commitInChunks(ops) {
  // Firestore batches hold up to 500 writes.
  for (let i = 0; i < ops.length; i += 400) {
    const batch = fb.writeBatch(fb.db);
    ops.slice(i, i + 400).forEach((op) => op(batch));
    bg(batch.commit());
  }
}

function vPlace() {
  setTab('locations');
  const p = S.place;
  if (!p) return go('locations');
  const rows = S.items.filter((i) => locKey(i) === locKey(p)).sort((a, b) => a.name.localeCompare(b.name));
  view().innerHTML = `
    <a href="#locations" class="back">‹ All locations</a>
    <h1>What's here</h1>${locStrip(p, true)}
    <div class="row-btns"><button class="btn primary" id="addHere">Add item here</button><button class="btn" id="ren">Rename or move this spot</button></div>
    <form id="rf" class="panel" hidden><div id="rerr"></div>${locFields(p, 'r')}
      <div class="hint">Everything in this spot moves with it. If you pick a name that already exists, the two are combined.</div>
      <div class="row-btns"><button class="btn primary" type="submit">Save</button></div></form>
    <h2>${rows.length} item${rows.length === 1 ? '' : 's'}</h2>
    <div class="list">${rows.map(card).join('') || '<div class="empty">Nothing stored here now.</div>'}</div>`;
  $('#addHere').addEventListener('click', () => { store.set('pp.lastLoc', p); go('add'); });
  $('#ren').addEventListener('click', () => { $('#rf').hidden = !$('#rf').hidden; });
  $('#rf').addEventListener('submit', (e) => {
    e.preventDefault();
    const to = { area: clean($('#rarea').value, 80), spot: clean($('#rspot').value, 80), bin: clean($('#rbin').value, 80) };
    if (!to.area) { $('#rerr').innerHTML = '<div class="error">Fill in the Area.</div>'; return; }
    const stamp = now();
    commitInChunks(rows.map((i) => (b) => b.update(fb.doc(itemsCol, i.id), { ...to, updated: stamp })));
    S.place = to; toast(`Moved ${rows.length} item${rows.length === 1 ? '' : 's'} to ${locLabel(to)}`);
  });
}

// CSV
export function parseCsv(text) {
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { f += '"'; i++; } else if (c === '"') q = false; else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
    else f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim()));
}
const csvCell = (v) => /[",\n\r]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);

function vAccount() {
  setTab('account');
  view().innerHTML = `
    <h1>Account</h1>
    <div class="panel"><div class="card-name">${esc(S.user.email)}</div>
      <div class="muted small">${S.items.length} item${S.items.length === 1 ? '' : 's'} logged. Your list is private to this account.</div></div>
    <div class="panel"><span class="lab">Add many items from a spreadsheet</span>
      <p class="small muted">Make a sheet with these column headings, save it as CSV, and pick it here:<br>
      <b>name, type, quantity, area, spot, bin, notes</b><br>Type is tool, part or hardware. Only name is required.</p>
      <input type="file" id="csv" accept=".csv,text/csv" hidden>
      <div class="row-btns"><button class="btn" id="imp">Choose CSV file</button><button class="btn" id="exp">Save a backup copy</button></div>
      <div id="impMsg"></div></div>
    <div class="row-btns"><button class="btn" id="pw">Email me a password-change link</button></div>
    <div class="row-btns"><button class="btn danger block" id="out">Sign out</button></div>`;
  $('#imp').addEventListener('click', () => $('#csv').click());
  $('#csv').addEventListener('change', async (e) => {
    const file = e.target.files[0]; if (!file) return;
    const msg = $('#impMsg');
    const rows = parseCsv(await file.text());
    const head = (rows[0] || []).map((h) => h.trim().toLowerCase());
    const ci = (n) => head.indexOf(n);
    e.target.value = '';
    if (ci('name') < 0) { msg.innerHTML = '<div class="error">The first row needs a heading called "name".</div>'; return; }
    const get = (r, ...names) => { for (const n of names) if (ci(n) >= 0 && r[ci(n)]) return r[ci(n)]; return ''; };
    const ops = []; const errors = []; const stamp = now();
    rows.slice(1).forEach((r, k) => {
      try {
        const data = { ...validate({ name: get(r, 'name'), kind: (get(r, 'type', 'kind') || 'part').trim().toLowerCase(),
          qty: get(r, 'quantity', 'qty').trim(), notes: get(r, 'notes'), area: get(r, 'area'), spot: get(r, 'spot'), bin: get(r, 'bin') }), updated: stamp };
        const id = newId() + k.toString(36);
        ops.push((b) => b.set(fb.doc(itemsCol, id), data));
      } catch (err) { errors.push(`Row ${k + 2}: ${err.message}`); }
    });
    await commitInChunks(ops);
    msg.innerHTML = `<p class="small"><b>Added ${ops.length} item${ops.length === 1 ? '' : 's'}.</b></p>` +
      (errors.length ? `<div class="error small">${errors.slice(0, 30).map(esc).join('<br>')}</div>` : '');
  });
  $('#exp').addEventListener('click', () => {
    const lines = ['name,type,quantity,area,spot,bin,notes'];
    S.items.slice().sort((a, b) => a.name.localeCompare(b.name)).forEach((i) =>
      lines.push([i.name, i.kind, i.qty, i.area, i.spot, i.bin, i.notes].map((v) => csvCell(v ?? '')).join(',')));
    const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: 'pruitts-parts-backup.csv' });
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
  });
  $('#pw').addEventListener('click', async () => {
    try { await fb.sendPasswordResetEmail(fb.auth, S.user.email); toast('Link sent to ' + S.user.email); }
    catch (err) { toast(friendly(err)); }
  });
  $('#out').addEventListener('click', () => { history.replaceState(null, '', '#search'); fb.signOut(fb.auth); });
}

function vAuth(mode = 'in') {
  setTab('');
  const isIn = mode === 'in';
  view().innerHTML = `
    <div class="auth">
      <h1>${isIn ? 'Sign in' : 'Create your account'}</h1>
      <p class="sub">Find any tool, part or piece of hardware in your shop.</p>
      <form id="af" novalidate>
        <div id="aerr"></div>
        <div class="field"><label class="lab" for="email">Email</label>
          <input class="input" id="email" type="email" autocomplete="${isIn ? 'username' : 'email'}" autocapitalize="none" spellcheck="false" value="${esc(store.get('pp.email', ''))}"></div>
        <div class="field"><label class="lab" for="pass">Password</label>
          <input class="input" id="pass" type="password" autocomplete="${isIn ? 'current-password' : 'new-password'}">
          ${isIn ? '' : '<div class="hint">At least 8 characters. Your phone can suggest and remember one for you.</div>'}</div>
        <button class="btn primary block" type="submit" id="abtn">${isIn ? 'Sign in' : 'Create account'}</button>
      </form>
      ${isIn ? '<div class="switch"><button class="linkbtn" id="forgot">Forgot password?</button></div>' : ''}
      <div class="switch">${isIn ? 'First time here?' : 'Already have an account?'}
        <button class="linkbtn" id="sw">${isIn ? 'Create an account' : 'Sign in'}</button></div>
    </div>`;
  $('#sw').addEventListener('click', () => vAuth(isIn ? 'up' : 'in'));
  const err = (m) => { $('#aerr').innerHTML = `<div class="${m.ok ? 'notice' : 'error'}">${esc(m.text)}</div>`; };
  const forgot = $('#forgot');
  if (forgot) forgot.addEventListener('click', async () => {
    const email = $('#email').value.trim();
    if (!email) return err({ text: 'Type your email above, then tap "Forgot password?" again.' });
    try { await fb.sendPasswordResetEmail(fb.auth, email); err({ ok: true, text: `If there's an account for ${email}, a link to set a new password is on its way. Check your email.` }); }
    catch (e) { err({ text: friendly(e) }); }
  });
  $('#af').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $('#email').value.trim(), pass = $('#pass').value;
    if (!isIn && pass.length < 8) return err({ text: 'Use a password with at least 8 characters.' });
    const btn = $('#abtn'); btn.disabled = true;
    try {
      store.set('pp.email', email);
      if (isIn) await fb.signInWithEmailAndPassword(fb.auth, email, pass);
      else await fb.createUserWithEmailAndPassword(fb.auth, email, pass);
      // onAuthStateChanged takes it from here
    } catch (ex) { err({ text: friendly(ex) }); btn.disabled = false; }
  });
}

function vStatus() {
  setTab('');
  const msg = {
    loading: ['Opening your inventory…', 'Your tools, parts and hardware will show here, each with the spot where it\'s stored.'],
    setup: ['Almost ready', 'This site still needs its Firebase settings. Whoever set it up: follow "Set up" in the README, then reload.'],
    error: ['Couldn\'t open your inventory', 'Check your internet connection, then reload the page.'],
  }[S.status];
  view().innerHTML = `<div class="empty"><strong>${msg[0]}</strong>${msg[1]}</div>`;
}

// ---------- router ----------
function go(name) { if (location.hash === '#' + name) render(); else location.hash = name; }
function render() {
  document.body.classList.toggle('out', S.status !== 'ready');
  if (S.status === 'signedout') return vAuth();
  if (S.status !== 'ready') return vStatus();
  const h = location.hash.replace(/^#/, '') || 'search';
  let m;
  if (h === 'search') return vSearch();
  if (h === 'add') return vForm(null);
  if ((m = h.match(/^edit-([A-Za-z0-9]+)$/))) return vForm(m[1]);
  if ((m = h.match(/^item-([A-Za-z0-9]+)$/))) return vItem(m[1]);
  if (h === 'locations') return vLocations();
  if (h === 'place') return vPlace();
  if (h === 'account') return vAccount();
  go('search');
}
// New data arrived: refresh lists, but never wipe a form someone is typing in.
function refresh() {
  const h = location.hash.replace(/^#/, '') || 'search';
  if (h === 'add' || h.startsWith('edit-') || h === 'account') return;
  if (h === 'search' && $('#results')) return results();
  render();
}
window.addEventListener('hashchange', () => { if (S.status === 'ready') { render(); window.scrollTo(0, 0); } });

// ---------- search bar ----------
const q = $('#q'), clearQ = $('#clearQ');
let qt;
q.addEventListener('input', () => {
  S.query = q.value; clearQ.hidden = !q.value;
  clearTimeout(qt);
  qt = setTimeout(() => { const h = location.hash.replace(/^#/, ''); if (h && h !== 'search') go('search'); else results(); }, 120);
});
$('#searchForm').addEventListener('submit', (e) => { e.preventDefault(); q.blur(); });
clearQ.addEventListener('click', () => { S.query = ''; q.value = ''; clearQ.hidden = true; q.focus(); results(); });

// ---------- start ----------
async function loadFirebase() {
  if (window.__ppFirebase) return window.__ppFirebase; // test hook
  const [app, auth, fs] = await Promise.all([
    import(`${FB}/firebase-app.js`), import(`${FB}/firebase-auth.js`), import(`${FB}/firebase-firestore.js`),
  ]);
  const a = app.initializeApp(firebaseConfig);
  let db;
  try {
    // Keep a copy on the device so search works with no signal.
    db = fs.initializeFirestore(a, { localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }) });
  } catch { db = fs.getFirestore(a); }
  return { ...auth, ...fs, auth: auth.getAuth(a), db };
}

async function start() {
  if (!window.__ppFirebase && String(firebaseConfig.apiKey).startsWith('PASTE')) { S.status = 'setup'; return render(); }
  try { fb = await loadFirebase(); } catch { S.status = 'error'; return render(); }
  fb.onAuthStateChanged(fb.auth, (user) => {
    if (unsubItems) { unsubItems(); unsubItems = null; }
    S.user = user; S.items = []; S.query = ''; q.value = ''; clearQ.hidden = true;
    if (!user) { S.status = 'signedout'; return render(); }
    S.status = 'loading'; render();
    itemsCol = fb.collection(fb.db, 'users', user.uid, 'items');
    unsubItems = fb.onSnapshot(itemsCol, { includeMetadataChanges: true }, (snap) => {
      S.items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      const wasOffline = S.offline;
      S.offline = snap.metadata.fromCache;
      const first = S.status !== 'ready';
      S.status = 'ready';
      if (first) { if (!location.hash) location.replace('#search'); render(); }
      else if (wasOffline !== S.offline && (location.hash === '#search' || !location.hash)) render();
      else refresh();
    }, (e) => { S.status = 'error'; render(); toast(friendly(e)); });
  });
}
render();
start();
