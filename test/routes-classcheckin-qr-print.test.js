// A real user request: "in bulk print we should add printing QR sheets
// to scan for quick links to class check in/out kiosk for teachers.
// should be able to select how many classes are added. portrait view,
// name of each class. evenly spaced and displayed up to 4 class on a
// page" - later refined to "each page should be all of the class qr
// codes for that classroom, that day." Covers the Design/Print "Class
// Check-In QR Codes" panel (routes/admin-design.js) end to end: the
// picker lists every class, and the print route groups selected classes
// into one page per (day, room) - a room can never have more than 4
// classes in a day (one per hour_position) - each with a QR code
// encoding an ABSOLUTE URL to that class's own Class Check-In quick link
// (/kiosk/class-checkin/classes/:id/attendance - the same one every
// class card's own quick link opens).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const testDbPath = path.join(os.tmpdir(), `classcheckin-qr-print-test-db-${process.pid}.db`);
const testUploadsDir = path.join(os.tmpdir(), `classcheckin-qr-print-test-uploads-${process.pid}`);
process.env.DB_PATH = testDbPath;
process.env.UPLOADS_DIR = testUploadsDir;
process.env.SESSION_SECRET = 'test-secret-not-for-real-use';
process.env.ADMIN_USERNAME = 'testadmin';
process.env.ADMIN_PASSWORD = 'testpassword123';

const request = require('supertest');
const app = require('../server');
const { createClass } = require('../utils/classSchedule');

test.before(() => app.ready);
test.after(() => {
  fs.rmSync(testDbPath, { force: true });
  fs.rmSync(`${testDbPath}-wal`, { force: true });
  fs.rmSync(`${testDbPath}-shm`, { force: true });
  fs.rmSync(testUploadsDir, { recursive: true, force: true });
});

async function getBuffer(url, cookie) {
  return request(app)
    .get(url)
    .set('Cookie', cookie)
    .buffer(true)
    .parse((res, cb) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
}

async function loginAsAdmin() {
  const loginRes = await request(app).post('/login').type('form').send({ email: process.env.MAIN_ADMIN_EMAIL || 'mainadmin@coop.local', password: process.env.MAIN_ADMIN_PASSWORD || 'changeme123' });
  const cookie = loginRes.headers['set-cookie'];
  const page = await request(app).get('/admin/design?tab=print').set('Cookie', cookie);
  const csrfToken = /name="csrf-token" content="([^"]*)"/.exec(page.text)[1];
  return { cookie, csrfToken };
}

