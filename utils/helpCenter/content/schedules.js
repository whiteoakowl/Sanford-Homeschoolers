module.exports = {
  slug: 'schedules',
  title: 'Schedules & Calendars',
  icon: 'calendar-check',
  description: 'Your family\'s co-op schedule, student and teacher schedules, and the annual calendar.',
  articles: [
    {
      slug: 'view-your-schedule',
      title: 'Viewing your family\'s schedules',
      summary: 'My Profile, Schedules shows every family member\'s classes by semester and day.',
      audiences: ['member'],
      keywords: ['schedule', 'my schedule', 'child schedule', 'class times', 'room', 'classroom', 'where is my class', 'floater', 'teaching', 'assisting'],
      body: [
        { steps: [
          'Select **My Profile** in the top corner.',
          'Select the **Schedules** tab.',
        ] },
        { p: 'Each family member\'s schedule is grouped by semester, then by day. Each class shows its **Class Details** (name and time) and **Location/ Instructor** (room and teacher). Headings show what each person is doing:' },
        { list: [
          '**Signed Up**: classes they\'re registered for.',
          '**Teaching** and **Assisting**: classes they help lead.',
          '**Floater**: hours they\'re assigned as a floater.',
        ] },
        { tip: 'Use the print, PDF and CSV buttons above the schedules to print them, save them as a PDF, or open them in a spreadsheet.' },
      ],
      related: ['student-co-op-schedule', 'teacher-class-schedule', 'print-and-export'],
    },
    {
      slug: 'student-co-op-schedule',
      title: 'The Co-op Schedule (students)',
      summary: 'Students see their own classes on Co-op Schedule.',
      audiences: ['student'],
      permission: 'view_student_classes',
      keywords: ['co-op schedule', 'my classes', 'student schedule', 'room', 'teacher', 'time'],
      body: [
        { steps: ['In the Student Portal, open **Co-op Schedule**.', 'Pick a **Semester** if more than one is listed.'] },
        { p: 'Each class shows its **Time**, **Class Name**, **Room**, **Grade Level**, **Teacher** and **Assistant**. Use **Print**, **Download PDF** or **Export CSV** at the top.' },
      ],
      related: ['student-portal-overview'],
    },
    {
      slug: 'annual-calendar',
      title: 'The Annual Calendar',
      summary: 'Co-op days and breaks for the year, color-coded.',
      audiences: ['parent'],
      keywords: ['annual calendar', 'school year', 'co-op days', 'breaks', 'holidays', 'calendar colors', 'year'],
      body: [
        { steps: ['On your Parent Portal **Home** page, under **Forms**, select **Annual Calendar**.'] },
        { p: 'Each month shows the co-op\'s days in color. The key at the top explains what each color means (for example, co-op days and days off).' },
      ],
      related: ['view-the-calendar'],
    },
  ],
};
