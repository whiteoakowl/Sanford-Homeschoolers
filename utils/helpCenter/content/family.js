module.exports = {
  slug: 'family',
  title: 'Family & Members',
  icon: 'users',
  description: 'Adding children and other parents, updating their details, and medical notes.',
  articles: [
    {
      slug: 'add-a-child',
      title: 'Adding a child to your family',
      summary: 'Use + Add Child on your Edit Profile page.',
      audiences: ['parent'],
      keywords: ['add child', 'new child', 'student', 'kid', 'family member', 'sibling'],
      body: [
        {
          steps: [
            'Select **My Profile** in the top corner, then **Edit**.',
            'Scroll to **Children** and select **+ Add Child**.',
            'Fill in **Full Name**, **Birthdate** and any **Medical / Allergy Notes**. Add a **Photo** if you like.',
            'If this child should sign in to the Student Portal, check **Give this student their own portal login**, then enter a **Student Login Email** and a **Password**.',
            'Select **Save**.',
          ],
        },
        { note: 'If you leave the student\'s password blank, a default password is used. Set a real password, or have your student change it right away from **My Profile**, **Edit**.' },
        { p: 'Your new child appears in your family right away and can be registered for classes and events.' },
      ],
      related: ['add-a-parent', 'edit-a-family-member', 'register-for-a-class'],
    },
    {
      slug: 'add-a-parent',
      title: 'Adding another parent or guardian',
      summary: 'Use + Add Adult on your Edit Profile page.',
      audiences: ['parent'],
      keywords: ['add parent', 'spouse', 'guardian', 'adult', 'second parent', 'husband', 'wife'],
      body: [
        {
          steps: [
            'Open **My Profile**, then **Edit**.',
            'Under **Additional Parents / Guardians**, select **+ Add Adult**.',
            'Enter their **Full Name**, **Email** and **Phone Number**. Check **Address is the same as the first parent/guardian**, or type their address.',
            'To let them sign in with their own email and password, check **Give this parent their own portal login** and set a **Password**.',
            'Select **Save**.',
          ],
        },
      ],
      related: ['add-a-child', 'primary-parent'],
    },
    {
      slug: 'edit-a-family-member',
      title: 'Editing a family member\'s information',
      summary: 'Update a child\'s or parent\'s contact details, photo or medical notes.',
      audiences: ['parent'],
      keywords: ['edit child', 'update child', 'student information', 'medical', 'allergy', 'contact', 'birthday', 'grade'],
      body: [
        { h: 'From their profile' },
        {
          steps: [
            'Open **My Profile**. On the **Profile** tab, select the family member\'s name.',
            'Select **Edit**.',
            'Update **Name**, **Address**, **City**, **State**, **Zip**, **Phone**, **Email** or **Medical/Allergy Notes**. For a student with their own login, you can also change their **Login Email**.',
            'Select **Save**.',
          ],
        },
        { h: 'From your own Edit Profile page' },
        { p: 'Everyone in your family also appears under **Additional Parents / Guardians** and **Children** on your own **Edit** page. You can change their details or photo there, and set a **New Password (leave blank to keep the current one)** for a family member who has a login.' },
        { note: '**Birthday** and **Grade Level** show "(contact an admin to change)". Send the correct details with **Contact Admins**.' },
      ],
      related: ['medical-allergy-notes', 'add-a-child'],
    },
    {
      slug: 'medical-allergy-notes',
      title: 'Medical and allergy notes',
      summary: 'Keep each child\'s allergy and medical information up to date for teachers and staff.',
      audiences: ['parent'],
      keywords: ['medical', 'allergy', 'allergies', 'emergency', 'health', 'epipen'],
      body: [
        { p: 'Each family member has a **Medical / Allergy Notes** field. Co-op admins see these notes on rosters and on the allergy and medical list they use during co-op days.' },
        {
          steps: [
            'Open **My Profile** and select the family member (or your own **Edit** page).',
            'Select **Edit**.',
            'Type the information in **Medical / Allergy Notes**.',
            'Select **Save**.',
          ],
        },
        { tip: 'Keep it short and specific, for example: "Peanut allergy - EpiPen in backpack."' },
      ],
      related: ['who-can-see-what'],
    },
    {
      slug: 'remove-a-family-member',
      title: 'Removing a family member',
      summary: 'Ask a co-op admin to remove someone from your family.',
      audiences: ['parent'],
      keywords: ['remove', 'delete', 'family member', 'leaving'],
      body: [
        { p: 'Family members can\'t be removed from the website by a parent. Use **Contact Admins** and tell the co-op who should be removed. They\'ll take care of it.' },
        { p: 'To take a child out of co-op classes, see **Withdrawing from a class or from co-op classes**.' },
      ],
      related: ['contact-admins', 'withdraw-from-a-class'],
    },
    {
      slug: 'student-logins',
      title: 'Student logins',
      summary: 'Give a student their own Student Portal sign-in.',
      audiences: ['parent'],
      keywords: ['student login', 'child account', 'student password', 'student portal'],
      body: [
        { p: 'A student with their own login can sign in to the **Student Portal** to see their schedule, lessons, grades, chat and activities.' },
        { list: [
          'New child: check **Give this student their own portal login** when you add them (see **Adding a child to your family**).',
          'Existing child: open your **Edit** page, find the child under **Children**, check **Give this student their own portal login**, add a **Student Login Email**, and select **Save**.',
          'To reset a student\'s password, type it in **New Password (leave blank to keep the current one)** for that child on your **Edit** page.',
        ] },
      ],
      related: ['student-portal-overview', 'add-a-child'],
    },
  ],
};
