# How this app stores everything in Supabase

A plain-language overview of how Sanford Homeschoolers uses Supabase. You
can use it as a blueprint for setting up another app the same way.

## The big picture

```
Browser ──► Netlify (runs the Express app as a function) ──► Supabase
                                                        ├─ Postgres database (all data)
                                                        └─ Storage buckets (uploaded files)
```

- **Browsers never talk to Supabase directly.** Every read and write goes
  through the app's own server code. Supabase is only the back end.
- The app uses **two Supabase features**: the **Postgres database** and
  **Storage**.
- It does **not** use Supabase Auth (Supabase's login system). Logins are
  handled by the app itself. See "Logins and sessions" below.

## 1. The database (Postgres)

**What's in it:** every piece of data the app has, in about 230 ordinary
tables in the `public` schema. That includes members, families, classes,
rosters, attendance, events, the store, the newsletter, settings, and login
accounts.

**How the app connects:** with one connection string in the `DATABASE_URL`
environment variable. It uses the plain `pg` Node library (`db/postgres.js`),
not the Supabase JavaScript client. Use the **Transaction pooler** string
(Project Settings → Database → Connect, port 6543). Serverless functions open
connections constantly, and the pooler is built for that. If the password
contains special characters, percent-encode it.

**How the tables get created (migrations):**

- Every change to the database's structure is a SQL file in
  `supabase/migrations/`, named `YYYYMMDDHHMMSS_description.sql` (for example
  `20261231080000_diploma_designs.sql`). There are about 200 of them.
- They are applied **oldest to newest**. The first one,
  `20260811035644_initial_schema.sql`, creates the original tables. Each later
  one adds or changes something.
- To apply them to the live Supabase project, paste each new file into the
  **Supabase SQL Editor** and run it (or use the GitHub integration or
  `supabase db push`). `supabase/apply-all-migrations.sql` bundles all of them
  into one file for setting up a brand-new project in a single run.
- The app does **not** create tables when it starts up against a real
  Supabase database. The migrations have to be applied first.
- The files are written to be safe to run more than once (`create table if
  not exists`, `on conflict do nothing`, and so on).

**First-boot starter data:** `db/bootstrapPg.js` fills in a few defaults the
first time the app starts against an empty database. These include the
default Class Check-In PIN, the starter name tag and badge templates, and the
class hour slots.

**Local development and tests:** without a `DATABASE_URL`, the app uses
**PGlite** instead. PGlite is a real Postgres engine that runs in memory, and
it applies every migration file automatically. The test suite needs no
Supabase account at all.

**Security (Row Level Security):** RLS is turned **on** for every table, and
no access policies are defined. That means Supabase's public API keys (anon
and authenticated) can't read or write anything. The server's own database
connection bypasses RLS, so the app still works normally. This is a safety
net in case a public key ever leaks.

## 2. File storage (Supabase Storage)

**What's in it:** every uploaded file, including member photos, documents,
event, class and store images, name tag and badge artwork, receipts,
homework attachments, and so on.

**How it's organized:** one **bucket** per kind of upload. Buckets are listed
and created by `supabase/migrations/20261227010000_storage_buckets.sql`:

- **Public buckets** (for example `member-photos`, `event-images`,
  `store-images`, `homepage-images`) hold files shown with a normal image link.
- **Private buckets** (for example `documents`, `private-photos`,
  `accounting-receipts`, `family-school-attachments`) hold files only logged-in
  users should see. The app checks permissions and then passes the file
  through.

**How the app connects:** with the `@supabase/supabase-js` client in
`utils/storage.js`, using `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.

**What goes in the database:** only the file's **key** (a generated name like
`1731456789-123456789.jpg`), saved in a column such as `photo_path`. The full
URL is built when a page needs it, so buckets can change later without
rewriting any rows.

**Large files:** the browser uploads directly to Storage using a signed upload
URL, so big files never pass through the Netlify function.

**Important:** the app never creates buckets on its own. Every new upload
feature needs its bucket added to the bucket migration and that migration run.
A missing bucket means uploads silently fail.

## 3. Logins and sessions (also stored in the database)

- **Accounts** (admins, parents, students, teachers) are rows in app tables
  such as `member_accounts`. Passwords are stored only as **bcrypt hashes**.
- **Login sessions** are rows in the `sessions` table (`utils/pgSessionStore.js`).
  This lets sessions survive across Netlify function calls, and expired ones
  are swept out automatically.
- `SESSION_SECRET` signs the session cookie.
- Supabase's own `auth` schema exists in the project but this app doesn't use
  it. One thing to watch: it also contains a table named `sessions`, so the
  app's queries always say `public` explicitly. MIGRATION.md has the bug this
  caused.

## 4. Settings and secrets (environment variables)

These are set in Netlify (Site settings → Environment variables) and in a
local `.env` file that is never committed. Use `.env.example` as the template.

| Variable | Where to find it in Supabase | Used for |
|---|---|---|
| `DATABASE_URL` | Project Settings → Database → Connect → Transaction pooler | All database reads and writes |
| `SUPABASE_URL` | Project Settings → API | Storage |
| `SUPABASE_ANON_KEY` | Project Settings → API (publishable key) | Public identifier, not really used by the server |
| `SUPABASE_SERVICE_ROLE_KEY` | Project Settings → API (secret key) | Storage uploads and downloads. **Secret: server only.** |
| `SESSION_SECRET` | Make up a long random string | Signs login cookies |
| `TRUST_PROXY=1` | — | Needed on Netlify so secure cookies work |

## 5. Checklist: setting up another app the same way

1. Create a new Supabase project. Use a separate one per app, and ideally a
   separate dev and production project.
2. Write the database structure as dated SQL files in `supabase/migrations/`,
   and run them in the SQL Editor in order.
3. In the first migration, turn on RLS for every `public` table (see the end
   of `20260811035644_initial_schema.sql`).
4. Add a migration that creates the Storage buckets (public or private) the
   app needs.
5. Put `DATABASE_URL` (pooler), `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
   and `SESSION_SECRET` in the host's environment variables. Never put them
   in git.
6. Have the server do all database and Storage access. Store file keys, not
   full URLs, in the database.
7. Whenever a feature changes the database, add a **new** migration file
   rather than editing an old one, and run it on the live project.

## Key files to look at

- `db/postgres.js`: database connection and query helper
- `db/index.js`: picks real Postgres or local PGlite, and applies migrations
  locally
- `db/bootstrapPg.js`: first-boot starter data
- `supabase/migrations/`: the full database structure, in order
- `supabase/migrations/20261227010000_storage_buckets.sql`: the bucket list
- `utils/storage.js` and `utils/uploadBackend.js`: file uploads
- `utils/pgSessionStore.js`: login sessions
- `.env.example`: every environment variable
- `MIGRATION.md`: the full history of the move to Supabase
