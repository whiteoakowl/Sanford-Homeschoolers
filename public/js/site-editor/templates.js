// Add Section library - prebuilt, designed strips (Wix's "Add Section").
// Every color references the site palette (theme:*) so templates always
// match the current Site Design.
import { uid } from './util.js';

const el = (type, x, y, w, h, props, style, extra) => ({ id: uid('e'), type, name: extra && extra.name, layout: { desktop: { x, y, w, h } }, props: props || {}, style: style || {}, z: 1, ...(extra || {}) });
const text = (html, tag, ts, x, y, w, h, style) => el('text', x, y, w, h, { tag, textStyle: ts, html }, style, { name: tag === 'p' ? 'Paragraph' : 'Heading' });
const btn = (label, href, x, y, w, h, style) => el('button', x, y, w || 180, h || 48, { label, link: { href } }, style, { name: 'Button' });
const img = (x, y, w, h, style) => el('image', x, y, w, h, { fit: 'cover', alt: '' }, style, { name: 'Image' });
const icon = (name, x, y, s, style) => el('icon', x, y, s || 44, s || 44, { icon: name }, { color: 'theme:primary', ...(style || {}) }, { name: 'Icon' });
const box = (x, y, w, h, style) => el('shape', x, y, w, h, {}, { bg: 'theme:cards', radius: 12, shadow: 'sm', ...(style || {}) }, { name: 'Card' });
const sec = (name, height, elements, bg, extra) => {
  elements.forEach((e, i) => (e.z = i + 1));
  return { id: uid('s'), name, height: { desktop: height }, bg: bg || { type: 'color' }, elements, ...(extra || {}) };
};
const center = { align: 'center' };
const light = { type: 'color', color: 'theme:light' };

function cards3(top, render) {
  return [0, 1, 2].flatMap((i) => render(40 + i * 310, top, i));
}

