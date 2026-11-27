// Classroom Dashboard > Schedule Changes/Withdraw (views/parent-class-
// dashboard.ejs). Two checkboxes - change your classes, or withdraw from
// all classes - only one at a time; each shows its own part of the popup.
(function () {
  const dialog = document.getElementById('schedule-changes-dialog');
  if (!dialog) return;
  const choices = Array.from(dialog.querySelectorAll('[data-sc-choice]'));
  const panels = Array.from(dialog.querySelectorAll('[data-sc-panel]'));

  function show(choice) {
    choices.forEach((cb) => {
      cb.checked = cb.dataset.scChoice === choice;
    });
    panels.forEach((p) => {
      p.hidden = p.dataset.scPanel !== (choice || 'none');
    });
  }

  choices.forEach((cb) => {
    cb.addEventListener('change', () => show(cb.checked ? cb.dataset.scChoice : null));
  });
  dialog.querySelectorAll('[data-close-dialog]').forEach((btn) => btn.addEventListener('click', () => dialog.close()));
  document.querySelectorAll('[data-open-schedule-changes]').forEach((btn) =>
    btn.addEventListener('click', () => {
      show(null);
      dialog.showModal();
    })
  );

  // Opened straight from an old Schedule Change Request link, or after a
  // request that needs fixing - land on "change your classes".
  if (dialog.hasAttribute('data-open-on-load')) {
    show('change');
    dialog.showModal();
  } else {
    show(null);
  }
})();
