// Co-op Admin > Classes > Co-op Withdraw (utils/coopWithdrawal.js): each
// family's request to withdraw from co-op classes, its note and its full
// schedule, with Confirm (takes the family out of everything co-op) and
// Reject.
const express = require('express');
const router = express.Router();
const requireFullAdmin = require('../middleware/requireFullAdmin');
const cw = require('../utils/coopWithdrawal');
const { memberScheduleTables } = require('../utils/schedule');
const { memberForAccount } = require('../utils/portalAuth');

async function adminName(req) {
  if (!req.portalAccount) return null;
  const member = await memberForAccount(req.portalAccount.id);
  return (member && member.name) || req.portalAccount.email;
}

router.get('/coop-withdraw', requireFullAdmin, async (req, res) => {
  const withdrawals = await cw.listWithdrawals();
  const selected = req.query.id ? await cw.getWithdrawal(parseInt(req.query.id, 10)) : null;
  let tables = [];
  if (selected) tables = await memberScheduleTables(await cw.familyMembers(selected.family_id, selected.member_id));
  res.render('admin-coop-withdraw', {
    title: 'Co-op Withdraw',
    withdrawals,
    selected,
    tables,
    notice: req.query.notice || null,
  });
});

router.post('/coop-withdraw/:id/confirm', requireFullAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const removed = await cw.confirmWithdrawal(id, await adminName(req));
  const msg = removed
    ? `Withdrawal confirmed: removed from ${removed.classes.length} class enrollment(s), ${removed.staff.length} teaching/assistant spot(s) and ${removed.lists} floater/setup/cleanup list entr${removed.lists === 1 ? 'y' : 'ies'}.`
    : 'That request was already decided.';
  res.redirect(`/admin/coop-withdraw?id=${id}&notice=` + encodeURIComponent(msg));
});

router.post('/coop-withdraw/:id/reject', requireFullAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  await cw.rejectWithdrawal(id, await adminName(req));
  res.redirect(`/admin/coop-withdraw?id=${id}&notice=` + encodeURIComponent('Withdrawal rejected - nothing was changed.'));
});

module.exports = router;
