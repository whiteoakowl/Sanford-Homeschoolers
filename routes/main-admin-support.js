// Main Admin > Support - a real request: "Main admin portal add a
// support tab with Website feedback subpage and [Support] subpage. Both
// pages have a create form button, allows you to add different fields
// like jotform. Then a log of entries on each page... On those logs
// there should be a complete button to mark them done." Mounted at
// /main-admin/support (server.js). Entries come from Parent Portal's own
// contact form (routes/parent-support.js); "Create Form" opens the
// regular Custom Forms builder on that type's own hidden backing form
// (utils/supportRequests.js).
const express = require('express');
const router = express.Router();
const { requirePortalAuth, requirePortal, requirePortalPermission } = require('../middleware/portalAuth');
const { formatFriendlyTimestamp } = require('../utils/dates');
const customForms = require('../utils/customForms');
const { sendFormFile } = require('../utils/customFormAnswers');
const supportRequests = require('../utils/supportRequests');

router.use(requirePortalAuth, requirePortal('main_admin'));

// Website Feedback is the tab's own first subpage, so it shares the
// tab's top-level key (same convention as Members/Accounting).
const PERMISSION_BY_TYPE = { feedback: 'manage_support', support: 'view_support_requests' };
const STATUS_FILTERS = ['all', 'open', 'completed'];

function requireTypePermission(req, res, next) {
  const type = supportRequests.typeByKey(req.params.type);
  if (!type) return res.status(404).render('404', { title: 'Not Found' });
  req.supportType = type;
  return requirePortalPermission(PERMISSION_BY_TYPE[type.key])(req, res, next);
}

async function renderLog(req, res, typeKey) {
  const type = supportRequests.typeByKey(typeKey);
  const status = STATUS_FILTERS.includes(req.query.status) ? req.query.status : 'all';
  const entries = await supportRequests.listRequests(type.key, status);
  for (const e of entries) {
    e.submittedLabel = formatFriendlyTimestamp(e.submitted_at);
    e.completedLabel = e.completed_at ? formatFriendlyTimestamp(e.completed_at) : null;
  }
  const form = await supportRequests.formForType(type.key);
  const extraFieldCount = form ? (await customForms.fieldsForForm(form.id)).filter((f) => !customForms.DISPLAY_ONLY_TYPES.has(f.field_type)).length : 0;
  res.render('main-admin-support', {
    title: type.label,
    type,
    entries,
    status,
    form,
    extraFieldCount,
    customForms,
    notice: req.query.notice || null,
  });
}

router.get('/', requirePortalPermission('manage_support'), (req, res) => renderLog(req, res, 'feedback'));
router.get('/requests', requirePortalPermission('view_support_requests'), (req, res) => renderLog(req, res, 'support'));

// "Create Form" - makes the type's backing Custom Form on first use, then
// always lands in the existing builder (which links back here).
router.post('/:type/form', requireTypePermission, requirePortalPermission('manage_forms'), async (req, res) => {
  const formId = await supportRequests.ensureFormForType(req.supportType.key, req.portalAccount.id);
  res.redirect(`/main-admin/forms/${formId}/builder`);
});

function backHref(type, req) {
  const status = STATUS_FILTERS.includes(req.body.status) && req.body.status !== 'all' ? `status=${req.body.status}&` : '';
  return `${type.adminHref}?${status}`;
}

router.post('/:type/:id/complete', requireTypePermission, async (req, res) => {
  await supportRequests.setCompleted(req.params.id, req.supportType.key, req.portalAccount.id, true);
  res.redirect(backHref(req.supportType, req) + 'notice=' + encodeURIComponent('Marked complete.'));
});

router.post('/:type/:id/reopen', requireTypePermission, async (req, res) => {
  await supportRequests.setCompleted(req.params.id, req.supportType.key, req.portalAccount.id, false);
  res.redirect(backHref(req.supportType, req) + 'notice=' + encodeURIComponent('Reopened.'));
});

// An admin-added File Upload field's own attachment - same private
// custom-form-files storage routes/custom-forms.js serves from.
router.get('/:type/:id/files/:fieldId', requireTypePermission, async (req, res) => {
  const entry = await supportRequests.getRequest(req.params.id);
  const answer = entry && entry.request_type === req.supportType.key ? entry.extraAnswers.find((a) => String(a.fieldId) === req.params.fieldId && a.fieldType === 'file') : null;
  if (!answer || !answer.valueText) return res.status(404).render('404', { title: 'Not Found' });
  if (!(await sendFormFile(res, answer.valueText))) return res.status(404).render('404', { title: 'Not Found' });
});

module.exports = router;
