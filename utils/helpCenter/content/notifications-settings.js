module.exports = {
  slug: 'notifications-settings',
  title: 'Settings & Notifications',
  icon: 'gear',
  description: 'Where your settings are, notification choices, push notifications and directory privacy.',
  articles: [
    {
      slug: 'where-are-settings',
      title: 'Where to find your settings',
      summary: 'The gear icon in the top corner opens Settings.',
      audiences: ['member'],
      keywords: ['settings', 'gear', 'preferences', 'options'],
      body: [
        { p: 'Select **Settings** (the gear icon) in the top corner. Depending on your portal, you\'ll see:' },
        { table: { head: ['Card', 'What it does'], rows: [
          ['**Family School Settings** (parents)', 'Your homeschool\'s name, ID, logo and colors for printed records.'],
          ['**Notifications** (parents)', 'Choose email, text and push for each kind of message.'],
          ['**My Privacy**', 'Choose whether your family appears in the Member Directory.'],
          ['**Download App**', 'Install the site on your phone or computer.'],
        ] } },
        { p: 'Your name, contact details, photo and password are under **My Profile**, **Edit**.' },
        { note: 'The Student Portal has no Settings gear. Students change their details and password from **My Profile**.' },
      ],
      related: ['notification-preferences', 'directory-privacy', 'edit-your-profile'],
    },
    {
      slug: 'notification-preferences',
      title: 'Choosing how you get notifications',
      summary: 'Turn email, text and push on or off for each kind of message.',
      audiences: ['member'],
      keywords: ['notification settings', 'email notifications', 'text messages', 'sms', 'push', 'stop emails', 'unsubscribe', 'opt out'],
      body: [
        { p: '**What it does:** For each kind of notification (announcements, registrations, waitlists, assignments and so on), you choose whether it also comes by **Email**, **Text** or **Push**. Every notification always appears in your **Notifications** inbox too.' },
        { steps: [
          'Select **Settings**, then **Notifications** (or go to **Notification Preferences** from the Notifications page menu).',
          'Check or uncheck **Email**, **Text** and **Push** for each **Type**.',
          'Select **Save**.',
        ] },
        { p: '"N/A" means that kind of message is only ever sent one way.' },
        { note: 'Text messages go to the **Phone Number** on your profile. The co-op can also turn a channel off for a message type for everyone.' },
      ],
      related: ['push-notifications', 'notifications-inbox'],
    },
    {
      slug: 'push-notifications',
      title: 'Turning on push notifications on your phone or computer',
      summary: 'Get alerts on this device, even when the site isn\'t open.',
      audiences: ['member'],
      keywords: ['push', 'push notifications', 'alerts', 'phone notifications', 'app notifications', 'iphone', 'android'],
      body: [
        { steps: [
          'On the device you want alerts on, open **Notification Preferences**.',
          'In **Push notifications on this device**, select **Turn on for this device**.',
          'When your browser asks, choose **Allow**.',
          'Select **Send a test** to make sure it works.',
        ] },
        { list: [
          'Do this on each phone, tablet or computer you use.',
          '**iPhone/iPad**: first install the site to your Home Screen (see **Installing the site as an app**), open it from there, then turn push on.',
          'If you see "Notifications are blocked for this site", allow notifications for this site in your browser or phone settings, then reload the page.',
          'To stop push on one device, select **Turn off for this device**.',
        ] },
      ],
      related: ['notification-preferences', 'install-the-app'],
    },
    {
      slug: 'directory-privacy',
      title: 'Showing or hiding your family in the Member Directory',
      summary: 'My Privacy lets you remove yourself or any family member from the directory.',
      audiences: ['member'],
      keywords: ['privacy', 'directory privacy', 'hide', 'remove me', 'show me', 'member directory', 'opt out'],
      body: [
        { p: '**What it does:** Controls whether you and your family members appear in the **Member Directory** that other members can browse.' },
        { steps: [
          'Select **Settings**, then **My Privacy**, then **Manage**.',
          'On **Directory Privacy**, select **Remove Me** next to anyone who shouldn\'t be listed, or **Show Me** to list them again.',
        ] },
        { p: 'Which details are shown (photo, phone, email, address, grade level, family name) is set by the co-op for everyone, not per person.' },
      ],
      related: ['member-directory', 'who-can-see-what'],
    },
  ],
};
