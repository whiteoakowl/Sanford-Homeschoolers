// A real request: "Customize the public homepage. Using the information
// in this photo [the Sanford Homeschoolers welcome flyer]. List the key
// features such as homeschool management, diplomas, transcripts, rewards,
// resources, reading challenges, student portal activities. List group
// features such as field trips, classes, community, park days, holiday
// parties etc. Link for more class information. Link for more group
// community information (activities and events). Contact button and
// page. Co-op classes are only on Wednesdays 9am-2pm."
//
// Builds ready-made Home, Co-op Classes, Community and Contact pages in
// the site editor's own format. Main Admin > Public Homepage > "Load the
// Sanford Homeschoolers pages" puts them in the DRAFT only - nothing goes
// live until an admin previews and clicks Publish in the editor, and every
// word stays editable there. Each element carries its own mobile layout
// (stacked in reading order) so the feature grids read correctly on
// phones.
const crypto = require('crypto');
const R = require('../public/js/site-render');

const MW = 320;
const id = (p) => `${p}_${crypto.randomBytes(6).toString('hex')}`;
const esc = (s) => R.esc(s);

// Headings use a wide display font, so allow more width per character.
function textH(plain, width, size, lh) {
  const cpl = Math.max(8, Math.floor(width / (size * (size >= 20 ? 0.66 : 0.52))));
  const lines = String(plain).split('\n').reduce((n, para) => n + Math.max(1, Math.ceil(para.length / cpl)), 0);
  return Math.ceil(lines * size * lh) + 10;
}
const SIZES = { h1: [48, 1.15], h2: [36, 1.2], h3: [26, 1.25], p: [17, 1.6], small: [14, 1.5] };

// One element; `plain` (for text) sizes it on desktop and mobile.
function text(html, tag, style, x, y, w, extraStyle, plain) {
  const [size, lh] = SIZES[style];
  const p = plain || html.replace(/<[^>]+>/g, '');
  return { id: id('e'), type: 'text', name: tag === 'p' ? 'Paragraph' : 'Heading', layout: { desktop: { x, y, w, h: textH(p, w, size, lh) } }, props: { tag, textStyle: style, html }, style: { ...(extraStyle || {}) }, _plain: p, _size: style };
}
const button = (label, href, x, y, w, extra) => ({ id: id('e'), type: 'button', name: 'Button', layout: { desktop: { x, y, w: w || 220, h: 52 } }, props: { label, link: { href } }, style: { ...(extra || {}) } });
const icon = (name, x, y, color) => ({ id: id('e'), type: 'icon', name: 'Icon', layout: { desktop: { x, y, w: 48, h: 48 } }, props: { icon: name }, style: { color: color || 'theme:primary' } });
const widget = (type, x, y, w, h, props) => ({ id: id('e'), type, name: type, layout: { desktop: { x, y, w, h } }, props: props || {}, style: {} });

// Section from elements listed in reading order: desktop positions as
// given, mobile stacked one under another in that same order.
function section(name, els, bg, extra) {
  let my = 28;
  els.forEach((el, i) => {
    el.z = i + 1;
    const d = el.layout.desktop;
    let w = MW - 32;
    let h = d.h;
    if (el.type === 'icon') w = 48;
    else if (el.type === 'button') w = Math.min(MW - 32, Math.max(200, d.w));
    if (el.type === 'text') {
      const [size, lh] = SIZES[el._size];
      const mobileSize = el._size === 'h1' ? 32 : el._size === 'h2' ? 26 : size;
      h = textH(el._plain, w, mobileSize, lh);
    }
    const centered = el.style && el.style.align === 'center';
    el.layout.mobile = { x: centered || el.type === 'button' || el.type === 'icon' ? Math.round((MW - w) / 2) : 16, y: my, w, h };
    my += h + (el.type === 'icon' ? 8 : 16);
    delete el._plain;
    delete el._size;
  });
  const desktopH = Math.max(120, ...els.map((e) => e.layout.desktop.y + e.layout.desktop.h)) + 56;
  return { id: id('s'), name, height: { desktop: desktopH, mobile: my + 20 }, bg: bg || { type: 'color' }, elements: els, ...(extra || {}) };
}

const light = { type: 'color', color: 'theme:light' };
const hero = { type: 'gradient', gradient: { from: 'theme:primary', to: 'theme:accent', angle: 135 } };
const white = { color: '#FFFFFF', align: 'center' };
const center = { align: 'center' };

