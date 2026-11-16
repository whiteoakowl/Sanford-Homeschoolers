// Co-op Admin > Teachers/Assistants > Teacher Interest Form - the
// submissions log (newest first, Eastern date and time) and its Edit Form
// page. See utils/teacherInterest.js for the request this answers.
const express = require('express');
const router = express.Router();
const requireAdmin = require('../middleware/requireAdmin');
const ti = require('../utils/teacherInterest');
const { toCsvRow, sendCsv } = require('../utils/spreadsheet');

router.get('/teachers/interest-form', requireAdmin, async (req, res) => {
  res.render('admin-teacher-interest', {
    title: 'Teacher Interest Form',
    submissions: await ti.listSubmissions(),
    lists: ti.OPTION_LISTS,
    notice: req.query.notice || null,
  });
});

router.get('/teachers/interest-form/export.csv', requireAdmin, async (req, res) => {
  const subs = await ti.listSubmissions();
  const lines = [toCsvRow(['Submitted', 'Name', ...ti.OPTION_LISTS.map((l) => l.label), 'Class Idea 1', 'Class Idea 2', 'Class Idea 3'])];
  subs.forEach((s) => lines.push(toCsvRow([`${s.dateLabel} ${s.timeLabel}`, s.name, ...ti.OPTION_LISTS.map((l) => s[l.key].join('; ')), s.idea1 || '', s.idea2 || '', s.idea3 || ''])));
  sendCsv(res, 'teacher-interest-submissions.csv', lines);
});

router.post('/teachers/interest-form/:id/delete', requireAdmin, async (req, res) => {
  await ti.deleteSubmission(parseInt(req.params.id, 10));
  res.redirect('/admin/teachers/interest-form?notice=' + encodeURIComponent('Submission deleted.'));
});

router.get('/teachers/interest-form/edit', requireAdmin, async (req, res) => {
  res.render('admin-teacher-interest-edit', {
    title: 'Edit Teacher Interest Form',
    settings: await ti.getSettings(),
    lists: ti.OPTION_LISTS,
    notice: req.query.notice || null,
    error: req.query.error || null,
  });
});

router.post('/teachers/interest-form/edit', requireAdmin, async (req, res) => {
  await ti.saveTitle(req.body);
  res.redirect('/admin/teachers/interest-form/edit?notice=' + encodeURIComponent('Form saved.'));
});

router.post('/teachers/interest-form/options/add', requireAdmin, async (req, res) => {
  const added = await ti.addOption(req.body.list, req.body.value);
  const back = `/admin/teachers/interest-form/edit#list-${encodeURIComponent(req.body.list || '')}`;
  res.redirect(added ? back : `/admin/teachers/interest-form/edit?error=${encodeURIComponent('Enter a new option that is not already on the list.')}#list-${encodeURIComponent(req.body.list || '')}`);
});

router.post('/teachers/interest-form/options/remove', requireAdmin, async (req, res) => {
  await ti.removeOption(req.body.list, req.body.value);
  res.redirect(`/admin/teachers/interest-form/edit#list-${encodeURIComponent(req.body.list || '')}`);
});

module.exports = router;
