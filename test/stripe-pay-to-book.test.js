// A real request: "Event calendar charges are immediate in order to book
// their ticket. Store charges are immediate and added to a cart for final
// purchases." With online payments on, a priced ticket / the store cart is
// held while the family pays on Stripe right away: paid -> booked, backed
// out or ran out of time -> released (seat/stock freed, charge cancelled).
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const testDbPath = path.join(os.tmpdir(), `stripe-hold-test-db-${process.pid}.db`);
process.env.DB_PATH = testDbPath;
process.env.UPLOADS_DIR = path.join(os.tmpdir(), `stripe-hold-test-uploads-${process.pid}`);
process.env.SESSION_SECRET = 'test-secret-not-for-real-use';
process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_fake';

const request = require('supertest');
const app = require('../server');
const db = require('../db');
const { hashPassword } = require('../utils/portalAuth');
const payments = require('../utils/payments');
const onlinePayments = require('../utils/onlinePayments');

test.before(() => app.ready);
test.after(() => fs.rmSync(testDbPath, { force: true }));

const calls = [];
global.fetch = async (url, opts = {}) => {
  calls.push({ url, method: opts.method, body: opts.body || '' });
  const json = (data) => ({ ok: true, status: 200, json: async () => data });
  if (url.endsWith('/checkout/sessions') && opts.method === 'POST') {
    const ref = /client_reference_id=(\d+)/.exec(opts.body)[1];
    return json({ id: `cs_test_${ref}`, url: `https://checkout.stripe.com/c/pay/cs_test_${ref}` });
  }
  if (/\/checkout\/sessions\/cs_test_\d+\/expire$/.test(url)) return json({ id: 'x', status: 'expired' });
  if (/\/checkout\/sessions\/cs_test_/.test(url)) {
    const ref = /cs_test_(\d+)/.exec(url)[1];
    return json({ id: `cs_test_${ref}`, payment_status: 'paid', payment_intent: 'pi_hold', client_reference_id: ref, metadata: { checkout_id: ref } });
  }
  return { ok: false, status: 404, json: async () => ({ error: { message: 'not stubbed' } }) };
};

function signed(payload) {
  const t = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac('sha256', process.env.STRIPE_WEBHOOK_SECRET).update(`${t}.${payload}`).digest('hex');
  return `t=${t},v1=${sig}`;
}
async function webhook(type, checkoutId) {
  const body = JSON.stringify({ type, data: { object: { id: `cs_test_${checkoutId}`, status: type.endsWith('completed') ? 'complete' : 'expired', payment_status: type.endsWith('completed') ? 'paid' : 'unpaid', payment_intent: 'pi_hold', client_reference_id: String(checkoutId), metadata: { checkout_id: String(checkoutId) } } } });
  const res = await request(app).post('/stripe/webhook').set('Content-Type', 'application/json').set('Stripe-Signature', signed(body)).send(body);
  assert.equal(res.status, 200);
}
const csrfOf = (html) => /name="csrf-token" content="([^"]*)"/.exec(html)[1];

async function family() {
  const fam = (await db.prepare("INSERT INTO families (name) VALUES ('Hold') RETURNING id").get()).id;
  const parent = (await db.prepare("INSERT INTO members (name, barcode, member_type, family_id, is_primary_parent, active) VALUES ('Hana Hold', 'HH1', 'parent', ?, 1, 1) RETURNING id").get(fam)).id;
  const kid = (await db.prepare("INSERT INTO members (name, barcode, member_type, family_id, active) VALUES ('Kit Hold', 'KH1', 'student', ?, 1) RETURNING id").get(fam)).id;
  const acct = (await db.prepare("INSERT INTO member_accounts (member_id, email, password_hash, status, approved_at) VALUES (?, 'hold@example.com', ?, 'active', now_text()) RETURNING id").get(parent, hashPassword('testpassword123'))).id;
  await db.prepare("INSERT INTO member_account_roles (member_account_id, role_id) VALUES (?, (SELECT id FROM roles WHERE key = 'parent'))").run(acct);
  const agent = request.agent(app);
  await agent.post('/login').type('form').send({ email: 'hold@example.com', password: 'testpassword123' });
  return { parent, kid, agent };
}

