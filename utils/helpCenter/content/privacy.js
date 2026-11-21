module.exports = {
  slug: 'privacy',
  title: 'Privacy & Permissions',
  icon: 'shield',
  description: 'Who can see your family\'s information, and how to control it.',
  articles: [
    {
      slug: 'who-can-see-what',
      title: 'Who can see your information',
      summary: 'What parents, students, teachers, co-op admins and other members can see.',
      audiences: ['member'],
      keywords: ['privacy', 'who can see', 'visible', 'permissions', 'private', 'shared', 'security', 'personal information'],
      body: [
        { table: { head: ['Who', 'What they can see'], rows: [
          ['**You and your family\'s parents**', 'Your family\'s profiles, schedules, class registrations, your children\'s lessons, grades, attendance and handed-in work, your Family School records, and your family\'s Accounting page.'],
          ['**Students**', 'Their own profile, schedule, classes, lessons, grades, attendance and handed-in work. Not their family\'s accounting or other families\' information.'],
          ['**Teachers and assistants**', 'The students enrolled in the classes they teach, those students\' attendance, and the work handed in for their classes. Not other classes.'],
          ['**Co-op Admins**', 'What they need to run co-op days: member and family records (including medical/allergy notes), rosters, attendance, absence forms, schedules, class registrations and volunteer assignments.'],
          ['**Other members**', 'Your listing in the **Member Directory** (only the fields the co-op shares, and only if you haven\'t removed yourself), what you post in **Chat**, **Photos** you add, and your family on an event\'s **Who\'s Registered** list.'],
        ] } },
        { h: 'Kept private' },
        { list: [
          'Handed-in homework and Family School files: only the student, their family, and (for co-op classes) the class\'s teachers and co-op admins can open them.',
          'Your Accounting page: only your family and the co-op\'s leaders.',
          'Photos of members are shown only inside the signed-in site, on the co-op kiosk and on printed name tags. Links to them expire.',
        ] },
        { h: 'Things you choose to share' },
        { list: [
          'Business Directory and Classifieds listings have a **Visibility** choice: **Members only** or **Public**.',
          'Remove yourself or a family member from the Member Directory under **Settings**, **My Privacy**.',
        ] },
      ],
      related: ['directory-privacy', 'account-security-tips'],
    },
  ],
};
