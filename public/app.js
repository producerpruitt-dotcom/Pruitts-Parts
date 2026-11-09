// Pruitt's Parts — single-page app, no build step.
const $ = (sel, root = document) => root.querySelector(sel);
const app = $('#app');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const KIND_LABEL = { tool: 'Tool', part: 'Part', hardware: 'Hardware' };

const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};

const state = { user: null, query: '', kind: '', locations: [] };

// ---------- API ----------
async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (res.status === 401 && path !== '/api/login' && path !== '/api/me') {
    state.user = null; render();
    throw new Error(data?.error || 'Please sign in');
  }
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data;
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2400);
}

// ---------- icons ----------
const icon = {
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  bins: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 12h18M10 8h4M10 16h4"/></svg>',
  user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>',
};

// ---------- shared pieces ----------
function locStrip(loc, big = false) {
  if (!loc) return `<div class="loc none${big ? ' big' : ''}"><div><span class="lbl">Location</span><span class="val">Not set</span></div></div>`;
  const parts = [['Area', loc.area], ['Spot', loc.spot], ['Bin', loc.bin]].filter(([, v]) => v);
  return `<div class="loc${big ? ' big' : ''}">${parts.map(([l, v]) =>
    `<div><span class="lbl">${l}</span><span class="val">${esc(v)}</span></div>`).join('')}</div>`;
}

function itemCard(it) {
  return `<a class="card" href="#/item/${it.id}">
    <div class="card-head">
      <span class="card-name">${esc(it.name)}</span>
      <span class="qty${it.quantity === 0 ? ' zero' : ''}">${it.quantity === 0 ? 'Out' : `Qty ${it.quantity}`}</span>
    </div>
    <span class="kind">${KIND_LABEL[it.kind]}</span>
    ${locStrip(it.location)}
  </a>`;
}

function shell(active, inner) {
  const nav = (href, key, label) => `<a href="${href}" class="${active === key ? 'active' : ''}">${label}</a>`;
  return `
    <header class="top">
      <div class="top-row">
        <a class="brand" href="#/">Pruitt's Parts</a>
        <nav class="top-nav">
          ${nav('#/', 'search', 'Search')}${nav('#/add', 'add', 'Add item')}
          ${nav('#/locations', 'locations', 'Locations')}${nav('#/account', 'account', 'Account')}
        </nav>
      </div>
      <form class="search-wrap" id="searchForm" role="search">
        ${icon.search}
        <input class="search" id="q" type="search" placeholder="What are you looking for?"
          autocomplete="off" autocapitalize="none" spellcheck="false" enterkeyhint="search"
          aria-label="Search your inventory" value="${esc(state.query)}">
        <button type="button" class="clear-btn${state.query ? '' : ' hidden'}" id="clearQ" aria-label="Clear search">×</button>
      </form>
    </header>
    <main>${inner}</main>
    <nav class="tabs">
      <a href="#/" class="${active === 'search' ? 'active' : ''}">${icon.search}Search</a>
      <a href="#/add" class="add ${active === 'add' ? 'active' : ''}">${icon.plus}Add</a>
      <a href="#/locations" class="${active === 'locations' ? 'active' : ''}">${icon.bins}Locations</a>
      <a href="#/account" class="${active === 'account' ? 'active' : ''}">${icon.user}Account</a>
    </nav>`;
}

function wireSearchBar() {
  const q = $('#q');
  const clear = $('#clearQ');
  let timer;
  q.addEventListener('input', () => {
    state.query = q.value;
    clear.classList.toggle('hidden', !q.value);
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (location.hash !== '#/' && location.hash !== '') location.hash = '#/';
      else runSearch();
    }, 150);
  });
  $('#searchForm').addEventListener('submit', (e) => { e.preventDefault(); q.blur(); });
  clear.addEventListener('click', () => {
    state.query = ''; q.value = ''; clear.classList.add('hidden'); q.focus();
    if (location.hash === '#/' || location.hash === '') runSearch();
  });
}

// ---------- views ----------
async function viewSearch() {
  app.innerHTML = shell('search', `
    <div class="chips" id="chips">
      ${[['', 'All'], ['tool', 'Tools'], ['part', 'Parts'], ['hardware', 'Hardware']].map(([k, l]) =>
        `<button class="chip${state.kind === k ? ' on' : ''}" data-kind="${k}">${l}</button>`).join('')}
    </div>
    <div id="results"></div>`);
  wireSearchBar();
  $('#chips').addEventListener('click', (e) => {
    const b = e.target.closest('.chip'); if (!b) return;
    state.kind = b.dataset.kind;
    document.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c === b));
    runSearch();
  });
  // Focus the search box on desktop so you can just start typing.
  if (matchMedia('(min-width: 760px)').matches) $('#q').focus();
  if (state.query) { const q = $('#q'); q.setSelectionRange(q.value.length, q.value.length); }
  await runSearch();
}

