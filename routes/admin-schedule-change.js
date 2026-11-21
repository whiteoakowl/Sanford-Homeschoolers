// Co-op Admin > Classes > Schedule Change Requests (utils/scheduleChange.js):
// a family list log of parents' requests, each opening to its cancels and
// additions, approved as a switch with any addition declinable on its own.
const express = require('express');
const router = express.Router();
const requireFullAdmin = require('../middleware/requireFullAdmin');
const sc = require('../utils/scheduleChange');
const { memberForAccount } = require('../utils/portalAuth');

async function adminName(req) {
  if (!req.portalAccount) return null;
  const member = await memberForAccount(req.portalAccount.id);
  return (member && member.name) || req.portalAccount.email;
}

router.get('/schedule-changes', requireFullAdmin, async (req, res) => {
  res.render('admin-schedule-change', {
    title: 'Schedule Change Requests',
    requests: await sc.listRequests(),
    openId: req.query.id ? parseInt(req.query.id, 10) : null,
    notice: req.query.notice || null,
  });
});

// body.decline: the addition item ids to decline (checked boxes).
router.post('/schedule-changes/:id/approve', requireFullAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const declined = (Array.isArray(req.body.decline) ? req.body.decline : req.body.decline != null ? [req.body.decline] : []).map((v) => parseInt(v, 10));
  const result = await sc.approveRequest(id, { declinedItemIds: declined, adminAccountId: req.portalAccount ? req.portalAccount.id : null, decidedBy: await adminName(req) });
  const msg = result ? 'Schedule change approved. Rosters are updated and a name tag reprint was requested.' : 'That request was already decided.';
  res.redirect(`/admin/schedule-changes?id=${id}&notice=` + encodeURIComponent(msg));
});

router.post('/schedule-changes/:id/decline', requireFullAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  await sc.declineRequest(id, await adminName(req));
  res.redirect(`/admin/schedule-changes?id=${id}&notice=` + encodeURIComponent('Schedule change declined - nothing was changed.'));
});

module.exports = router;
