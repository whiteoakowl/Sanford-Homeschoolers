// Co-op Admin Portal > Teachers/Assistants - a real request: "Add a tab
// called Teachers/Assistants after the classes tab. Teachers/assistants
// shows a lost of Teachers and assistants organized by schedule grid
// semester with a dropdown filter. If a teacher teaches multiple classes
// they will all be listed under the members name with a dropdown arrow
// and minimize feature. You can click on the class and it will go to the
// class. Organized alphabetical by last name. Subpage, instructor
// profiles, list of members who are signed up as teachers with check
// mark for enable/disable instructors profile. Click on each member and
// you can edit their instructor profile. It asks email, phone number,
// about me, experience/qualifications (check box for include this).
// Teachers can edit their instructor profile on the teacher portal if
// they are given permission to view that portal and if their profile has
// been enabled." See routes/teacher-portal.js's own GET/POST /teacher/
// instructor-profile for that self-edit side of the same feature.
//
// A later real request: "Teachers/assistants. Separate into two
// different pages. One for assistants and one for teachers. Count the
// classes for each member separately based off if they teach or
// assistant" - GET /teachers and GET /teachers/assistants below now each
// only ever see ONE role's own class_staff rows, so a member who both
// teaches some classes and assists on others gets two independent counts
// (and two independent collapsible entries, one per page) instead of one
// combined list with a per-class Teacher/Assistant tag.
const express = require('express');
const router = express.Router();
const requireAdmin = require('../middleware/requireAdmin');
const db = require('../db');
const { byLastName } = require('../utils/members');
const { CLASS_DAY_ORDER } = require('../utils/classDays');
const { allClassesList, staffForClass, listSemesters } = require('../utils/classSchedule');
const { getActiveKioskSemesterId } = require('../utils/kioskSettings');
const { instructorProfilesByMemberIds, instructorProfile, setInstructorProfileEnabled, saveInstructorProfile } = require('../utils/instructorProfiles');
const multer = require('multer');
const reimb = require('../utils/reimbursements');
const { toCsvRow, sendCsv, buildTemplateWorkbook, readRowsFromFile } = require('../utils/spreadsheet');
const { renderViewToPdf, publicOrigin } = require('../utils/pdfRender');
const { spreadsheetFileFilter } = require('../utils/uploads');
const { formatTimestamp, formatDateShort } = require('../utils/dates');
const { renderForm: renderReimbursementForm, submit: submitReimbursement, uploadReceipts, queryErrors } = require('./teacher-reimbursements');

const reimbursementImportUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 1024 * 1024 }, fileFilter: spreadsheetFileFilter });

// "Schedule grid semester" is the same active-semester concept the Kiosk
// Settings dropdown drives everywhere else (Classes grid default,
// Volunteers/Setup-Cleanup/Check-in) - defaulting to it here means this
// page opens already scoped to whichever semester is "current" instead of
// an admin having to pick it by hand every time, same as admin-schedule.js's
// own resolveSemesterId. ?semesterId= (including the literal empty string
// from "All Semesters") always wins when present.
async function resolveSemesterId(req) {
  if (req.query.semesterId !== undefined) {
    return req.query.semesterId ? parseInt(req.query.semesterId, 10) : null;
  }
  return getActiveKioskSemesterId();
}

// Every active member staffed in the given ROLE on at least one class in
// scope, grouped under their own member record - one entry per class
// they're staffed on, not one entry per class_staff row rendered flat,
// since the real request was explicit: "they will all be listed under
// the members name." allClassesList's own semesterId matching is an
// EXACT match (no semester given means no filter at all - see its own
// comment) - a dedicated "who's teaching this semester" report reading
// that literally is simpler and less surprising than the Classes grid's
// own "selected semester OR untagged" fallback would be here.
//
// role-scoped (not "every teacher/assistant combined") - a real request:
// "Separate into two different pages. One for assistants and one for
// teachers. Count the classes for each member separately based off if
// they teach or assistant." A member staffed as both teacher on some
// classes and assistant on others now gets two separate entries, one per
// page this is called from, each with its own independent class count -
// never one member with a single combined count spanning both roles.
async function staffForSemesterByRole(semesterId, role) {
  const classes = await allClassesList(null, semesterId);
  const byMember = new Map();
  for (const cls of classes) {
    const staff = await staffForClass(cls.id);
    for (const s of staff) {
      if (s.role !== role) continue;
      if (!byMember.has(s.id)) byMember.set(s.id, { id: s.id, name: s.name, classes: [] });
      byMember.get(s.id).classes.push({
        id: cls.id,
        className: cls.class_name,
        day: cls.day,
        dayLabel: cls.dayLabel,
        hourPosition: cls.hour_position,
        room: cls.room,
        timeLabel: cls.timeLabel,
      });
    }
  }
  const members = [...byMember.values()];
  members.forEach((m) => {
    m.classes.sort((a, b) => CLASS_DAY_ORDER[a.day] - CLASS_DAY_ORDER[b.day] || a.hourPosition - b.hourPosition);
  });
  return members.sort(byLastName);
}

