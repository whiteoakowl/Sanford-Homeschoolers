// Read-only lesson plan for one class - the class QR code's View Lesson
// Plan page (routes/kiosk-class-checkin.js) and Co-op Teacher Portal's
// Attendance > class > View Lesson Plan (routes/teacher-portal.js) both
// show it (views/partials/lesson-plan-readonly.ejs). Content titles only,
// never quiz answers. approvedOnly: just what students can see.
const { assignmentsForClass, contentItemsForAssignment } = require('./academics');
const { formatDateLong } = require('./dates');

async function lessonPlanSummary(classId, { approvedOnly = true } = {}) {
  const lessons = [];
  for (const lesson of await assignmentsForClass(classId)) {
    if (approvedOnly && lesson.approval_status !== 'approved') continue;
    const items = await contentItemsForAssignment(lesson.id);
    lessons.push({
      ...lesson,
      openDateLabel: lesson.open_date ? formatDateLong(lesson.open_date) : null,
      closeDateLabel: lesson.close_date ? formatDateLong(lesson.close_date) : null,
      contentItems: items.map((i) => ({ title: i.title, type: i.type, dueDateLabel: i.due_date ? formatDateLong(i.due_date) : null })),
    });
  }
  return lessons;
}

module.exports = { lessonPlanSummary };
