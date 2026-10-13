// Local development / verification database.
//
// Runs a real Postgres (PGlite = Postgres compiled to WASM) in-process and
// exposes it over the regular Postgres wire protocol, so the API talks to it
// with the ordinary `pg` driver - no server install required.
//
// Usage:
//   node scripts/dev-db.mjs                 # in-memory, schema + seed applied
//   node scripts/dev-db.mjs --persist       # keep data in .pgdata between runs
//   node scripts/dev-db.mjs --port 5433     # custom port
//
// Then point the API at it:
//   DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5433/postgres npm run dev

import { readFileSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

const here = path.dirname(fileURLToPath(import.meta.url));
const dbDir = path.join(here, '..', 'src', 'db');

const args = process.argv.slice(2);
const persist = args.includes('--persist');
const portArgIndex = args.indexOf('--port');
const port = Number(portArgIndex === -1 ? process.env.PGLITE_PORT ?? 5433 : args[portArgIndex + 1]);
const dataDir = path.join(here, '..', '.pgdata');

if (persist && args.includes('--reset') && existsSync(dataDir)) {
  rmSync(dataDir, { recursive: true, force: true });
}

const sql = (file) => readFileSync(path.join(dbDir, file), 'utf8');

const db = persist ? new PGlite(dataDir) : new PGlite();
await db.waitReady;

// Deterministic state: always rebuild schema, then seed only when empty.
await db.exec(sql('schema.sql'));

const { rows: seeded } = await db.query('SELECT COUNT(*)::int AS total FROM members');
if (seeded[0].total === 0) {
  await db.exec(sql('seed.sql'));
  console.log('[dev-db] schema applied and seed data loaded');
} else {
  console.log(`[dev-db] schema applied, existing data kept (${seeded[0].total} members)`);
}

const server = new PGLiteSocketServer({ db, port, host: '127.0.0.1', maxConnections: 10 });
await server.start();

console.log(`[dev-db] Postgres (PGlite) listening on postgres://postgres:postgres@127.0.0.1:${port}/postgres`);

const shutdown = async () => {
  console.log('\n[dev-db] shutting down');
  await server.stop().catch(() => {});
  await db.close().catch(() => {});
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
