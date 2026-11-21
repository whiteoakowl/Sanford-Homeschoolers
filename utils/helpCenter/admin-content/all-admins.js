// Guides that apply to both Co-op Admins and Main Admins.
module.exports = {
  slug: 'all-admins',
  title: 'All Admins: Printing, Quick Links & Safety',
  icon: 'printer',
  description: 'Design and printing, quick links to kiosk screens, and keeping members\' information safe.',
  articles: [
    {
      slug: 'coop-admin-printing',
      title: 'Design/Print: what you can print',
      summary: 'Name tags, schedule cards, badges, QR codes, labels, schedules and logs.',
      audiences: ['coop_admin', 'main_admin'],
      keywords: ['print', 'design print', 'name tags', 'schedule cards', 'badges', 'qr codes', 'barcode labels', 'print schedules', 'print logs', 'copies', 'requests'],
      body: [
        { p: 'Open **Design/Print** (Main Admin: **Name Tags**).' },
        { table: { head: ['Tab', 'What it does'], rows: [
          ['**Design**', 'Lay out name tags, schedule cards and badges. See **Designing name tags and schedule cards**.'],
          ['**Print**', 'Choose what to print: **Name Tags**, **Schedule Cards**, **Setup/Cleanup Badges**, **Setup/Cleanup Bypass Badges**, **Custom Badges**, **Barcode Mailing Labels**, **Library Barcodes**, **QR Codes for Classes** or **Playground Check-In QR Codes**. Pick people with **Search** or **Select All**, set **How many copies?**, and select **Print**.'],
          ['**Print** (lower)', '**Print Schedules** (each day\'s class schedule and the **Member Schedules List**) and **Print Logs**.'],
          ['**Requests**', 'Name tag requests from families. **Archived** shows finished ones.'],
        ] } },
        { tip: 'Name tags with a schedule on the back print as a double-sided set. Turn on duplex printing.' },
      ],
      related: ['design-name-tags'],
    },
    {
      slug: 'design-name-tags',
      title: 'Designing name tags and schedule cards',
      summary: 'Add text, images, barcodes and shapes; style, layer and save templates.',
      audiences: ['coop_admin', 'main_admin'],
      keywords: ['design', 'name tag design', 'template', 'font', 'color', 'shape', 'barcode', 'image', 'text', 'outline', 'border', 'reset', 'layer', 'background'],
      body: [
        { steps: [
          'Open **Design/Print**, then **Design** (Main Admin: **Name Tags**, **Design**).',
          'Choose what to design: **Student Name Tag**, **Parent Name Tag**, **Admin Name Tag**, **Schedule Card**, **Setup/Cleanup Badge** or **Custom Badge**.',
        ] },
        { h: 'Adding and changing elements' },
        { list: [
          '**Add Text**, **Add Image**, **Add Barcode** and **Add Schedule Table** put a new element on the design. **Add Element** adds shapes.',
          'Drag an element to move it; drag a corner to resize it.',
          'With an element selected, change its **Font**, **Font size**, **Bold**, **Italic**, **Color**, **Text align**, **Fill color**, **Border color**, **Border width**, **Line style** or **Opacity**.',
          '**Bring to Front**, **Bring Forward**, **Send Backward** and **Send to Back** change the **Layer order**. **Duplicate** copies an element, **Lock** stops it moving, and **Delete Element** removes it.',
          'Images: **Crop Image**, then **Apply Crop**.',
          '**Change Background** sets the card\'s background.',
          '**Undo**, **Redo**, **Zoom**, **Toggle Grid** and **Toggle Snap to Grid** help with layout.',
        ] },
        { h: 'Saving' },
        { list: [
          '**Save Template** saves the design. You\'ll be warned about **Unsaved changes** if you leave first.',
          '**Copy Design to All Name Tags** applies this layout to the other name tag types.',
          '**Reset to Default** goes back to the original design.',
        ] },
      ],
      related: ['coop-admin-printing'],
    },
    {
      slug: 'main-admin-quick-links',
      title: 'Quick Links',
      summary: 'One-tap links to every kiosk screen and public form.',
      audiences: ['main_admin', 'coop_admin'],
      keywords: ['quick links', 'kiosk link', 'check-in kiosk', 'membership form link'],
      body: [
        { p: '**Settings**, **Quick Links** lists links to the **Full Kiosk Screen**, **Check-In Kiosk**, **Check-Out Kiosk**, **Class Check-In Kiosk**, **Find a Parent**, **Floater Assignments**, **Name Tag Form**, **Absence/Late Form**, **Annual Calendar**, **Membership Form** and **Public Homepage**. Open one on the device you\'re setting up.' },
        { note: 'Kiosk screens ask for the Class Check-In PIN once a day on each device.' },
      ],
    },
    {
      slug: 'main-admin-security-practices',
      title: 'Keeping the site and members\' information safe',
      summary: 'Good habits for admins.',
      audiences: ['main_admin', 'coop_admin'],
      keywords: ['security', 'safe', 'privacy', 'passwords', 'pin', 'best practices', 'kiosk link'],
      body: [
        { list: [
          'Give admin positions only the pages they need.',
          'Change default passwords and the default Class Check-In PIN. Change the PIN if it may have been shared too widely.',
          'Share the kiosk link and PIN only with people running co-op days.',
          'Log out of admin accounts on shared computers.',
          'Approve photos, listings and posts before they go public, and choose **Members only** visibility unless something is meant for the public.',
          'Review the **Audit Log** now and then.',
        ] },
      ],
    },
  ],
};