test('a priced event ticket is paid at booking: held, then booked when paid or released when not', async () => {
  await onlinePayments.setEnabled(true);
  const { parent, kid, agent } = await family();
  const eventId = (await db.prepare("INSERT INTO events (title, starts_at, status, price_cents) VALUES ('Zoo Trip', to_char(now() + interval '10 days', 'YYYY-MM-DD HH24:MI:SS'), 'published', 1500) RETURNING id").get()).id;
  const page = await agent.get(`/events/${eventId}`);
  assert.match(page.text, /Continue to Payment/);
  const csrf = csrfOf(page.text);
  const regOf = (m) => db.prepare('SELECT * FROM event_registrations WHERE event_id = ? AND member_id = ? ORDER BY id DESC LIMIT 1').get(eventId, m);

  // Book -> held -> Stripe -> back out: released.
  let res = await agent.post(`/events/${eventId}/register`).set('Accept', 'application/json').type('form').send({ _csrf: csrf, memberId: parent });
  assert.equal(res.body.needsPayment, true);
  let reg = await regOf(parent);
  assert.equal(reg.status, 'confirmed');
  assert.ok((await payments.getCharge(reg.charge_id)).hold_until, 'charge held while paying');
  assert.equal(res.body.payUrl, `/events/${eventId}/checkout`);
  const checkoutPage = await agent.get(`/events/${eventId}/checkout`);
  assert.match(checkoutPage.text, /data-hold-until="\d{4}-/);
  assert.match(checkoutPage.text, /Time left to pay/);
  assert.match(checkoutPage.text, /\$15\.00/);
  const holdMs = Date.parse((await payments.getCharge(reg.charge_id)).hold_until) - Date.now();
  assert.ok(holdMs > 9 * 60 * 1000 && holdMs <= 10 * 60 * 1000, 'a 10 minute hold');
  res = await agent.get(`/events/${eventId}/pay`);
  assert.equal(res.status, 303);
  assert.match(res.headers.location, /^https:\/\/checkout\.stripe\.com\//);
  const body = decodeURIComponent(calls.at(-1).body);
  assert.match(body, /expires_at=\d+/);
  assert.match(body, /success_url=[^&]*\/pay\/return\?session_id=/);
  let checkoutId = /cs_test_(\d+)/.exec(res.headers.location)[1];
  res = await agent.get(`/pay/cancel?checkout=${checkoutId}&next=${encodeURIComponent(`/events/${eventId}`)}`);
  assert.equal(res.headers.location, `/events/${eventId}?payment=cancelled`);
  assert.ok(calls.some((c) => c.url.endsWith(`/checkout/sessions/cs_test_${checkoutId}/expire`)), 'Stripe page closed so it cannot be paid later');
  assert.equal((await regOf(parent)).status, 'cancelled', 'seat released');
  assert.equal((await payments.getCharge(reg.charge_id)).status, 'cancelled');

  // Book again -> pay -> booked.
  await agent.post(`/events/${eventId}/register`).set('Accept', 'application/json').type('form').send({ _csrf: csrf, memberId: parent });
  res = await agent.get(`/events/${eventId}/pay`);
  checkoutId = /cs_test_(\d+)/.exec(res.headers.location)[1];
  await webhook('checkout.session.completed', checkoutId);
  reg = await regOf(parent);
  assert.equal(reg.status, 'confirmed');
  const paid = await payments.getCharge(reg.charge_id);
  assert.equal(paid.status, 'paid');
  assert.equal(paid.hold_until, null);
  res = await agent.get(`/pay/return?session_id=cs_test_${checkoutId}&next=${encodeURIComponent(`/events/${eventId}`)}`);
  assert.equal(res.headers.location, `/events/${eventId}?payment=success`);
  assert.match((await agent.get(res.headers.location)).text, /your ticket is booked/);

  // Book a second ticket but never pay: released once the hold runs out,
  // or when Stripe reports the page expired.
  await agent.post(`/events/${eventId}/register`).set('Accept', 'application/json').type('form').send({ _csrf: csrf, memberId: kid });
  const kidCharge = (await regOf(kid)).charge_id;
  await db.prepare("UPDATE payment_charges SET hold_until = '2000-01-01T00:00:00.000Z' WHERE id = ?").run(kidCharge);
  await agent.get(`/events/${eventId}`);
  assert.equal((await regOf(kid)).status, 'cancelled');
  assert.equal((await regOf(parent)).status, 'confirmed', 'the paid ticket is untouched');

  await agent.post(`/events/${eventId}/register`).set('Accept', 'application/json').type('form').send({ _csrf: csrf, memberId: kid });
  res = await agent.get(`/events/${eventId}/pay`);
  await webhook('checkout.session.expired', /cs_test_(\d+)/.exec(res.headers.location)[1]);
  assert.equal((await regOf(kid)).status, 'cancelled');

  // Online payments off: booked straight away, owed on the account.
  await onlinePayments.setEnabled(false);
  res = await agent.post(`/events/${eventId}/register`).set('Accept', 'application/json').type('form').send({ _csrf: csrf, memberId: kid });
  assert.equal(res.body.ok, true);
  assert.equal(res.body.needsPayment, undefined);
  const k = await regOf(kid);
  assert.equal(k.status, 'confirmed');
  assert.equal((await payments.getCharge(k.charge_id)).hold_until, null);
});
