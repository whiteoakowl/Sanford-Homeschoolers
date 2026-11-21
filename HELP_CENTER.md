# Help Centers

The site has two help centers. Both require signing in.

| | Member Help Center | Admin Help Center |
|---|---|---|
| Address | `/help` | `/admin-help` |
| For | Parents, students, teachers (and any signed-in member) | Co-op Admins and Main Admins only |
| Opened from | **Help** (question mark) in every member portal's top corner | **Help** in the Co-op Admin and Main Admin top corners |
| Content | `utils/helpCenter/content/*.js` | `utils/helpCenter/admin-content/*.js` |
| Size | 20 topics, 110 articles, 38 FAQs | 11 topics, 68 articles, 20 FAQs |

## Who sees what

- Each article lists its **audiences**:
  - member help: `member`, `parent`, `student`, `teacher`, `coop_admin`;
  - admin help: `coop_admin`, `main_admin`.

  A person only sees articles for roles they actually hold.
- An article can also name a **page permission**. It then only shows to
  people who can open that page. Main Admin articles use this, so an
  admin only gets help for the Main Admin pages their position allows.
- Search, FAQs, category pages and direct links all use the same check.
  A hidden article gives the same "not found" page as one that doesn't
  exist.
- Members are turned away from `/admin-help`. Nothing in either help
  center describes servers, the database, keys or other setup details.

## Updating help when the site changes

1. Find the article: search the content folders for the page or button
   name.
2. Edit its text. Wrap exact on-screen labels in `**double asterisks**`.
   Body blocks are `p`, `h`, `steps`, `list`, `tip`, `note` and `table`
   (see `utils/helpCenter/index.js`).
3. To add an article, add an object to the right category file with a
   new `slug`, a `title`, a `summary`, its `audiences` and `keywords`.
   To add a category, create a file and list it in `index.js` or
   `admin.js`.
4. To put a "?" help link on a page:

   ```ejs
   <%- include('partials/help/link', { slug: 'article-slug', label: 'Help' }) %>
   ```

   Add `base: '/admin-help'` for an admin page.
5. Run `npm test`. These tests fail on broken related links, FAQ links,
   contextual help links, or internal details mentioned in help text:
   - `test/help-center.test.js`
   - `test/admin-help-center.test.js`
   - `test/help-context-links.test.js`

## Coverage checklist

**Member Help Center**

| Area | Covered by |
|---|---|
| Sign-in, menus, portals, install app, troubleshooting | Getting Started |
| Profile, photo, contact details, Primary Parent | Account & Profile |
| Adding children and parents, editing, medical notes, student logins, removal | Family & Members |
| Membership requests, status, locked accounts, Policy Handbook | Membership |
| Finding classes, registering, waitlists, withdrawing, schedule changes, teaching, Classroom Dashboard, assignments | Classes & Registration |
| Family schedules, student and teacher schedules, Annual Calendar | Schedules & Calendars |
| Kiosk check-in and check-out, Find a Parent, Class Check In & Out, absences, viewing attendance | Attendance |
| Calendar, registering, guests, sign-ups, cancelling, tickets, adding to your calendar, suggesting events | Events & Calendar |
| Announcements, Chat, formatting, class chat, moderators, Notifications inbox | Announcements, Chat & Notifications |
| Documents, resources, training, both directories, classifieds, photos, library, babysitters, store, forms, reading challenge | Group Information & Resources |
| Floater, setup/cleanup, committees, sign-up lists, volunteer hours | Setup, Cleanup & Volunteering |
| Balance, how to pay | Payments & Accounting |
| Printing and requesting name tags | Name Tags |
| Every print, PDF and export location | Printing & Exporting |
| Every Family School Management page | Family School Management |
| The Student Portal | For Students |
| The Co-op Teacher Portal | For Teachers |
| Settings, notification preferences, push, directory privacy | Settings & Notifications |
| Who can see what | Privacy & Permissions |
| Passwords, forgot password, signing out, safety | Account Security |

Things the site doesn't do are stated plainly where people would look
for them: card payments, private messages, polls, reactions, removing a
family member yourself, a self-service password reset, and a membership
renewal form.

**Admin Help Center**

| Area | Covered by |
|---|---|
| Co-op Admin menu, dashboard, search, daily kiosk setup, every Settings tab | Co-op Admin: Getting Started |
| Rosters, every log, floaters, setup/cleanup, library | Co-op Admin: Attendance, Logs & Volunteers |
| Classes, registration windows and rules, logs, requests, withdrawals, teachers, lesson approval | Co-op Admin: Classes & Teachers |
| Members, announcements, text, email, training, documents, orientation | Co-op Admin: Members, Communication & Printing |
| Design/Print, name tag designer, Quick Links, safety | All Admins |
| Main Admin menu, Settings hub, admins and positions, Portal Permissions, admin login, Audit Log | Main Admin: Getting Started |
| Approvals, members and families, archive and lock, import, membership settings, sections, directory settings | Main Admin: Members & Membership |
| Accounts, invoices, payments and adjustments, categories and fiscal years, transactions and receipts, reports and settings | Main Admin: Accounting |
| Announcements, email, text, newsletter, notification settings, events, registrations, event settings, chat | Main Admin: Communication, Events & Chat |
| Volunteers, name tags, photos, publications, Nature News, resource links, directory and classifieds, babysitters, documents | Main Admin: Volunteers & Community Content |
| Public website editor, FAQ, Annual Calendar, Shop, Custom Forms, Support, Family School records, training, Fun | Main Admin: Website, Shop & More |
