// Parent Portal > Forms > Teacher Interest Form (utils/teacherInterest.js).
const express = require('express');
const router = express.Router();
const { requirePortalAuth, requirePortal } = require('../middleware/portalAuth');
const { memberForAccount } = require('../utils/portalAuth');
const ti = require('../utils/teacherInterest');

router.use(requirePortalAuth, requirePortal('parent'));

router.get('/', async (req, res) => {
  const member = await memberForAccount(req.portalAccount.id);
  res.render('parent-teacher-interest', {
    title: 'Teacher Interest Form',
    settings: await ti.getSettings(),
    lists: ti.OPTION_LISTS,
    defaultName: member ? member.name : '',
    sent: req.query.sent === '1',
    error: null,
    values: {},
  });
});

router.post('/', async (req, res) => {
  const member = await memberForAccount(req.portalAccount.id);
  const result = await ti.submit({ accountId: req.portalAccount.id, memberId: member ? member.id : null, body: req.body });
  if (!result.ok) {
    return res.status(400).render('parent-teacher-interest', {
      title: 'Teacher Interest Form',
      settings: await ti.getSettings(),
      lists: ti.OPTION_LISTS,
      defaultName: member ? member.name : '',
      sent: false,
      error: result.error,
      values: req.body,
    });
  }
  res.redirect('/parent/teacher-interest?sent=1');
});

module.exports = router;