// A grid of icon + title + text items, 3 per row; reading order is item
// by item so a phone shows each one whole.
function featureGrid(items, top) {
  const els = [];
  const colW = 280;
  const gap = 50;
  let rowY = top;
  for (let i = 0; i < items.length; i += 3) {
    const row = items.slice(i, i + 3);
    let rowH = 0;
    // Every description in a row starts at the same height, under the
    // tallest title, so the row lines up.
    const titles = row.map(([, title], j) => text(esc(title), 'h3', 'h3', 40 + j * (colW + gap), rowY + 60, colW));
    const titleH = Math.max(...titles.map((t) => t.layout.desktop.h));
    titles.forEach((t) => (t.layout.desktop.h = titleH));
    row.forEach(([ic, , body], j) => {
      const x = 40 + j * (colW + gap);
      const t = titles[j];
      const b = text(esc(body), 'p', 'p', x, rowY + 60 + titleH + 6, colW);
      els.push(icon(ic, x, rowY), t, b);
      rowH = Math.max(rowH, 60 + titleH + 6 + b.layout.desktop.h);
    });
    rowY += rowH + 40;
  }
  return els;
}

function pageHeader(title, intro) {
  const h = text(esc(title), 'h1', 'h1', 90, 70, 800, white);
  const p = text(esc(intro), 'p', 'p', 140, 70 + h.layout.desktop.h + 14, 700, white);
  return section('Page header', [h, p], hero);
}

const GROUP_FEATURES = [
  ['calendar', 'Field Trips', 'Hands-on outings around North Carolina planned by and for our families.'],
  ['gift', 'Events & Holiday Parties', 'Seasonal celebrations, holiday parties and special events all year long.'],
  ['sun', 'Park Days', 'Relaxed meetups where kids play and parents connect.'],
  ['users', 'Teen Hangouts', 'Time for teens to build friendships with other homeschooled teens.'],
  ['heart', 'Community Service', 'Ways for families to give back to Sanford together.'],
  ['chat', 'Parent Support', 'Encouragement, advice and friendship from experienced homeschool parents.'],
];

const MEMBER_FEATURES = [
  ['home', 'Homeschool Management', 'Plan, track and organize your family\'s school year in one place.'],
  ['pencil', 'Custom Transcripts', 'Build professional high school transcripts with grades, credits and GPA.'],
  ['award', 'High School Diplomas', 'Design and print your own personalized high school diplomas.'],
  ['star', 'Rewards', 'Badges and certificates that celebrate your students\' achievements.'],
  ['book', 'Reading Challenges', 'Fun reading challenges that keep kids turning pages.'],
  ['check-circle', 'Student Portal', 'Students log in for their own classes, lessons and activities.'],
  ['globe', 'Giant Resource List', 'A huge, curated list of homeschool resources and curriculum ideas.'],
  ['map-pin', 'Business Directory', 'Find and support member-owned and family-friendly local businesses.'],
  ['arrow-right', 'Buy / Sell / Trade', 'Pass along curriculum, books and supplies to other families.'],
];

