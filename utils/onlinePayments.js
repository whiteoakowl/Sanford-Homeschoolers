// Online payments - Pay Now on the parent Accounting page through Stripe
// Checkout (utils/stripe.js). A family picks open charges, pays them in
// full plus the card fee (a real request: "Members will pay the card
// fees"), and when Stripe confirms the payment each charge gets a
// method 'stripe' payment row through utils/payments.js's recordPayment,
// so its status, balance and receipts update exactly like a payment an
// admin records. Refunds to the card go back through Stripe the same way.
const db = require('../db');
const stripe = require('./stripe');
const payments = require('./payments');
const { appSetting, setAppSetting } = require('./appSettings');

const ENABLED_KEY = 'online_payments_enabled';

// On by default once Stripe keys are set; Main Admin can switch it off.
async function isEnabled() {
  if (!stripe.isConfigured()) return false;
  return (await appSetting(ENABLED_KEY, '1')) !== '0';
}

async function setEnabled(on) {
  await setAppSetting(ENABLED_KEY, on ? '1' : '0');
}

// What's still owed on a charge (discounts/credits lower it, payments and
// refunds move cash) - 0 for anything paid, cancelled or refunded.
async function amountOwed(charge) {
  if (!charge || !['pending', 'partially_refunded'].includes(charge.status)) return 0;
  const owed = (await payments.effectiveChargeAmount(charge)) - (await payments.netCashForCharge(charge.id));
  return Math.max(0, owed);
}

async function payableCharges(memberId) {
  const rows = await db.prepare("SELECT * FROM payment_charges WHERE member_id = ? AND status IN ('pending', 'partially_refunded') ORDER BY created_at, id").all(memberId);
  const out = [];
  for (const c of rows) {
    const owed = await amountOwed(c);
    if (owed > 0) out.push({ ...c, owedCents: owed });
  }
  return out;
}

// Starts a Stripe Checkout for the chosen charges (only this member's
// own, each for exactly what's still owed). Returns { url } to send the
// family to, or { error }.
async function startCheckout({ memberId, accountId, chargeIds, email, baseUrl }) {
  if (!(await isEnabled())) return { error: 'Online payments are not turned on.' };
  const wanted = new Set((Array.isArray(chargeIds) ? chargeIds : [chargeIds]).map(Number).filter(Boolean));
  const charges = (await payableCharges(memberId)).filter((c) => wanted.has(c.id));
  if (!charges.length) return { error: 'Choose at least one charge to pay.' };
  const amount = charges.reduce((s, c) => s + c.owedCents, 0);
  const fee = stripe.cardFeeCents(amount);
  const lineItems = charges.map((c) => ({ quantity: 1, price_data: { currency: 'usd', unit_amount: c.owedCents, product_data: { name: c.description } } }));
  if (fee > 0) lineItems.push({ quantity: 1, price_data: { currency: 'usd', unit_amount: fee, product_data: { name: 'Card processing fee' } } });
  const row = await db
    .prepare('INSERT INTO stripe_checkouts (account_id, member_id, charges_json, amount_cents, fee_cents) VALUES (?, ?, ?, ?, ?) RETURNING id')
    .get(accountId || null, memberId, JSON.stringify(charges.map((c) => ({ id: c.id, cents: c.owedCents }))), amount, fee);
  const session = await stripe.createCheckoutSession(
    {
      mode: 'payment',
      line_items: lineItems,
      customer_email: email || undefined,
      client_reference_id: String(row.id),
      metadata: { checkout_id: String(row.id), member_id: String(memberId) },
      payment_intent_data: { metadata: { checkout_id: String(row.id) } },
      success_url: `${baseUrl}/accounting/pay/return?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/accounting?payment=cancelled`,
    },
    `checkout-${row.id}`
  );
  await db.prepare('UPDATE stripe_checkouts SET session_id = ? WHERE id = ?').run(session.id, row.id);
  return { url: session.url, checkoutId: row.id };
}

