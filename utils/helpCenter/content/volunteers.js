module.exports = {
  slug: 'volunteers',
  title: 'Setup, Cleanup & Volunteering',
  icon: 'broom',
  description: 'Floater assignments, setup and cleanup teams, committees and sign-up lists.',
  articles: [
    {
      slug: 'volunteer-assignments',
      title: 'What am I responsible for on co-op day?',
      summary: 'Check your schedule, floater assignments and setup/cleanup team.',
      audiences: ['parent', 'teacher', 'coop_admin'],
      keywords: ['responsibility', 'assignment', 'job', 'floater', 'duty', 'what do i do', 'volunteer', 'co-op day'],
      body: [
        { list: [
          '**Classes you teach or assist, and floater hours**: **My Profile**, **Schedules** tab, under **Teaching**, **Assisting** and **Floater**.',
          '**Today\'s floater chart**: the **Floater Assignments** screen (see **Floater assignments**).',
          '**Your setup or cleanup team**: the **Setup/Cleanup Teams** screen (see **Setup and cleanup teams**).',
          '**Notifications**: when the co-op assigns you a floater spot or a setup/cleanup task, you get a notification (email, text or push, depending on your settings).',
        ] },
        { tip: 'Can\'t make it? Send an **Absence/Late Form** as early as you can so the co-op can find a replacement.' },
      ],
      related: ['floater-assignments', 'setup-cleanup-teams', 'report-an-absence'],
    },
    {
      slug: 'floater-assignments',
      title: 'Floater assignments',
      summary: 'See who is floating each hour of the co-op day.',
      audiences: ['parent', 'teacher', 'coop_admin'],
      keywords: ['floater', 'floater assignments', 'float', 'substitute', 'hour', 'position'],
      body: [
        { steps: [
          'On the co-op kiosk home screen, open **Floater Assignments**. Signed-in members can also open it from the co-op\'s link.',
          'Choose the day.',
        ] },
        { p: 'The chart shows each hour\'s floater positions and who\'s assigned, for today or the next co-op date. Your own floater hours also appear on **My Profile**, **Schedules**, under **Floater**.' },
        { p: 'Assignments are made by co-op admins. To change one, use **Contact Admins**.' },
      ],
      related: ['volunteer-assignments'],
    },
    {
      slug: 'setup-cleanup-teams',
      title: 'Setup and cleanup teams',
      summary: 'See your team and record your task with your Setup/Cleanup badge.',
      audiences: ['parent', 'teacher', 'coop_admin'],
      keywords: ['setup', 'cleanup', 'clean up', 'team', 'badge', 'task', 'chores'],
      body: [
        { steps: ['Open **Setup/Cleanup Teams** from the co-op kiosk (or the co-op\'s link) and choose the day.'] },
        { p: 'The **Setup/Cleanup Teams** screen shows each team, its leader, and its members.' },
        { p: 'At the kiosk, setup team members scan their **Setup/Cleanup** badge when they check in, and cleanup team members when they check out. That\'s how the co-op knows each task got done. If you see "…has already been logged today", that badge\'s task was already recorded; scan a different one.' },
      ],
      related: ['check-in-at-the-kiosk', 'check-out-at-the-kiosk'],
    },
    {
      slug: 'committees',
      title: 'Joining a committee',
      summary: 'Sign up for an open committee position.',
      audiences: ['parent'],
      keywords: ['committee', 'join a committee', 'volunteer', 'position', 'leader'],
      body: [
        { steps: [
          'On your Parent Portal **Home** page, under **Forms**, select **Join a Committee**.',
          'Find the committee and position you\'d like, and select **Sign Up**.',
        ] },
        { p: 'Select **Cancel** next to a position to take yourself off it. Each committee shows its **Committee Leader**.' },
      ],
    },
    {
      slug: 'signup-lists',
      title: 'Sign-up lists and volunteer shifts',
      summary: 'Claim an item or a volunteer shift from a list the co-op shares.',
      audiences: ['member'],
      keywords: ['sign up list', 'signup', 'volunteer shift', 'bring', 'claim'],
      body: [
        { p: 'The co-op sometimes shares a link to a sign-up list (for example, things to bring) or a volunteer list with shifts.' },
        { steps: ['Open the link while signed in.', 'Select **Sign Up** next to the item or shift you\'ll take.'] },
        { p: 'On a volunteer list, you can cancel your own shift from the same page.' },
      ],
    },
    {
      slug: 'volunteer-hours',
      title: 'Logging volunteer hours (Family School)',
      summary: 'Record a student\'s volunteer hours for their homeschool records.',
      audiences: ['parent'],
      permission: 'view_fsm_volunteer_hours',
      keywords: ['volunteer hours', 'service hours', 'community service', 'log hours'],
      body: [
        { steps: [
          'Open **Family School Management**, then **Volunteer Hours**.',
          'Select **+ Add Hours**.',
          'Choose the **Student**, then enter the **Date**, **Hours** and **Activity**.',
          'Select **Save**.',
        ] },
        { p: 'Use **Filter** to pick a **Student** and **School Year**, and the export, print and PDF buttons to keep a copy.' },
      ],
      related: ['family-school-overview'],
    },
  ],
};
