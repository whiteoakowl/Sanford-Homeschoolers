// Co-op Teacher Portal > Reimbursements - the teacher/assistant side of
// Teacher Reimbursements (utils/reimbursements.js; Co-op Admin's log lives
// in routes/admin-teachers.js). A teacher submits the form and sees only
// their own past submissions + status - never the Admin Only section -
// and can Edit & Resubmit one an admin rejected. Its own router (mounted
// at '/') rather than more routes inside routes/teacher-portal.js, so it
// carries its own gates per route.
const express = require('express');
const router = express.Router();
const multer = require('multer');
const { requirePortalAuth, requirePortal, requirePortalPermission } = require('../middleware/portalAuth');
const { hasCoopAdminAccess } = require('../middleware/requireAdmin');
const { memberForAccount } = require('../utils/portalAuth');
const { formatTimestamp, formatDateShort } = require('../utils/dates');
const reimb = require('../utils/reimbursements');

const teacherGate = [requirePortalAuth, requirePortal('teacher'), requirePortalPermission('view_teacher_reimbursements')];

const receiptMulter = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: reimb.MAX_RECEIPT_BYTES, files: reimb.MAX_RECEIPTS },
  fileFilter: reimb.receiptFileFilter,
});

// Same friendly redirect-back shape as utils/memberIntake.js's
// uploadIntakePhotos: an oversized receipt never reaches the handler as
// a bare 500.
function uploadReceipts(backTo) {
  return function (req, res, next) {
    receiptMulter.array('receipts', reimb.MAX_RECEIPTS)(req, res, (err) => {
      if (err && (err.code === 'LIMIT_FILE_SIZE' || err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE')) {
        const message =
          err.code === 'LIMIT_FILE_SIZE'
            ? `That receipt is too large - receipts are limited to ${reimb.MAX_RECEIPT_BYTES / (1024 * 1024)}MB each.`
            : `A form can have at most ${reimb.MAX_RECEIPTS} receipts.`;
        return res.redirect(`${typeof backTo === 'function' ? backTo(req) : backTo}?error=` + encodeURIComponent(message));
      }
      next(err);
    });
  };
}

async function renderForm(res, { shell, formAction, backHref, backLabel, values, errors, status, notice, existingReceipts, rejection, submitLabel }) {
  const [settings, people, catalog] = await Promise.all([reimb.formSettings(), reimb.reimbursementPeople(), reimb.formCatalog()]);
  res.status(status || 200).render('reimbursement-form', {
    title: settings.title,
    shell,
    formAction,
    backHref,
    backLabel,
    settings,
    people,
    catalog,
    values,
    errors: errors || [],
    notice: notice || null,
    existingReceipts: existingReceipts || [],
    rejection: rejection || null,
    submitLabel: submitLabel || null,
    maxReceiptMb: reimb.MAX_RECEIPT_BYTES / (1024 * 1024),
  });
}

function queryErrors(req) {
  return req.query.error ? [String(req.query.error)] : [];
}

// Shared by a new submission (teacher, shareable link, admin on someone's
// behalf) and a resubmission (resubmitId set).
async function submit(req, res, { shell, formAction, backHref, backLabel, onSuccess, resubmitId, existingReceipts, rejection, submitLabel }) {
  const people = await reimb.reimbursementPeople();
  const result = await reimb.validateSubmission(req.body, people);
  if (req.rejectedReceiptNames && req.rejectedReceiptNames.length) {
    result.errors.push(`Receipts must be photos (JPEG, PNG, WebP, HEIC) or PDF files - not accepted: ${req.rejectedReceiptNames.join(', ')}.`);
  }
  const files = req.files || [];
  if (result.errors.length) {
    if (files.length) result.errors.push('Please choose your receipt files again before resubmitting.');
    return renderForm(res, {
      shell,
      formAction,
      backHref,
      backLabel,
      status: 400,
      errors: result.errors,
      existingReceipts,
      rejection,
      submitLabel,
      values: { memberId: req.body.memberId, semesterId: req.body.semesterId, day: req.body.day, classId: req.body.classId, items: result.rawItems },
    });
  }
  const fields = { person: result.person, semester: result.choice.semester, cls: result.choice.cls, items: result.items };
  if (resubmitId) {
    await reimb.resubmitRequest(resubmitId, { ...fields, removeReceiptIds: [].concat(req.body.removeReceiptIds || []), files });
    return onSuccess(resubmitId);
  }
  const id = await reimb.createRequest({ ...fields, accountId: req.portalAccount.id });
  await reimb.saveReceipts(id, files);
  onSuccess(id);
}

const TEACHER_FORM = { shell: 'Co-op Teacher Portal', formAction: '/teacher/reimbursements', backHref: '/teacher/reimbursements', backLabel: 'Reimbursements' };

async function ownsRequest(req, request) {
  if (!request) return false;
  const member = await memberForAccount(req.portalAccount.id);
  return (member && request.member_id === member.id) || request.submitted_by_account_id === req.portalAccount.id;
}

// Co-teachers (and assistants) on the same class may VIEW each other's
// submissions for it - the supply-fee money is shared per class - but
// only the owner can ever edit/resubmit.
async function canViewRequest(req, request) {
  if (!request) return false;
  if (await ownsRequest(req, request)) return true;
  const member = await memberForAccount(req.portalAccount.id);
  return !!(member && (await reimb.isStaffOnClass(member.id, request.class_id)));
}

// A real request: "On teacher portal under reimbursement tab there should
// be a list of the teachers classes and total class supply fees, total
// payout, total leftover. When you click on the class you can view all of
// the reimbursement submissions." My Classes = every class this member is
// staffed on (teacher or assistant), money from classFeeSummary.
router.get('/teacher/reimbursements', teacherGate, async (req, res) => {
  const member = await memberForAccount(req.portalAccount.id);
  const requests = await reimb.listRequests({ owner: { memberId: member && member.id, accountId: req.portalAccount.id } });
  const myClasses = await reimb.classFeeRows(await reimb.classIdsForStaffMember(member && member.id));
  const myTotals = reimb.summaryLabels(
    myClasses.reduce((s, c) => s + c.availableCents, 0),
    myClasses.reduce((s, c) => s + c.payoutCents, 0)
  );
  res.render('teacher-reimbursements', { title: 'Reimbursements', requests, myClasses, myTotals, notice: req.query.notice || null, formatTimestamp });
});

router.get('/teacher/reimbursements/classes/:classId', teacherGate, async (req, res) => {
  const classId = parseInt(req.params.classId, 10);
  const member = await memberForAccount(req.portalAccount.id);
  if (!classId || !member || !(await reimb.isStaffOnClass(member.id, classId))) return res.status(404).send('Not found');
  const [cls] = await reimb.classFeeRows([classId]);
  if (!cls) return res.status(404).send('Not found');
  res.render('teacher-reimbursements-class', {
    title: `Reimbursements - ${cls.className}`,
    cls,
    requests: await reimb.requestsForClass(classId),
    formatTimestamp,
  });
});

router.get('/teacher/reimbursements/new', teacherGate, async (req, res) => {
  const member = await memberForAccount(req.portalAccount.id);
  await renderForm(res, { ...TEACHER_FORM, errors: queryErrors(req), values: { memberId: member && member.id } });
});

router.post('/teacher/reimbursements', teacherGate, uploadReceipts('/teacher/reimbursements/new'), async (req, res) => {
  await submit(req, res, {
    ...TEACHER_FORM,
    onSuccess: () => res.redirect('/teacher/reimbursements?notice=' + encodeURIComponent('Your reimbursement form was submitted for approval.')),
  });
});

async function loadOwned(req) {
  const id = parseInt(req.params.id, 10);
  const request = id ? await reimb.getRequest(id) : null;
  return (await ownsRequest(req, request)) ? request : null;
}

router.get('/teacher/reimbursements/:id', teacherGate, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const request = id ? await reimb.getRequest(id) : null;
  if (!(await canViewRequest(req, request))) return res.status(404).send('Not found');
  res.render('reimbursement-detail', {
    title: 'Reimbursement',
    shell: 'Co-op Teacher Portal',
    backHref: '/teacher/reimbursements',
    backLabel: 'Reimbursements',
    settings: await reimb.formSettings(),
    request,
    notice: req.query.notice || null,
    error: null,
    admins: [],
    canEdit: await ownsRequest(req, request),
    formatTimestamp,
    formatDateShort,
  });
});

