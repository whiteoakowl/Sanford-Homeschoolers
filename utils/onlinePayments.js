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
  return (await appSetting(ENABLED_KEY, '0')) === '1';
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
// successPath/cancelPath (optional) send the family back somewhere other
// than Accounting - an event page or the store. held: true (booking a
// ticket / checking out the cart) makes the Stripe page expire after
// HOLD_CHECKOUT_MINUTES, so it can never be paid after the hold is gone.
async function startCheckout({ memberId, accountId, chargeIds, email, baseUrl, successPath, cancelPath, held }) {
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
      success_url: successPath
        ? `${baseUrl}/pay/return?session_id={CHECKOUT_SESSION_ID}&next=${encodeURIComponent(successPath)}`
        : `${baseUrl}/accounting/pay/return?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: cancelPath ? `${baseUrl}/pay/cancel?checkout=${row.id}&next=${encodeURIComponent(cancelPath)}` : `${baseUrl}/accounting?payment=cancelled`,
      expires_at: held ? Math.floor(Date.now() / 1000) + HOLD_CHECKOUT_MINUTES * 60 : undefined,
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
  if (session && session.status === 'complete' && session.payment_status === 'unpaid') {
    // A bank payment still clearing: keep any held ticket/order booked
    // while it does (async_payment_succeeded records it; _failed releases).
    const pendingRow = await db.prepare('SELECT charges_json FROM stripe_checkouts WHERE session_id = ?').get(session.id);
    if (pendingRow) {
      const until = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();
      for (const it of JSON.parse(pendingRow.charges_json)) {
        await db.prepare('UPDATE payment_charges SET hold_until = ? WHERE id = ? AND hold_until IS NOT NULL').run(until, it.id);
      }
    }
  }
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
  await clearHolds(items.map((i) => i.id));
  return { recorded: true, chargeIds: items.map((i) => i.id), amountCents: claimed.amount_cents };
}

// --- Pay-to-book holds (a real request: "Event calendar charges are
// immediate in order to book their ticket. Store charges are immediate
// and added to a cart for final purchases.") A ticket or store order
// that needs paying is created right away (so the seat/stock is
// reserved) with its charge held until hold_until. Paying clears the
// hold; backing out of Stripe's page, or the hold running out, releases
// it - the registration is cancelled (seat freed, waitlist moves up) or
// the order cancelled (stock put back), and the unpaid charge cancelled.
// Stripe's own page closes after HOLD_CHECKOUT_MINUTES (its minimum is
// 30), always before the hold itself runs out, so a released hold can
// never be paid afterwards.
// A real request: "There should be a 10 minute countdown timer for events
// and shop purchase on the checkout. If they don't pay by the end of the
// timer their tickets are available again and their cart is cleared."
// Stripe won't close its own page sooner than 30 minutes, so releasing a
// hold always closes the Stripe page first (closeOpenCheckoutsFor) - a
// released ticket/order can never be paid afterwards.
const HOLD_CHECKOUT_MINUTES = 31;
const HOLD_MINUTES = 10;

function nowIso() {
  return new Date().toISOString();
}

async function holdCharges(chargeIds) {
  const ids = [...new Set((chargeIds || []).map(Number).filter(Boolean))];
  if (!ids.length) return;
  const until = new Date(Date.now() + HOLD_MINUTES * 60 * 1000).toISOString();
  await db.prepare(`UPDATE payment_charges SET hold_until = ? WHERE status = 'pending' AND id IN (${ids.map(() => '?').join(',')})`).run(until, ...ids);
}

async function clearHolds(chargeIds) {
  const ids = [...new Set((chargeIds || []).map(Number).filter(Boolean))];
  if (!ids.length) return;
  await db.prepare(`UPDATE payment_charges SET hold_until = NULL WHERE id IN (${ids.map(() => '?').join(',')})`).run(...ids);
}

// Closes every still-open Stripe page covering this charge. Returns
// 'paid' if Stripe says one was actually paid (it's recorded instead),
// 'error' if Stripe couldn't be reached, otherwise 'closed'.
async function closeOpenCheckoutsFor(chargeId) {
  const rows = await db.prepare("SELECT * FROM stripe_checkouts WHERE status = 'pending' AND charges_json LIKE ?").all(`%"id":${Number(chargeId)},%`);
  for (const row of rows) {
    if (row.session_id) {
      try {
        await stripe.expireCheckoutSession(row.session_id);
      } catch (err) {
        const result = await completeBySessionId(row.session_id).catch(() => ({ recorded: false }));
        if (result.recorded || result.reason === 'already_recorded') return 'paid';
        console.error('Could not close Stripe checkout:', err.message);
        return 'error';
      }
    }
    await db.prepare("UPDATE stripe_checkouts SET status = 'expired' WHERE id = ? AND status = 'pending'").run(row.id);
  }
  return 'closed';
}

// Releases one held charge's ticket(s)/order. Only an unpaid charge is
// ever released - anything paid stays booked.
async function releaseHeldCharge(chargeId) {
  const current = await payments.getCharge(chargeId);
  if (!current || !current.hold_until || current.status !== 'pending') return false;
  if ((await closeOpenCheckoutsFor(chargeId)) !== 'closed') return false;
  const claimed = await db
    .prepare("UPDATE payment_charges SET hold_until = NULL WHERE id = ? AND hold_until IS NOT NULL AND status = 'pending' RETURNING *")
    .get(chargeId);
  if (!claimed) return false;
  if ((await payments.netCashForCharge(chargeId)) > 0) return false;
  if (claimed.source_type === 'event_registration') {
    const events = require('./events');
    const regs = await db
      .prepare("SELECT event_id, member_id FROM event_registrations WHERE charge_id = ? AND status IN ('confirmed', 'waitlisted')")
      .all(chargeId);
    for (const r of regs) await events.cancelRegistration(r.event_id, r.member_id);
  } else if (claimed.source_type === 'store_order' && claimed.source_id) {
    await require('./store').cancelOrder(claimed.source_id);
  }
  const after = await payments.getCharge(chargeId);
  if (after && after.status === 'pending') await payments.cancelCharge(chargeId);
  return true;
}

// Every hold whose time ran out - run whenever someone books a ticket,
// opens an event/the store, or Stripe reports a closed checkout, so an
// abandoned hold never blocks a seat or stock for long.
async function releaseExpiredHolds() {
  const rows = await db.prepare("SELECT id FROM payment_charges WHERE hold_until IS NOT NULL AND hold_until < ? AND status = 'pending'").all(nowIso());
  for (const r of rows) await releaseHeldCharge(r.id);
  return rows.length;
}

// A Checkout that ended without payment (Stripe's checkout.session.expired
// webhook, or the family pressing Back on Stripe's page): release every
// held charge it covered.
async function releaseCheckout(checkoutId) {
  const row = await db.prepare("UPDATE stripe_checkouts SET status = 'expired' WHERE id = ? AND status = 'pending' RETURNING *").get(checkoutId);
  if (!row) return false;
  for (const it of JSON.parse(row.charges_json)) await releaseHeldCharge(it.id);
  return true;
}

async function releaseExpiredCheckoutSession(session) {
  const checkoutId = parseInt((session && session.metadata && session.metadata.checkout_id) || (session && session.client_reference_id), 10);
  if (!checkoutId) return false;
  return releaseCheckout(checkoutId);
}

// The family pressed Back/cancel on Stripe's page. Closes that Checkout
// at Stripe first so it can't be paid later, then releases the holds. If
// Stripe says it was actually paid, it's recorded instead.
async function cancelHeldCheckout(checkoutId, memberIds) {
  const row = await db.prepare('SELECT * FROM stripe_checkouts WHERE id = ?').get(checkoutId);
  if (!row || !memberIds.includes(row.member_id)) return { released: false };
  if (row.status === 'completed') return { released: false, paid: true };
  let released = false;
  for (const it of JSON.parse(row.charges_json)) {
    if (await releaseHeldCharge(it.id)) released = true;
  }
  const after = await db.prepare('SELECT status FROM stripe_checkouts WHERE id = ?').get(checkoutId);
  return { released, paid: after && after.status === 'completed' };
}

// Releases a list of this family's held charges (Cancel on the checkout
// page, or the countdown running out).
async function releaseHeldCharges(chargeIds) {
  for (const id of chargeIds) await releaseHeldCharge(id);
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
  HOLD_MINUTES,
  holdCharges,
  clearHolds,
  releaseHeldCharge,
  releaseExpiredHolds,
  releaseCheckout,
  releaseExpiredCheckoutSession,
  cancelHeldCheckout,
  releaseHeldCharges,
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