let searchSeq = 0;
async function runSearch() {
  const box = $('#results'); if (!box) return;
  const seq = ++searchSeq;
  const params = new URLSearchParams();
  if (state.query.trim()) params.set('q', state.query.trim());
  if (state.kind) params.set('kind', state.kind);
  const { items } = await api(`/api/items?${params}`);
  if (seq !== searchSeq) return; // a newer search already finished
  const q = state.query.trim();
  if (!items.length) {
    box.innerHTML = q
      ? `<div class="empty"><strong>No match for “${esc(q)}”</strong>Try fewer words, or <a href="#/add" id="addFromSearch">add it</a>.</div>`
      : `<div class="empty"><strong>Your inventory is empty</strong>Tap <b>Add</b> to log your first tool or part,<br>or import a spreadsheet from <a href="#/account">Account</a>.</div>`;
    const link = $('#addFromSearch');
    if (link) link.addEventListener('click', () => store.set('pp.prefillName', q));
    return;
  }
  box.innerHTML = `
    <h2>${q ? `${items.length}${items.length === 100 ? '+' : ''} result${items.length === 1 ? '' : 's'}` : 'Recently updated'}</h2>
    <div class="list">${items.map(itemCard).join('')}</div>`;
}

async function viewItem(id) {
  app.innerHTML = shell('', '<p class="muted">Loading…</p>');
  wireSearchBar();
  let item;
  try { ({ item } = await api(`/api/items/${id}`)); }
  catch (e) { $('main').innerHTML = `<div class="empty"><strong>${esc(e.message)}</strong><a href="#/">Back to search</a></div>`; return; }

  $('main').innerHTML = `
    <a href="#/" class="small muted" id="back">‹ Back</a>
    <div class="kind">${KIND_LABEL[item.kind]}</div>
    <div class="detail-name">${esc(item.name)}</div>
    ${locStrip(item.location, true)}
    <div class="panel">
      <label class="lab">Quantity on hand</label>
      <div class="stepper">
        <button id="dec" aria-label="Use one">−</button>
        <span class="n" id="qty">${item.quantity}</span>
        <button id="inc" aria-label="Add one">+</button>
      </div>
    </div>
    ${item.notes ? `<div class="panel"><label class="lab">Notes</label><div class="notes">${esc(item.notes)}</div></div>` : ''}
    <div class="row-btns">
      <a class="btn primary" href="#/edit/${item.id}">Edit / Move</a>
      ${item.location ? `<a class="btn" href="#/location/${item.location.id}">What else is here?</a>` : ''}
      <button class="btn danger" id="del">Delete</button>
    </div>`;

  $('#back').addEventListener('click', (e) => { if (history.length > 1) { e.preventDefault(); history.back(); } });
  const setQty = async (delta) => {
    const n = Math.max(0, item.quantity + delta);
    if (n === item.quantity) return;
    item.quantity = n; $('#qty').textContent = n;
    try { await api(`/api/items/${item.id}`, { method: 'PATCH', body: { quantity: n } }); }
    catch (e) { toast(e.message); }
  };
  $('#dec').addEventListener('click', () => setQty(-1));
  $('#inc').addEventListener('click', () => setQty(1));
  $('#del').addEventListener('click', async () => {
    if (!confirm(`Delete “${item.name}”? This can't be undone.`)) return;
    await api(`/api/items/${item.id}`, { method: 'DELETE' });
    toast('Deleted');
    location.hash = '#/';
  });
}

async function loadLocations() {
  const { locations } = await api('/api/locations');
  state.locations = locations;
  return locations;
}

