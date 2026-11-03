// Design tab: one dropdown picks Student/Parent/Admin Name Tag or Schedule
// Card. Both canvas engines (name-tag-editor.js, schedule-card-editor.js)
// are already initialized on the page - this only shows/hides their
// sections and, for the three name-tag types, forwards the choice into the
// editor's own hidden #name-tag-type-select so its existing switchType
// logic runs unmodified.
(function () {
  const typeSelect = document.getElementById('design-type-select');
  if (!typeSelect) return;

  const nameTagSection = document.getElementById('design-name-tag-section');
  const scheduleCardSection = document.getElementById('design-schedule-card-section');
  const nameTagToolbar = document.getElementById('design-name-tag-toolbar-controls');
  const scheduleCardToolbar = document.getElementById('design-schedule-card-toolbar-controls');
  const hiddenNameTagSelect = document.getElementById('name-tag-type-select');

  function apply(value) {
    const isScheduleCard = value === 'scheduleCard';
    if (nameTagSection) nameTagSection.hidden = isScheduleCard;
    if (nameTagToolbar) nameTagToolbar.hidden = isScheduleCard;
    if (scheduleCardSection) scheduleCardSection.hidden = !isScheduleCard;
    if (scheduleCardToolbar) scheduleCardToolbar.hidden = !isScheduleCard;

    if (!isScheduleCard && hiddenNameTagSelect && hiddenNameTagSelect.value !== value) {
      hiddenNameTagSelect.value = value;
      hiddenNameTagSelect.dispatchEvent(new Event('change'));
    }
  }

  typeSelect.addEventListener('change', () => apply(typeSelect.value));
  apply(typeSelect.value);
})();

