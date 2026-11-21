# Storage and Security Audit (November 2026)

This covers three requests: a storage audit for 200 families, a full
security audit, and adding push notifications.

## 1. Storage: is it ready for 200 families?

**Yes, with one plan change: use Supabase Pro, not the free plan.**

### Expected usage

These are rough estimates for 200 families (about 800 people, about 450
of them children).

| What | Size after upload | Estimate |
|---|---|---|
| Member and child photos | Shrunk in the browser to about 0.2–0.4 MB each | About 0.3 GB total |
| Co-op homework uploads | Up to 10 MB each, photos shrunk | 3–15 GB per school year |
| Family-school files (lessons, journal, planner) | Up to 10 MB each | 2–10 GB per school year |
| Photo albums, event, store and class images | Shrunk in the browser | 1–3 GB per year |
| Documents, receipts, form uploads | Up to 20 MB each | Under 1 GB per year |
| **Files total** | | **About 5–30 GB per year** |
| **Database (all records)** | | **Under 1 GB per year** |

### Supabase plan

- **Free plan:** a 500 MB database, a small amount of file storage, no
  daily backups, and the project **pauses after 7 days without use**.
  That isn't enough for 200 families, and you'd have no backups of
  children's records.
- **Pro plan:** about $25/month. It includes an 8 GB database, daily
  backups kept 7 days, and roughly 100 GB of file storage. That covers
  several years at the usage above.
- Check the current numbers at supabase.com/pricing before you upgrade.
  I couldn't open that page from this environment, and the published
  figures I found don't all agree.

### What was already in good shape

- Every upload has a size limit and a file-type check. SVG images are
  blocked.
- Photos are shrunk in the browser before upload, to a longest side of
  1600 px.
- Every storage folder ("bucket") the code uses exists. New buckets are
  created by migrations.
- Files are stored under random names. The database keeps only that name,
  never a full web address.

### Fixed in this audit

1. **Student homework was in a public folder.** Co-op class homework went
   into the public `lesson-attachments` bucket, so anyone holding the link
   could open a child's work. New homework now goes to a new **private**
   `assignment-submissions` bucket. It opens only through the app, and
   only for:
   - the student,
   - their family,
   - the class's teachers,
   - Co-op Admins.

   Older homework is served through the same checked page. Its old links
   in the public folder still work until those files are removed.
2. **Re-uploading homework left the old file behind forever.** The
   replaced file is now deleted.
3. **Private files over about 6 MB could not be opened.** Netlify can't
   send back more than about 6 MB, and private files (documents, the
   handbook, homework, family-school files, receipts, form uploads) were
   being streamed through it. After the permission check, the browser now
   goes to a Supabase link that expires after 5 minutes. Large files work,
   and a forwarded link stops working quickly.
4. **Database connections.** Each running server instance now uses at most
   5 connections (setting: `PG_POOL_MAX`). Idle ones close after 10
   seconds, so a busy morning can't use up Supabase's connection limit.

## 2. Security audit

### Fixed

1. **186 database tables had no row-level security.** Only the tables
   from the very first migration had it. Every table added since did not,
   including:
   - `member_accounts` (emails and password hashes),
   - members, payments, family-school records, chat and notifications.

   On a Supabase project that still uses the older default permissions,
   anyone with the project's public key could read or change those tables
   through Supabase's built-in web API, without going through the app.
   The new migration
   `supabase/migrations/20261231200000_rls_all_tables.sql`:
   - turns row-level security on for every table,
   - removes all direct table access from Supabase's public roles,
   - keeps tables added later from getting that access automatically.

   The app itself never uses that web API (its server connection bypasses
   row-level security), so nothing in the app changes. A new test
   (`test/rls-every-table.test.js`) fails if a future table is added
   without row-level security. **Run this migration first.**
2. **Kiosk screens were open to the whole internet.** The walk-up kiosk
   pages need no sign-in:
   - `/kiosk` check-in, check-out and Find a Parent,
   - `/absence`, `/name-tag`, `/volunteers`, `/setup` and `/training`.

   That was fine on a building-only network. Now that the app is online,
   anyone could:
   - open `/absence` and read **every parent's and child's name**;
   - type 6-digit member codes into the check-in, check-out and Find a
     Parent screens to **check children in or out remotely**, or to learn
     a parent's schedule (where they'll be, and when).

   Each member code had about a 1-in-1,250 chance of matching someone.

   These pages now open only:
   - for someone signed in with a member account (parents can still report
     an absence from home), or
   - on a device unlocked once with the Class Check-In PIN. That's the new
     `/kiosk/unlock` screen; unlocking Class Check-In also counts.

   **What you need to do once:** on each kiosk tablet, open the kiosk and
   enter the Class Check-In PIN. The tablet then stays unlocked.
