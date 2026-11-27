// 10-minute pay-by countdown on the event ticket / store checkout page
// (views/held-checkout.ejs). At zero the Pay button is disabled and the
// page goes back - the server releases the hold (tickets freed, cart
// order cancelled) the next time it's asked.
(function () {
  const box = document.querySelector('[data-hold-until]');
  if (!box) return;
  const until = Date.parse(box.dataset.holdUntil);
  const out = box.querySelector('[data-hold-remaining]');
  const payBtn = document.querySelector('[data-hold-pay]');
  const expiredMsg = document.querySelector('[data-hold-expired-msg]');
  function tick() {
    const left = Math.max(0, Math.round((until - Date.now()) / 1000));
    out.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    box.classList.toggle('is-low', left <= 60);
    if (left > 0) return;
    clearInterval(timer);
    if (payBtn) {
      payBtn.setAttribute('aria-disabled', 'true');
      payBtn.removeAttribute('href');
    }
    if (expiredMsg) expiredMsg.hidden = false;
    setTimeout(() => {
      window.location.href = box.dataset.expiredHref;
    }, 1500);
  }
  const timer = setInterval(tick, 1000);
  tick();
})();
