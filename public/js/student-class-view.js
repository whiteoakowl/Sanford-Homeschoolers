// Powers the click-a-class-card popup on Student Portal's own Co-op
// Schedule grid (views/student-classes.ejs) - a real request: "Student
// portal, co-op schedule, should be able to click on each class and view
// the information, student is not able to register for classes." Same
// fetch-a-fragment-into-a-shared-dialog pattern as Co-op Teacher Portal's
// own public/js/teacher-class-view.js (see that file's own comment);
// this is the Student Portal equivalent, read-only (no register
// controls) and not gated to classes this student is enrolled in.
(function () {
  const dialog = document.getElementById('student-class-dialog');
  if (!dialog || !window.loadFragmentIntoDialog) return;

  document.addEventListener('click', (e) => {
    const card = e.target.closest('[data-view-class]');
    if (!card) return;
    const id = card.getAttribute('data-view-class');
    window.loadFragmentIntoDialog(dialog, `/student/classes/${id}/fragment`).catch(() => {});
  });
})();