function resubmitOptions(request) {
  return {
    shell: 'Co-op Teacher Portal',
    formAction: `/teacher/reimbursements/${request.id}/resubmit`,
    backHref: `/teacher/reimbursements/${request.id}`,
    backLabel: 'Back to this form',
    existingReceipts: request.receipts,
    rejection: request.currentRejection,
    submitLabel: 'Resubmit for Reimbursement',
  };
}

// Edit & Resubmit - only while Rejected; a Submitted or Approved form is
// read-only for the teacher.
router.get('/teacher/reimbursements/:id/edit', teacherGate, async (req, res) => {
  const request = await loadOwned(req);
  if (!request) return res.status(404).send('Not found');
  if (request.status !== 'rejected') return res.redirect(`/teacher/reimbursements/${request.id}`);
  await renderForm(res, {
    ...resubmitOptions(request),
    errors: queryErrors(req),
    values: {
      memberId: request.member_id,
      semesterId: request.semester_id,
      day: request.day,
      classId: request.class_id,
      items: request.items.map((it) => ({ description: it.description, date: it.purchase_date || '', amount: (it.amount_cents / 100).toFixed(2) })),
    },
  });
});

router.post(
  '/teacher/reimbursements/:id/resubmit',
  teacherGate,
  uploadReceipts((req) => `/teacher/reimbursements/${parseInt(req.params.id, 10) || 0}/edit`),
  async (req, res) => {
    const request = await loadOwned(req);
    if (!request) return res.status(404).send('Not found');
    if (request.status !== 'rejected') return res.redirect(`/teacher/reimbursements/${request.id}`);
    await submit(req, res, {
      ...resubmitOptions(request),
      resubmitId: request.id,
      onSuccess: (id) => res.redirect(`/teacher/reimbursements/${id}?notice=` + encodeURIComponent('Your reimbursement form was resubmitted for approval.')),
    });
  }
);

