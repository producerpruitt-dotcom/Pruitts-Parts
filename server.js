import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { openDb } from './server/db.js';
import { createApp } from './server/app.js';

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const DB_FILE = process.env.DB_FILE || path.join(process.cwd(), 'data', 'pruitts-parts.db');
// Set SECURE_COOKIES=1 when served over HTTPS (any real deployment).
const secureCookies = process.env.SECURE_COOKIES === '1';

const db = openDb(DB_FILE);
const server = http.createServer(createApp(db, { secureCookies }));

server.listen(PORT, HOST, () => {
  console.log(`Pruitt's Parts running:  http://localhost:${PORT}`);
  for (const nets of Object.values(os.networkInterfaces())) {
    for (const n of nets ?? []) {
      if (n.family === 'IPv4' && !n.internal) console.log(`  on your Wi-Fi (iPhone):  http://${n.address}:${PORT}`);
    }
  }
  console.log(`  database: ${DB_FILE}`);
});
