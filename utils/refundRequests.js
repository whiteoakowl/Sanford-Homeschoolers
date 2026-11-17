// Refund approval - a real request: "Admin must approve all refunds, even
// if the system automated a refund. Admin must confirm it before it is
// officially finalized." Anything the system would refund on its own
// (utils/classRegistration.js's settleChargeOnCancel) becomes a pending
// request here instead of a recorded refund; Main Admin > Accounting >
// Pending Refunds approves it (recorded as a refund - and, for a charge
// paid online, sent back to the card through Stripe first) or declines
// it (nothing changes). A refund an admin enters by hand is confirmed in
// the form itself (routes/admin-accounting.js).
const db = require('../db');
const payments = require('./payments');
const { easternStamp } = require('./classRegistration');

async function requestRefund({ chargeId, amountCents, reason, source = 'automatic', accountId = null }) {
  if (!(amountCents > 0)) return null;
  const charge = await payments.getCharge(chargeId);
  if (!charge) return null;
  const row = await db
    .prepare('INSERT INTO refund_requests (charge_id, member_id, amount_cents, reason, source, requested_by_account_id) VALUES (?, ?, ?, ?, ?, ?) RETURNING id')
    .get(chargeId, charge.member_id, amountCents, reason || null, source, accountId);
  return row.id;
}

const SELECT = `SELECT r.*, c.description AS charge_description, m.name AS member_name
  FROM refund_requests r JOIN payment_charges c ON c.id = r.charge_id LEFT JOIN members m ON m.id = r.member_id`;

async function decorate(r) {
  const onlinePayments = require('./onlinePayments');
  const asked = easternStamp(r.created_at);
  const decided = r.decided_at ? easternStamp(r.decided_at) : null;
  const card = await onlinePayments.refundableToCard(r.charge_id);
  return {
    ...r,
    requestedLabel: `${asked.dateLabel} · ${asked.timeLabel}`,
    decidedLabel: decided ? `${decided.dateLabel} · ${decided.timeLabel}` : null,
    cardRefundableCents: card.reduce((s, p) => s + p.cents, 0),
  };
}

async function listRequests() {
  const rows = await db.prepare(`${SELECT} ORDER BY CASE r.status WHEN 'pending' THEN 0 ELSE 1 END, r.created_at DESC, r.id DESC LIMIT 300`).all();
  const out = [];
  for (const r of rows) out.push(await decorate(r));
  return out;
}

async function pendingCount() {
  return Number((await db.prepare("SELECT COUNT(*) AS n FROM refund_requests WHERE status = 'pending'").get()).n);
}

// Approve: send it back to the card through Stripe when the charge was
// paid online (toCard), otherwise record it as a refund paid some other
// way (check, cash...). Only then is it final.
async function approveRequest(id, { adminAccountId, decidedBy, toCard }) {
  const r = await db.prepare(`${SELECT} WHERE r.id = ?`).get(id);
  if (!r || r.status !== 'pending') return { error: 'That refund was already decided.' };
  const note = `Approved refund${r.reason ? ': ' + r.reason : ''}`;
  if (toCard) {
    const onlinePayments = require('./onlinePayments');
    const result = await onlinePayments.refundToCard({ chargeId: r.charge_id, amountCents: r.amount_cents, adminAccountId, note });
    if (result.error) return result;
  } else {
    await payments.recordPayment(r.charge_id, -r.amount_cents, 'manual', adminAccountId, note, 'refund');
  }
  await db
    .prepare("UPDATE refund_requests SET status = 'approved', decided_by = ?, decided_at = now_text(), result = ? WHERE id = ?")
    .run(decidedBy || null, toCard ? 'Refunded to card (Stripe)' : 'Recorded as refunded', id);
  return { ok: true };
}

async function declineRequest(id, decidedBy) {
  await db.prepare("UPDATE refund_requests SET status = 'declined', decided_by = ?, decided_at = now_text(), result = 'Declined' WHERE id = ? AND status = 'pending'").run(decidedBy || null, id);
}

module.exports = { requestRefund, listRequests, pendingCount, approveRequest, declineRequest };
