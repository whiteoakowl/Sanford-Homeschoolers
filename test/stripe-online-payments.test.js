// A real request: "Build the connection" (Stripe), "Members will pay the
// card fees", and "Admin must approve all refunds, even if the system
// automated a refund." Stripe itself is stubbed (global fetch) - no keys,
// no network, no money.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const testDbPath = path.join(os.tmpdir(), `stripe-test-db-${process.pid}.db`);
process.env.DB_PATH = testDbPath;
process.env.UPLOADS_DIR = path.join(os.tmpdir(), `stripe-test-uploads-${process.pid}`);
process.env.SESSION_SECRET = 'test-secret-not-for-real-use';
process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_fake';
delete process.env.STRIPE_FEE_PERCENT;
delete process.env.STRIPE_FEE_FIXED_CENTS;

const request = require('supertest');
const app = require('../server');
const db = require('../db');
const { hashPassword } = require('../utils/portalAuth');
const payments = require('../utils/payments');
const { cardFeeCents, encodeForm } = require('../utils/stripe');

test.before(() => app.ready);
test.after(() => fs.rmSync(testDbPath, { force: true }));

// Stand-in Stripe: remembers every call, answers like the real API.
const calls = [];
let sessionPaid = false;
global.fetch = async (url, opts = {}) => {
  calls.push({ url, method: opts.method, body: opts.body || '' });
  const json = (data) => ({ ok: true, status: 200, json: async () => data });
  if (url.endsWith('/checkout/sessions') && opts.method === 'POST') {
    const ref = /client_reference_id=(\d+)/.exec(opts.body)[1];
    return json({ id: `cs_test_${ref}`, url: `https://checkout.stripe.com/c/pay/cs_test_${ref}` });
  }
  if (/\/checkout\/sessions\/cs_test_/.test(url)) {
    const ref = /cs_test_(\d+)/.exec(url)[1];
    return json({ id: `cs_test_${ref}`, payment_status: sessionPaid ? 'paid' : 'unpaid', payment_intent: 'pi_test_1', client_reference_id: ref, metadata: { checkout_id: ref } });
  }
  if (url.endsWith('/refunds')) return json({ id: 're_test_1', status: 'succeeded' });
  return { ok: false, status: 404, json: async () => ({ error: { message: 'not stubbed' } }) };
};

function signed(payload) {
  const t = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac('sha256', process.env.STRIPE_WEBHOOK_SECRET).update(`${t}.${payload}`).digest('hex');
  return `t=${t},v1=${sig}`;
}

const csrfOf = (html) => /name="csrf-token" content="([^"]*)"/.exec(html)[1];

test('the card fee is grossed up so the co-op still receives the full amount', () => {
  for (const cents of [100, 2500, 15000]) {
    const fee = cardFeeCents(cents);
    const total = cents + fee;
    const stripeTakes = Math.round(total * 0.029) + 30;
    assert.ok(total - stripeTakes >= cents, `${cents}: co-op nets at least the charge`);
    assert.ok(total - stripeTakes - cents <= 2, `${cents}: and not much more`);
  }
  assert.equal(encodeForm({ a: [{ b: { c: 1 } }] }), 'a%5B0%5D%5Bb%5D%5Bc%5D=1');
});