function datalists(locs) {
  const uniq = (arr) => [...new Set(arr.filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const opts = (arr) => arr.map((v) => `<option value="${esc(v)}">`).join('');
  return `
    <datalist id="dl-area">${opts(uniq(locs.map((l) => l.area)))}</datalist>
    <datalist id="dl-spot">${opts(uniq(locs.map((l) => l.spot)))}</datalist>
    <datalist id="dl-bin">${opts(uniq(locs.map((l) => l.bin)))}</datalist>`;
}

async function viewForm(id) {
  const editing = Boolean(id);
  app.innerHTML = shell(editing ? '' : 'add', '<p class="muted">Loading…</p>');
  wireSearchBar();

  const [locs, existing] = await Promise.all([
    loadLocations(),
    editing ? api(`/api/items/${id}`).then((r) => r.item) : null,
  ]);
  const last = store.get('pp.lastLocation', { area: '', spot: '', bin: '' });
  const lastKind = store.get('pp.lastKind', 'part');
  const prefill = store.get('pp.prefillName', '');
  store.set('pp.prefillName', '');
  const it = existing || { name: prefill, kind: lastKind, quantity: 1, notes: '', location: last };
  const loc = it.location || { area: '', spot: '', bin: '' };

  $('main').innerHTML = `
    <h1>${editing ? 'Edit item' : 'Add an item'}</h1>
    <form id="itemForm" novalidate>
      <div id="formErr"></div>
      <div class="field">
        <label class="lab" for="name">What is it?</label>
        <input class="input" id="name" name="name" required maxlength="200" value="${esc(it.name)}"
          placeholder="e.g. 1/4&quot; x 3&quot; lag screws" autocomplete="off">
      </div>
      <div class="field">
        <label class="lab">Type</label>
        <div class="seg" id="kindSeg">
          ${Object.entries(KIND_LABEL).map(([k, l]) =>
            `<button type="button" data-kind="${k}" class="${it.kind === k ? 'on' : ''}">${l}</button>`).join('')}
        </div>
      </div>
      <div class="field">
        <label class="lab">Where is it stored?</label>
        <div class="loc-grid">
          <div><label class="lab" for="area">Area</label>
            <input class="input" id="area" list="dl-area" value="${esc(loc.area)}" placeholder="Garage" autocomplete="off"></div>
          <div><label class="lab" for="spot">Spot</label>
            <input class="input" id="spot" list="dl-spot" value="${esc(loc.spot)}" placeholder="Red toolbox" autocomplete="off"></div>
          <div><label class="lab" for="bin">Bin / Drawer</label>
            <input class="input" id="bin" list="dl-bin" value="${esc(loc.bin)}" placeholder="Drawer 2" autocomplete="off"></div>
        </div>
        <div class="hint">Area is the room or vehicle. Spot is the shelf, cabinet or box. Bin is optional.</div>
        ${datalists(locs)}
      </div>
      <div class="field">
        <label class="lab" for="quantity">Quantity</label>
        <input class="input" id="quantity" type="number" inputmode="numeric" min="0" step="1" value="${it.quantity}">
      </div>
      <div class="field">
        <label class="lab" for="notes">Notes <span class="muted">(optional)</span></label>
        <textarea class="input" id="notes" maxlength="2000" placeholder="Size, brand, model, what it fits…">${esc(it.notes)}</textarea>
      </div>
      ${editing ? '' : `<div class="field"><label class="check"><input type="checkbox" id="another" ${store.get('pp.addAnother', true) ? 'checked' : ''}>
        Add another to the same spot after saving</label></div>`}
      <button class="btn primary block" type="submit" id="save">${editing ? 'Save changes' : 'Save item'}</button>
      ${editing ? `<a class="btn block" href="#/item/${id}">Cancel</a>` : ''}
    </form>`;

  let kind = it.kind;
  $('#kindSeg').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    kind = b.dataset.kind;
    document.querySelectorAll('#kindSeg button').forEach((x) => x.classList.toggle('on', x === b));
  });
  if (!it.name) $('#name').focus();

  $('#itemForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = {
      name: $('#name').value, kind,
      quantity: $('#quantity').value === '' ? 1 : Number($('#quantity').value),
      notes: $('#notes').value,
      location: { area: $('#area').value, spot: $('#spot').value, bin: $('#bin').value },
    };
    const btn = $('#save'); btn.disabled = true;
    try {
      const { item } = editing
        ? await api(`/api/items/${id}`, { method: 'PATCH', body })
        : await api('/api/items', { method: 'POST', body });
      store.set('pp.lastLocation', body.location);
      store.set('pp.lastKind', kind);
      const where = item.location ? ` → ${item.location.label}` : '';
      if (editing) { toast(`Saved${where}`); location.hash = `#/item/${item.id}`; return; }
      const another = $('#another').checked;
      store.set('pp.addAnother', another);
      toast(`Saved ${item.name}${where}`);
      if (another) {
        // Fast entry: keep the location and type, clear the rest.
        $('#name').value = ''; $('#notes').value = ''; $('#quantity').value = 1;
        $('#formErr').innerHTML = ''; btn.disabled = false; $('#name').focus();
        loadLocations();
      } else {
        location.hash = `#/item/${item.id}`;
      }
    } catch (err) {
      $('#formErr').innerHTML = `<div class="error">${esc(err.message)}</div>`;
      btn.disabled = false;
    }
  });
}

