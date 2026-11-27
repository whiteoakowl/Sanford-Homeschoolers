// The public website's contact form (a real request: "Contact button and
// page.") - the 'contactform' site element posts here. Open to anyone, so
// it has a hidden honeypot field and a per-IP rate limit; each message is
// logged in Main Admin > Support > Contact Messages and every Main Admin
// gets a notification (email/text per Main Admin > Notifications).
const express = require('express');
const router = express.Router();
const supportRequests = require('../utils/supportRequests');
const { notifyMainAdmins } = require('../utils/adminNotify');
const { createRateLimiter } = require('../utils/rateLimit');

const limiter = createRateLimiter({ windowMs: 60 * 60 * 1000, maxAttempts: 8 });
const TOPICS = ['Membership', 'Co-op Classes', 'Events & Activities', 'Volunteering', 'Something else'];

function safeBack(value) {
  const v = String(value || '');
  return /^\/[a-z0-9-]*$/i.test(v) ? v : '/contact';
}

router.post('/send', async (req, res) => {
  const back = safeBack(req.body.back);
  const sep = back.includes('?') ? '&' : '?';
  // A bot fills every field, including the hidden one people never see.
  if (String(req.body.website || '').trim()) return res.redirect(303, back + sep + 'sent=1#contact-form');
  if (limiter.isLimited(req.ip)) return res.status(429).send('Too many messages - please try again later.');
  limiter.recordAttempt(req.ip);
  const name = String(req.body.name || '').trim().slice(0, 120);
  const email = String(req.body.email || '').trim().slice(0, 200);
  const phone = String(req.body.phone || '').trim().slice(0, 40);
  const message = String(req.body.message || '').trim().slice(0, 4000);
  const topic = TOPICS.includes(req.body.topic) ? req.body.topic : 'Something else';
  if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !message) {
    return res.status(400).send('Please go back and fill in your name, a valid email and a message.');
  }
  await supportRequests.createContactMessage({ name, email, phone, topic, message });
  await notifyMainAdmins(
    'website_contact_message',
    { title: `New contact message: ${topic}`, body: `${name} (${email}) wrote: ${message.slice(0, 300)}`, linkUrl: '/main-admin/support/contact' },
    { permissionKey: 'view_support_requests' }
  );
  res.redirect(303, back + sep + 'sent=1#contact-form');
});

module.exports = router;
