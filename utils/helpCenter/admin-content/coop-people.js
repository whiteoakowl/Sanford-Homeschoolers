module.exports = {
  slug: 'coop-people',
  title: 'Co-op Admin: Members, Communication & Printing',
  icon: 'users',
  description: 'Members, texting and emailing, announcements, training, documents, orientation, and Design/Print.',
  articles: [
    {
      slug: 'coop-admin-members',
      title: 'Members',
      summary: 'Find members, see profiles, notes, cards and schedules, and text or email them.',
      audiences: ['coop_admin'],
      keywords: ['members', 'member list', 'filter', 'notes', 'text member', 'view cards', 'view schedule', 'member profile', 'family', 'grade level report', 'bulk action'],
      body: [
        { p: 'Open **Members**.' },
        { list: [
          '**Filter** (**Filter Members**) narrows the list by type, **Role**, **Family**, **Roster Day** and more. Select **Apply Filter**.',
          'Row buttons: **Notes** (private admin notes), **Text** (send a text), **View Cards** (name tag and schedule card), **View Schedule**, and **Add to Name Tag Request Log**.',
          '**Bulk Action**: check members, then choose **Email** or **Text** to message them all.',
          'Select a name to open the profile: **Profile**, **Class Schedule** and **Attendance** tabs, a **Family Member** switcher, and **Edit Profile**.',
          '**Grade Level Report**: how many students are in each grade, with names.',
          'Use **Export CSV**, **Print** or **Download PDF** for the list.',
        ] },
        { p: 'New accounts, approvals, locking and archiving are handled by the Main Admin.' },
      ],
    },
    {
      slug: 'coop-admin-communication',
      title: 'Announcements, texts and emails',
      summary: 'Send now or schedule for later, to everyone or a chosen group.',
      audiences: ['coop_admin'],
      keywords: ['announcement', 'send announcement', 'text', 'email', 'schedule for later', 'communication', 'message families', 'recipients'],
      body: [
        { h: 'Announcements' },
        { steps: [
          'Open **Communication**, then **Announcements**.',
          'Enter a **Title** and **Message**.',
          'Under **Send to**, choose **Everyone (all active members)**, specific roles (for example parents or teachers), and/or **Public Homepage**.',
          'Select **Send Now**, or **Schedule for Later** and choose a **Date** and **Time**.',
        ] },
        { p: 'Announcements appear on portal Home pages and in Notifications, and go out by email, text or push based on each member\'s settings. **Past Announcements** lists what was sent.' },
        { h: 'Text and Email' },
        { steps: [
          'Open **Communication**, then **Text** or **Email**.',
          'Use **Filter** (**Role**, **Section**, **Grade Level**, **Age Group**, **Registered for Classes**) and check the people to message.',
          'Select **Send Email** (or the text button) to write the message. Email has **Subject**, **Message** and an optional **Reply-To**. Text has **Message** and an optional **Image**.',
          'Choose **Send right away** or **Schedule for later**.',
        ] },
        { p: 'The past and scheduled lists show each message\'s **Recipients** and **Date & Time**. Scheduled ones can be sent early with **Send Now**.' },
      ],
    },
    {
      slug: 'coop-admin-training',
      title: 'Training',
      summary: 'Build training, assign it, and see results.',
      audiences: ['coop_admin'],
      keywords: ['training', 'assign training', 'training report', 'quiz', 'new training', 'lessons'],
      body: [
        { steps: [
          'Open **Training** and select **+ New Training**. Enter a **Title**, **Description**, **Estimated Time (minutes)** and **Passing Score (%)**, then select **Create**.',
          'In the builder, add lessons and quiz questions.',
          'Assign it: check **Members** (or **Select All**), set an optional **Due Date**, and select **Assign Training**.',
          'Select **View Report** to see each member\'s **Status**, scores and **Attempts**.',
        ] },
      ],
    },
    {
      slug: 'coop-admin-documents',
      title: 'Documents',
      summary: 'Upload documents and choose who can see them.',
      audiences: ['coop_admin'],
      keywords: ['documents', 'upload', 'pdf', 'word', 'who can view', 'copy link', 'share'],
      body: [
        { steps: [
          'Open **Documents** and select **Add Documents**.',
          'Enter a **Title**, choose a **File (PDF or Word)**, and add an optional **Image**.',
          'Select **Upload**.',
          'Open **Who Can View** on the document to choose which roles see it, then **Save**.',
        ] },
        { p: '**Copy Link** copies a link to share. The trash icon deletes a document.' },
      ],
    },
    {
      slug: 'coop-admin-orientation',
      title: 'Orientation tracking',
      summary: 'New families\' tours and open house.',
      audiences: ['coop_admin'],
      keywords: ['orientation', 'tour', 'open house', 'new families', 'tracking', 'check-in'],
      body: [
        { list: [
          '**Orientation**, **Orientation Tracking**: each new family\'s progress by **Semester**, with export, print and PDF. **Orientation Settings** sets the steps.',
          '**Tour Check-In** and **Open House Check-In**: who has checked in. **Copy Link** copies the check-in link. Families can also use the kiosk\'s **Orientation Kiosk**.',
        ] },
      ],
    },
  ],
};