async function viewLocations() {
  app.innerHTML = shell('locations', '<p class="muted">Loading…</p>');
  wireSearchBar();
  const locs = await loadLocations();
  if (!locs.length) {
    $('main').innerHTML = `<h1>Locations</h1><div class="empty"><strong>No locations yet</strong>They're created automatically when you add an item.</div>`;
    return;
  }
  const byArea = new Map();
  for (const l of locs) {
    if (!byArea.has(l.area)) byArea.set(l.area, []);
    byArea.get(l.area).push(l);
  }
  $('main').innerHTML = `<h1>Locations</h1>${[...byArea].map(([area, rows]) => `
    <div class="area-group">
      <h2>${esc(area)}</h2>
      <div class="list">${rows.map((l) => `
        <a class="card loc-row" href="#/location/${l.id}">
          <span class="card-name">${esc([l.spot, l.bin].filter(Boolean).join(' › ') || '(anywhere in ' + l.area + ')')}</span>
          <span class="count">${l.item_count} item${l.item_count === 1 ? '' : 's'} ›</span>
        </a>`).join('')}
      </div>
    </div>`).join('')}`;
}

async function viewLocation(id) {
  app.innerHTML = shell('locations', '<p class="muted">Loading…</p>');
  wireSearchBar();
  const [locs, { items }] = await Promise.all([loadLocations(), api(`/api/items?location_id=${id}`)]);
  const loc = locs.find((l) => l.id === Number(id));
  if (!loc) { $('main').innerHTML = '<div class="empty"><strong>Location not found</strong><a href="#/locations">All locations</a></div>'; return; }

  $('main').innerHTML = `
    <a href="#/locations" class="small muted">‹ All locations</a>
    <h1>What's here</h1>
    ${locStrip(loc, true)}
    <div class="row-btns">
      <a class="btn primary" href="#/add" id="addHere">Add item here</a>
      <button class="btn" id="rename">Rename / move</button>
      ${items.length ? '' : '<button class="btn danger" id="delLoc">Delete location</button>'}
    </div>
    <form id="renameForm" class="panel hidden">
      <div id="renErr"></div>
      <div class="loc-grid">
        <div><label class="lab" for="rArea">Area</label><input class="input" id="rArea" list="dl-area" value="${esc(loc.area)}"></div>
        <div><label class="lab" for="rSpot">Spot</label><input class="input" id="rSpot" list="dl-spot" value="${esc(loc.spot)}"></div>
        <div><label class="lab" for="rBin">Bin / Drawer</label><input class="input" id="rBin" list="dl-bin" value="${esc(loc.bin)}"></div>
      </div>
      ${datalists(locs)}
      <div class="hint">Everything in this spot moves with it. If the new name already exists, the two are combined.</div>
      <div class="row-btns"><button class="btn primary" type="submit">Save</button></div>
    </form>
    <h2>${items.length} item${items.length === 1 ? '' : 's'}</h2>
    <div class="list">${items.map(itemCard).join('') || '<div class="empty">Nothing stored here.</div>'}</div>`;

  $('#addHere').addEventListener('click', () => store.set('pp.lastLocation', { area: loc.area, spot: loc.spot, bin: loc.bin }));
  $('#rename').addEventListener('click', () => $('#renameForm').classList.toggle('hidden'));
  $('#delLoc')?.addEventListener('click', async () => {
    if (!confirm('Delete this empty location?')) return;
    await api(`/api/locations/${id}`, { method: 'DELETE' });
    location.hash = '#/locations';
  });
  $('#renameForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const r = await api(`/api/locations/${id}`, { method: 'PATCH',
        body: { area: $('#rArea').value, spot: $('#rSpot').value, bin: $('#rBin').value } });
      toast(r.merged ? 'Combined with existing location' : 'Location updated');
      if (String(r.id) === String(id)) render(); else location.hash = `#/location/${r.id}`;
    } catch (err) { $('#renErr').innerHTML = `<div class="error">${esc(err.message)}</div>`; }
  });
}

