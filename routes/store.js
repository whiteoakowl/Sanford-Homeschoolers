// Member-facing Store (Community & Commerce track, item 8), mounted at
// /store (server.js). Members-only, any signed-in portal account - no
// public storefront (unlike Events/Directory/Classifieds' own public
// toggle), matching the handoff's own "member checkout" framing.
// A real request: "Store charges are immediate and added to a cart for
// final purchases." Items go into a cart (kept in the session); Checkout
// places the order(s) and, with online payments on, the family pays by
// card right away on a 10-minute countdown (views/held-checkout.ejs) -
// not paid in time, the order is cancelled and its stock put back. With
// online payments off, Checkout bills the family's account as before.
const express = require('express');
const db = require('../db');
const router = express.Router();
const { createStorageClient, publicUrl } = require('../utils/storage');
const { requirePortalAuth, blockTeacherOnlyAccounts, requireAnyPortalPermission } = require('../middleware/portalAuth');
const { familyForAccount, memberForAccount } = require('../utils/portalAuth');
const { primaryParentForBilling } = require('../utils/members');
const store = require('../utils/store');
const payments = require('../utils/payments');
const onlinePayments = require('../utils/onlinePayments');
const stripeApi = require('../utils/stripe');
const { publicOrigin } = require('../utils/pdfRender');

const MAX_CART_LINES = 50;
function cartOf(req) {
  if (!Array.isArray(req.session.storeCart)) req.session.storeCart = [];
  return req.session.storeCart;
}

const STORE_IMAGES_BUCKET = 'store-images';
const storageClient = createStorageClient();

function imageUrl(imageKey) {
  if (!imageKey) return null;
  return storageClient ? publicUrl(STORE_IMAGES_BUCKET, imageKey) : `/uploads/store/${imageKey}`;
}
function withImageUrl(product) {
  return { ...product, imageUrl: imageUrl(product.image_key) };
}

router.use(requirePortalAuth);
// A real request: "Teacher portal... remove ... store..." - see
// blockTeacherOnlyAccounts' own comment.
router.use(blockTeacherOnlyAccounts);
// A real request: "permission to view each of these pages and
// subpages... unchecking removes the permission and the page
// disappears." Only Parent Portal lists Store as its own nav entry
// today - see routes/directory.js's identical comment.
router.use(requireAnyPortalPermission([{ role: 'parent', key: 'view_parent_store' }]));
router.use((req, res, next) => {
  res.locals.cartCount = Array.isArray(req.session.storeCart) ? req.session.storeCart.length : 0;
  next();
});

// A real request: "change shop product card to look similar [to a
// reference design: image left, In Stock/Out of Stock badge, price and
// stock count on one row, a prominent order button]." Stock computation
// itself lives in utils/store.js's own withStockInfo, shared with the
// Main Admin product cards (routes/admin-store.js) so the two never
// disagree.
async function withStockAndImage(product) {
  return withImageUrl(await store.withStockInfo(product));
}

router.get('/', async (req, res) => {
  const settings = await store.getStoreSettings();
  if (!settings.store_enabled) {
    return res.render('store-list', { title: 'Store', storeClosed: true, welcomeMessage: null, products: [] });
  }
  const products = await store.listProducts({ status: 'active', availability: 'online' });
  res.render('store-list', { title: 'Store', storeClosed: false, welcomeMessage: settings.welcome_message, products: await Promise.all(products.map(withStockAndImage)) });
});

router.get('/orders', async (req, res) => {
  const family = await familyForAccount(req.portalAccount.id);
  const orders = [];
  for (const m of family) orders.push(...(await store.ordersForMember(m.id)));
  orders.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  res.render('store-orders', {
    title: 'My Orders',
    orders,
    notice: req.query.notice || null,
    paymentNotice: ['success', 'processing'].includes(req.query.payment) ? req.query.payment : null,
  });
});

router.get('/orders/:id', async (req, res) => {
  const order = await store.getOrder(req.params.id);
  if (!order) return res.status(404).render('404', { title: 'Not Found' });
  const family = await familyForAccount(req.portalAccount.id);
  if (!family.some((m) => m.id === order.member_id)) {
    return res.status(403).render('403', { title: 'Not Authorized', message: "That's not your order.", backHref: '/store/orders', backLabel: 'Back to My Orders' });
  }
  const settings = await store.getStoreSettings();
  res.render('store-order-detail', { title: `Order #${order.id}`, order, pickupInstructions: settings.pickup_instructions });
});

