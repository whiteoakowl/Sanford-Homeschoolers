// Grade Level Awards builder (views/partials/grade-award-builder.ejs):
// highlights the chosen design card, and when the grade level changes
// while the design is still that grade's own matching design, switches
// to the new grade's matching design.
(function () {
  document.querySelectorAll('form[data-grade-award-builder]').forEach((form) => {
    const gradeDesigns = JSON.parse(form.dataset.gradeDesigns || '{}');
    const grade = form.querySelector('[name="grade"]');
    const radios = form.querySelectorAll('input[name="design"]');
    const mark = () => radios.forEach((r) => r.closest('label').classList.toggle('is-selected', r.checked));
    radios.forEach((r) => r.addEventListener('change', mark));
    let last = grade ? grade.value : null;
    if (grade) {
      grade.addEventListener('change', () => {
        const current = form.querySelector('input[name="design"]:checked');
        if (!current || current.value === gradeDesigns[last]) {
          const next = form.querySelector(`input[name="design"][value="${gradeDesigns[grade.value]}"]`);
          if (next) { next.checked = true; mark(); }
        }
        last = grade.value;
      });
    }
  });
})();
