import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  hashPassword, verifyPassword, createSession, userForToken, destroySession,
  loginBlocked, recordLoginFailure, clearLoginFailures,
} from './auth.js';

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const KINDS = ['tool', 'part', 'hardware'];
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.webmanifest': 'application/manifest+json', '.json': 'application/json',
};

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bad = (msg) => { throw new HttpError(400, msg); };

// ---------- helpers ----------
function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

async function readJson(req, limit = 2_000_000) {
  const type = req.headers['content-type'] || '';
  // Requiring JSON blocks cross-site form posts (CSRF) since browsers can't send it without CORS.
  if (!type.startsWith('application/json')) throw new HttpError(415, 'Expected JSON');
  let size = 0; const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw new HttpError(413, 'Request too large');
    chunks.push(c);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
  catch { bad('Invalid JSON'); }
}

const str = (v, max = 200) => String(v ?? '').trim().slice(0, max);

function send(res, status, body, headers = {}) {
  const data = body === undefined ? '' : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers });
  res.end(data);
}

function locationLabel(l) {
  return [l.area, l.spot, l.bin].filter(Boolean).join(' › ');
}

// ---------- data access (every query is scoped to user_id) ----------
function getOrCreateLocation(db, userId, loc) {
  if (!loc) return null;
  const area = str(loc.area, 80), spot = str(loc.spot, 80), bin = str(loc.bin, 80);
  if (!area) {
    if (spot || bin) bad('A location needs an Area (e.g. Garage, Shop, Truck)');
    return null;
  }
  const found = db.prepare('SELECT id FROM locations WHERE user_id=? AND area=? AND spot=? AND bin=?')
    .get(userId, area, spot, bin);
  if (found) return found.id;
  return Number(db.prepare('INSERT INTO locations (user_id, area, spot, bin) VALUES (?,?,?,?)')
    .run(userId, area, spot, bin).lastInsertRowid);
}

const ITEM_SELECT = `
  SELECT i.id, i.name, i.kind, i.quantity, i.notes, i.updated_at, i.location_id,
         l.area, l.spot, l.bin
  FROM items i LEFT JOIN locations l ON l.id = i.location_id`;

function shapeItem(r) {
  return {
    id: r.id, name: r.name, kind: r.kind, quantity: r.quantity, notes: r.notes,
    updated_at: r.updated_at,
    location: r.location_id
      ? { id: r.location_id, area: r.area, spot: r.spot, bin: r.bin, label: locationLabel(r) }
      : null,
  };
}

function getItem(db, userId, id) {
  const r = db.prepare(`${ITEM_SELECT} WHERE i.user_id=? AND i.id=?`).get(userId, id);
  if (!r) throw new HttpError(404, 'Item not found');
  return shapeItem(r);
}

// Normalize a search word: "Screws" -> "screw", so plurals match singulars and vice versa.
function stem(t) {
  if (t.length > 3 && t.endsWith('es') && /(ch|sh|x|ss)es$/.test(t)) return t.slice(0, -2);
  if (t.length > 3 && t.endsWith('s') && !t.endsWith('ss')) return t.slice(0, -1);
  return t;
}
const likeEscape = (s) => s.replace(/[\\%_]/g, (m) => '\\' + m);