// --- Cart and checkout ---

async function billedMemberFor(req) {
  const self = await memberForAccount(req.portalAccount.id);
  return self ? primaryParentForBilling(self.id) : null;
}

async function heldStoreCharges(billedMemberId) {
  if (!billedMemberId) return [];
  return db
    .prepare("SELECT * FROM payment_charges WHERE member_id = ? AND source_type = 'store_order' AND status = 'pending' AND hold_until IS NOT NULL ORDER BY id")
    .all(billedMemberId);
}

const CART_EXPIRED_MSG = "Time ran out before payment, so your order was cancelled and your cart was cleared. The items are available again if you'd still like them.";

router.get('/cart', async (req, res) => {
  const family = await familyForAccount(req.portalAccount.id);
  const lines = [];
  for (const [index, item] of cartOf(req).entries()) {
    const preview = await store.previewCartLine(item);
    const member = family.find((m) => m.id === item.memberId);
    lines.push({ ...preview, index, memberName: member ? member.name : '' });
  }
  const totalCents = lines.filter((l) => !l.error).reduce((sum, l) => sum + l.lineCents, 0);
  const payNow = await onlinePayments.isEnabled();
  res.render('store-cart', {
    title: 'Cart',
    lines,
    totalCents,
    payNow,
    feeCents: payNow ? stripeApi.cardFeeCents(totalCents) : 0,
    formatCents: payments.formatCents,
    notice: req.query.notice || null,
    error: req.query.error || null,
    paymentNotice: req.query.payment === 'cancelled' ? 'cancelled' : null,
  });
});

router.post('/cart/remove', (req, res) => {
  const cart = cartOf(req);
  const index = parseInt(req.body.index, 10);
  if (index >= 0 && index < cart.length) cart.splice(index, 1);
  res.redirect('/store/cart');
});

router.post('/cart/checkout', async (req, res) => {
  const settings = await store.getStoreSettings();
  if (!settings.store_enabled) return res.redirect('/store');
  await onlinePayments.releaseExpiredHolds();
  const cart = cartOf(req);
  if (!cart.length) return res.redirect('/store/cart');
  const family = await familyForAccount(req.portalAccount.id);
  const billedMemberId = await billedMemberFor(req);
  // One order per family member the items are for, all billed to the
  // family's primary parent so the whole cart is a single payment.
  const byMember = new Map();
  for (const item of cart) {
    if (!family.some((m) => m.id === item.memberId)) continue;
    if (!byMember.has(item.memberId)) byMember.set(item.memberId, []);
    byMember.get(item.memberId).push(item);
  }
  const placed = [];
  try {
    for (const [memberId, items] of byMember) {
      placed.push(await store.placeOnlineOrder(memberId, req.portalAccount.id, items, { billedMemberId }));
    }
  } catch (err) {
    for (const orderId of placed) await store.cancelOrder(orderId);
    return res.redirect('/store/cart?error=' + encodeURIComponent(err.message));
  }
  req.session.storeCart = [];
  if (await onlinePayments.isEnabled()) {
    const orders = await Promise.all(placed.map((id) => store.getOrder(id)));
    await onlinePayments.holdCharges(orders.map((o) => o.charge_id));
    return res.redirect('/store/checkout');
  }
  res.redirect('/store/orders?notice=' + encodeURIComponent('Order placed - the total has been added to your account.'));
});

router.get('/checkout', async (req, res) => {
  await onlinePayments.releaseExpiredHolds();
  const held = await heldStoreCharges(await billedMemberFor(req));
  if (!held.length) return res.redirect('/store/cart' + (req.query.expired ? '?error=' + encodeURIComponent(CART_EXPIRED_MSG) : ''));
  const items = [];
  for (const c of held) items.push({ description: c.description, cents: await onlinePayments.amountOwed(c) });
  const subtotalCents = items.reduce((sum, it) => sum + it.cents, 0);
  const feeCents = stripeApi.cardFeeCents(subtotalCents);
  res.render('held-checkout', {
    title: 'Checkout',
    heading: 'Checkout',
    portalTitle: res.locals.sharedPortalTitle ? res.locals.sharedPortalTitle('Store') : 'Store',
    navLinks: [
      { href: '/portal', icon: 'home', label: 'My Portals' },
      { href: '/store', icon: 'tag', label: 'Store' },
      { href: '/store/orders', icon: 'file-text', label: 'My Orders' },
    ],
    items,
    subtotalCents,
    feeCents,
    totalCents: subtotalCents + feeCents,
    holdUntil: held.map((c) => c.hold_until).sort()[0],
    payHref: '/store/checkout/pay',
    cancelAction: '/store/checkout/cancel',
    expiredHref: '/store/checkout?expired=1',
    formatCents: payments.formatCents,
  });
});