// Private receipt proxy - Co-op Admin, or the teacher the reimbursement
// belongs to / who submitted it. Never a public storage URL.
router.get('/reimbursement-receipts/:id', requirePortalAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const receipt = id ? await reimb.getReceipt(id) : null;
  if (!receipt) return res.status(404).send('Not found');
  if (!hasCoopAdminAccess(req)) {
    const request = await reimb.getRequest(receipt.request_id);
    if (!(await canViewRequest(req, request))) return res.status(404).send('Not found');
  }
  const buffer = await reimb.receiptBuffer(receipt);
  if (!buffer) return res.status(404).send('Not found');
  res.set('Content-Type', receipt.mime_type);
  res.set('Cache-Control', 'private, no-store');
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Content-Disposition', `inline; filename="${String(receipt.original_name || 'receipt').replace(/[^\w.\- ]/g, '_')}"`);
  res.send(buffer);
});

// The direct, shareable link to the form. A teacher-portal account goes
// to its Teacher Portal page; anyone else signed in who is staffed on a
// class (or on the Name list) gets the same form in their own portal
// shell.
async function standaloneEligible(req) {
  if (req.portalRoles.some((r) => r.key === 'teacher')) return 'teacher';
  const member = await memberForAccount(req.portalAccount.id);
  if (member && (await reimb.isReimbursementPerson(member.id))) return member;
  return null;
}

router.get('/reimbursement-form', requirePortalAuth, async (req, res) => {
  const who = await standaloneEligible(req);
  if (who === 'teacher') return res.redirect('/teacher/reimbursements/new');
  if (!who) {
    return res.status(403).render('403', { title: 'Not Authorized', message: 'The reimbursement form is for co-op teachers and assistants.', backHref: '/portal', backLabel: 'Back to My Portals' });
  }
  await renderForm(res, {
    shell: res.locals.sharedPortalTitle('Parent Portal'),
    formAction: '/reimbursement-form',
    backHref: null,
    notice: req.query.notice || null,
    errors: queryErrors(req),
    values: { memberId: who.id },
  });
});

router.post('/reimbursement-form', requirePortalAuth, uploadReceipts('/reimbursement-form'), async (req, res) => {
  const who = await standaloneEligible(req);
  if (!who) return res.status(403).send('Not authorized');
  await submit(req, res, {
    shell: res.locals.sharedPortalTitle('Parent Portal'),
    formAction: '/reimbursement-form',
    backHref: null,
    onSuccess: () => res.redirect('/reimbursement-form?notice=' + encodeURIComponent('Thank you! Your reimbursement form was submitted for approval.')),
  });
});

module.exports = router;
module.exports.renderForm = renderForm;
module.exports.submit = submit;
module.exports.uploadReceipts = uploadReceipts;
module.exports.queryErrors = queryErrors;
