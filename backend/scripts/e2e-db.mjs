/**
 * Create (or recreate) the end-to-end test database, then migrate it.
 *
 *   npm run test:e2e:setup && npm run test:e2e
 *
 * ⚠️ IT IS A SEPARATE DATABASE ON PURPOSE — `gun_galore_e2e`, never the dev
 * one. The auth migration opens with `TRUNCATE "User" CASCADE`, and the specs
 * truncate again on every run; pointed at a developer's own database that is
 * their listings, offers and motivations gone.
 *
 * ⚠️ IT DROPS AND RECREATES. A migration that only applies cleanly to a
 * database that already had the previous shape is a migration that has not
 * been tested — replaying the whole chain from empty is the point.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const here = path.dirname(fileURLToPath(import.meta.url));
const backend = path.resolve(here, '..');
const DB_NAME = 'gun_galore_e2e';

// Read .env by hand rather than through dotenv: dotenv prints a banner to
// stdout, and this value gets composed into a connection string.
function devUrl() {
  const line = fs
    .readFileSync(path.join(backend, '.env'), 'utf8')
    .split(/\r?\n/)
    .find((l) => l.startsWith('DATABASE_URL='));
  if (!line) throw new Error('DATABASE_URL is not in backend/.env');
  return line
    .slice('DATABASE_URL='.length)
    .trim()
    .replace(/^["']|["']$/g, '')
    .replace(/\?.*$/, '');
}

const base = devUrl();
const target = `${base.replace(/\/[^/]+$/, `/${DB_NAME}`)}?schema=public`;
// CREATE DATABASE cannot run inside a transaction or from the target database.
const maintenance = base.replace(/\/[^/]+$/, '/postgres');

const client = new pg.Client({ connectionString: maintenance });
await client.connect();

const existing = await client.query(
  'SELECT 1 FROM pg_database WHERE datname = $1',
  [DB_NAME],
);
if (existing.rows.length) {
  await client.query(
    'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1',
    [DB_NAME],
  );
  await client.query(`DROP DATABASE "${DB_NAME}"`);
  console.log(`dropped ${DB_NAME}`);
}
await client.query(`CREATE DATABASE "${DB_NAME}"`);
await client.end();
console.log(`created ${DB_NAME}`);

execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
  cwd: backend,
  stdio: 'inherit',
  shell: process.platform === 'win32',
  // prisma.config.ts loads dotenv WITHOUT override, so this wins.
  env: { ...process.env, DATABASE_URL: target },
});

console.log(`\n${DB_NAME} is migrated. Now: npm run test:e2e`);