export const TEMPLATES = [
  {
    key: 'blank',
    name: 'Blank',
    group: 'Basic',
    desc: 'An empty strip to build from scratch.',
    make: () => sec('Blank section', 400, []),
  },
  {
    key: 'header',
    name: 'Page header',
    group: 'Basic',
    desc: 'Big page title over a colored banner.',
    make: () =>
      sec('Page header', 300, [text('Page Title', 'h1', 'h1', 140, 92, 700, 64, { ...center, color: '#FFFFFF' }), text('A short line that introduces this page.', 'p', 'p', 240, 176, 500, 32, { ...center, color: '#FFFFFF' })], {
        type: 'gradient',
        gradient: { from: 'theme:primary', to: 'theme:accent', angle: 135 },
      }),
  },
  {
    key: 'navigation',
    name: 'Navigation bar',
    group: 'Basic',
    desc: 'Your site menu plus the member log in button.',
    make: () => sec('Navigation', 88, [el('menu', 40, 20, 700, 48, { label: 'Section menu' }, {}, { name: 'Menu' }), el('login', 790, 22, 150, 44, {}, {}, { name: 'Log In Button' })], light),
  },
  {
    key: 'hero',
    name: 'Hero',
    group: 'Intro',
    desc: 'Headline, intro text, two buttons and a photo.',
    make: () =>
      sec('Hero', 560, [
        text('Learning together, growing together', 'h1', 'h1', 40, 120, 440, 176),
        text('A welcoming homeschool co-op with weekly classes, field trips and a community that has your back.', 'p', 'p', 40, 312, 420, 80),
        btn('Join Us', '/register', 40, 412, 160, 52),
        btn('Learn More', '#about', 216, 412, 160, 52, { bg: 'transparent', color: 'theme:primary', borderWidth: 2, borderColor: 'theme:primary', radius: 6 }),
        img(520, 60, 420, 440, { radius: 16 }),
      ]),
  },
  {
    key: 'about',
    name: 'About',
    group: 'Intro',
    desc: 'Photo beside your story.',
    make: () =>
      sec(
        'About',
        520,
        [
          img(40, 60, 420, 400, { radius: 12 }),
          text('About Us', 'h2', 'h2', 520, 110, 420, 50),
          text('We are a parent-led co-op of families who believe learning is better together. Share your story, mission and what makes your community special.', 'p', 'p', 520, 180, 420, 130),
          btn('Meet the Families', '#team', 520, 330, 200, 48),
        ],
        { type: 'color' },
        { anchor: 'about' }
      ),
  },
  {
    key: 'services',
    name: 'Services / Programs',
    group: 'Content',
    desc: 'Three cards with an icon, title and text.',
    make: () =>
      sec(
        'Programs',
        520,
        [
          text('What We Offer', 'h2', 'h2', 190, 60, 600, 50, center),
          ...cards3(150, (x, y, i) => [
            box(x, y, 280, 300),
            icon(['book', 'users', 'sun'][i], x + 118, y + 36, 44),
            text(['Weekly Classes', 'Community', 'Field Trips'][i], 'h3', 'h3', x + 20, y + 100, 240, 38, center),
            text('Describe this program in a sentence or two so families know what to expect.', 'p', 'p', x + 24, y + 150, 232, 100, center),
          ]),
        ],
        light
      ),
  },
  {
    key: 'features',
    name: 'Features',
    group: 'Content',
    desc: 'Four highlights in a two-by-two grid.',
    make: () =>
      sec('Features', 520, [
        text('Why Families Choose Us', 'h2', 'h2', 140, 50, 700, 50, center),
        ...[0, 1, 2, 3].flatMap((i) => {
          const x = 90 + (i % 2) * 420;
          const y = 150 + Math.floor(i / 2) * 160;
          return [
            icon(['check-circle', 'heart', 'award', 'leaf'][i], x, y, 40),
            text(['Flexible schedule', 'Caring community', 'Experienced parents', 'Hands-on learning'][i], 'h4', 'h4', x + 60, y, 320, 32),
            text('A short sentence that explains this benefit.', 'p', 'p', x + 60, y + 40, 320, 56),
          ];
        }),
      ]),
  },
  {
    key: 'testimonials',
    name: 'Testimonials',
    group: 'Content',
    desc: 'What families say, in three quote cards.',
    make: () =>
      sec(
        'Testimonials',
        480,
        [
          text('What Families Say', 'h2', 'h2', 190, 56, 600, 50, center),
          ...cards3(150, (x, y, i) => [
            box(x, y, 280, 260),
            text('“Our kids look forward to co-op day all week. We found our people here.”', 'p', 'p', x + 24, y + 30, 232, 130, { italic: true }),
            text(['The Smith Family', 'The Garcia Family', 'The Lee Family'][i], 'h4', 'h4', x + 24, y + 180, 232, 30),
            text('Member since 2022', 'p', 'small', x + 24, y + 214, 232, 22),
          ]),
        ],
        light
      ),
  },
  {
    key: 'team',
    name: 'Team',
    group: 'Content',
    desc: 'Leaders with round photos, names and roles.',
    make: () =>
      sec(
        'Team',
        460,
        [
          text('Meet Our Leaders', 'h2', 'h2', 190, 50, 600, 50, center),
          ...[0, 1, 2, 3].flatMap((i) => {
            const x = 70 + i * 220;
            return [img(x + 20, 140, 160, 160, { radius: 999 }), text(['Jane Doe', 'Sam Lee', 'Ana Ruiz', 'Mark Bell'][i], 'h4', 'h4', x, 318, 200, 30, center), text(['Director', 'Classes', 'Events', 'Treasurer'][i], 'p', 'small', x, 352, 200, 22, center)];
          }),
        ],
        { type: 'color' },
        { anchor: 'team' }
      ),
  },
  {
    key: 'pricing',
    name: 'Pricing / Membership',
    group: 'Content',
    desc: 'Three membership plans with a button each.',
    make: () =>
      sec(
        'Membership',
        600,
        [
          text('Membership Options', 'h2', 'h2', 190, 50, 600, 50, center),
          ...cards3(140, (x, y, i) => [
            box(x, y, 280, 400, i === 1 ? { borderWidth: 2, borderColor: 'theme:primary' } : {}),
            text(['Single Semester', 'Full Year', 'Drop-in'][i], 'h3', 'h3', x + 20, y + 30, 240, 38, center),
            text(['$60', '$100', '$10'][i], 'h1', 'h1', x + 20, y + 80, 240, 64, center),
            text('Weekly classes<br>Field trips<br>Family events', 'p', 'p', x + 30, y + 170, 220, 110, center),
            btn('Register', '/register', x + 50, y + 312, 180, 48),
          ]),
        ],
        light
      ),
  },
  {
    key: 'portfolio',
    name: 'Portfolio / Projects',
    group: 'Media',
    desc: 'Heading plus a three-column photo grid.',
    make: () => sec('Projects', 560, [text('Student Projects', 'h2', 'h2', 190, 50, 600, 50, center), el('gallery', 40, 130, 900, 380, { items: [], columns: 3, gap: 12 }, {}, { name: 'Gallery' })]),
  },
  {
    key: 'gallery',
    name: 'Photo slideshow',
    group: 'Media',
    desc: 'A full-width slideshow of your photos.',
    make: () => sec('Slideshow', 520, [el('slideshow', 0, 0, 980, 520, { slides: [], autoplay: true, interval: 5, label: 'Photo slideshow' }, {}, { name: 'Slideshow' })]),
  },
  {
    key: 'video',
    name: 'Video',
    group: 'Media',
    desc: 'Heading over a YouTube or Vimeo video.',
    make: () => sec('Video', 560, [text('See Co-op Life', 'h2', 'h2', 190, 50, 600, 50, center), el('video', 170, 130, 640, 360, { source: 'embed', url: '', title: 'Co-op video' }, {}, { name: 'Video' })], light),
  },
  {
    key: 'contact',
    name: 'Contact',
    group: 'Contact',
    desc: 'Contact details, social links and a map.',
    make: () =>
      sec(
        'Contact',
        480,
        [
          text('Get in Touch', 'h2', 'h2', 40, 70, 420, 50),
          text('Questions about joining? We would love to hear from you.<br><br>hello@example.com<br>(555) 555-0100', 'p', 'p', 40, 140, 400, 140),
          el('social', 40, 300, 220, 40, { links: [{ network: 'facebook', url: 'https://facebook.com/' }, { network: 'instagram', url: 'https://instagram.com/' }], gap: 14 }, { color: 'theme:primary' }, { name: 'Social Bar' }),
          el('map', 500, 60, 440, 360, { address: 'Sanford, NC', zoom: 13 }, { radius: 12 }, { name: 'Map' }),
        ],
        { type: 'color' },
        { anchor: 'contact' }
      ),
  },
  {
    key: 'faq',
    name: 'FAQ',
    group: 'Contact',
    desc: 'Your co-op FAQ list (Main Admin > FAQ).',
    make: () => sec('FAQ', 420, [text('Frequently Asked Questions', 'h2', 'h2', 140, 50, 700, 50, center), el('faq', 140, 130, 700, 240, {}, {}, { name: 'FAQ' })], light, { autoHide: true }),
  },
  {
    key: 'accordion',
    name: 'Questions (custom)',
    group: 'Contact',
    desc: 'An accordion of questions you write here.',
    make: () =>
      sec('Questions', 420, [
        text('Good to Know', 'h2', 'h2', 140, 50, 700, 50, center),
        el('accordion', 140, 130, 700, 220, { items: [{ title: 'When do classes meet?', body: 'Every week during the school year.' }, { title: 'Do parents stay?', body: 'Yes - every family helps out.' }], openFirst: true }, {}, { name: 'Accordion' }),
      ]),
  },
  {
    key: 'newsletter',
    name: 'Newsletter / Sign-up',
    group: 'Contact',
    desc: 'Invite visitors to one of your Custom Forms.',
    make: () =>
      sec('Newsletter', 340, [text('Stay in the Loop', 'h2', 'h2', 60, 90, 420, 50, { color: '#FFFFFF' }), text('Sign up to hear about open enrollment, events and news.', 'p', 'p', 60, 156, 400, 60, { color: '#FFFFFF' }), el('form', 520, 60, 400, 220, {}, {}, { name: 'Form' })], {
        type: 'color',
        color: 'theme:accent',
      }),
  },
  {
    key: 'footer',
    name: 'Footer strip',
    group: 'Basic',
    desc: 'A dark closing strip with links and social icons.',
    make: () =>
      sec('Footer strip', 220, [
        text('Sanford Homeschoolers', 'h3', 'h3', 40, 50, 400, 38, { color: '#FFFFFF' }),
        text('A parent-led homeschool co-op.', 'p', 'p', 40, 96, 400, 30, { color: '#FFFFFF' }),
        el('menu', 500, 46, 440, 44, { label: 'Footer menu' }, { color: '#FFFFFF' }, { name: 'Menu' }),
        el('social', 500, 120, 220, 36, { links: [{ network: 'facebook', url: 'https://facebook.com/' }, { network: 'instagram', url: 'https://instagram.com/' }], gap: 14 }, { color: '#FFFFFF' }, { name: 'Social Bar' }),
      ], { type: 'color', color: 'theme:dark' }),
  },
  {
    key: 'classes',
    name: 'Classes showcase',
    group: 'Co-op',
    desc: 'Public classes from Co-op Admin > Classes.',
    make: () => sec('Classes We Offer', 420, [text('Classes We Offer', 'h2', 'h2', 60, 48, 860, 52), el('classes', 60, 120, 860, 240, { showButton: true }, {}, { name: 'Classes Showcase' })], light, { autoHide: true }),
  },
  {
    key: 'events',
    name: 'Upcoming events',
    group: 'Co-op',
    desc: 'Public, upcoming events from Events.',
    make: () => sec('Upcoming Events', 400, [text('Upcoming Events', 'h2', 'h2', 60, 48, 860, 52), el('events', 60, 120, 860, 220, { limit: 4 }, {}, { name: 'Upcoming Events' })], { type: 'color' }, { autoHide: true }),
  },
  {
    key: 'announcements',
    name: 'Announcements',
    group: 'Co-op',
    desc: 'Public announcements.',
    make: () => sec('Announcements', 400, [text('Announcements', 'h2', 'h2', 60, 48, 860, 52), el('announcements', 60, 120, 860, 220, { limit: 3 }, {}, { name: 'Announcements' })], { type: 'color' }, { autoHide: true }),
  },
];
