// A real bug report: "Every time I reopen the app I have to refresh the
// page in order to click on any pages and go to a new one. Otherwise it
// sits frozen." Guards the three parts of the fix (public/sw.js,
// public/js/pwa.js, public/js/fullscreen-nav.js) - the behavior itself
// was checked in a real browser with a stalled stylesheet (old service
// worker: the next page never finished loading; new one: ~4s from cache).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');

test('service worker: a hung network fetch falls back to the cached copy after a timeout', () => {
  const sw = read('sw.js');
  assert.match(sw, /const NETWORK_TIMEOUT_MS = \d+;/);
  assert.match(sw, /Promise\.race\(\[network, timedOut\]\)/);
  assert.match(sw, /setTimeout\(resolve, NETWORK_TIMEOUT_MS\)/);
  assert.ok(!sw.includes("fetch(event.request, { cache: 'no-store' })\n      .then("), 'not the old wait-forever version');
});

test('pwa.js: reloads a page left in the background 15+ minutes, unless someone is typing', () => {
  const pwa = read('js/pwa.js');
  assert.match(pwa, /var STALE_AFTER_MS = 15 \* 60 \* 1000;/);
  assert.match(pwa, /addEventListener\('visibilitychange'/);
  assert.match(pwa, /addEventListener\('pageshow'/);
  assert.match(pwa, /if \(awayMs >= STALE_AFTER_MS && !isTypingInForm\(\)\) window\.location\.reload\(\);/);
});

test('kiosk in-place navigation gives up on a hung fetch and loads the page normally', () => {
  const nav = read('js/fullscreen-nav.js');
  assert.match(nav, /setTimeout\(\(\) => controller\.abort\(\), 8000\)/);
  assert.match(nav, /signal: controller \? controller\.signal : undefined/);
});
