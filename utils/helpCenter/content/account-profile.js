module.exports = {
  slug: 'account-profile',
  title: 'Account & Profile',
  icon: 'user-circle',
  description: 'Viewing and updating your profile, photo, contact details and password.',
  articles: [
    {
      slug: 'view-your-profile',
      title: 'Viewing your profile',
      summary: 'My Profile shows your details, your family, your schedules and your event signups.',
      audiences: ['member'],
      keywords: ['profile', 'my profile', 'member id', 'account', 'details'],
      body: [
        { steps: ['Select **My Profile** (the person icon) in the top corner.'] },
        { p: 'My Profile has three tabs:' },
        { list: [
          '**Profile**: your photo, contact details, birthday, Member ID, medical/allergy notes, family members, sections and portal roles. Select a family member\'s name to see their profile.',
          '**Schedules**: your family\'s co-op schedules. See **Viewing your family\'s schedules**.',
          '**Event Signups**: the events your family is registered for, by month.',
        ] },
        { tip: 'Your **Member ID** is the 6-digit number on your name tag barcode. You can type it at the kiosk if you don\'t have your name tag.' },
      ],
      related: ['edit-your-profile', 'view-your-schedule', 'my-event-registrations'],
    },
    {
      slug: 'edit-your-profile',
      title: 'Editing your profile',
      summary: 'Change your name, contact details, address, photo or medical notes.',
      audiences: ['member'],
      keywords: ['edit', 'update', 'change', 'name', 'phone', 'address', 'city', 'state', 'zip', 'contact information', 'profile'],
      body: [
        {
          steps: [
            'Select **My Profile** in the top corner.',
            'On the **Profile** tab, select **Edit**.',
            'Change what you need under **General**: **Full Name**, **Email**, **Phone Number**, **Address**, **Address 2**, **City**, **State**, **Zip Code** or **Medical / Allergy Notes**.',
            'Select **Save**.',
          ],
        },
        { p: 'You\'ll see "Profile updated." when it saves. A required field left blank shows a message at the top of the form.' },
        { note: 'The **Email** on your profile is your contact email. To change the email you **sign in** with, ask a co-op admin with **Contact Admins**.' },
        { note: 'Birthdays and grade levels are changed by a co-op admin. Use **Contact Admins** if one is wrong.' },
      ],
      related: ['change-your-photo', 'change-password', 'add-a-child', 'edit-a-family-member'],
    },
    {
      slug: 'change-your-photo',
      title: 'Adding or changing your profile photo',
      summary: 'Upload a new photo from the Edit page.',
      audiences: ['member'],
      keywords: ['photo', 'picture', 'image', 'profile photo', 'upload'],
      body: [
        {
          steps: [
            'Open **My Profile** and select **Edit**.',
            'Under **Photo**, choose a new picture. It replaces the one on file.',
            'Select **Save**.',
          ],
        },
        { p: 'Large phone photos are shrunk automatically before they upload. To change a child\'s photo, edit that child (see **Editing a family member**).' },
        { p: 'Photos are kept private. They\'re only shown inside the signed-in site, on the co-op kiosk and on printed name tags.' },
      ],
      related: ['edit-your-profile', 'edit-a-family-member'],
    },
    {
      slug: 'primary-parent',
      title: 'What "Primary Parent" means',
      summary: 'The Primary Parent is the main adult for the family\'s co-op account.',
      audiences: ['parent'],
      keywords: ['primary parent', 'main contact', 'billing'],
      body: [
        { p: 'Each family has one **Primary Parent**, shown with a star on the profile. The co-op uses the Primary Parent as the main adult for the family, including for the family\'s **Accounting** charges.' },
        { steps: ['Open **My Profile** and select **Edit**.', 'Check or uncheck **Primary Parent** under **General**.', 'Select **Save**.'] },
      ],
      related: ['view-your-account-balance'],
    },
  ],
};