function homePage() {
  const h1 = text('Welcome to Sanford Homeschoolers!', 'h1', 'h1', 40, 80, 900, white);
  const intro = text(
    esc('A 501(c)(3) nonprofit, secular and inclusive homeschool group in Sanford, North Carolina. Established in 2019, we are 150 families strong with activities planned every day of the week!'),
    'p', 'p', 140, 80 + h1.layout.desktop.h + 16, 700, white
  );
  const by = intro.layout.desktop.y + intro.layout.desktop.h + 28;
  const s1 = section('Welcome', [h1, intro, button('Join Us', '/register', 270, by, 200), button('Contact Us', '/contact', 510, by, 200)], hero);

  const t2 = text('Participate as much or as little as you like', 'h2', 'h2', 90, 56, 800, center);
  const p2 = text(
    esc('All group activities are optional, so your family can choose how much you would like to participate. You do NOT have to enroll in co-op classes to be a member of our group.'),
    'p', 'p', 140, 56 + t2.layout.desktop.h + 12, 700, center
  );
  const s2 = section('About', [t2, p2]);

  const t3 = text('Co-op Classes', 'h2', 'h2', 90, 56, 800, center);
  const when = text('<strong>Wednesdays &middot; 9:00 am &ndash; 2:00 pm</strong>', 'p', 'h3', 190, 56 + t3.layout.desktop.h + 8, 600, { ...center, color: 'theme:primary' }, 'Wednesdays · 9:00 am – 2:00 pm');
  const p3 = text(esc('Parent-led classes for every age, from science and art to writing and more. An optional add-on for group members, with its own semester fee plus each class fee. Members register online through the Parent Portal.'), 'p', 'p', 140, when.layout.desktop.y + when.layout.desktop.h + 10, 700, center);
  const s3 = section('Co-op Classes', [t3, when, p3, button('Class Information', '/classes', 380, p3.layout.desktop.y + p3.layout.desktop.h + 20, 220)], light);

  const t4 = text('Our Community', 'h2', 'h2', 90, 56, 800, center);
  const p4 = text(esc('Something is happening every day of the week.'), 'p', 'p', 140, 56 + t4.layout.desktop.h + 8, 700, center);
  const grid4 = featureGrid(GROUP_FEATURES, p4.layout.desktop.y + p4.layout.desktop.h + 36);
  const g4Bottom = Math.max(...grid4.map((e) => e.layout.desktop.y + e.layout.desktop.h));
  const s4 = section('Group Activities', [t4, p4, ...grid4, button('Activities & Events', '/community', 380, g4Bottom + 24, 220)]);

  const t5 = text('Your Family\'s Homeschool Hub', 'h2', 'h2', 90, 56, 800, center);
  const p5 = text(esc('Membership includes online tools for parents and students.'), 'p', 'p', 140, 56 + t5.layout.desktop.h + 8, 700, center);
  const grid5 = featureGrid(MEMBER_FEATURES, p5.layout.desktop.y + p5.layout.desktop.h + 36);
  const s5 = section('Member Features', [t5, p5, ...grid5], light);

  const t6 = text('Upcoming Events', 'h2', 'h2', 60, 48, 860);
  const s6 = section('Upcoming Events', [t6, widget('events', 60, 48 + t6.layout.desktop.h + 16, 860, 220, { limit: 4 })], null, { autoHide: true });

  const t7 = text('Ready to join Sanford Homeschoolers?', 'h2', 'h2', 90, 56, 800, white);
  const p7 = text(esc('Create your family\'s account, or send us a message - we\'d love to meet you.'), 'p', 'p', 140, 56 + t7.layout.desktop.h + 10, 700, white);
  const b7 = p7.layout.desktop.y + p7.layout.desktop.h + 24;
  const s7 = section('Join', [t7, p7, button('Member Registration', '/register', 140, b7, 230), button('See Pricing', '/pricing', 390, b7, 200), button('Contact Us', '/contact', 610, b7, 220)], hero);

  return { title: 'Home', slug: 'home', isHome: true, seo: { description: 'Sanford Homeschoolers is a 501(c)(3) secular, inclusive homeschool group in Sanford, NC with co-op classes, field trips, park days and more.' }, sections: [s1, s2, s3, s4, s5, s6, s7] };
}

function classesPage() {
  const t = text('Co-op Classes on Wednesdays', 'h2', 'h2', 90, 56, 800, center);
  const when = text('<strong>Every Wednesday &middot; 9:00 am &ndash; 2:00 pm</strong>', 'p', 'h3', 190, 56 + t.layout.desktop.h + 8, 600, { ...center, color: 'theme:primary' }, 'Every Wednesday · 9:00 am – 2:00 pm');
  const body = text(
    esc('Our co-op classes are taught by member parents and volunteers. Classes are grouped by age and grade, and change each semester. Co-op is an optional add-on for group members: it has its own fee each semester on top of group membership, plus each class fee. Members browse the class schedule and register their students online through the Parent Portal, where fees and due dates are shown on their account.'),
    'p', 'p', 140, when.layout.desktop.y + when.layout.desktop.h + 14, 700, center
  );
  const s1 = section('Class details', [t, when, body]);
  const t2 = text('This Semester\'s Classes', 'h2', 'h2', 60, 48, 860);
  const s2 = section('Classes', [t2, widget('classes', 60, 48 + t2.layout.desktop.h + 16, 860, 240, { showButton: true })], light, { autoHide: true });
  const t3 = text('Questions about classes?', 'h2', 'h2', 90, 56, 800, center);
  const s3 = section('Questions', [t3, button('See Pricing', '/pricing', 270, 56 + t3.layout.desktop.h + 20, 200), button('Contact Us', '/contact', 510, 56 + t3.layout.desktop.h + 20, 200)]);
  return { title: 'Co-op Classes', slug: 'classes', sections: [pageHeader('Co-op Classes', 'Wednesdays, 9am - 2pm, for every age.'), s1, s2, s3] };
}