3. **Login and PIN lockouts didn't work on Netlify.** Wrong-password and
   wrong-PIN counts were kept in each server instance's memory, so they
   reset all the time. They're now saved in the database (new
   `login_failures` table). The limits:
   - **Logins:** 8 wrong passwords per email, or 30 per network address,
     in 15 minutes. The network limit is higher because the whole building
     shares one address.
   - **Class Check-In PIN** (the 4-digit one): 5 wrong tries in 15
     minutes.
4. **Session renewal at sign-in.** Signing in now issues a brand-new
   session ID, so an ID someone saw or planted beforehand is useless.
5. **Browser security headers.** Added:
   - a rule that other websites can't show this site inside a frame
     (blocks click-tricking),
   - HTTPS-only on future visits (HSTS),
   - a camera, microphone and location policy.

   The header that reveals the server software is also removed.
6. **Data placed in pages' scripts.** Eleven places put saved data into a
   page's script code without escaping it. Text containing `</script>` or
   an apostrophe could break the page or run code. They all use the safe
   helper now, which also fixes custom-form show/hide rules for answer
   choices with an apostrophe, like "Mom's".
7. **Package updates.** Updated `proxy-addr` (it allowed faking a network
   address), `sanitize-html` (cleans forum and rich-text posts), `multer`,
   `body-parser` and `qs`.

### Checked and found sound

- **Family-to-family access:** every parent, student, family-school and
  event page that takes a child or member ID checks that the person
  belongs to the signed-in account's family before showing or changing
  anything.
- **Signed-out access:** I requested all 590 pages while signed out. The
  only ones that open are the public website, login, registration, and
  the kiosk pages above, which are now gated.
- **Rich text** (forum posts, homework responses, descriptions) is
  cleaned before it's saved.
- **Database queries** use placeholders for anything a user types.
- **Passwords** are stored only as bcrypt hashes.
- **Form protection (CSRF)** covers every signed-in form.

### Still to do (needs you)

1. **Change the default passwords** if you haven't already:
   - the Main Admin account `mainadmin@coop.local` / `changeme123`,
   - the Class Check-In PIN `0000`.
2. **Upgrade Supabase to Pro** so you get daily backups (see section 1).
3. **Run the four new migrations** in the Supabase SQL Editor. Start with
   the row-level security one, since it's the most urgent; the other
   three can go in any order after it:
   - `supabase/migrations/20261231200000_rls_all_tables.sql` (most urgent)
   - `supabase/migrations/20261231170000_assignment_submissions_bucket.sql`
   - `supabase/migrations/20261231180000_login_failures.sql`
   - `supabase/migrations/20261231190000_push_notifications.sql`

   The other three turn row-level security on for their own new tables.

   **Deploy the new code only after these have run.** The new code expects
   the new tables and columns, so deploying first would break logins and
   notifications until the migrations are applied.
4. **Sign-ins never expire.** You asked earlier for members to stay
   signed in until they sign out. That's convenient, but on a shared
   family or co-op device the next person is still signed in. Remind
   members to sign out on shared devices.
5. **There's no "forgot password" page.** Admins reset passwords by hand.
6. **Remaining package warnings:**
   - `xlsx` (spreadsheet import) has a known flaw with no fix on npm. Only
     admins can upload spreadsheets, so the risk is low.
   - `archiver` (photo zip downloads) has moderate warnings that need a
     major-version update. Upload paths aren't affected.
7. **Old homework files** saved before this change are still in the public
   folder. Ask me if you want them moved into the private one.
8. **Member photos** (including children's) are in a public bucket under
   random names. They can't be listed or guessed, but anyone who has a
   photo's link can open it. Moving them to private links is a bigger
   change across many pages. Ask me if you want it.

## 3. Push notifications

Every notification the app already sends (announcements, class and event
registrations, waitlists, floater assignments, cancellations, and so on)
can now also arrive as a phone or computer push notification.

- **Members:** go to **Notifications → Preferences** and press **Turn on
  for this device**. Do it on each phone or computer you use. **Send a
  test** confirms it works. The existing **Push** column turns push on or
  off for each notification type.
- **iPhone and iPad:** push works only after the site is added to the
  Home Screen and opened from there. The page explains this.
- **Main Admin:** **Settings → Notifications** now has a **Push** switch
  for each notification type, next to Email and Text.
- **Setup (one time):**
  1. Run `node scripts/generate-vapid-keys.js`.
  2. Add the three values it prints (`VAPID_PUBLIC_KEY`,
     `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`) to Netlify's environment
     variables.
  3. Redeploy.

  Until then, the page says push isn't set up and nothing is sent.
- **Privacy:** each push is encrypted for the one device it goes to.
  Links inside a push can only point to pages on this site. When a device
  turns push off or is reset, it's removed automatically.
