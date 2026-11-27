// A real request: "Pricing page. $20 annual group membership and
// features. Co-op $45/semester + additional class fees. Settings on main
// admin settings to change pricing information." Stored as one app
// setting; the public site's 'pricing' element (public/js/site-render.js)
// shows it, so a change in Main Admin > Settings > Pricing is live at once.
const { appSetting, setAppSetting } = require('./appSettings');

const KEY = 'public_pricing';
const DEFAULT_PRICING = {
  // A real request: "Co-op class is an additional fee as well. Group
  // membership is the first step and main membership."
  membership: {
    label: 'Step 1 · Main membership',
    title: 'Group Membership',
    price: '20',
    period: 'per year',
    note: 'per family',
    features: [
      'Field trips, events & holiday parties',
      'Park days & teen hangouts',
      'Community service & parent support',
      'Homeschool management tools',
      'Custom transcripts & high school diplomas',
      'Rewards & reading challenges',
      'Student portal activities',
      'Giant homeschool resource list',
      'Buy/sell/trade & business directory',
    ],
  },
  coop: {
    label: 'Step 2 · Optional add-on',
    title: 'Co-op Classes',
    price: '45',
    period: 'per semester',
    note: 'in addition to group membership, plus each class fee',
    features: ['For group members', 'Wednesdays, 9am - 2pm', 'Parent-led classes for every age', 'Register online in the Parent Portal', 'Each class lists its own fee when you register'],
  },
  footnote: 'Group membership comes first - it is the main membership for your whole family. Co-op classes are an optional add-on with their own semester fee plus each class fee. You do not have to enroll in co-op classes to be a member.',
};

function clean(s, max) {
  return String(s == null ? '' : s).trim().slice(0, max);
}
function cleanPlan(p, fallback) {
  const src = p && typeof p === 'object' ? p : {};
  const features = Array.isArray(src.features) ? src.features : String(src.features || '').split(/\r?\n/);
  return {
    label: clean(src.label, 60),
    title: clean(src.title, 80) || fallback.title,
    price: clean(src.price, 20).replace(/^\$/, ''),
    period: clean(src.period, 40),
    note: clean(src.note, 120),
    features: features.map((f) => clean(f, 160)).filter(Boolean).slice(0, 20),
  };
}

async function getPricing() {
  let saved;
  try {
    saved = JSON.parse((await appSetting(KEY, '')) || 'null');
  } catch (err) {
    saved = null;
  }
  if (!saved) return JSON.parse(JSON.stringify(DEFAULT_PRICING));
  return {
    membership: cleanPlan(saved.membership, DEFAULT_PRICING.membership),
    coop: cleanPlan(saved.coop, DEFAULT_PRICING.coop),
    footnote: clean(saved.footnote, 400),
  };
}

// body: the settings form - membershipTitle, membershipPrice, ...
async function savePricing(body) {
  const plan = (prefix) => ({
    label: body[`${prefix}Label`],
    title: body[`${prefix}Title`],
    price: body[`${prefix}Price`],
    period: body[`${prefix}Period`],
    note: body[`${prefix}Note`],
    features: body[`${prefix}Features`],
  });
  const value = {
    membership: cleanPlan(plan('membership'), DEFAULT_PRICING.membership),
    coop: cleanPlan(plan('coop'), DEFAULT_PRICING.coop),
    footnote: clean(body.footnote, 400),
  };
  await setAppSetting(KEY, JSON.stringify(value));
  return value;
}

module.exports = { DEFAULT_PRICING, getPricing, savePricing };