router.get('/checkout/pay', async (req, res) => {
  await onlinePayments.releaseExpiredHolds();
  const billedMemberId = await billedMemberFor(req);
  const held = await heldStoreCharges(billedMemberId);
  if (!held.length) return res.redirect('/store/cart?error=' + encodeURIComponent(CART_EXPIRED_MSG));
  const chargeIds = held.map((c) => c.id);
  try {
    const result = await onlinePayments.startCheckout({
      memberId: billedMemberId,
      accountId: req.portalAccount.id,
      chargeIds,
      email: req.portalAccount.email,
      baseUrl: publicOrigin(req),
      successPath: '/store/orders',
      cancelPath: '/store/cart',
      held: true,
    });
    if (result.error) throw new Error(result.error);
    return res.redirect(303, result.url);
  } catch (err) {
    console.error('Store checkout failed:', err.message);
    await onlinePayments.releaseHeldCharges(chargeIds);
    return res.redirect('/store/cart?error=' + encodeURIComponent('Online payment is not available right now, so your order was cancelled. Please try again later.'));
  }
});

router.post('/checkout/cancel', async (req, res) => {
  const held = await heldStoreCharges(await billedMemberFor(req));
  await onlinePayments.releaseHeldCharges(held.map((c) => c.id));
  res.redirect('/store/cart?payment=cancelled');
});

router.get('/:id', async (req, res) => {
  const settings = await store.getStoreSettings();
  // "Shop open for online purchases?" (Main Admin > Shop > Settings) -
  // closed means the whole member-facing storefront is off, not just the
  // homepage, so a bookmarked/shared product link doesn't become a back
  // door around it.
  if (!settings.store_enabled) return res.redirect('/store');
  const product = await store.getProduct(req.params.id);
  if (!product || product.status !== 'active' || (product.availability !== 'online' && product.availability !== 'both')) {
    return res.status(404).render('404', { title: 'Not Found' });
  }
  const family = await familyForAccount(req.portalAccount.id);
  const optionGroups = await store.availableOptionGroupsForProduct(product.id);
  res.render('store-detail', { title: product.name, product: withImageUrl(product), optionGroups, family, error: req.query.error || null });
});

// Add to Cart (a real request: "added to a cart for final purchases").
router.post('/:id/buy', async (req, res) => {
  const settings = await store.getStoreSettings();
  if (!settings.store_enabled) return res.redirect('/store');
  const family = await familyForAccount(req.portalAccount.id);
  const memberId = parseInt(req.body.memberId, 10);
  if (!family.some((m) => m.id === memberId)) {
    return res.redirect(`/store/${req.params.id}?error=` + encodeURIComponent('You can only buy for yourself or your own family.'));
  }
  const quantity = Math.min(99, Math.max(1, parseInt(req.body.quantity, 10) || 1));
  // One <select> per option group (views/store-detail.ejs) - see
  // routes/admin-store.js's own in-person sale route for why
  // Object.values() (not assuming an array) is the safe way to read this
  // regardless of whether express's qs parser treated the group-id keys
  // as object keys or array indices.
  const optionValueIds = Object.values(req.body.optionValues || {})
    .map((id) => parseInt(id, 10))
    .filter(Boolean);
  const item = { productId: parseInt(req.params.id, 10), quantity, optionValueIds, memberId };
  const preview = await store.previewCartLine(item);
  if (preview.error) return res.redirect(`/store/${req.params.id}?error=` + encodeURIComponent(preview.error));
  const cart = cartOf(req);
  if (cart.length >= MAX_CART_LINES) return res.redirect('/store/cart?error=' + encodeURIComponent('Your cart is full - check out first.'));
  cart.push(item);
  res.redirect('/store/cart?notice=' + encodeURIComponent(`Added ${preview.productName} to your cart.`));
});

module.exports = router;
