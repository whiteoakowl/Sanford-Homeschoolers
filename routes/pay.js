// Where Stripe sends a family back after paying for a held ticket or
// store cart (a real request: "Event calendar charges are immediate in
// order to book their ticket. Store charges are immediate and added to a
// cart for final purchases."). Mounted at /pay (server.js), signed-in
// accounts only - kept apart from /accounting so a family member who
// can book an event or shop but can't open Accounting still gets back.
const express = require('express');
const router = express.Router();
const { requirePortalAuth } = require('../middleware/portalAuth');
const { familyForAccount } = require('../utils/portalAuth');
const onlinePayments = require('../utils/onlinePayments');

router.use(requirePortalAuth);

// Only ever a local event/store path on this site - never an open redirect.
function safeNext(value) {
  const v = String(value || '');
  return /^\/(events|store)(\/|\?|$)/.test(v) && !v.startsWith('//') ? v : '/portal';
}

function withParam(path, key, value) {
  return path + (path.includes('?') ? '&' : '?') + key + '=' + encodeURIComponent(value);
}

router.get('/return', async (req, res) => {
  const next = safeNext(req.query.next);
  let outcome = 'processing';
  try {
    const result = await onlinePayments.completeBySessionId(String(req.query.session_id || ''));
    if (result.recorded || result.reason === 'already_recorded') outcome = 'success';
  } catch (err) {
    console.error('Stripe return check failed:', err.message);
  }
  res.redirect(withParam(next, 'payment', outcome));
});

// Backed out on Stripe's page: release the held ticket/order.
router.get('/cancel', async (req, res) => {
  const next = safeNext(req.query.next);
  const family = await familyForAccount(req.portalAccount.id);
  const result = await onlinePayments.cancelHeldCheckout(parseInt(req.query.checkout, 10), family.map((m) => m.id));
  res.redirect(withParam(next, 'payment', result.paid ? 'success' : 'cancelled'));
});

module.exports = router;
