// Security audit: every table in the public schema must have Row Level
// Security on, so Supabase's REST API (anon/authenticated keys) can never
// read or write app data directly. The server's own connection bypasses
// RLS, so this never affects the app. A new migration that creates a
// table must end with:
//   alter table public.<name> enable row level security;
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');

process.env.DB_PATH = path.join(os.tmpdir(), `rls-every-table-${process.pid}.db`);
process.env.SESSION_SECRET = 'test-secret-not-for-real-use';

const app = require('../server');
const db = require('../db');

test.before(() => app.ready);

test('every public table has Row Level Security enabled', async () => {
  const rows = await db.prepare("SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND rowsecurity = false ORDER BY tablename").all();
  assert.deepEqual(
    rows.map((r) => r.tablename),
    [],
    'These tables need "alter table public.<name> enable row level security;" in a new migration'
  );
  const count = await db.prepare("SELECT COUNT(*) AS n FROM pg_tables WHERE schemaname = 'public'").get();
  assert.ok(Number(count.n) > 200, 'sanity check: the schema was actually applied');
});