export function searchItems(db, userId, { q = '', kind = '', locationId = null, limit = 100 }) {
  const where = ['i.user_id = ?'];
  const args = [userId];
  if (KINDS.includes(kind)) { where.push('i.kind = ?'); args.push(kind); }
  if (locationId) { where.push('i.location_id = ?'); args.push(Number(locationId)); }

  const tokens = String(q).toLowerCase().split(/[\s,]+/).filter(Boolean).slice(0, 8).map(stem);
  for (const t of tokens) {
    const p = `%${likeEscape(t)}%`;
    where.push(`(lower(i.name) LIKE ? ESCAPE '\\' OR lower(i.notes) LIKE ? ESCAPE '\\'
      OR lower(coalesce(l.area,'') || ' ' || coalesce(l.spot,'') || ' ' || coalesce(l.bin,'')) LIKE ? ESCAPE '\\'
      OR i.kind LIKE ? ESCAPE '\\')`);
    args.push(p, p, p, p);
  }

  const order = tokens.length ? 'i.name COLLATE NOCASE' : 'i.updated_at DESC, i.id DESC';
  const rows = db.prepare(`${ITEM_SELECT} WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT 500`).all(...args);

  // Rank: name starts with the query > every word in the name > matched elsewhere (notes/location).
  if (tokens.length) {
    const full = tokens.join(' ');
    const score = (r) => {
      const n = r.name.toLowerCase();
      if (n.startsWith(full)) return 0;
      if (tokens.every((t) => n.includes(t))) return n.startsWith(tokens[0]) ? 1 : 2;
      return 3;
    };
    rows.sort((a, b) => score(a) - score(b));
  }
  return rows.slice(0, limit).map(shapeItem);
}

function validateItem(body, partial = false) {
  const out = {};
  if (!partial || 'name' in body) {
    out.name = str(body.name, 200);
    if (!out.name) bad('Give the item a name');
  }
  if (!partial || 'kind' in body) {
    out.kind = str(body.kind || 'part').toLowerCase();
    if (!KINDS.includes(out.kind)) bad('Type must be tool, part, or hardware');
  }
  if (!partial || 'quantity' in body) {
    const q = body.quantity === undefined || body.quantity === '' ? 1 : Number(body.quantity);
    if (!Number.isInteger(q) || q < 0 || q > 1_000_000) bad('Quantity must be a whole number, 0 or more');
    out.quantity = q;
  }
  if (!partial || 'notes' in body) out.notes = str(body.notes, 2000);
  return out;
}

// Minimal RFC-4180-ish CSV parser (quoted fields, escaped quotes, CRLF).
function parseCsv(text) {
  const rows = []; let row = []; let field = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((f) => f.trim()));
}