router.get('/teachers', requireAdmin, async (req, res) => {
  const semesterId = await resolveSemesterId(req);
  const members = await staffForSemesterByRole(semesterId, 'teacher');
  res.render('admin-teachers', {
    title: 'Teachers',
    roleLabel: 'teacher',
    basePath: '/admin/teachers',
    members,
    semesters: await listSemesters(),
    selectedSemesterId: semesterId,
  });
});

// A real request: "Separate into two different pages. One for assistants
// and one for teachers" - see staffForSemesterByRole's own comment above.
// Reuses the exact same admin-teachers.ejs view as GET /teachers (same
// collapsible-list layout, semester filter, and click-through-to-class
// behavior), just scoped to the 'assistant' role instead.
router.get('/teachers/assistants', requireAdmin, async (req, res) => {
  const semesterId = await resolveSemesterId(req);
  const members = await staffForSemesterByRole(semesterId, 'assistant');
  res.render('admin-teachers', {
    title: 'Assistants',
    roleLabel: 'assistant',
    basePath: '/admin/teachers/assistants',
    members,
    semesters: await listSemesters(),
    selectedSemesterId: semesterId,
  });
});

// Registered ahead of GET /teachers/instructor-profiles/:id below so
// "instructor-profiles" itself is never swallowed as a member id, same
// reasoning every other admin list's own literal-subpath-before-:id
// route ordering already documents (e.g. routes/main-admin-members.js's
// own grade-level-report).
router.get('/teachers/instructor-profiles', requireAdmin, async (req, res) => {
  const rows = await db
    .prepare(
      `SELECT DISTINCT m.id, m.name FROM members m
       JOIN class_staff cs ON cs.member_id = m.id
       WHERE m.active = 1`
    )
    .all();
  const members = rows.sort(byLastName);
  const profiles = await instructorProfilesByMemberIds(members.map((m) => m.id));
  res.render('admin-teachers-instructor-profiles', {
    title: 'Instructor Profiles',
    members: members.map((m) => ({ ...m, profile: profiles[m.id] || null })),
    notice: req.query.notice || null,
  });
});

router.post('/teachers/instructor-profiles/:id/enabled', requireAdmin, async (req, res) => {
  const memberId = parseInt(req.params.id, 10);
  await setInstructorProfileEnabled(memberId, !!req.body.enabled);
  res.redirect('/admin/teachers/instructor-profiles');
});

router.get('/teachers/instructor-profiles/:id/edit', requireAdmin, async (req, res) => {
  const memberId = parseInt(req.params.id, 10);
  const member = await db.prepare('SELECT * FROM members WHERE id = ?').get(memberId);
  if (!member) return res.status(404).send('Not found');
  res.render('admin-teachers-instructor-profile-edit', {
    title: `Instructor Profile - ${member.name}`,
    member,
    profile: (await instructorProfile(memberId)) || {},
    backTo: '/admin/teachers/instructor-profiles',
    formAction: `/admin/teachers/instructor-profiles/${memberId}/edit`,
  });
});

router.post('/teachers/instructor-profiles/:id/edit', requireAdmin, async (req, res) => {
  const memberId = parseInt(req.params.id, 10);
  await saveInstructorProfile(memberId, {
    email: (req.body.email || '').trim(),
    phone: (req.body.phone || '').trim(),
    aboutMe: (req.body.aboutMe || '').trim(),
    qualifications: (req.body.qualifications || '').trim(),
    qualificationsVisible: !!req.body.qualificationsVisible,
  });
  res.redirect('/admin/teachers/instructor-profiles?notice=' + encodeURIComponent('Instructor profile saved.'));
});

// --- Teacher Reimbursements - a real request: "add a subpage called
// teacher reimbursements. This will be a log of reimbursement forms that
// have been submitted for approval. There should be import, export,
// print, and PDF icons on this page lined up on the same row. There will
// also be a button that says edit form." See utils/reimbursements.js;
// the teacher-facing form is routes/teacher-reimbursements.js. Every
// literal subpath is registered ahead of /teachers/reimbursements/:id.

function reimbursementFilters(req) {
  const status = reimb.STATUS_LABELS[req.query.status] ? req.query.status : '';
  const semesterId = parseInt(req.query.semesterId, 10) || null;
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (semesterId) params.set('semesterId', String(semesterId));
  const qs = params.toString();
  return { status, semesterId, query: qs ? `?${qs}` : '' };
}

