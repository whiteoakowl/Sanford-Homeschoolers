// Loaded (deferred) on every page via partials/head.ejs so the site
// registers as an installable PWA no matter which page someone lands on
// first, and so Settings > Install App's button/status text - the only
// place with matching element ids - has a live install prompt to use by
// the time that panel loads. Everywhere else this is a silent no-op.
(function () {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/sw.js').catch(function () {
        // Best-effort - the site is fully usable without it either way.
      });
    });
  }

  // The browser only offers this once per page load (and only when it
  // has decided the page qualifies), so it's stashed on window rather
  // than assumed to still be around later - the Install App button
  // reuses this same page load's prompt, it never fetches a new one.
  window.__pwaDeferredPrompt = null;
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    window.__pwaDeferredPrompt = e;
    document.dispatchEvent(new CustomEvent('pwa-installable'));
  });
  window.addEventListener('appinstalled', function () {
    window.__pwaDeferredPrompt = null;
    document.dispatchEvent(new CustomEvent('pwa-installed'));
  });

  function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  }

  function wireInstallPanel() {
    var btn = document.getElementById('pwa-install-btn');
    var statusEl = document.getElementById('pwa-install-status');
    if (!btn || !statusEl) return; // Install App tab isn't on this page

    if (isStandalone()) {
      btn.hidden = true;
      statusEl.textContent = 'Installed ✓ You’re using the installed app on this device.';
      return;
    }

    function refresh() {
      if (window.__pwaDeferredPrompt) {
        btn.hidden = false;
        btn.disabled = false;
        statusEl.textContent = '';
      } else {
        btn.hidden = true;
        statusEl.textContent = 'One-tap install isn’t available in this browser right now - use the steps below instead.';
      }
    }
    refresh();
    document.addEventListener('pwa-installable', refresh);
    document.addEventListener('pwa-installed', function () {
      btn.hidden = true;
      statusEl.textContent = 'Installed ✓ Look for it on your device’s home screen or app list.';
    });

    btn.addEventListener('click', function () {
      var promptEvent = window.__pwaDeferredPrompt;
      if (!promptEvent) return;
      btn.disabled = true;
      promptEvent.prompt();
      promptEvent.userChoice.finally(function () {
        window.__pwaDeferredPrompt = null;
        refresh();
      });
    });
  }

  wireInstallPanel();

  // A real bug report: "Every time I reopen the app I have to refresh the
  // page in order to click on any pages... Otherwise it sits frozen." A
  // page the phone kept in memory (or restored from the back/forward
  // cache) while the app sat in the background can come back with dead
  // connections and an expired login/CSRF token - so after a long time
  // away, reload it fresh, exactly what the manual refresh did. Skipped
  // while someone is in the middle of typing in a form, so nothing they
  // entered is thrown away.
  var STALE_AFTER_MS = 15 * 60 * 1000;
  var hiddenAt = document.visibilityState === 'hidden' ? Date.now() : null;
  function isTypingInForm() {
    var el = document.activeElement;
    if (el && el.form && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) && el.type !== 'submit') return true;
    return Array.prototype.some.call(document.querySelectorAll('form textarea, form input[type="text"], form input[type="email"]'), function (f) {
      return f.value && f.defaultValue !== undefined && f.value !== f.defaultValue;
    });
  }
  function reloadIfStale(awayMs) {
    if (awayMs >= STALE_AFTER_MS && !isTypingInForm()) window.location.reload();
  }
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') {
      hiddenAt = Date.now();
    } else if (hiddenAt) {
      var away = Date.now() - hiddenAt;
      hiddenAt = null;
      reloadIfStale(away);
      // Pick up a newer service worker too, if one has been deployed.
      if ('serviceWorker' in navigator && navigator.serviceWorker.getRegistration) {
        navigator.serviceWorker.getRegistration().then(function (reg) { if (reg) reg.update(); }).catch(function () {});
      }
    }
  });
  window.addEventListener('pageshow', function (e) {
    // Restored from the back/forward cache: none of this page's scripts
    // re-ran. If it was stashed long ago, load it fresh instead.
    if (e.persisted && window.__pwaPageHiddenAt && Date.now() - window.__pwaPageHiddenAt >= STALE_AFTER_MS) window.location.reload();
  });
  window.addEventListener('pagehide', function () {
    window.__pwaPageHiddenAt = Date.now();
  });
})();
