import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY,
      email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
      name          TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );

    -- A location is "Area > Spot > Bin", like Home Depot's "Aisle 14 > Bay 3".
    -- e.g. Garage > Red Toolbox > Drawer 2   or   Truck > Side Box   (bin optional)
    CREATE TABLE IF NOT EXISTS locations (
      id      INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      area    TEXT NOT NULL,
      spot    TEXT NOT NULL DEFAULT '',
      bin     TEXT NOT NULL DEFAULT '',
      UNIQUE (user_id, area, spot, bin)
    );

    CREATE TABLE IF NOT EXISTS items (
      id          INTEGER PRIMARY KEY,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name        TEXT NOT NULL,
      kind        TEXT NOT NULL CHECK (kind IN ('tool','part','hardware')),
      quantity    INTEGER NOT NULL DEFAULT 1 CHECK (quantity >= 0),
      location_id INTEGER REFERENCES locations(id) ON DELETE SET NULL,
      notes       TEXT NOT NULL DEFAULT '',
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS items_user ON items(user_id);
    CREATE INDEX IF NOT EXISTS items_loc  ON items(location_id);
  `);
  return db;
}