async function filteredReimbursements(req) {
  const filters = reimbursementFilters(req);
  const requests = await reimb.listRequests(filters);
  const grandTotalLabel = reimb.formatCents(requests.reduce((sum, r) => sum + Number(r.total_cents || 0), 0));
  return { filters, requests, grandTotalLabel };
}

async function reimbursementFilterLabel(filters) {
  const parts = [];
  if (filters.status) parts.push(reimb.STATUS_LABELS[filters.status]);
  if (filters.semesterId) {
    const sem = (await listSemesters()).find((s) => s.id === filters.semesterId);
    if (sem) parts.push(sem.title);
  }
  return parts.join(', ');
}

async function renderReimbursementLog(req, res, extra = {}) {
  const { filters, requests, grandTotalLabel } = await filteredReimbursements(req);
  res.render('admin-teacher-reimbursements', {
    title: 'Teacher Reimbursements',
    requests,
    grandTotalLabel,
    filters,
    filterQuery: filters.query,
    statusLabels: reimb.STATUS_LABELS,
    semesters: await listSemesters(),
    notice: req.query.notice || null,
    error: req.query.error || null,
    importErrors: [],
    formatTimestamp,
    ...extra,
  });
}

router.get('/teachers/reimbursements', requireAdmin, async (req, res) => {
  await renderReimbursementLog(req, res);
});

router.get('/teachers/reimbursements/export.csv', requireAdmin, async (req, res) => {
  const { requests } = await filteredReimbursements(req);
  const lines = [toCsvRow(['Submitted', 'Name', 'Semester', 'Day', 'Class', 'Items', 'Receipts', 'Total', 'Status', 'Check Number', 'Check Date', 'Approved By'])];
  requests.forEach((r) => {
    lines.push(
      toCsvRow([
        r.submitted_at,
        r.member_name,
        r.semester_title,
        r.dayLabel,
        r.class_name,
        r.itemCount,
        r.receiptCount,
        (Number(r.total_cents) / 100).toFixed(2),
        r.statusLabel,
        r.check_number || '',
        r.check_date || '',
        r.approved_by_name || '',
      ])
    );
  });
  sendCsv(res, 'teacher-reimbursements.csv', lines);
});

// One row per item line, in the same columns the Import template uses,
// so an export can be re-imported elsewhere.
router.get('/teachers/reimbursements/export-items.csv', requireAdmin, async (req, res) => {
  const { requests } = await filteredReimbursements(req);
  const items = await reimb.itemsForRequests(requests.map((r) => r.id));
  const byId = new Map(requests.map((r) => [r.id, r]));
  const lines = [toCsvRow(reimb.IMPORT_HEADERS)];
  items.forEach((it) => {
    const r = byId.get(it.request_id);
    lines.push(
      toCsvRow([
        r.member_name,
        r.semester_title,
        r.dayLabel,
        r.class_name,
        it.description,
        it.purchase_date || '',
        (it.amount_cents / 100).toFixed(2),
        (r.submitted_at || '').slice(0, 10),
        r.check_number || '',
        r.check_date || '',
        r.approved_by_name || '',
      ])
    );
  });
  sendCsv(res, 'teacher-reimbursement-items.csv', lines);
});

async function reimbursementPrintLocals(req) {
  const { filters, requests, grandTotalLabel } = await filteredReimbursements(req);
  return {
    title: 'Teacher Reimbursements',
    requests,
    grandTotalLabel,
    filterLabel: await reimbursementFilterLabel(filters),
    formatTimestamp,
    formatDateShort,
  };
}

router.get('/teachers/reimbursements/print', requireAdmin, async (req, res) => {
  res.render('admin-teacher-reimbursements-print', await reimbursementPrintLocals(req));
});

router.get('/teachers/reimbursements/download.pdf', requireAdmin, async (req, res) => {
  // req.app.render() never sees this request's res.locals, so the nav's
  // isFullAdmin has to be passed explicitly (same as admin-design.js).
  const pdf = await renderViewToPdf(req, 'admin-teacher-reimbursements-print', { ...(await reimbursementPrintLocals(req)), isFullAdmin: !!res.locals.isFullAdmin });
  res.set('Content-Type', 'application/pdf');
  res.set('Content-Disposition', 'attachment; filename="teacher-reimbursements.pdf"');
  res.send(pdf);
});

router.get('/teachers/reimbursements/import-template.xlsx', requireAdmin, (req, res) => {
  const buffer = buildTemplateWorkbook(reimb.IMPORT_HEADERS, [
    ['Jane Smith', 'Fall 2026', 'Monday', 'Art', 'Construction paper', '2026-09-01', '12.50', '2026-09-05', '', '', ''],
    ['Jane Smith', 'Fall 2026', 'Monday', 'Art', 'Glue sticks', '2026-09-01', '6.00', '2026-09-05', '', '', ''],
  ]);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="teacher-reimbursements-import-template.xlsx"');
  res.send(buffer);
});

