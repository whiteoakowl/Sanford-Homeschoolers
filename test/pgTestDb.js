// Shared test helper for the Postgres-backed migration: boots a fresh,
// isolated PGlite instance (in-process, WASM-compiled real Postgres - no
// Docker, no network, no shared state between test files), applies the
// same schema migration file Supabase itself would apply, and runs the
// same first-boot seeding db/bootstrapPg.js runs against a real
// production database. Mirrors how every existing *.test.js file gets its
// own fresh, throwaway SQLite file via DB_PATH - same isolation
// guarantee, different engine.
const fs = require('fs');
const path = require('path');
const { PGlite } = require('@electric-sql/pglite');
const { createPgliteDb } = require('../db/postgres');
const { seedIfMissing } = require('../db/bootstrapPg');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'supabase', 'migrations');

// Every *.sql file in the migrations directory, in filename order - the
// same "apply the whole directory" allMigrationSql() db/index.js's own
// PGlite path uses, not just the original initial-schema file. Used to
// hardcode just that one file's path; a real bug this caused: a later
// migration's own column (misc_badges.day/leader_name, added the same day
// as the backfill that reads it) simply didn't exist yet in a
// createTestDb() database, so any test exercising that backfill against
// this helper would fail with an undefined-column error that a real
// Supabase database - which always has every migration applied - would
// never hit.
function allMigrationSql() {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8'))
    .join('\n');
}

// A real Supabase project already has its own internal `storage` schema
// (storage.buckets, storage.objects, ...) before any of OUR migrations
// ever run - it's part of the platform, not something this app's own
// supabase/migrations/*.sql creates. supabase/migrations/20261227010000_
// storage_buckets.sql assumes that and just inserts rows into the
// existing storage.buckets table - which a bare PGlite instance (no
// Supabase platform underneath it) never has, breaking every single
// test in the suite with "relation storage.buckets does not exist" the
// moment that migration runs. This stub mirrors only the handful of
// columns that one insert actually touches (id/name/public), same
// "mirror what a real Supabase database already has" reasoning this
// file's own header comment gives for applying every migration in
// order - just for a piece of the platform that isn't a migration at
// all.
async function ensureStorageSchemaStub(pglite) {
  await pglite.exec('create schema if not exists storage;');
  await pglite.exec('create table if not exists storage.buckets (id text primary key, name text not null, public boolean not null default false);');
}

async function createTestDb({ seed = true } = {}) {
  const pglite = new PGlite();
  await ensureStorageSchemaStub(pglite);
  await pglite.exec(allMigrationSql());

  const db = createPgliteDb(pglite);
  if (seed) await seedIfMissing(db);

  return db;
}

module.exports = { createTestDb };