function communityPage() {
  const t = text('Something for every family', 'h2', 'h2', 90, 56, 800, center);
  const p = text(esc('All group activities are optional - join in as much or as little as you like. Members see the full calendar and sign up in the Parent Portal.'), 'p', 'p', 140, 56 + t.layout.desktop.h + 10, 700, center);
  const grid = featureGrid(GROUP_FEATURES, p.layout.desktop.y + p.layout.desktop.h + 36);
  const s1 = section('Activities', [t, p, ...grid]);
  const t2 = text('Upcoming Events', 'h2', 'h2', 60, 48, 860);
  const s2 = section('Upcoming Events', [t2, widget('events', 60, 48 + t2.layout.desktop.h + 16, 860, 260, { limit: 8 })], light, { autoHide: true });
  const t3 = text('Come join us!', 'h2', 'h2', 90, 56, 800, white);
  const b = 56 + t3.layout.desktop.h + 20;
  const s3 = section('Join', [t3, button('Member Registration', '/register', 250, b, 230), button('Contact Us', '/contact', 510, b, 220)], hero);
  return { title: 'Community', slug: 'community', sections: [pageHeader('Community, Activities & Events', 'Field trips, park days, holiday parties, teen hangouts and more.'), s1, s2, s3] };
}

// A real request: "Pricing page. $20 annual group membership and
// features. Co-op $45/semester + additional class fees." The prices come
// live from Main Admin > Settings > Pricing.
function pricingPage() {
  const t = text('Start with group membership', 'h2', 'h2', 90, 56, 800, center);
  const p = text(esc('Group membership is the first step and the main membership for your whole family. Co-op classes are an optional add-on with their own semester fee, plus each class fee.'), 'p', 'p', 140, 56 + t.layout.desktop.h + 10, 700, center);
  const grid = widget('pricing', 60, p.layout.desktop.y + p.layout.desktop.h + 30, 860, 640);
  grid.layout.desktop.h = 640;
  const s1 = section('Pricing', [t, p, grid]);
  s1.height.mobile = Math.max(s1.height.mobile, 1500);
  const t2 = text('Questions about membership?', 'h2', 'h2', 90, 56, 800, center);
  const s2 = section('Questions', [t2, button('Contact Us', '/contact', 380, 56 + t2.layout.desktop.h + 20, 220)], light);
  return { title: 'Pricing', slug: 'pricing', sections: [pageHeader('Membership & Pricing', 'Group membership and co-op classes'), s1, s2] };
}

function contactPage(site) {
  const lines = [];
  if (site && site.contactEmail) lines.push(`Email: <a href="mailto:${esc(site.contactEmail)}">${esc(site.contactEmail)}</a>`);
  if (site && site.contactPhone) lines.push(`Phone: <a href="tel:${esc(site.contactPhone)}">${esc(site.contactPhone)}</a>`);
  lines.push('Sanford, North Carolina');
  const t = text('We\'d love to hear from you', 'h2', 'h2', 60, 56, 360);
  const p = text(esc('Questions about membership, co-op classes or activities? Send us a message and a group leader will get back to you.'), 'p', 'p', 60, 56 + t.layout.desktop.h + 12, 360);
  const info = text(lines.join('<br>'), 'p', 'p', 60, p.layout.desktop.y + p.layout.desktop.h + 16, 360, {}, lines.join('\n').replace(/<[^>]+>/g, ''));
  const form = widget('contactform', 460, 56, 480, 600, { title: 'Send us a message', buttonLabel: 'Send Message' });
  return { title: 'Contact', slug: 'contact', sections: [pageHeader('Contact Us', 'Sanford Homeschoolers - Sanford, North Carolina'), section('Contact', [t, p, info, form])] };
}

// Puts the four pages into `doc` (a draft): the home page is replaced;
// a page already using one of the other slugs is replaced in place,
// otherwise added. The menu gets a link to each one it doesn't have yet.
function applyStarterPages(doc) {
  const pages = [homePage(), classesPage(), communityPage(), pricingPage(), contactPage(doc.site)];
  const out = { ...doc, pages: [...doc.pages] };
  for (const pg of pages) {
    const full = { id: id('p'), hidden: false, access: 'public', type: 'standard', seo: {}, isHome: false, ...pg };
    const idx = pg.isHome ? out.pages.findIndex((p) => p.isHome) : out.pages.findIndex((p) => p.slug === pg.slug);
    if (idx >= 0) out.pages[idx] = { ...full, id: out.pages[idx].id, slug: out.pages[idx].slug };
    else out.pages.push(full);
  }
  const menu = [...(doc.menu || [])];
  // Home isn't added - the logo already links there, and five links fit
  // the header menu on one line where six don't.
  for (const pg of ['classes', 'community', 'pricing', 'contact'].map((slug) => out.pages.find((p) => p.slug === slug)).filter(Boolean)) {
    const already = menu.some((m) => (m.type === 'page' && m.pageId === pg.id) || (m.href && m.href === (pg.isHome ? '/' : `/${pg.slug}`)));
    if (!already) menu.push({ id: id('m'), type: 'page', pageId: pg.id, label: pg.isHome ? 'Home' : pg.slug === 'classes' ? 'Classes' : pg.title });
  }
  out.menu = menu;
  return out;
}

module.exports = { applyStarterPages };
