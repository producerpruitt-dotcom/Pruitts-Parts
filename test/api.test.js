import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { openDb } from '../server/db.js';
import { createApp } from '../server/app.js';

let server, base;
before(async () => {
  server = http.createServer(createApp(openDb(':memory:')));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

// Tiny client that keeps its own cookie, so each one is a separate signed-in user.
function client() {
  let cookie = '';
  return async (path, { method = 'GET', body, raw } = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, data: raw ? await res.text() : await res.json().catch(() => null) };
  };
}

test('register, sign out, sign back in', async () => {
  const c = client();
  let r = await c('/api/register', { method: 'POST', body: { email: 'Bob@Shop.com', name: 'Bob', password: 'hunter22!' } });
  assert.equal(r.status, 201);
  assert.equal(r.data.user.email, 'bob@shop.com');
  assert.equal((await c('/api/me')).status, 200);

  await c('/api/logout', { method: 'POST', body: {} });
  assert.equal((await c('/api/me')).status, 401);

  r = await c('/api/login', { method: 'POST', body: { email: 'bob@shop.com', password: 'wrong-pass' } });
  assert.equal(r.status, 401);
  r = await c('/api/login', { method: 'POST', body: { email: 'BOB@shop.com', password: 'hunter22!' } });
  assert.equal(r.status, 200);
  assert.equal((await c('/api/me')).status, 200);
});

test('rejects weak passwords, duplicate emails and non-JSON posts', async () => {
  const c = client();
  assert.equal((await c('/api/register', { method: 'POST', body: { email: 'x@y.co', password: 'short' } })).status, 400);
  assert.equal((await c('/api/register', { method: 'POST', body: { email: 'dup@y.co', password: 'longenough' } })).status, 201);
  assert.equal((await client()('/api/register', { method: 'POST', body: { email: 'DUP@y.co', password: 'longenough' } })).status, 409);
  const res = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'email=a' });
  assert.equal(res.status, 415);
});

test('API requires sign-in', async () => {
  const c = client();
  assert.equal((await c('/api/items')).status, 401);
  assert.equal((await c('/api/items', { method: 'POST', body: { name: 'x' } })).status, 401);
});

test('search tells you where things are, with plurals and location words', async () => {
  const c = client();
  await c('/api/register', { method: 'POST', body: { email: 'search@t.co', password: 'password1' } });
  const add = (name, kind, location, extra = {}) => c('/api/items', { method: 'POST', body: { name, kind, location, ...extra } });

  let r = await add('Hex lag screws 1/4" x 3"', 'hardware', { area: 'Garage', spot: 'Wall cabinet', bin: 'Bin 4' }, { quantity: 40 });
  assert.equal(r.status, 201);
  assert.equal(r.data.item.location.label, 'Garage › Wall cabinet › Bin 4');
  await add('Impact driver', 'tool', { area: 'Truck', spot: 'Side box' });
  await add('Lag shield anchors', 'hardware', { area: 'Garage', spot: 'Wall cabinet', bin: 'Bin 5' });
  await add('PVC elbow 3/4"', 'part', { area: 'Shed' }, { notes: 'Schedule 40, for sprinkler repairs' });

  // singular query finds plural name
  r = await c('/api/items?q=lag%20screw');
  assert.deepEqual(r.data.items.map((i) => i.name), ['Hex lag screws 1/4" x 3"']);
  assert.equal(r.data.items[0].location.bin, 'Bin 4');

  // fractions and inch marks work
  r = await c(`/api/items?q=${encodeURIComponent('1/4')}`);
  assert.equal(r.data.items.length, 1);

  // match on notes
  r = await c('/api/items?q=sprinkler');
  assert.equal(r.data.items[0].name, 'PVC elbow 3/4"');

  // match on location ("what's in the truck")
  r = await c('/api/items?q=truck');
  assert.equal(r.data.items[0].name, 'Impact driver');

  // type filter
  r = await c('/api/items?kind=tool');
  assert.deepEqual(r.data.items.map((i) => i.name), ['Impact driver']);

  // ranking: name-prefix match first
  r = await c('/api/items?q=lag');
  assert.equal(r.data.items[0].name, 'Lag shield anchors');

  // LIKE wildcards are treated literally
  r = await c('/api/items?q=%25');
  assert.equal(r.data.items.length, 0);
});