test('Class Check-In QR Codes picker lists every class, with no description text, a Room column, and a Day/Room filter popup', async () => {
  const { cookie } = await loginAsAdmin();
  const classId = await createClass({ day: 'monday', hourPosition: 1, className: 'QR Picker Class', room: 'Room 1' });

  const res = await request(app).get('/admin/design?tab=print').set('Cookie', cookie);
  assert.equal(res.status, 200);
  assert.match(res.text, /Class Check-In QR Codes/);
  assert.match(res.text, new RegExp(`name="classIds" value="${classId}"`));
  assert.match(res.text, /QR Picker Class/);
  assert.doesNotMatch(res.text, /One QR code per selected class/);
  // The Print button now sits in the same top row as Select All/Select
  // None/Filter, not a separate row below the picker list - a real
  // request: "the print button should be moved to the top right of the
  // page with the other buttons."
  assert.match(res.text, /id="classcheckin-qr-filter-btn"[\s\S]*?name-tag-bulk-submit"[\s\S]*?Print/);

  // Filter button + popup (Day/Room selects, Save button) that narrows the
  // class list - a real request: "Class QR code printing filter should be
  // filter by day and room number, remove hour filter."
  assert.match(res.text, /id="classcheckin-qr-filter-btn"/);
  assert.match(res.text, /id="classcheckin-qr-filter-dialog"/);
  assert.match(res.text, /id="classcheckin-qr-filter-day-select"/);
  assert.match(res.text, /id="classcheckin-qr-filter-room-select"/);
  assert.doesNotMatch(res.text, /id="classcheckin-qr-filter-hour-select"/);
  assert.match(res.text, /id="classcheckin-qr-filter-save-btn"/);
  assert.match(res.text, new RegExp(`class="qr-picker-row" data-semester="[^"]*" data-day="monday" data-room="Room 1"[\\s\\S]*?value="${classId}"`));
  // Room column in the picker table itself, alongside Class/Day/Time.
  assert.match(res.text, /<th>Room<\/th>/);
  // A real request: "the download should be a pdf of exactly how it
  // would also look when printing" - a second submit button right next
  // to Print, posting the exact same checked classIds but as a GET to
  // routes/admin-design.js's download.pdf route.
  assert.match(res.text, /formaction="\/admin\/design\/print-classcheckin-qr\/download\.pdf" formmethod="GET"[^>]*aria-label="Download PDF"/);
});

test('printing with no classes selected redirects with an error', async () => {
  const { cookie, csrfToken } = await loginAsAdmin();
  const res = await request(app).post('/admin/design/print-classcheckin-qr').set('Cookie', cookie).type('form').send({ _csrf: csrfToken });
  assert.equal(res.status, 302);
  assert.match(decodeURIComponent(res.headers.location), /Select at least one class/);
});

// A real follow-up request: "Each page should be all of the class qr
// codes for that classroom, that day." Pages now group by (day, room)
// rather than just chunking the selection 4-at-a-time - covered directly
// below rather than by the old flat "5 classes -> 2 pages" chunking test,
// which no longer describes how pages are built at all.
test('the print sheet groups classes into one page per (day, room), sorted by hour position', async (t) => {
  const { cookie, csrfToken } = await loginAsAdmin();
  // Room A/monday: 4 classes filling every hour slot, seeded out of
  // hour_position order - the page should still read 1, 2, 3, 4.
  const roomAIds = [];
  roomAIds.push(await createClass({ day: 'monday', hourPosition: 3, className: 'Room A Hour 3', room: 'Room A' }));
  roomAIds.push(await createClass({ day: 'monday', hourPosition: 1, className: 'Room A Hour 1', room: 'Room A' }));
  roomAIds.push(await createClass({ day: 'monday', hourPosition: 4, className: 'Room A Hour 4', room: 'Room A' }));
  roomAIds.push(await createClass({ day: 'monday', hourPosition: 2, className: 'Room A Hour 2', room: 'Room A' }));
  // Room B/wednesday: only 1 class - a different day AND a different room
  // than Room A, so it must land on its own separate page.
  const roomBId = await createClass({ day: 'wednesday', hourPosition: 1, className: 'Room B Solo Class', room: 'Room B' });

  const classIds = [...roomAIds, roomBId];
  const res = await request(app)
    .post('/admin/design/print-classcheckin-qr')
    .set('Cookie', cookie)
    .type('form')
    .send({ classIds: classIds.map(String), _csrf: csrfToken });
  assert.equal(res.status, 200);

  await t.test('5 classes across 2 (day, room) groups land on exactly 2 pages', async () => {
    const pageCount = (res.text.match(/class="qr-sheet-page"/g) || []).length;
    assert.equal(pageCount, 2, 'one page for Room A/monday, one page for Room B/wednesday');
    const cellCount = (res.text.match(/class="qr-sheet-cell"/g) || []).length;
    assert.equal(cellCount, 5, 'every selected class should get its own cell across both pages');
  });

  await t.test('each page header names its own room and day', async () => {
    assert.match(res.text, /Room A[\s\S]{0,30}Monday/);
    assert.match(res.text, /Room B[\s\S]{0,30}Wednesday/);
  });

  await t.test('Room A\'s page reads Hour 1 through Hour 4 in order, not seed order', async () => {
    const order = ['Room A Hour 1', 'Room A Hour 2', 'Room A Hour 3', 'Room A Hour 4'].map((name) => res.text.indexOf(name));
    assert.ok(order.every((i) => i !== -1), 'all four class names should be present');
    assert.deepEqual(order, [...order].sort((a, b) => a - b), 'hour 1-4 should appear in that order on the page');
  });

  await t.test('each cell carries the class name and an absolute Class Check-In URL', async () => {
    for (const classId of classIds) {
      assert.match(res.text, new RegExp(`data-qr-value="http://[^"]*/kiosk/class-checkin/classes/${classId}/attendance\\?k=[0-9a-f]{20}"`));
    }
    assert.match(res.text, /Room A Hour 1/);
    assert.match(res.text, /Room B Solo Class/);
  });

  await t.test('the QR rendering script and vendored library are both loaded', async () => {
    assert.match(res.text, /<script src="\/js\/vendor\/qrcode\.min\.js"><\/script>/);
    assert.match(res.text, /<script src="\/js\/classcheckin-qr-print\.js"><\/script>/);
  });

  // A real bug report: "The print preview shows 4 nice class cards on one
  // page ... When you go to the printer it is on two pages." Root cause:
  // @page's own non-zero margin, stacked on top of .qr-sheet-page's own
  // identical-sized 8.5in x 11in box (with its own padding as the visual
  // margin), shrank the printable area enough that the bottom of the page
  // had nowhere to go but a second physical page - see styles.css's
  // .qr-sheet-page comment for the full explanation. margin: 0 here is
  // what makes the div's box exactly match the physical page again.
  await t.test('@page has no margin of its own - only .qr-sheet-page\'s own padding provides one', async () => {
    assert.match(res.text, /@page\s*\{\s*size:\s*letter portrait;\s*margin:\s*0;\s*\}/);
  });
});

// A real request: "the download should be a pdf of exactly how it would
// also look when printing" - routes/admin-design.js's new GET
// /design/print-classcheckin-qr/download.pdf route renders the exact
// same admin-classcheckin-qr-print.ejs view through headless Chromium
// (see utils/pdfRender.js), with the selected classIds carried as a
// query string instead of a POST body. PDF generation via real headless
// Chromium is slow (~1-2s) - expected, not a bug.
test('downloading the QR sheet as a PDF renders a real, non-trivial PDF', async () => {
  const { cookie } = await loginAsAdmin();
  const classId = await createClass({ day: 'monday', hourPosition: 1, className: 'QR Download Class', room: 'Room 1' });

  const res = await getBuffer(`/admin/design/print-classcheckin-qr/download.pdf?classIds=${classId}`, cookie);
  assert.equal(res.status, 200);
  assert.equal(res.headers['content-type'], 'application/pdf');
  assert.match(res.headers['content-disposition'], /attachment; filename="class-checkin-qr-codes\.pdf"/);
  assert.equal(res.body.slice(0, 5).toString(), '%PDF-');
  // A broken QR render would still return 200 with a near-blank page -
  // a real one-page sheet with a rendered QR code comes back well into
  // the tens of KB, not a trivial handful of bytes.
  assert.ok(res.body.length > 5000, `expected a non-trivial PDF, got ${res.body.length} bytes`);
});

// A real bug report (photos of a printed Room 5 Wednesday sheet with QR
// cards overlapping each other and the next page's header): a room with
// more than 4 classes in a day (several share an hour across semesters)
// overflowed its one fixed 2x2 page. It now continues onto another page
// for that same room/day, never more than 4 cards per page.
test('a room with more than 4 classes that day continues onto another page instead of overflowing', async () => {
  const { cookie, csrfToken } = await loginAsAdmin();
  const ids = [];
  for (const [hour, name] of [[1, 'Room 5 Class A'], [1, 'Room 5 Class B'], [2, 'Room 5 Class C'], [3, 'Room 5 Class D'], [3, 'Room 5 Class E'], [4, 'Room 5 Class F']]) {
    ids.push(await createClass({ day: 'wednesday', hourPosition: hour, className: name, room: 'Room 5' }));
  }
  const res = await request(app)
    .post('/admin/design/print-classcheckin-qr')
    .set('Cookie', cookie)
    .type('form')
    .send({ classIds: ids.map(String), _csrf: csrfToken });
  assert.equal(res.status, 200);
  const sheets = res.text.split('class="qr-sheet-page"').slice(1);
  assert.equal(sheets.length, 2, '6 classes in one room/day need 2 sheets');
  assert.equal((sheets[0].match(/class="qr-sheet-cell"/g) || []).length, 4);
  assert.equal((sheets[1].match(/class="qr-sheet-cell"/g) || []).length, 2);
  for (const sheet of sheets) assert.match(sheet, /Room 5[\s\S]{0,30}Wednesday/, 'every sheet keeps its room/day header');

});

// A real request: "When printing qr codes for class check in there needs
// to be a semester dropdown added to the filter." The Filter popup lists
// only the semesters/days its classes use (days in calendar order), and
// each picker row carries its semester so the filter can match it.
test('the QR picker Filter popup has a Semester dropdown and each row carries its semester', async () => {
  const { createSemester } = require('../utils/classSchedule');
  const { cookie } = await loginAsAdmin();
  const fall = await createSemester('QR Fall Semester');
  const classId = await createClass({ day: 'monday', hourPosition: 2, className: 'QR Semester Class', room: 'Room 9', semesterId: fall.id });
  const page = await request(app).get('/admin/design?tab=print').set('Cookie', cookie);
  assert.equal(page.status, 200);
  assert.match(page.text, /<select id="classcheckin-qr-filter-semester-select">[\s\S]*?<option value="">All Semesters<\/option>[\s\S]*?<option value="\d+">QR Fall Semester<\/option>/);
  assert.match(page.text, new RegExp(`data-semester="${fall.id}"[^>]*>\\s*<td><input type="checkbox" name="classIds" value="${classId}"`));
  const daySelect = /<select id="classcheckin-qr-filter-day-select">([\s\S]*?)<\/select>/.exec(page.text)[1];
  assert.match(daySelect, /<option value="monday">Monday<\/option>/);
  assert.doesNotMatch(daySelect, /<option value="tuesday">/, 'only days that actually have classes are offered');
});

// A real request: "When scanning qr codes to do class attendance, check in
// and out, it should not ask for a pin #. Scanning the class qr code goes
// directly to the class attendance page." The printed URL's per-class key
// opens that class (and its check-in/out) with no PIN; no key, a wrong
// key, or another class's key still lands on the PIN screen.
test('a printed class QR code opens that class attendance page with no PIN, but only that class', async () => {
  const { classQrKey } = require('../utils/classQrKey');
  const classA = await createClass({ day: 'monday', hourPosition: 1, className: 'QR No PIN Class A', room: 'Room Q' });
  const classB = await createClass({ day: 'monday', hourPosition: 2, className: 'QR No PIN Class B', room: 'Room Q' });
  const keyA = await classQrKey(classA);

  const noKey = await request(app).get(`/kiosk/class-checkin/classes/${classA}/attendance`);
  assert.equal(noKey.status, 302);
  assert.match(noKey.headers.location, /^\/kiosk\/class-checkin\?next=/);

  const wrongKey = await request(app).get(`/kiosk/class-checkin/classes/${classA}/attendance?k=${'0'.repeat(20)}`);
  assert.match(wrongKey.headers.location, /^\/kiosk\/class-checkin\?next=/);

  const agent = request.agent(app);
  const scanned = await agent.get(`/kiosk/class-checkin/classes/${classA}/attendance?k=${keyA}`);
  assert.equal(scanned.status, 302, 'the key is accepted and stripped from the URL');
  assert.equal(scanned.headers.location, `/kiosk/class-checkin/classes/${classA}/attendance`);
  const page = await agent.get(`/kiosk/class-checkin/classes/${classA}/attendance`);
  assert.equal(page.status, 200);
  assert.match(page.text, /QR No PIN Class A/);
  const scanPage = await agent.get(`/kiosk/class-checkin/classes/${classA}/scan?mode=checkin`);
  assert.equal(scanPage.status, 200);
  const checkin = await agent.post(`/kiosk/class-checkin/classes/${classA}/scan/checkin`).type('form').send({ barcode: 'no-such-barcode' });
  assert.equal(checkin.status, 200, 'check-in scanning works on the unlocked class (an unknown barcode just reports not recognized)');

  const otherClass = await agent.get(`/kiosk/class-checkin/classes/${classB}/attendance`);
  assert.equal(otherClass.status, 302, 'one class\'s QR key does not unlock a different class');
  const otherWithAKey = await agent.get(`/kiosk/class-checkin/classes/${classB}/attendance?k=${keyA}`);
  assert.equal(otherWithAKey.status, 302);
  assert.match(otherWithAKey.headers.location, /^\/kiosk\/class-checkin\?next=/);
  const list = await agent.get('/kiosk/class-checkin/classes');
  assert.equal(list.status, 302, 'the class list itself still needs the PIN');
});
