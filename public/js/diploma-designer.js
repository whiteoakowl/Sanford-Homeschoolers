// Diploma builder (views/partials/diploma-student-builder.ejs): highlights
// the chosen design and seal cards, shows Design 3's own Header Line and
// Second Seal only when Design 3 is picked, and swaps the Wording box to
// the new design's own default wording (and signature roles) when they
// haven't been changed.
(function () {
  function wire(form) {
    const defaults = JSON.parse(form.dataset.defaultBody || '{}');
    const sigDefaults = JSON.parse(form.dataset.defaultSignatures || '{}');
    const roleSelects = [1, 2, 3].map((n) => form.querySelector(`[name="signature${n}Title"]`));
    const body = form.querySelector('[name="bodyText"]');
    const designOnly = form.querySelectorAll('[data-design-only]');

    function markSelected(name) {
      form.querySelectorAll(`input[type="radio"][name="${name}"]`).forEach((r) => {
        const card = r.closest('label');
        if (card) card.classList.toggle('is-selected', r.checked);
      });
    }

    function currentDesign() {
      const r = form.querySelector('input[name="template"]:checked');
      return r ? r.value : 'design1';
    }

    function applyDesign(prev) {
      const design = currentDesign();
      designOnly.forEach((el) => { el.hidden = el.dataset.designOnly !== design; });
      if (body && prev && body.value.trim() === (defaults[prev] || '').trim()) body.value = defaults[design] || '';
      // Signature roles follow the design too, while they're still that
      // design's own starting roles.
      if (prev && sigDefaults[prev] && roleSelects.every((sel, i) => !sel || sel.value === (sigDefaults[prev][i] || ''))) {
        roleSelects.forEach((sel, i) => { if (sel) sel.value = sigDefaults[design][i] || ''; });
      }
    }

    let last = currentDesign();
    form.querySelectorAll('input[name="template"]').forEach((r) => r.addEventListener('change', () => {
      markSelected('template');
      applyDesign(last);
      last = currentDesign();
    }));
    ['seal1', 'seal2'].forEach((name) => form.querySelectorAll(`input[name="${name}"]`).forEach((r) => r.addEventListener('change', () => markSelected(name))));
    applyDesign(null);
  }
  document.querySelectorAll('form[data-diploma-builder]').forEach(wire);
})();
