// Assign Training member picker (admin-training-assign.ejs) - a filter
// dropdown (All/Students/Primary Parents/Parents/Admins/Teachers) plus
// Select All, same interaction as the Design/Print hub's own
// bulk print pickers (public/js/design-print-hub.js's wireBulkMemberList)
// - standalone here since this page doesn't otherwise load that script. A
// real request: "should have a filter option like bulk printing. primary
// parents, parents, students, admins" (teachers added as a follow-up to
// that same request).
(function () {
  const list = document.getElementById('training-assign-list');
  if (!list) return;

  const filterSelect = document.getElementById('training-assign-filter-select');
  function applyFilter() {
    const filter = filterSelect ? filterSelect.value : 'all';
    list.querySelectorAll('.print-picker-row').forEach((row) => {
      const matches =
        filter === 'all' ||
        (filter === 'teacher' ? row.dataset.teacher === '1' : filter === 'primaryParent' ? row.dataset.primary === '1' : row.dataset.type === filter);
      row.style.display = matches ? '' : 'none';
    });
  }
  if (filterSelect) filterSelect.addEventListener('change', applyFilter);

  // A real request: "Remove select none check box... Simply unselecting
  // select all will uncheck them." Select All also follows the rows:
  // unchecking any row clears it, checking every visible row checks it.
  const selectAll = document.getElementById('training-assign-select-all-checkbox');
  if (selectAll) {
    const visibleBoxes = () => Array.from(list.querySelectorAll('.print-picker-row'))
      .filter((row) => row.style.display !== 'none')
      .map((row) => row.querySelector('input[type="checkbox"]'));
    selectAll.addEventListener('change', () => {
      visibleBoxes().forEach((cb) => { cb.checked = selectAll.checked; });
    });
    list.addEventListener('change', (e) => {
      if (!e.target.closest('.print-picker-row')) return;
      const boxes = visibleBoxes();
      selectAll.checked = boxes.length > 0 && boxes.every((cb) => cb.checked);
    });
  }
})();
