// One-time setup for push notifications: prints a new VAPID key pair.
// Put both values in the site's environment variables (Netlify: Site
// configuration > Environment variables), plus VAPID_SUBJECT, then
// redeploy. Keep VAPID_PRIVATE_KEY secret. Generating a new pair later
// means every device has to turn push on again.
//
//   node scripts/generate-vapid-keys.js
const webpush = require('web-push');

const keys = webpush.generateVAPIDKeys();
console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`);
console.log('VAPID_SUBJECT=mailto:you@example.com   # a contact address for push services');
