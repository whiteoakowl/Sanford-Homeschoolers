// Found checking against Stripe's real test API: closing a Checkout that
// Stripe already expired on its own returns a 400. Releasing a held
// ticket/order must still go ahead then (and keep it if it was paid).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const testDbPath = path.join(os.tmpdir(), `stripe-expired-test-db-${process.pid}.db`);
process.env.DB_PATH = testDbPath;
process.env.UPLOADS_DIR = path.join(os.tmpdir(), `stripe-expired-test-uploads-${process.pid}`);
process.env.SESSION_SECRET = 'test-secret-not-for-real-use';
process.env.STRIPE_SECRET_KEY = 'sk_test_fake';

const app = require('../server');
const db = require('../db');
const payments = require('../utils/payments');
const onlinePayments = require('../utils/onlinePayments');

test.before(() => app.ready);
test.after(() => fs.rmSync(testDbPath, { force: true }));

let sessionState = 'expired';
global.fetch = async (url, opts = {}) => {
  const json = (status, data) => ({ ok: status < 300, status, json: async () => data });
  if (url.endsWith('/checkout/sessions') && opts.method === 'POST') {
    const ref = /client_reference_id=(\d+)/.exec(opts.body)[1];
    return json(200, { id: `cs_test_${ref}`, url: 'https://checkout.stripe.com/x' });
  }
  if (url.endsWith('/expire')) return json(400, { error: { message: 'Only Checkout Sessions with a status in ["open"] can be expired.' } });
  const ref = /cs_test_(\d+)/.exec(url)[1];
  return json(200, { id: `cs_test_${ref}`, status: sessionState, payment_status: sessionState === 'complete' ? 'paid' : 'unpaid', payment_intent: 'pi_x', client_reference_id: ref, metadata: { checkout_id: ref } });
};

async function heldCharge() {
  const fam = (await db.prepare("INSERT INTO families (name) VALUES (?) RETURNING id").get('X' + Math.random())).id;
  const m = (await db.prepare("INSERT INTO members (name, barcode, member_type, family_id, is_primary_parent, active) VALUES ('Xa', ?, 'parent', ?, 1, 1) RETURNING id").get(`X${fam}`, fam)).id;
  const charge = await payments.createCharge(m, null, 'manual', null, 'Held thing', 1000);
  await onlinePayments.holdCharges([charge]);
  await onlinePayments.startCheckout({ memberId: m, chargeIds: [charge], baseUrl: 'http://x', held: true });
  await db.prepare("UPDATE payment_charges SET hold_until = '2000-01-01T00:00:00.000Z' WHERE id = ?").run(charge);
  return charge;
}

test('a hold is still released when Stripe already expired the page, and kept when it was paid', async () => {
  await onlinePayments.setEnabled(true);
  const a = await heldCharge();
  sessionState = 'expired';
  await onlinePayments.releaseExpiredHolds();
  assert.equal((await payments.getCharge(a)).status, 'cancelled');

  const b = await heldCharge();
  sessionState = 'complete';
  await onlinePayments.releaseExpiredHolds();
  const paid = await payments.getCharge(b);
  assert.equal(paid.status, 'paid', 'paid on Stripe - recorded, not released');
  assert.equal(paid.hold_until, null);
});