function viewAccount() {
  app.innerHTML = shell('account', `
    <h1>Account</h1>
    <div class="panel">
      <div class="card-name">${esc(state.user.name)}</div>
      <div class="muted">${esc(state.user.email)}</div>
    </div>
    <div class="panel">
      <label class="lab">Bulk add from a spreadsheet</label>
      <p class="small muted">Fastest way to get started on your Mac. Save a sheet as CSV with these column headers:<br>
        <b>name, type, quantity, area, spot, bin, notes</b><br>Type is tool, part or hardware. Only name is required.</p>
      <input type="file" id="csv" accept=".csv,text/csv" class="hidden">
      <div class="row-btns">
        <button class="btn" id="importBtn">Import CSV…</button>
        <a class="btn" href="/api/export.csv">Download backup (CSV)</a>
      </div>
      <div id="importMsg"></div>
    </div>
    <div class="row-btns"><button class="btn danger block" id="logout">Sign out</button></div>`);
  wireSearchBar();

  $('#importBtn').addEventListener('click', () => $('#csv').click());
  $('#csv').addEventListener('change', async (e) => {
    const file = e.target.files[0]; if (!file) return;
    const msg = $('#importMsg');
    msg.innerHTML = '<p class="muted small">Importing…</p>';
    try {
      const r = await api('/api/import', { method: 'POST', body: { csv: await file.text() } });
      msg.innerHTML = `<p class="small"><b>Added ${r.added} item${r.added === 1 ? '' : 's'}.</b></p>` +
        (r.errors.length ? `<div class="error small">${r.errors.map(esc).join('<br>')}</div>` : '');
    } catch (err) { msg.innerHTML = `<div class="error">${esc(err.message)}</div>`; }
    e.target.value = '';
  });
  $('#logout').addEventListener('click', async () => {
    await api('/api/logout', { method: 'POST', body: {} });
    state.user = null; state.query = '';
    location.hash = '#/'; render();
  });
}

function viewAuth(mode = 'login') {
  const isLogin = mode === 'login';
  app.innerHTML = `
    <div class="auth">
      <img class="logo" src="/icon.svg" alt="">
      <h1>Pruitt's Parts</h1>
      <p class="sub">Know where every tool and part is.</p>
      <form id="authForm" novalidate>
        <div id="authErr"></div>
        ${isLogin ? '' : `<div class="field"><label class="lab" for="aname">Your name</label>
          <input class="input" id="aname" autocomplete="name"></div>`}
        <div class="field"><label class="lab" for="email">Email</label>
          <input class="input" id="email" type="email" autocomplete="${isLogin ? 'username' : 'email'}" autocapitalize="none" spellcheck="false"></div>
        <div class="field"><label class="lab" for="password">Password</label>
          <input class="input" id="password" type="password" autocomplete="${isLogin ? 'current-password' : 'new-password'}"
            ${isLogin ? '' : 'minlength="8"'}>
          ${isLogin ? '' : '<div class="hint">At least 8 characters.</div>'}</div>
        <button class="btn primary block" type="submit" id="authBtn">${isLogin ? 'Sign in' : 'Create account'}</button>
      </form>
      <div class="switch">${isLogin ? 'New here?' : 'Already have an account?'}
        <button class="linkbtn" id="switchMode">${isLogin ? 'Create an account' : 'Sign in'}</button></div>
    </div>`;
  $('#switchMode').addEventListener('click', () => viewAuth(isLogin ? 'register' : 'login'));
  $('#email').focus();
  $('#authForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#authBtn'); btn.disabled = true;
    try {
      const body = { email: $('#email').value, password: $('#password').value };
      if (!isLogin) body.name = $('#aname').value;
      const { user } = await api(isLogin ? '/api/login' : '/api/register', { method: 'POST', body });
      state.user = user;
      location.hash = '#/'; render();
    } catch (err) {
      $('#authErr').innerHTML = `<div class="error">${esc(err.message)}</div>`;
      btn.disabled = false;
    }
  });
}

// ---------- router ----------
async function render() {
  if (!state.user) return viewAuth();
  const h = location.hash.replace(/^#/, '') || '/';
  let m;
  try {
    if (h === '/') return await viewSearch();
    if (h === '/add') return await viewForm(null);
    if ((m = h.match(/^\/edit\/(\d+)$/))) return await viewForm(m[1]);
    if ((m = h.match(/^\/item\/(\d+)$/))) return await viewItem(m[1]);
    if (h === '/locations') return await viewLocations();
    if ((m = h.match(/^\/location\/(\d+)$/))) return await viewLocation(m[1]);
    if (h === '/account') return viewAccount();
    location.hash = '#/';
  } catch (e) {
    if (state.user) toast(e.message);
  }
}

window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); });

(async function start() {
  try { ({ user: state.user } = await api('/api/me')); } catch { state.user = null; }
  render();
})();
