// Stripe - a real request: "Build the connection" (online card payments
// through Stripe, after "Walk me through setting up stripe"). Talks to
// Stripe's REST API directly with fetch (no SDK dependency): Checkout
// Sessions for paying, Refunds for refunding to the card, and webhook
// signature checks so only Stripe can mark a payment paid.
//
// Configuration lives in environment variables (Netlify > Site
// configuration > Environment variables), never in the database or code:
//   STRIPE_SECRET_KEY       rk_test_/rk_live_ (restricted, preferred) or sk_test_/sk_live_ (required)
//   STRIPE_WEBHOOK_SECRET   whsec_...                   (required for webhooks)
//   STRIPE_FEE_PERCENT      card fee percent passed to members (default 2.9)
//   STRIPE_FEE_FIXED_CENTS  card fee fixed cents passed to members (default 30)
const crypto = require('crypto');

const API = 'https://api.stripe.com/v1';

function secretKey() {
  return (process.env.STRIPE_SECRET_KEY || '').trim();
}

function isConfigured() {
  return /^[sr]k_(test|live)_/.test(secretKey());
}

function mode() {
  const key = secretKey();
  if (/^[sr]k_live_/.test(key)) return 'live';
  if (/^[sr]k_test_/.test(key)) return 'test';
  return null;
}

// Stripe's form encoding: nested objects/arrays as a[b][0][c]=...
function encodeForm(params, prefix, out = []) {
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (item !== null && typeof item === 'object') encodeForm(item, `${key}[${i}]`, out);
        else out.push(`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(item)}`);
      });
    } else if (typeof v === 'object') {
      encodeForm(v, key, out);
    } else {
      out.push(`${encodeURIComponent(key)}=${encodeURIComponent(v)}`);
    }
  }
  return out.join('&');
}

async function stripeRequest(method, path, params, { idempotencyKey } = {}) {
  if (!isConfigured()) throw new Error('Stripe is not set up yet (STRIPE_SECRET_KEY is missing).');
  const headers = { Authorization: `Bearer ${secretKey()}` };
  let url = `${API}${path}`;
  let body;
  if (method === 'GET') {
    if (params) url += `?${encodeForm(params)}`;
  } else {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    body = encodeForm(params || {});
  }
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  const res = await fetch(url, { method, headers, body });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data && data.error && data.error.message) || `Stripe request failed (${res.status}).`;
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return data;
}

// The card fee members pay on top (a real request: "Members will pay the
// card fees"): grossed up so that after Stripe's own percent + fixed fee
// comes out of the total, the co-op still receives the full amount owed.
function feeConfig() {
  const pct = parseFloat(process.env.STRIPE_FEE_PERCENT);
  const fixed = parseInt(process.env.STRIPE_FEE_FIXED_CENTS, 10);
  return {
    percent: Number.isFinite(pct) && pct >= 0 && pct < 50 ? pct : 2.9,
    fixedCents: Number.isFinite(fixed) && fixed >= 0 ? fixed : 30,
  };
}

function cardFeeCents(amountCents) {
  if (!(amountCents > 0)) return 0;
  const { percent, fixedCents } = feeConfig();
  const total = Math.ceil((amountCents + fixedCents) / (1 - percent / 100));
  return total - amountCents;
}

async function createCheckoutSession(params, idempotencyKey) {
  return stripeRequest('POST', '/checkout/sessions', params, { idempotencyKey });
}

async function retrieveCheckoutSession(id) {
  return stripeRequest('GET', `/checkout/sessions/${encodeURIComponent(id)}`);
}

// Ends an open Checkout so it can no longer be paid (used when a family
// backs out of paying for a held ticket/order).
async function expireCheckoutSession(id) {
  return stripeRequest('POST', `/checkout/sessions/${encodeURIComponent(id)}/expire`, {});
}

async function createRefund({ paymentIntent, amountCents, reason }, idempotencyKey) {
  return stripeRequest('POST', '/refunds', { payment_intent: paymentIntent, amount: amountCents, metadata: reason ? { reason } : undefined }, { idempotencyKey });
}

// Stripe-Signature: t=<unix>,v1=<hex hmac of "t.rawBody">[,v1=...]
function verifyWebhook(rawBody, signatureHeader, secret = process.env.STRIPE_WEBHOOK_SECRET, toleranceSeconds = 300) {
  if (!secret) throw new Error('STRIPE_WEBHOOK_SECRET is not set.');
  if (!signatureHeader) throw new Error('Missing Stripe-Signature header.');
  const parts = {};
  for (const piece of String(signatureHeader).split(',')) {
    const [k, v] = piece.split('=');
    if (!k || !v) continue;
    (parts[k] = parts[k] || []).push(v);
  }
  const t = parts.t && parts.t[0];
  if (!t || !parts.v1) throw new Error('Malformed Stripe-Signature header.');
  const payload = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody);
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex');
  const ok = parts.v1.some((sig) => sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)));
  if (!ok) throw new Error('Stripe signature does not match.');
  if (Math.abs(Date.now() / 1000 - Number(t)) > toleranceSeconds) throw new Error('Stripe webhook timestamp is too old.');
  return JSON.parse(payload);
}

module.exports = {
  isConfigured,
  mode,
  encodeForm,
  feeConfig,
  cardFeeCents,
  createCheckoutSession,
  retrieveCheckoutSession,
  expireCheckoutSession,
  createRefund,
  verifyWebhook,
};