test('users never see each other\'s inventory', async () => {
  const a = client(), b = client();
  await a('/api/register', { method: 'POST', body: { email: 'a@iso.co', password: 'password1' } });
  await b('/api/register', { method: 'POST', body: { email: 'b@iso.co', password: 'password1' } });
  const { data } = await a('/api/items', { method: 'POST', body: { name: 'Secret saw', kind: 'tool', location: { area: 'Barn' } } });
  const id = data.item.id;
  const locId = data.item.location.id;

  assert.equal((await b('/api/items?q=saw')).data.items.length, 0);
  assert.equal((await b('/api/locations')).data.locations.length, 0);
  assert.equal((await b(`/api/items/${id}`)).status, 404);
  assert.equal((await b(`/api/items/${id}`, { method: 'PATCH', body: { name: 'mine now' } })).status, 404);
  assert.equal((await b(`/api/items/${id}`, { method: 'DELETE' })).status, 404);
  assert.equal((await b(`/api/locations/${locId}`, { method: 'PATCH', body: { area: 'X' } })).status, 404);
  assert.equal((await b(`/api/items?location_id=${locId}`)).data.items.length, 0);
  assert.equal((await a(`/api/items/${id}`)).data.item.name, 'Secret saw');
});

test('edit, move, quantity, rename/merge locations, delete', async () => {
  const c = client();
  await c('/api/register', { method: 'POST', body: { email: 'edit@t.co', password: 'password1' } });
  const { data } = await c('/api/items', { method: 'POST', body: { name: 'Chisel set', kind: 'tool', location: { area: 'Shop', spot: 'Bench' } } });
  const id = data.item.id;

  let r = await c(`/api/items/${id}`, { method: 'PATCH', body: { quantity: 0 } });
  assert.equal(r.data.item.quantity, 0);
  assert.equal((await c(`/api/items/${id}`, { method: 'PATCH', body: { quantity: -1 } })).status, 400);

  r = await c(`/api/items/${id}`, { method: 'PATCH', body: { location: { area: 'Shop', spot: 'Pegboard' } } });
  assert.equal(r.data.item.location.label, 'Shop › Pegboard');

  await c('/api/items', { method: 'POST', body: { name: 'Mallet', kind: 'tool', location: { area: 'Shop', spot: 'Wall' } } });
  const locs = (await c('/api/locations')).data.locations;
  const peg = locs.find((l) => l.spot === 'Pegboard');
  const wall = locs.find((l) => l.spot === 'Wall');
  // Renaming Pegboard to Wall merges the two
  r = await c(`/api/locations/${peg.id}`, { method: 'PATCH', body: { area: 'Shop', spot: 'Wall' } });
  assert.equal(r.data.merged, true);
  assert.equal((await c(`/api/items?location_id=${wall.id}`)).data.items.length, 2);

  assert.equal((await c(`/api/items/${id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await c(`/api/items/${id}`)).status, 404);

  // spot without area is rejected
  assert.equal((await c('/api/items', { method: 'POST', body: { name: 'x', location: { spot: 'shelf' } } })).status, 400);
});

test('CSV import and export round-trip', async () => {
  const c = client();
  await c('/api/register', { method: 'POST', body: { email: 'csv@t.co', password: 'password1' } });
  const csv = 'Name,Type,Quantity,Area,Spot,Bin,Notes\r\n' +
    '"Wood screws #8 x 1-1/4""",hardware,200,Garage,Shelf 2,Coffee can,"Phillips, zinc"\r\n' +
    'Circular saw,tool,1,Shop,Under bench,,\r\n' +
    ',part,1,,,,\r\n' +
    'Bad qty,part,lots,Shop,,,\r\n';
  const r = await c('/api/import', { method: 'POST', body: { csv } });
  assert.equal(r.data.added, 2);
  assert.equal(r.data.errors.length, 2);

  const s = await c('/api/items?q=wood%20screw');
  assert.equal(s.data.items[0].name, 'Wood screws #8 x 1-1/4"');
  assert.equal(s.data.items[0].notes, 'Phillips, zinc');
  assert.equal(s.data.items[0].location.label, 'Garage › Shelf 2 › Coffee can');

  const out = await c('/api/export.csv', { raw: true });
  assert.match(out.data, /^name,type,quantity,area,spot,bin,notes\n/);
  assert.match(out.data, /"Wood screws #8 x 1-1\/4""",hardware,200,Garage,Shelf 2,Coffee can,"Phillips, zinc"/);
});

test('serves the app and blocks path traversal', async () => {
  let res = await fetch(base + '/');
  assert.equal(res.status, 200);
  assert.match(await res.text(), /Pruitt's Parts/);
  res = await fetch(base + '/item/5'); // deep links fall back to the app
  assert.equal(res.status, 200);
  res = await fetch(base + '/..%2fpackage.json');
  assert.notEqual(res.status, 200);
});