// Print tab: one dropdown picks which existing print flow to show
// (Schedule Cards / Name Tags / Schedules / Logs).
(function () {
  const typeSelect = document.getElementById('print-type-select');
  if (!typeSelect) return;

  const sections = {
    scheduleCards: document.getElementById('print-schedule-cards-section'),
    nameTags: document.getElementById('print-name-tags-section'),
    nameTagRequests: document.getElementById('print-nameTagRequests-section'),
    cardsDuplex: document.getElementById('print-cardsDuplex-section'),
    barcodes: document.getElementById('print-barcodes-section'),
    barcodeLabels: document.getElementById('print-barcodeLabels-section'),
    setupCleanupBadges: document.getElementById('print-setupCleanupBadges-section'),
    bypassBadge: document.getElementById('print-bypassBadge-section'),
    customBadges: document.getElementById('print-customBadges-section'),
    schedules: document.getElementById('print-schedules-section'),
    classCheckinQr: document.getElementById('print-classCheckinQr-section'),
    playgroundQr: document.getElementById('print-playgroundQr-section'),
    libraryBarcodes: document.getElementById('print-libraryBarcodes-section'),
    logs: document.getElementById('print-logs-section'),
  };

  function apply(value) {
    Object.keys(sections).forEach((key) => {
      if (sections[key]) sections[key].hidden = key !== value;
    });
  }

  typeSelect.addEventListener('change', () => apply(typeSelect.value));
  apply(typeSelect.value);

  // A real request: "Should be able to choose all filters and save before
  // it refreshes" - Print reloads this page (bulk-print-refresh.js), which
  // used to drop back to Schedule Cards every time. The chosen print type
  // is kept for this browser tab and reopened after the reload, unless the
  // URL itself already picked one (an option rendered `selected`).
  const PRINT_TYPE_KEY = 'printType:' + window.location.pathname;
  typeSelect.addEventListener('change', () => {
    try {
      window.sessionStorage.setItem(PRINT_TYPE_KEY, typeSelect.value);
    } catch (err) {
      // Storage unavailable - the page just won't reopen this type.
    }
  });
  if (!typeSelect.querySelector('option[selected]')) {
    let savedType = null;
    try {
      savedType = window.sessionStorage.getItem(PRINT_TYPE_KEY);
    } catch (err) {
      savedType = null;
    }
    if (savedType && savedType !== typeSelect.value && sections[savedType]) {
      // After every other handler on this page has attached, so the same
      // 'change' each of them listens for runs as if it were picked by hand.
      setTimeout(() => {
        typeSelect.value = savedType;
        typeSelect.dispatchEvent(new Event('change'));
      }, 0);
    }
  }

  // The 6 print flows below all list the exact same active-member set
  // (only the checkbox selections differ per flow) - views/partials/
  // print-picker-table.ejs only renders real rows into the Schedule
  // Cards list (the one visible by default) and leaves the other 5
  // tables' <tbody> empty (skipRows) so the page doesn't ship that same
  // hundreds-of-rows table 6 times over in one response. Clone the real
  // rows into the empty ones here, once, before any of the wiring below
  // runs - each table's <tbody> ends up with its own independent copy of
  // the rows/checkboxes, so everything past this point behaves exactly
  // as if they'd all been server-rendered separately.
  const sourceList = document.getElementById('schedule-print-list');
  if (sourceList) {
    const sourceRows = sourceList.querySelectorAll('tbody tr');
    ['name-tag-bulk-list', 'cards-duplex-bulk-list', 'barcodes-bulk-list', 'barcode-labels-bulk-list'].forEach((listId) => {
      const target = document.getElementById(listId);
      const tbody = target && target.querySelector('tbody');
      if (!tbody) return;
      sourceRows.forEach((row) => tbody.appendChild(row.cloneNode(true)));
    });
  }

  // Select All for one picker. A real request: "Remove select none check
  // box from pages. Simply unselecting select all will uncheck them." -
  // checking/unchecking Select All checks/unchecks every row currently on
  // screen (a row hidden by the Filter popup or search is left alone), and
  // Select All itself stays in sync: it reads checked only while every
  // visible row is checked, so manually unchecking one row (or a filter
  // change) unchecks it again.
  function wireSelectAll(container, rowSelector, checkboxSelector, selectAll) {
    if (!container || !selectAll) return { sync() {} };
    const visibleBoxes = () =>
      Array.from(container.querySelectorAll(rowSelector))
        .filter((row) => row.style.display !== 'none')
        .map((row) => row.querySelector(checkboxSelector))
        .filter(Boolean);
    const sync = () => {
      const boxes = visibleBoxes();
      selectAll.checked = boxes.length > 0 && boxes.every((cb) => cb.checked);
    };
    selectAll.addEventListener('change', () => {
      visibleBoxes().forEach((cb) => {
        cb.checked = selectAll.checked;
      });
    });
    container.addEventListener('change', (e) => {
      if (e.target instanceof HTMLInputElement && e.target.matches(checkboxSelector)) sync();
    });
    return { sync };
  }

  // Filter button -> popup -> Save, shared by every picker on this page
  // (views/partials/print-filter-popup.ejs renders the markup). A real
  // request: "All printing should allow you to filter by family name,
  // semester, day. Should be able to change multiple items in the filter
  // popup without it refreshing and click save." Changing a select in the
  // popup does nothing on its own - only Save (or Clear filters) applies
  // the whole combination at once, client-side, never reloading the page.
  // Rows the filter hides are also unchecked (a real bug report on the
  // class QR picker: hidden rows kept their old checks and still printed),
  // so Print only ever sends what's on screen. The saved filter is kept in
  // sessionStorage per page + picker and re-applied on load, so it
  // survives the reload that follows every Print (bulk-print-refresh.js).
  // Options: prefix (the partial's id prefix), container/rowSelector/
  // checkboxSelector (the rows it narrows, if any), matches(row, filter),
  // extraMatch(row) (optional second, live narrowing - Schedule Cards'
  // name search), selectAll (from wireSelectAll), onApply(filter)
  // (optional, for a panel with no rows - Schedules' links).
  function wireFilterPopup(opts) {
    const dialog = document.getElementById(opts.prefix + '-filter-dialog');
    if (!dialog) return { refresh() {} };
    const button = document.getElementById(opts.prefix + '-filter-btn');
    const saveBtn = document.getElementById(opts.prefix + '-filter-save-btn');
    const clearBtn = document.getElementById(opts.prefix + '-filter-clear-btn');
    const summary = document.getElementById(opts.prefix + '-filter-summary');
    const selects = Array.from(dialog.querySelectorAll('select[data-filter-field]'));
    const storageKey = 'printFilter:' + window.location.pathname + ':' + opts.prefix;
    const checkboxSelector = opts.checkboxSelector || 'input[type="checkbox"]';

    const readSelects = () => {
      const filter = {};
      selects.forEach((s) => {
        filter[s.dataset.filterField] = s.value;
      });
      return filter;
    };
    let current = readSelects();

    function apply(filter, uncheckHidden) {
      current = filter;
      if (opts.container) {
        opts.container.querySelectorAll(opts.rowSelector).forEach((row) => {
          const shown = opts.matches(row, filter) && (!opts.extraMatch || opts.extraMatch(row));
          row.style.display = shown ? '' : 'none';
          if (!shown && uncheckHidden) {
            row.querySelectorAll(checkboxSelector).forEach((cb) => {
              cb.checked = false;
            });
          }
        });
      }
      if (opts.selectAll) opts.selectAll.sync();
      if (opts.onApply) opts.onApply(filter);
      const labels = selects.filter((s) => s.value).map((s) => s.options[s.selectedIndex].text);
      if (summary) summary.textContent = labels.length ? 'Filtered: ' + labels.join(' · ') : '';
      if (button) button.classList.toggle('is-filter-active', labels.length > 0);
    }

    function save(filter) {
      try {
        window.sessionStorage.setItem(storageKey, JSON.stringify(filter));
      } catch (err) {
        // Storage unavailable (private window, blocked) - the filter just
        // won't survive a reload; everything else still works.
      }
    }

    let saved = null;
    try {
      saved = JSON.parse(window.sessionStorage.getItem(storageKey) || 'null');
    } catch (err) {
      saved = null;
    }
    if (saved && typeof saved === 'object') {
      selects.forEach((s) => {
        const value = saved[s.dataset.filterField] || '';
        if (Array.from(s.options).some((o) => o.value === value)) s.value = value;
      });
      apply(readSelects(), true);
    } else {
      // No saved filter - still apply whatever the popup starts on (e.g.
      // Name Tags' own Primary Parents Only default).
      apply(readSelects(), true);
    }

    if (button) {
      button.addEventListener('click', () => {
        // Reopen showing what's actually applied, not leftover unsaved picks.
        selects.forEach((s) => {
          s.value = current[s.dataset.filterField] || '';
        });
        dialog.showModal();
      });
    }
    if (saveBtn) {
      saveBtn.addEventListener('click', () => {
        const filter = readSelects();
        apply(filter, true);
        save(filter);
        dialog.close();
      });
    }
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        selects.forEach((s) => {
          s.value = '';
        });
        const filter = readSelects();
        apply(filter, true);
        save(filter);
        dialog.close();
      });
    }
    return { refresh: () => apply(current, false) };
  }

  const listOf = (value) => (value || '').split(' ').filter(Boolean);

  // Member pickers' rows (views/partials/print-picker-table.ejs): Member
  // Type / Family / Semester / Day (partials/member-print-filter.ejs).
  // "Teachers" and "Primary Parents" are their own dataset (data-teacher/
  // data-primary) rather than their own member_type value - a teacher/
  // primary parent is still a parent-type member underneath. Semester/Day
  // match if the member is enrolled in or staffs any class in that
  // semester/on that day (data-semesters/data-days, utils/
  // printPickerFilters.js).
  function memberRowMatches(row, f) {
    const type = f.type || '';
    const typeOk =
      !type || (type === 'teacher' ? row.dataset.teacher === '1' : type === 'primaryParent' ? row.dataset.primary === '1' : row.dataset.type === type);
    const familyOk = !f.family || row.dataset.familyId === f.family;
    const semesterOk = !f.semester || listOf(row.dataset.semesters).includes(f.semester);
    const dayOk = !f.day || listOf(row.dataset.days).includes(f.day);
    return typeOk && familyOk && semesterOk && dayOk;
  }

  // Single-valued data attribute per popup field (field name -> dataset key).
  function datasetMatcher(fieldToDataset) {
    return (row, f) => Object.keys(fieldToDataset).every((field) => !f[field] || row.dataset[fieldToDataset[field]] === f[field]);
  }

  // Every member picker: its own Filter popup + Select All. Schedule Cards
  // also keeps its live name search box, layered on top of the popup's
  // saved filter (typing narrows the list as before, but never unchecks).
  function wireBulkMemberList(listId, prefix, selectAllId, searchInputId) {
    const bulkList = document.getElementById(listId);
    if (!bulkList) return;
    const selectAll = wireSelectAll(bulkList, '.print-picker-row', 'input[type="checkbox"]', document.getElementById(selectAllId));
    const searchInput = searchInputId ? document.getElementById(searchInputId) : null;
    const popup = wireFilterPopup({
      prefix,
      container: bulkList,
      rowSelector: '.print-picker-row',
      matches: memberRowMatches,
      extraMatch: searchInput
        ? (row) => {
          const q = searchInput.value.trim().toLowerCase();
          return !q || (row.dataset.name || '').includes(q);
        }
        : null,
      selectAll,
    });
    if (searchInput) searchInput.addEventListener('input', () => popup.refresh());
  }

  wireBulkMemberList('schedule-print-list', 'schedule-print', 'schedule-print-select-all-checkbox', 'schedule-print-search-input');
  wireBulkMemberList('name-tag-bulk-list', 'name-tag-bulk', 'name-tag-select-all-checkbox');
  wireBulkMemberList('name-tag-requests-bulk-list', 'name-tag-requests', 'name-tag-requests-select-all-checkbox');
  wireBulkMemberList('cards-duplex-bulk-list', 'cards-duplex', 'cards-duplex-select-all-checkbox');
  wireBulkMemberList('barcodes-bulk-list', 'barcodes', 'barcodes-select-all-checkbox');
  wireBulkMemberList('barcode-labels-bulk-list', 'barcode-labels', 'barcode-labels-select-all-checkbox');

  // Setup/Cleanup + Custom badge lists (partials/misc-badge-print-panel):
  // one Select All per form; Setup/Cleanup also gets a Team / Semester /
  // Day Filter popup over each row's data-team-id/-semester-id/-day (set
  // server-side from each badge's own team_id/semester_id and that team's
  // day). Custom badges have no team/semester/day concept, so no popup.
  ['setupCleanup', 'custom'].forEach((type) => {
    const form = document.getElementById(type + '-badge-print-form');
    if (!form) return;
    const list = form.querySelector('.member-picker-list');
    const selectAll = wireSelectAll(list, '.member-picker-row', 'input[name="badgeIds"]', form.querySelector('.' + type + '-badge-select-all-checkbox'));
    wireFilterPopup({
      prefix: type + '-badge',
      container: list,
      rowSelector: '.member-picker-row',
      checkboxSelector: 'input[name="badgeIds"]',
      matches: datasetMatcher({ team: 'teamId', semester: 'semesterId', day: 'day' }),
      selectAll,
    });
  });

  // Class Check-In QR Codes picker: Semester / Day / Room over
  // .qr-picker-row (classes, not members - a separate row class from
  // .print-picker-row so it never gets swept up by the member-list clone
  // step above). Classes have no family, so no Family filter here.
  const qrList = document.getElementById('classcheckin-qr-list');
  wireFilterPopup({
    prefix: 'classcheckin-qr',
    container: qrList,
    rowSelector: '.qr-picker-row',
    matches: datasetMatcher({ semester: 'semester', day: 'day', room: 'room' }),
    selectAll: wireSelectAll(qrList, '.qr-picker-row', 'input[type="checkbox"]', document.getElementById('classcheckin-qr-select-all-checkbox')),
  });

  // Library Barcodes picker: Category, in the same popup (it used to
  // re-filter the list the moment its dropdown changed).
  const libraryList = document.getElementById('library-barcodes-list');
  wireFilterPopup({
    prefix: 'library-barcodes',
    container: libraryList,
    rowSelector: '.library-picker-row',
    matches: datasetMatcher({ category: 'type' }),
    selectAll: wireSelectAll(libraryList, '.library-picker-row', 'input[type="checkbox"]', document.getElementById('library-barcodes-select-all-checkbox')),
  });

  // Schedules panel: no rows to pick, just print links. Day hides the
  // other day's class grid link; Family/Day carry over onto the Member
  // Schedules List link as /admin/schedule/print's own familyId/day params.
  const scheduleLinks = document.getElementById('schedules-print-links');
  if (scheduleLinks) {
    wireFilterPopup({
      prefix: 'schedules',
      onApply(filter) {
        scheduleLinks.querySelectorAll('.schedules-print-link[data-day]').forEach((link) => {
          link.hidden = !!filter.day && link.dataset.day !== filter.day;
        });
        const memberList = scheduleLinks.querySelector('[data-member-list]');
        if (memberList) {
          const params = new URLSearchParams();
          if (filter.family) params.set('familyId', filter.family);
          if (filter.day) params.set('day', filter.day);
          const qs = params.toString();
          memberList.setAttribute('href', '/admin/schedule/print' + (qs ? '?' + qs : ''));
        }
      },
    });
  }

  // A big enough "Select All" (a co-op's full membership - potentially
  // several hundred to 1000+ people) can generate more badge HTML than
  // Netlify's serverless functions are allowed to return in one response
  // (~6MB - Function.ResponseSizeTooLarge), which crashes the whole print
  // request with no page at all. None of these forms need the entire
  // selection answered by one giant response just because they submit as
  // one click: past MAX_PRINT_CHUNK, fetch the print page in same-size
  // batches instead (so no single response can ever cross the cap
  // regardless of how large the co-op's membership grows) and merge every
  // batch's printable content into ONE already-open tab - a single
  // combined print job, not one tab per batch (which stops scaling well
  // once there are more than a couple of batches, and risks browsers'
  // own per-click popup ceilings). A selection at or under the limit
  // still submits the normal, single way with no client-side involvement
  // here at all.
  const MAX_PRINT_CHUNK = 100;

  function chunkArray(arr, size) {
    const out = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  }

  // Mirrors utils/members.js's lastNameOf exactly (final whitespace-
  // separated token) - every print route sorts its own request's members
  // by last name server-side (byLastName), but that sort only ever sees
  // ONE batch's worth of ids at a time here. A real bug report: "select
  // all" on Barcodes Only "still separates the names into different
  // groups when printing" - the checkbox rows themselves are in the
  // Design/Print picker's own family-grouped order (utils/members.js's
  // sortMembersByFamily, via membersWithDetails), not alphabetical, so
  // chunking split that family-grouped order into batches and each
  // batch's own from-scratch alphabetical sort read as several separate
  // A-Z runs back to back instead of one continuous list. Sorting the
  // full selection by last name BEFORE chunking means every batch is
  // already a correctly-ordered slice of one single alphabetical run -
  // each batch's own server-side sort then has nothing left to do.
  function lastNameOf(fullName) {
    const parts = (fullName || '').trim().split(/\s+/);
    return parts.length > 0 ? parts[parts.length - 1] : '';
  }

  function sortCheckboxesByLastName(checkboxes) {
    return checkboxes.slice().sort((a, b) => {
      const nameA = (a.closest('tr') && a.closest('tr').dataset.name) || '';
      const nameB = (b.closest('tr') && b.closest('tr').dataset.name) || '';
      return lastNameOf(nameA).localeCompare(lastNameOf(nameB), undefined, { sensitivity: 'base' }) ||
        nameA.localeCompare(nameB, undefined, { sensitivity: 'base' });
    });
  }

  async function fetchChunkDocument(action, memberIds) {
    const body = new URLSearchParams();
    memberIds.forEach((id) => body.append('memberIds', id));
    const res = await fetch(action, {
      method: 'POST',
      body,
      headers: { 'X-CSRF-Token': window.CSRF_TOKEN || '' },
    });
    return new DOMParser().parseFromString(await res.text(), 'text/html');
  }

  // Every one of these print pages shares the same shape: a
  // #main-content with a .no-print header (title/Print button) followed
  // by one or more top-level "page" elements holding the actual printable
  // content (a repeating .badge-sheet-page per 8/12/30-per-sheet grid, or
  // a single flowing container for the Name Tags + Schedule Cards pair
  // layout). Always appending each batch's page elements as new top-level
  // siblings - rather than trying to detect and merge into an existing
  // matching container - keeps this one merge routine correct for both
  // shapes: a repeating sheet template ends up with more (still correctly
  // fixed-capacity) sheet pages, and the single-flowing-container
  // template ends up with more than one of that same container back to
  // back, which prints identically to one continuous one.
  async function printInChunks(form) {
    const checkedBoxes = sortCheckboxesByLastName(Array.from(form.querySelectorAll('input[name="memberIds"]:checked')));
    const checkedIds = checkedBoxes.map((cb) => cb.value);
    const win = window.open('', '_blank');
    if (!win) return; // Popup blocked - nothing more to do client-side; reducing the selection below MAX_PRINT_CHUNK still works the normal way.
    win.document.write('<!doctype html><title>Preparing print job&hellip;</title><body style="font: 16px sans-serif; padding: 2rem;">Preparing your print job&hellip; this tab will fill in automatically once ready.</body>');
    win.document.close();

    const batches = chunkArray(checkedIds, MAX_PRINT_CHUNK);
    let targetMain = null;
    for (let i = 0; i < batches.length; i++) {
      const doc = await fetchChunkDocument(form.action, batches[i]);
      if (i === 0) {
        // The first batch becomes the tab's real document as-is - full
        // head/nav/scripts intact - so every later batch just adds more
        // printable content into its already-correct #main-content.
        // document.write of a document this size (the full nav/head/
        // page shell) doesn't finish parsing synchronously - querying
        // the DOM immediately after write()/close() can run before the
        // parser has reached #main-content at all, so wait for the
        // popup's own 'load' to actually fire first.
        win.document.open();
        win.document.write('<!doctype html>' + doc.documentElement.outerHTML);
        win.document.close();
        if (win.document.readyState !== 'complete') {
          await new Promise((resolve) => win.addEventListener('load', resolve, { once: true }));
        }
        targetMain = win.document.getElementById('main-content');
        continue;
      }
      try {
        const sourceMain = doc.getElementById('main-content');
        if (!sourceMain || !targetMain) continue;
        // A real bug report: printing several hundred name tags "timed out,
        // wouldn't load all the pages" - re-running the shared renderers
        // over win.document (every batch reprocessing every earlier
        // batch's already-finished content too, not just what's new) was
        // never actually the "idempotent, just as safe" no-op the old
        // comment here claimed. renderNameTagBarcodes redoes real SVG
        // generation for every barcode again; worse, badge-autofit.js's
        // shrink search always resets each field back to its own recorded
        // full-size data-base-font-size before re-measuring - re-running it
        // means redoing the ENTIRE shrink-to-fit search, forced-reflow
        // measurements and all, for every already-fitted card on every
        // later batch. That's O(total batches²) work, not O(n) - batch 5
        // of a many-hundred-member print job was redoing 4 batches' worth
        // of already-finished shrink searches on top of its own, and it
        // only gets worse the bigger the co-op. Scoping both calls to just
        // the newly-imported nodes fixes that: each batch now does exactly
        // its own share of the work, regardless of how many batches came
        // before it.
        const imported = [];
        Array.from(sourceMain.children).forEach((child) => {
          if (child.classList.contains('no-print')) return; // the header/Print button - only the first batch's copy is kept.
          imported.push(targetMain.appendChild(win.document.importNode(child, true)));
        });
        let handledDirectly = false;
        if (typeof win.renderNameTagBarcodes === 'function') {
          imported.forEach((node) => win.renderNameTagBarcodes(node));
          handledDirectly = true;
        }
        if (typeof win.runBadgeAutoFit === 'function') {
          imported.forEach((node) => win.runBadgeAutoFit(node));
          handledDirectly = true;
        }
        // Barcode Only / Barcode Mailing Labels sheets (public/js/barcode-
        // print-shrink-name.js) expose neither function above - a
        // synthetic beforeprint is the only hook they listen for, and that
        // script's own work (re-running JsBarcode + a plain scrollWidth
        // shrink loop, no forced-reflow search) is cheap enough per badge
        // that re-running it over the whole tab hasn't shown the same
        // blowup, so it's left as-is rather than adding scoped support
        // for a page type that isn't the one actually timing out.
        if (!handledDirectly) win.dispatchEvent(new win.Event('beforeprint'));
      } catch (err) {
        // One bad batch shouldn't take down the rest of an otherwise-fine
        // print job - the remaining batches still get appended.
        console.error('Bulk print: failed to merge one batch into the print tab', err);
      }
    }

    // A real request: "after any bulk printing the page should refresh on
    // its own." This path bypasses the form's own native submission
    // entirely (preventDefault above), so bulk-print-refresh.js's generic
    // submit listener never sees a chance to fire for it - reload here
    // instead, once every batch has actually finished landing in the
    // print tab, rather than on that script's fixed short delay (which
    // could easily fire before a many-hundred-member job is done).
    window.location.reload();
  }

  function wireChunkedSubmit(formId) {
    const form = document.getElementById(formId);
    if (!form) return;
    form.addEventListener('submit', (e) => {
      const checkedCount = form.querySelectorAll('input[name="memberIds"]:checked').length;
      if (checkedCount <= MAX_PRINT_CHUNK) return;
      e.preventDefault();
      printInChunks(form);
    });
  }

  ['schedule-print-form', 'bulk-print-form', 'cards-duplex-print-form', 'barcodes-print-form', 'barcode-labels-print-form'].forEach(wireChunkedSubmit);

  // No preview iframe on this hub - every bulk print form here just
  // submits normally (target="_blank"), opening the print page in its
  // own tab (or, past MAX_PRINT_CHUNK, a tab assembled from several
  // smaller requests - see printInChunks above). That page's own
  // print-auto.js opens the OS print dialog as soon as it loads, so
  // clicking Print here is still the
  // only click needed.
})();