const csvCell = (v) => /[",\n\r]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);

// ---------- router ----------
export function createApp(db, { secureCookies = false } = {}) {
  const cookie = (token, maxAge) =>
    `pp_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secureCookies ? '; Secure' : ''}`;

  function requireUser(req) {
    const user = userForToken(db, parseCookies(req.headers.cookie).pp_session);
    if (!user) throw new HttpError(401, 'Please sign in');
    return user;
  }

  async function api(req, res, url) {
    const m = req.method;
    const p = url.pathname;
    let match;

    // --- auth ---
    if (p === '/api/register' && m === 'POST') {
      const b = await readJson(req);
      const email = str(b.email, 200).toLowerCase();
      const name = str(b.name, 80) || email.split('@')[0];
      const password = String(b.password ?? '');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) bad('Enter a valid email address');
      if (password.length < 8) bad('Password must be at least 8 characters');
      if (db.prepare('SELECT 1 FROM users WHERE email=?').get(email)) {
        throw new HttpError(409, 'An account with that email already exists');
      }
      const id = Number(db.prepare('INSERT INTO users (email, name, password_hash) VALUES (?,?,?)')
        .run(email, name, hashPassword(password)).lastInsertRowid);
      const s = createSession(db, id);
      return send(res, 201, { user: { id, email, name } }, { 'Set-Cookie': cookie(s.token, s.maxAge) });
    }

    if (p === '/api/login' && m === 'POST') {
      const b = await readJson(req);
      const email = str(b.email, 200).toLowerCase();
      const key = `${email}|${req.socket.remoteAddress}`;
      if (loginBlocked(key)) throw new HttpError(429, 'Too many attempts. Try again in 15 minutes.');
      const u = db.prepare('SELECT id, email, name, password_hash FROM users WHERE email=?').get(email);
      if (!u || !verifyPassword(String(b.password ?? ''), u.password_hash)) {
        recordLoginFailure(key);
        throw new HttpError(401, 'Email or password is incorrect');
      }
      clearLoginFailures(key);
      const s = createSession(db, u.id);
      return send(res, 200, { user: { id: u.id, email: u.email, name: u.name } },
        { 'Set-Cookie': cookie(s.token, s.maxAge) });
    }

    if (p === '/api/logout' && m === 'POST') {
      destroySession(db, parseCookies(req.headers.cookie).pp_session);
      return send(res, 200, { ok: true }, { 'Set-Cookie': cookie('', 0) });
    }

    // Everything below needs a signed-in user.
    const user = requireUser(req);

    if (p === '/api/me' && m === 'GET') return send(res, 200, { user });

    // --- items ---
    if (p === '/api/items' && m === 'GET') {
      return send(res, 200, {
        items: searchItems(db, user.id, {
          q: url.searchParams.get('q') || '',
          kind: url.searchParams.get('kind') || '',
          locationId: url.searchParams.get('location_id'),
        }),
      });
    }

    if (p === '/api/items' && m === 'POST') {
      const b = await readJson(req);
      const v = validateItem(b);
      const locId = getOrCreateLocation(db, user.id, b.location);
      const id = Number(db.prepare(`INSERT INTO items (user_id, name, kind, quantity, notes, location_id)
        VALUES (?,?,?,?,?,?)`).run(user.id, v.name, v.kind, v.quantity, v.notes, locId).lastInsertRowid);
      return send(res, 201, { item: getItem(db, user.id, id) });
    }

    if ((match = p.match(/^\/api\/items\/(\d+)$/))) {
      const id = Number(match[1]);
      if (m === 'GET') return send(res, 200, { item: getItem(db, user.id, id) });
      if (m === 'PATCH') {
        getItem(db, user.id, id); // 404s if it isn't this user's
        const b = await readJson(req);
        const v = validateItem(b, true);
        if ('location' in b) v.location_id = getOrCreateLocation(db, user.id, b.location);
        const keys = Object.keys(v);
        if (keys.length) {
          db.prepare(`UPDATE items SET ${keys.map((k) => `${k}=?`).join(', ')}, updated_at=datetime('now')
            WHERE id=? AND user_id=?`).run(...keys.map((k) => v[k]), id, user.id);
        }
        return send(res, 200, { item: getItem(db, user.id, id) });
      }
      if (m === 'DELETE') {
        const r = db.prepare('DELETE FROM items WHERE id=? AND user_id=?').run(id, user.id);
        if (!r.changes) throw new HttpError(404, 'Item not found');
        return send(res, 200, { ok: true });
      }
    }

    // --- locations ---
    if (p === '/api/locations' && m === 'GET') {
      const rows = db.prepare(`
        SELECT l.id, l.area, l.spot, l.bin, count(i.id) AS item_count
        FROM locations l LEFT JOIN items i ON i.location_id = l.id
        WHERE l.user_id = ? GROUP BY l.id
        ORDER BY l.area COLLATE NOCASE, l.spot COLLATE NOCASE, l.bin COLLATE NOCASE`).all(user.id);
      return send(res, 200, { locations: rows.map((r) => ({ ...r, label: locationLabel(r) })) });
    }

    if ((match = p.match(/^\/api\/locations\/(\d+)$/))) {
      const id = Number(match[1]);
      const loc = db.prepare('SELECT * FROM locations WHERE id=? AND user_id=?').get(id, user.id);
      if (!loc) throw new HttpError(404, 'Location not found');
      if (m === 'PATCH') {
        // Renaming/moving a bin moves everything in it. If the new name already exists, merge.
        const b = await readJson(req);
        const area = str(b.area, 80), spot = str(b.spot, 80), bin = str(b.bin, 80);
        if (!area) bad('A location needs an Area');
        const existing = db.prepare('SELECT id FROM locations WHERE user_id=? AND area=? AND spot=? AND bin=?')
          .get(user.id, area, spot, bin);
        if (existing && existing.id !== id) {
          db.prepare('UPDATE items SET location_id=? WHERE location_id=? AND user_id=?').run(existing.id, id, user.id);
          db.prepare('DELETE FROM locations WHERE id=? AND user_id=?').run(id, user.id);
          return send(res, 200, { id: existing.id, merged: true });
        }
        db.prepare('UPDATE locations SET area=?, spot=?, bin=? WHERE id=? AND user_id=?').run(area, spot, bin, id, user.id);
        return send(res, 200, { id, merged: false });
      }
      if (m === 'DELETE') {
        db.prepare('DELETE FROM locations WHERE id=? AND user_id=?').run(id, user.id);
        return send(res, 200, { ok: true });
      }
    }

    // --- bulk import / export (CSV) ---
    if (p === '/api/export.csv' && m === 'GET') {
      const rows = searchItems(db, user.id, { limit: 1e9 });
      const lines = [['name', 'type', 'quantity', 'area', 'spot', 'bin', 'notes'].join(',')];
      for (const r of rows) {
        lines.push([r.name, r.kind, r.quantity, r.location?.area ?? '', r.location?.spot ?? '',
          r.location?.bin ?? '', r.notes].map(csvCell).join(','));
      }
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'no-store',
        'Content-Disposition': 'attachment; filename="pruitts-parts-inventory.csv"',
      });
      return res.end(lines.join('\n'));
    }

    if (p === '/api/import' && m === 'POST') {
      const b = await readJson(req, 5_000_000);
      const rows = parseCsv(String(b.csv ?? ''));
      if (!rows.length) bad('That file is empty');
      const header = rows[0].map((h) => h.trim().toLowerCase());
      const col = (n) => header.indexOf(n);
      if (col('name') < 0) bad('The first row must be a header that includes a "name" column');
      const get = (r, n) => (col(n) >= 0 ? r[col(n)] ?? '' : '');
      let added = 0; const errors = [];
      db.exec('BEGIN');
      try {
        rows.slice(1).forEach((r, i) => {
          try {
            const v = validateItem({
              name: get(r, 'name'), kind: get(r, 'type') || get(r, 'kind') || 'part',
              quantity: get(r, 'quantity') || get(r, 'qty'), notes: get(r, 'notes'),
            });
            const locId = getOrCreateLocation(db, user.id, { area: get(r, 'area'), spot: get(r, 'spot'), bin: get(r, 'bin') });
            db.prepare('INSERT INTO items (user_id, name, kind, quantity, notes, location_id) VALUES (?,?,?,?,?,?)')
              .run(user.id, v.name, v.kind, v.quantity, v.notes, locId);
            added++;
          } catch (e) {
            if (!(e instanceof HttpError)) throw e;
            errors.push(`Row ${i + 2}: ${e.message}`);
          }
        });
        db.exec('COMMIT');
      } catch (e) { db.exec('ROLLBACK'); throw e; }
      return send(res, 200, { added, errors: errors.slice(0, 50) });
    }

    throw new HttpError(404, 'Not found');
  }

  function serveStatic(req, res, url) {
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/' || !path.extname(rel)) rel = '/index.html'; // single-page app
    const file = path.normalize(path.join(PUBLIC_DIR, rel));
    if (!file.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); return res.end('Not found'); }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
        'Cache-Control': rel === '/index.html' || rel === '/sw.js' ? 'no-cache' : 'public, max-age=300',
      });
      res.end(data);
    });
  }

  return async function handler(req, res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy',
      "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'");
    const url = new URL(req.url, 'http://localhost');
    if (!url.pathname.startsWith('/api/')) return serveStatic(req, res, url);
    try {
      await api(req, res, url);
    } catch (e) {
      if (e instanceof HttpError) return send(res, e.status, { error: e.message });
      console.error(e);
      send(res, 500, { error: 'Something went wrong' });
    }
  };
}
