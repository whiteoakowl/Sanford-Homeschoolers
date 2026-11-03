// Parent Portal's Website Feedback & Support contact form - a real
// request: "The button on the parent portal website is a contact form.
// Dropdown menu to choose feedback or support. Subject, message. Submit,
// cancel. Those entries go onto the different logs." Mounted at
// /parent/support (server.js); logged on Main Admin > Support (routes/
// main-admin-support.js). A full page rather than a dialog - this co-op
// has asked for real pages over popups.
const express = require('express');
const router = express.Router();
const multer = require('multer');
const { requirePortalAuth, requirePortal } = require('../middleware/portalAuth');
const { memberForAccount } = require('../utils/portalAuth');
const { lessonAttachmentFileFilter } = require('../utils/uploads');
const customForms = require('../utils/customForms');
const { collectAnswers } = require('../utils/customFormAnswers');
const supportRequests = require('../utils/supportRequests');

router.use(requirePortalAuth, requirePortal('parent'));

// Same limits as routes/custom-forms.js - an admin-added File Upload
// field on this form behaves exactly like one on any Custom Form.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 }, fileFilter: lessonAttachmentFileFilter });

// Rendered directly (not a redirect) on a validation error too, so a
// parent's typed message is never lost to a round trip.
async function renderForm(res, { typeKey, subject, message, error }) {
  const types = [];
  for (const type of supportRequests.REQUEST_TYPES) {
    types.push({ ...type, pages: await supportRequests.extraPagesForType(type.key) });
  }
  res.status(error ? 400 : 200).render('parent-support', {
    title: 'Website Feedback and Support',
    types,
    selectedType: supportRequests.typeByKey(typeKey) ? typeKey : 'feedback',
    subject: subject || '',
    message: message || '',
    ratingMax: customForms.RATING_MAX,
    spinnerRange: customForms.SPINNER_RANGE,
    customFormImageUrl: customForms.customFormImageUrl,
    error: error || null,
  });
}

router.get('/', async (req, res) => {
  await renderForm(res, { typeKey: req.query.type });
});

router.post('/', upload.any(), async (req, res) => {
  const type = supportRequests.typeByKey(req.body.requestType);
  const subject = (req.body.subject || '').trim();
  const message = (req.body.message || '').trim();
  const back = (error) => renderForm(res, { typeKey: req.body.requestType, subject, message, error });
  if (!type) return back('Choose Feedback or Support.');
  if (!subject) return back('Subject is required.');
  if (!message) return back('Message is required.');

  // Only the selected type's own extra fields are read - the other
  // type's sit in a disabled <fieldset> on the page and never post.
  const pages = await supportRequests.extraPagesForType(type.key);
  const result = await collectAnswers(pages, req.body, req.files);
  if (result.error) return back(result.error);

  const member = await memberForAccount(req.portalAccount.id);
  await supportRequests.createRequest({
    typeKey: type.key,
    subject,
    message,
    memberId: member ? member.id : null,
    accountId: req.portalAccount.id,
    extraAnswers: supportRequests.snapshotAnswers(pages, result.answers),
  });
  res.redirect('/parent?notice=' + encodeURIComponent(`Thanks! Your ${type.key === 'feedback' ? 'feedback' : 'support request'} was sent.`));
});

module.exports = router;
