module.exports = {
  slug: 'name-tags',
  title: 'Name Tags & Schedule Cards',
  icon: 'badge',
  description: 'Printing your family\'s name tags and requesting new ones.',
  articles: [
    {
      slug: 'print-your-name-tags',
      title: 'Printing your family\'s name tags',
      summary: 'Print name tags, with each person\'s schedule on the back if you want.',
      audiences: ['parent'],
      permission: 'view_parent_name_tags',
      keywords: ['name tag', 'badge', 'print name tag', 'schedule card', 'barcode', 'lanyard'],
      body: [
        { steps: [
          'In the Parent Portal, open **Name Tags**.',
          'Check each family member whose name tag you want.',
          'Check **Include schedule on the back** to print their schedule card on the back.',
          'Select **Print Selected**.',
        ] },
        { p: 'Each name tag has a barcode for checking in and out at the kiosk. The design is set by the co-op.' },
        { tip: 'For two-sided printing, turn on double-sided (duplex) printing in your printer settings.' },
      ],
      related: ['name-tag-form', 'check-in-at-the-kiosk'],
    },
    {
      slug: 'name-tag-form',
      title: 'Requesting a new or replacement name tag',
      summary: 'Use the Name Tag Form for a new, lost, or updated name tag.',
      audiences: ['parent'],
      permission: 'view_parent_name_tag_form',
      keywords: ['name tag form', 'lost name tag', 'new name tag', 'replacement', 'schedule change', 'request'],
      body: [
        { steps: [
          'Open **Co-op Classes**, then **Name Tag Form**. (It\'s also under **Forms** on your Home page.)',
          'Under **Your Name**, choose your name, then check each person who needs one (or **Select All**).',
          'Under **What Do You Need?**, choose **New Name Tag**, **Lost Name Tag**, **Schedule Change** or **Both**.',
          'Choose the **Day** and add a **Description** if needed.',
          'Select **Submit**.',
        ] },
        { p: 'The co-op prints it for you. Requests show on the co-op\'s Name Tag Requests list.' },
      ],
      related: ['print-your-name-tags'],
    },
  ],
};