// Records a paid Checkout exactly once: the first caller to flip its row
// from 'pending' to 'completed' records a 'stripe' payment for each
// charge it covered. Safe to call from both the webhook and the return
// page, in either order, any number of times.
async function completeCheckoutSession(session) {
  if (!session || session.payment_status !== 'paid') return { recorded: false, reason: 'not_paid' };
  const checkoutId = parseInt((session.metadata && session.metadata.checkout_id) || session.client_reference_id, 10);
  const claimed = await db
    .prepare("UPDATE stripe_checkouts SET status = 'completed', completed_at = now_text(), payment_intent = ?, session_id = COALESCE(session_id, ?) WHERE id = ? AND status = 'pending' RETURNING *")
    .get(session.payment_intent || null, session.id, checkoutId);
  if (!claimed) return { recorded: false, reason: 'already_recorded' };
  const items = JSON.parse(claimed.charges_json);
  for (const it of items) {
    await payments.recordPayment(it.id, it.cents, 'stripe', claimed.account_id, `Paid online by card (Stripe)${claimed.fee_cents ? ` - card fee ${payments.formatCents(claimed.fee_cents)} paid by family` : ''}`, null);
    if (session.payment_intent) {
      await db
        .prepare("UPDATE payment_payments SET stripe_payment_intent = ? WHERE id = (SELECT MAX(id) FROM payment_payments WHERE charge_id = ? AND method = 'stripe')")
        .run(session.payment_intent, it.id);
    }
  }
  return { recorded: true, chargeIds: items.map((i) => i.id), amountCents: claimed.amount_cents };
}

async function completeBySessionId(sessionId) {
  const session = await stripe.retrieveCheckoutSession(sessionId);
  return completeCheckoutSession(session);
}

// Card payments on a charge that can still be refunded: what was paid
// through Stripe minus any card refunds already made.
async function refundableToCard(chargeId) {
  const paid = await db
    .prepare("SELECT stripe_payment_intent AS pi, SUM(amount_cents) AS cents FROM payment_payments WHERE charge_id = ? AND method = 'stripe' AND stripe_payment_intent IS NOT NULL GROUP BY stripe_payment_intent")
    .all(chargeId);
  return paid.map((p) => ({ paymentIntent: p.pi, cents: Number(p.cents) })).filter((p) => p.cents > 0);
}

// Refunds up to amountCents back to the card(s) this charge was paid
// with, then records the refund (method 'stripe', a negative row) so the
// charge's status and the family's balance update. The card fee isn't
// refunded - it went to Stripe.
async function refundToCard({ chargeId, amountCents, adminAccountId, note }) {
  const sources = await refundableToCard(chargeId);
  const available = sources.reduce((s, p) => s + p.cents, 0);
  if (!sources.length) return { error: 'This charge has no card payment to refund.' };
  if (!(amountCents > 0) || amountCents > available) return { error: `You can refund up to ${payments.formatCents(available)} to the card.` };
  let left = amountCents;
  for (const src of sources) {
    if (left <= 0) break;
    const part = Math.min(left, src.cents);
    const refund = await stripe.createRefund({ paymentIntent: src.paymentIntent, amountCents: part, reason: note || 'Co-op refund' }, `refund-${chargeId}-${src.paymentIntent}-${part}-${Date.now()}`);
    await db
      .prepare("INSERT INTO payment_payments (charge_id, amount_cents, method, recorded_by_account_id, note, adjustment_type, stripe_payment_intent) VALUES (?, ?, 'stripe', ?, ?, 'refund', ?)")
      .run(chargeId, -part, adminAccountId || null, `Refunded to card (Stripe ${refund.id})${note ? ' - ' + note : ''}`, src.paymentIntent);
    left -= part;
  }
  await payments.recalculateStatus(chargeId);
  return { ok: true };
}

module.exports = {
  isEnabled,
  setEnabled,
  amountOwed,
  payableCharges,
  startCheckout,
  completeCheckoutSession,
  completeBySessionId,
  refundableToCard,
  refundToCard,
};
