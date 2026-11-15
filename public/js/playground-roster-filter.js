// Playground Roster's Filter popup (views/admin-rosters.ejs): the Date list
// follows the chosen Semester and Day - the form's data-dates holds every
// semester/day's session dates ({ semesterId: { day: [{ date, label }] } }).
(function () {
  const form = document.getElementById('playground-filter-form');
  if (!form) return;
  let dates = {};
  try {
    dates = JSON.parse(form.dataset.dates || '{}');
  } catch (e) {
    dates = {};
  }
  const semester = form.querySelector('select[name="semesterId"]');
  const day = form.querySelector('select[name="day"]');
  const date = form.querySelector('select[name="date"]');
  let wanted = form.dataset.selectedDate || '';

  function fill() {
    const semesterKey = semester ? semester.value : Object.keys(dates)[0] || '';
    const list = ((dates[semesterKey] || {})[day ? day.value : ''] || []).slice().reverse();
    date.innerHTML = '';
    if (list.length === 0) {
      const none = document.createElement('option');
      none.value = '';
      none.textContent = 'No session dates yet';
      date.appendChild(none);
      return;
    }
    list.forEach((d) => {
      const opt = document.createElement('option');
      opt.value = d.date;
      opt.textContent = d.label;
      if (d.date === wanted) opt.selected = true;
      date.appendChild(opt);
    });
    wanted = '';
  }

  if (semester) semester.addEventListener('change', fill);
  if (day) day.addEventListener('change', fill);
  fill();
})();
