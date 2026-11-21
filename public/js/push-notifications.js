// "Push notifications on this device" card on Notifications > Preferences
// (views/notifications-preferences.ejs). Turning it on asks the browser
// for permission, subscribes this device with the site's public VAPID
// key, and sends that subscription to the server
// (POST /notifications/push/subscribe). Turning it off unsubscribes this
// device only - other devices keep getting pushes.
(function () {
  var card = document.getElementById('push-device-card');
  if (!card) return;
  var statusEl = document.getElementById('push-device-status');
  var onBtn = document.getElementById('push-enable-btn');
  var offBtn = document.getElementById('push-disable-btn');
  var testBtn = document.getElementById('push-test-btn');
  var publicKey = card.getAttribute('data-public-key');
  var csrfMeta = document.querySelector('meta[name="csrf-token"]');
  var csrf = csrfMeta ? csrfMeta.getAttribute('content') : '';

  function show(el, visible) {
    if (el) el.hidden = !visible;
  }
  function setStatus(text) {
    statusEl.textContent = text;
  }
  function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  }
  function isIos() {
    return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }
  function urlBase64ToUint8Array(base64) {
    var padding = '='.repeat((4 - (base64.length % 4)) % 4);
    var raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
    var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }
  function post(url, body) {
    return fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-CSRF-Token': csrf },
      body: JSON.stringify(body || {}),
    }).then(function (r) {
      return r.json().catch(function () { return { ok: false }; }).then(function (data) {
        data.httpOk = r.ok;
        return data;
      });
    });
  }

  if (!publicKey) {
    setStatus('Push notifications are not set up on this site yet. An administrator needs to add the push keys.');
    return;
  }
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    if (isIos() && !isStandalone()) {
      setStatus('On iPhone or iPad, first add this site to your Home Screen (Share, then "Add to Home Screen"), open it from there, and come back to this page.');
    } else {
      setStatus('This browser does not support push notifications.');
    }
    return;
  }

  function registration() {
    return navigator.serviceWorker.register('/sw.js').then(function () {
      return navigator.serviceWorker.ready;
    });
  }

  function refresh() {
    if (Notification.permission === 'denied') {
      setStatus('Notifications are blocked for this site in your browser settings. Allow them there, then reload this page.');
      show(onBtn, false);
      show(offBtn, false);
      show(testBtn, false);
      return Promise.resolve();
    }
    return registration().then(function (reg) {
      return reg.pushManager.getSubscription();
    }).then(function (sub) {
      if (sub) {
        setStatus('On: this device will get push notifications.');
        show(onBtn, false);
        show(offBtn, true);
        show(testBtn, true);
      } else {
        setStatus('Off on this device.');
        show(onBtn, true);
        show(offBtn, false);
        show(testBtn, false);
      }
    });
  }

  onBtn.addEventListener('click', function () {
    onBtn.disabled = true;
    Notification.requestPermission()
      .then(function (permission) {
        if (permission !== 'granted') throw new Error('permission');
        return registration();
      })
      .then(function (reg) {
        return reg.pushManager.getSubscription().then(function (existing) {
          return existing || reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) });
        });
      })
      .then(function (sub) {
        return post('/notifications/push/subscribe', { subscription: sub.toJSON() });
      })
      .then(function (result) {
        if (!result.ok) throw new Error(result.error || 'save');
      })
      .catch(function (err) {
        setStatus(err && err.message === 'permission' ? 'Notifications were not allowed. You can turn them on any time.' : 'Could not turn on push notifications on this device. Please try again.');
      })
      .then(function () {
        onBtn.disabled = false;
        if (Notification.permission === 'granted') return refresh();
      });
  });

  offBtn.addEventListener('click', function () {
    offBtn.disabled = true;
    registration()
      .then(function (reg) {
        return reg.pushManager.getSubscription();
      })
      .then(function (sub) {
        if (!sub) return null;
        var endpoint = sub.endpoint;
        return sub.unsubscribe().then(function () {
          return post('/notifications/push/unsubscribe', { endpoint: endpoint });
        });
      })
      .catch(function () {})
      .then(function () {
        offBtn.disabled = false;
        return refresh();
      });
  });

  testBtn.addEventListener('click', function () {
    testBtn.disabled = true;
    post('/notifications/push/test')
      .then(function (result) {
        setStatus(result.ok ? 'Test sent - it should appear in a few seconds.' : 'The test could not be sent: ' + (result.detail || 'unknown error'));
      })
      .catch(function () {
        setStatus('The test could not be sent. Please try again.');
      })
      .then(function () {
        testBtn.disabled = false;
      });
  });

  refresh();
})();
