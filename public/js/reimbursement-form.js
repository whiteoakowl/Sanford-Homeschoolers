// Teacher Reimbursement form (views/reimbursement-form.ejs): the Semester
// -> Day -> Class cascade, "Add an Item" rows and the live total. The
// total here is display-only - the server recomputes it from the lines.
(function () {
  var form = document.querySelector('[data-reimbursement-form]');
  var dataEl = document.getElementById('reimbursement-catalog');
  if (!form || !dataEl) return;
  var catalog = JSON.parse(dataEl.textContent || '[]');

  var memberSel = form.querySelector('[data-reimb-member]');
  var semesterSel = form.querySelector('[data-reimb-semester]');
  var daySel = form.querySelector('[data-reimb-day]');
  var classSel = form.querySelector('[data-reimb-class]');
  var itemsWrap = form.querySelector('[data-reimb-items]');
  var totalEl = form.querySelector('[data-reimb-total]');

  function option(value, label, selected) {
    var o = document.createElement('option');
    o.value = value;
    o.textContent = label;
    if (selected) o.selected = true;
    return o;
  }

  function currentSemester() {
    var id = Number(semesterSel.value);
    return catalog.filter(function (s) { return s.id === id; })[0] || null;
  }

  function currentDay() {
    var sem = currentSemester();
    if (!sem) return null;
    return sem.days.filter(function (d) { return d.day === daySel.value; })[0] || null;
  }

  function renderDays() {
    var sem = currentSemester();
    var keep = daySel.value || daySel.getAttribute('data-selected');
    daySel.setAttribute('data-selected', '');
    daySel.innerHTML = '';
    if (!sem) {
      daySel.appendChild(option('', 'Choose a semester first…'));
    } else if (!sem.days.length) {
      daySel.appendChild(option('', 'No co-op days in this semester'));
    } else {
      daySel.appendChild(option('', 'Choose a day…'));
      sem.days.forEach(function (d) { daySel.appendChild(option(d.day, d.label, d.day === keep)); });
    }
    renderClasses();
  }

  // The chosen person's own classes are listed first in their own group;
  // any other class that day stays pickable underneath.
  function renderClasses() {
    var day = currentDay();
    var keep = classSel.value || classSel.getAttribute('data-selected');
    classSel.setAttribute('data-selected', '');
    classSel.innerHTML = '';
    if (!day) {
      classSel.appendChild(option('', 'Choose a day first…'));
      return;
    }
    if (!day.classes.length) {
      classSel.appendChild(option('', 'No classes on this day'));
      return;
    }
    classSel.appendChild(option('', 'Choose a class…'));
    var memberId = Number(memberSel.value);
    var mine = day.classes.filter(function (c) { return memberId && c.staffIds.indexOf(memberId) !== -1; });
    var others = day.classes.filter(function (c) { return mine.indexOf(c) === -1; });
    function label(c) { return c.room ? c.name + ' (' + c.room + ')' : c.name; }
    function addGroup(title, list) {
      if (!list.length) return;
      var parent = classSel;
      if (mine.length) {
        parent = document.createElement('optgroup');
        parent.label = title;
        classSel.appendChild(parent);
      }
      list.forEach(function (c) { parent.appendChild(option(String(c.id), label(c), String(c.id) === String(keep))); });
    }
    addGroup('My Classes', mine);
    addGroup('Other Classes', others);
  }

  function parseCents(value) {
    var cleaned = String(value || '').replace(/[$,\s]/g, '');
    if (!/^\d+(\.\d{1,2})?$|^\.\d{1,2}$/.test(cleaned)) return 0;
    return Math.round(parseFloat(cleaned) * 100);
  }

  function updateTotal() {
    var cents = 0;
    itemsWrap.querySelectorAll('[data-reimb-amount]').forEach(function (input) { cents += parseCents(input.value); });
    totalEl.textContent = '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function rows() { return itemsWrap.querySelectorAll('[data-reimb-item]'); }

  form.querySelector('[data-reimb-add]').addEventListener('click', function () {
    var all = rows();
    var clone = all[all.length - 1].cloneNode(true);
    clone.querySelectorAll('input').forEach(function (input) { input.value = ''; });
    itemsWrap.appendChild(clone);
    clone.querySelector('input').focus();
    updateTotal();
  });

  itemsWrap.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-reimb-remove]');
    if (!btn) return;
    var row = btn.closest('[data-reimb-item]');
    if (rows().length > 1) row.remove();
    else row.querySelectorAll('input').forEach(function (input) { input.value = ''; });
    updateTotal();
  });

  itemsWrap.addEventListener('input', function (e) {
    if (e.target.matches('[data-reimb-amount]')) updateTotal();
  });

  // Receipts: "Add More Receipts" adds another file input; each is
  // removable (the last one just clears instead).
  var receiptsWrap = form.querySelector('[data-reimb-receipts]');
  var addReceipt = form.querySelector('[data-reimb-add-receipt]');
  if (receiptsWrap && addReceipt) {
    addReceipt.addEventListener('click', function () {
      var all = receiptsWrap.querySelectorAll('[data-reimb-receipt]');
      var clone = all[all.length - 1].cloneNode(true);
      clone.querySelector('input').value = '';
      receiptsWrap.appendChild(clone);
    });
    receiptsWrap.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-reimb-receipt-remove]');
      if (!btn) return;
      var row = btn.closest('[data-reimb-receipt]');
      if (receiptsWrap.querySelectorAll('[data-reimb-receipt]').length > 1) row.remove();
      else row.querySelector('input').value = '';
    });
  }

  semesterSel.addEventListener('change', renderDays);
  daySel.addEventListener('change', renderClasses);
  memberSel.addEventListener('change', renderClasses);

  renderDays();
  updateTotal();
})();