test('Pay Online -> Stripe Checkout -> webhook marks the charges paid once; refunds need admin approval', async () => {
  const fam = (await db.prepare("INSERT INTO families (name) VALUES ('Payer') RETURNING id").get()).id;
  const parent = (await db.prepare("INSERT INTO members (name, barcode, member_type, family_id, is_primary_parent, active) VALUES ('Pat Payer', 'PP', 'parent', ?, 1, 1) RETURNING id").get(fam)).id;
  const acct = (await db.prepare("INSERT INTO member_accounts (member_id, email, password_hash, status, approved_at) VALUES (?, 'payer@example.com', ?, 'active', now_text()) RETURNING id").get(parent, hashPassword('testpassword123'))).id;
  await db.prepare("INSERT INTO member_account_roles (member_account_id, role_id) VALUES (?, (SELECT id FROM roles WHERE key = 'parent'))").run(acct);
  const c1 = await payments.createCharge(parent, acct, 'manual', null, 'Fall Pottery', 2500);
  const c2 = await payments.createCharge(parent, acct, 'manual', null, 'Field Trip', 1000);

  const fam1 = request.agent(app);
  await fam1.post('/login').type('form').send({ email: 'payer@example.com', password: 'testpassword123', next: '/accounting' });
  const page = await fam1.get('/accounting');
  assert.match(page.text, /Pay Online/);
  assert.match(page.text, new RegExp(`name="chargeIds" value="${c1}" data-cents="2500"`));
  assert.match(page.text, new RegExp(`name="chargeIds" value="${c2}" data-cents="1000"`));

  const pay = await fam1.post('/accounting/pay').type('form').send({ _csrf: csrfOf(page.text), chargeIds: [String(c1), String(c2)] });
  assert.equal(pay.status, 303);
  assert.match(pay.headers.location, /^https:\/\/checkout\.stripe\.com\//);
  const create = calls.find((c) => c.url.endsWith('/checkout/sessions'));
  const body = decodeURIComponent(create.body);
  assert.match(body, /line_items\[0\]\[price_data\]\[unit_amount\]=2500/);
  assert.match(body, /line_items\[1\]\[price_data\]\[unit_amount\]=1000/);
  assert.match(body, new RegExp(`line_items\\[2\\]\\[price_data\\]\\[unit_amount\\]=${cardFeeCents(3500)}`));
  assert.match(body, /Card processing fee/);
  assert.equal(await payments.amountPaidForCharge(c1), 0, 'nothing recorded before Stripe confirms');

  const checkoutId = /cs_test_(\d+)/.exec(pay.headers.location)[1];
  const event = JSON.stringify({ type: 'checkout.session.completed', data: { object: { id: `cs_test_${checkoutId}`, payment_status: 'paid', payment_intent: 'pi_test_1', client_reference_id: checkoutId, metadata: { checkout_id: checkoutId } } } });
  const bad = await request(app).post('/stripe/webhook').set('Content-Type', 'application/json').set('Stripe-Signature', 't=1,v1=forged').send(event);
  assert.equal(bad.status, 400, 'a forged webhook is rejected');
  assert.equal(await payments.amountPaidForCharge(c1), 0);
  for (let i = 0; i < 2; i++) {
    const ok = await request(app).post('/stripe/webhook').set('Content-Type', 'application/json').set('Stripe-Signature', signed(event)).send(event);
    assert.equal(ok.status, 200);
  }
  sessionPaid = true;
  const back = await fam1.get(`/accounting/pay/return?session_id=cs_test_${checkoutId}`);
  assert.equal(back.headers.location, '/accounting?payment=success');
  assert.equal(await payments.amountPaidForCharge(c1), 2500, 'recorded once despite two webhooks and the return page');
  assert.equal(await payments.amountPaidForCharge(c2), 1000);
  assert.equal((await payments.getCharge(c1)).status, 'paid');
  const row = await db.prepare("SELECT method, stripe_payment_intent FROM payment_payments WHERE charge_id = ?").get(c1);
  assert.deepEqual({ ...row }, { method: 'stripe', stripe_payment_intent: 'pi_test_1' });

  // Admin Refund to Card needs its confirm box, then goes through Stripe.
  const admin = request.agent(app);
  await admin.post('/login').type('form').send({ email: 'mainadmin@coop.local', password: 'changeme123' });
  const acctPage = await admin.get(`/main-admin/accounting/members/${parent}`);
  assert.match(acctPage.text, /Refund to Card<\/button>/);
  const unconfirmed = await admin.post(`/main-admin/accounting/charges/${c2}/card-refund`).type('form').send({ _csrf: csrfOf(acctPage.text), amount: '10.00' });
  assert.match(decodeURIComponent(unconfirmed.headers.location), /confirm the refund/);
  assert.equal(calls.filter((c) => c.url.endsWith('/refunds')).length, 0);
  await admin.post(`/main-admin/accounting/charges/${c2}/card-refund`).type('form').send({ _csrf: csrfOf(acctPage.text), amount: '10.00', confirmRefund: '1' });
  assert.equal(calls.filter((c) => c.url.endsWith('/refunds')).length, 1);
  assert.equal((await payments.getCharge(c2)).status, 'refunded');

  // A system (automatic) refund waits for approval, then goes to the card.
  const { requestRefund } = require('../utils/refundRequests');
  const rid = await requestRefund({ chargeId: c1, amountCents: 2500, reason: 'Class registration removed.' });
  assert.equal(await payments.amountPaidForCharge(c1), 2500, 'still paid while waiting');
  const pendingPage = await admin.get('/main-admin/accounting/refunds');
  assert.match(pendingPage.text, /Class registration removed\./);
  assert.match(pendingPage.text, /name="toCard" value="1" checked/);
  await admin.post(`/main-admin/accounting/refunds/${rid}/approve`).type('form').send({ _csrf: csrfOf(pendingPage.text), toCard: '1' });
  assert.equal(calls.filter((c) => c.url.endsWith('/refunds')).length, 2);
  assert.equal((await payments.getCharge(c1)).status, 'refunded');
  assert.equal((await db.prepare('SELECT status FROM refund_requests WHERE id = ?').get(rid)).status, 'approved');
});

test('a manual refund entered by an admin needs its confirm box', async () => {
  const m = (await db.prepare("INSERT INTO members (name, barcode, member_type, active) VALUES ('Manual Refund', 'MR', 'parent', 1) RETURNING id").get()).id;
  const c = await payments.createCharge(m, null, 'manual', null, 'Dues', 5000);
  await payments.recordPayment(c, 5000, 'manual', null, 'Check', null);
  const admin = request.agent(app);
  await admin.post('/login').type('form').send({ email: 'mainadmin@coop.local', password: 'changeme123' });
  const page = await admin.get(`/main-admin/accounting/members/${m}`);
  const no = await admin.post(`/main-admin/accounting/charges/${c}/payments`).type('form').send({ _csrf: csrfOf(page.text), direction: 'refund', adjustmentType: 'refund', amount: '50' });
  assert.match(decodeURIComponent(no.headers.location), /confirm the refund/);
  assert.equal(await payments.amountPaidForCharge(c), 5000);
  await admin.post(`/main-admin/accounting/charges/${c}/payments`).type('form').send({ _csrf: csrfOf(page.text), direction: 'refund', adjustmentType: 'refund', amount: '50', confirmRefund: '1' });
  assert.equal(await payments.amountPaidForCharge(c), 0);
});