router.post('/teachers/reimbursements/import', requireAdmin, reimbursementImportUpload.single('file'), async (req, res) => {
  if (!req.file) return res.redirect('/admin/teachers/reimbursements?error=' + encodeURIComponent('Please choose a file to import.'));
  let rows;
  try {
    rows = await readRowsFromFile(req.file.buffer);
  } catch {
    return res.redirect('/admin/teachers/reimbursements?error=' + encodeURIComponent('Could not read that file. Please use the template format.'));
  }
  const { imported, errors } = await reimb.importRows(rows, req.portalAccount ? req.portalAccount.id : null);
  const notice = `Imported ${imported} reimbursement form${imported === 1 ? '' : 's'}.`;
  if (errors.length === 0) return res.redirect('/admin/teachers/reimbursements?notice=' + encodeURIComponent(notice));
  await renderReimbursementLog(req, res, { notice, importErrors: errors });
});

router.get('/teachers/reimbursements/form-settings', requireAdmin, async (req, res) => {
  res.render('admin-teacher-reimbursements-form-settings', {
    title: 'Edit Reimbursement Form',
    settings: await reimb.formSettings(),
    teacherFormUrl: `${publicOrigin(req)}/reimbursement-form`,
    notice: req.query.notice || null,
  });
});

router.post('/teachers/reimbursements/form-settings', requireAdmin, async (req, res) => {
  await reimb.saveFormSettings({ title: req.body.title, intro: req.body.intro, footer: req.body.footer });
  res.redirect('/admin/teachers/reimbursements/form-settings?notice=' + encodeURIComponent('Form saved.'));
});

const ADMIN_FORM = { shell: 'admin', formAction: '/admin/teachers/reimbursements', backHref: '/admin/teachers/reimbursements', backLabel: 'Teacher Reimbursements' };

router.get('/teachers/reimbursements/new', requireAdmin, async (req, res) => {
  await renderReimbursementForm(res, { ...ADMIN_FORM, errors: queryErrors(req), values: {} });
});

router.post('/teachers/reimbursements', requireAdmin, uploadReceipts('/admin/teachers/reimbursements/new'), async (req, res) => {
  await submitReimbursement(req, res, {
    ...ADMIN_FORM,
    onSuccess: (id) => res.redirect(`/admin/teachers/reimbursements/${id}?notice=` + encodeURIComponent('Reimbursement form submitted.')),
  });
});

async function renderReimbursementDetail(req, res, request, { notice, error, status } = {}) {
  res.status(status || 200).render('reimbursement-detail', {
    title: 'Reimbursement',
    shell: 'admin',
    backHref: '/admin/teachers/reimbursements',
    backLabel: 'Teacher Reimbursements',
    settings: await reimb.formSettings(),
    request,
    admins: await reimb.adminMembers(),
    notice: notice || null,
    error: error || null,
    formatTimestamp,
    formatDateShort,
  });
}

router.get('/teachers/reimbursements/:id', requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const request = id ? await reimb.getRequest(id) : null;
  if (!request) return res.status(404).send('Not found');
  await renderReimbursementDetail(req, res, request, { notice: req.query.notice });
});

router.post('/teachers/reimbursements/:id/admin', requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const existing = id ? await reimb.getRequest(id) : null;
  if (!existing) return res.status(404).send('Not found');
  const error = await reimb.saveAdminSection(id, {
    checkNumber: req.body.checkNumber,
    checkDate: req.body.checkDate,
    approvedByMemberId: req.body.approvedByMemberId,
  });
  if (error) return renderReimbursementDetail(req, res, existing, { error, status: 400 });
  const saved = await reimb.getRequest(id);
  const notice = saved.status === 'approved' ? 'Saved - marked Approved/Paid.' : 'Saved. Fill in the check number, check date and approver to mark it Approved/Paid.';
  res.redirect(`/admin/teachers/reimbursements/${id}?notice=` + encodeURIComponent(notice));
});

router.post('/teachers/reimbursements/:id/reject', requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const existing = id ? await reimb.getRequest(id) : null;
  if (!existing) return res.status(404).send('Not found');
  const error = await reimb.rejectRequest(id, req.body.message, req.portalAccount ? req.portalAccount.id : null);
  if (error) return renderReimbursementDetail(req, res, existing, { error, status: 400 });
  res.redirect(`/admin/teachers/reimbursements/${id}?notice=` + encodeURIComponent('Rejected - the teacher was notified and can edit and resubmit it.'));
});

router.post('/teachers/reimbursements/:id/delete', requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (id) await reimb.deleteRequest(id);
  res.redirect('/admin/teachers/reimbursements?notice=' + encodeURIComponent('Reimbursement form deleted.'));
});

module.exports = router;
