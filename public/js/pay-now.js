// Pay Now (views/accounting-home.ejs): keeps the Selected / Card
// processing fee / Total lines in step with the checked charges, using
// the same gross-up as utils/stripe.js's cardFeeCents (the server
// recomputes it - this is only the preview).
(function () {
  const form = document.querySelector('.pay-now-form');
  if (!form) return;
  const pct = parseFloat(form.dataset.feePercent) || 0;
  const fixed = parseInt(form.dataset.feeFixed, 10) || 0;
  const money = (c) => (c / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
  const fee = (c) => (c > 0 ? Math.ceil((c + fixed) / (1 - pct / 100)) - c : 0);
  function update() {
    const subtotal = Array.from(form.querySelectorAll('input[name="chargeIds"]:checked')).reduce((s, el) => s + (parseInt(el.dataset.cents, 10) || 0), 0);
    const f = fee(subtotal);
    form.querySelector('[data-pay-subtotal]').textContent = money(subtotal);
    form.querySelector('[data-pay-fee]').textContent = money(f);
    form.querySelector('[data-pay-total]').textContent = money(subtotal + f);
    const btn = form.querySelector('[data-pay-button]');
    btn.disabled = subtotal <= 0;
    btn.textContent = subtotal > 0 ? `Pay ${money(subtotal + f)}` : 'Pay Now';
  }
  form.addEventListener('change', update);
  update();
})();
