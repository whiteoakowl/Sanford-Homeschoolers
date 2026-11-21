module.exports = {
  slug: 'main-content',
  title: 'Main Admin: Volunteers & Community Content',
  icon: 'users',
  description: 'Committees and sign-up lists, photos, publications, Nature News, resource links, directory, classifieds, babysitters and documents.',
  articles: [
    {
      slug: 'main-admin-volunteers',
      title: 'Committees, Sign-Up Lists and Volunteer Lists',
      summary: 'Create committees and positions, item sign-up lists, and shift volunteer lists.',
      audiences: ['main_admin'],
      permission: 'manage_volunteers',
      keywords: ['volunteers', 'committee', 'sign-up list', 'volunteer list', 'shifts', 'positions', 'copy link', 'import'],
      body: [
        { h: 'Committees' },
        { steps: [
          'Open **Volunteers** (**Committees**) and select **+ Add Committee**. Enter a **Name**, **Description** and **Leader**, then **Create**.',
          'Open the committee. **+ Add Position** (**Position Name**, **Slots Needed (optional)**) creates spots members can sign up for under **Join a Committee**. **+ Add Member** adds someone directly.',
          'Check members and select **Email Selected** to email them. Print or export the list.',
        ] },
        { h: 'Sign-Up Lists (things to bring)' },
        { steps: [
          'Open **Sign-Up Lists** and select **+ Add List**. Give a **Title**, and optionally **Attach to Event** or **Attach to Member**.',
          'In the list, **+ Add Item** with an **Item Name**, **Quantity Needed** and **Notes**.',
          'Select **Copy Link** and share it with members.',
        ] },
        { p: '**Import** creates lists from a spreadsheet (**Download Sample File** shows the format). Turn a list off with **Enabled**.' },
        { h: 'Volunteer Lists (shifts)' },
        { p: 'Open **Volunteer Lists**, select **+ Add List**, then **+ Add Shift** with a **Job Name**, optional **Date**, **Start Time**, **End Time**, and **Slots Needed**. Share it with **Copy Link**.' },
      ],
    },
    {
      slug: 'main-admin-name-tags',
      title: 'Name Tags (Main Admin)',
      summary: 'Design, print and handle name tag requests from Main Admin.',
      audiences: ['main_admin'],
      permission: 'manage_name_tags',
      keywords: ['name tags', 'print', 'design', 'requests', 'plain parent tags', 'playground qr'],
      body: [
        { p: 'Open **Name Tags**. It has the same **Design**, **Print** and **Requests** tabs as Co-op Admin\'s **Design/Print**, plus:' },
        { list: [
          '**Print Plain Parent Tags**: simple parent tags without the full design.',
          '**Print Playground Check-In QR Codes**: QR codes for the playground roster.',
        ] },
      ],
      related: ['coop-admin-printing', 'design-name-tags'],
    },
    {
      slug: 'main-admin-photos',
      title: 'Photo albums and photo approvals',
      summary: 'Create albums, upload, approve members\' photos and archive.',
      audiences: ['main_admin'],
      permission: 'manage_publications',
      keywords: ['photos', 'album', 'upload', 'approve photos', 'pending photos', 'cover photo', 'visibility', 'archive'],
      body: [
        { steps: [
          'Open **Photos** and select **+ New Album**. Enter a **Title** and **Description**, choose **Visibility** (**Members Only** or **Public**), and check **Members can add photos** if families may add to it. Select **Create**.',
          'Open the album to upload **Images (JPG/PNG, up to 20 at once)** with a **Caption**, set a **Cover Photo**, or **Remove** photos.',
        ] },
        { p: '**Pending Photos** lists what members added. Select **Approve** or **Reject**. Use **Archive** for old albums and **Download Album** to save one.' },
      ],
    },
    {
      slug: 'main-admin-publications',
      title: 'Publications and Nature News',
      summary: 'Write articles, and review students\' Nature News.',
      audiences: ['main_admin'],
      permission: 'manage_publications',
      keywords: ['publications', 'article', 'nature news', 'approve', 'publish'],
      body: [
        { list: [
          '**Publications**: **+ New Article**, give a **Title**, **Create Draft**, then write the **Content**, choose **Visibility**, and select **Publish**. **Move Back to Draft** unpublishes it.',
          '**Fun**, **Nature News**: student discoveries under **Pending Review**. **Approve** or **Reject** each one.',
        ] },
      ],
    },
    {
      slug: 'main-admin-resource-links',
      title: 'Resource Links',
      summary: 'Add resources, manage categories, and approve member suggestions.',
      audiences: ['main_admin'],
      permission: 'manage_resources',
      keywords: ['resource links', 'resources', 'approve', 'deny', 'category', 'shown on'],
      body: [
        { list: [
          '**+ Add Resource**: **Title**, **Website**, **Description**, **City**, **State**, **Category**, and which portals it\'s **Shown On**.',
          '**+ Add/Edit Category**: add or rename categories.',
          '**Approvals**: members\' suggestions. **Approve** or **Deny** each.',
        ] },
      ],
    },
    {
      slug: 'main-admin-directory-classifieds',
      title: 'Business Directory and Classifieds',
      summary: 'Approve listings, manage categories, and archive.',
      audiences: ['main_admin'],
      permission: 'manage_directory',
      keywords: ['business directory', 'classifieds', 'listing', 'approve', 'deny', 'archive', 'category'],
      body: [
        { p: 'Both work the same way:' },
        { list: [
          '**Requests**: new listings from members. **Approve** or **Deny** them.',
          'Select **Edit** on a listing to change its details, **Visibility** or image. **Archive** or **Delete** it.',
          '**+ Add Category** manages categories.',
          '**Archive** lists archived listings; **Restore** brings one back.',
        ] },
        { p: 'Classifieds uses the **Classifieds** menu and its own permission.' },
      ],
    },
    {
      slug: 'main-admin-babysitters',
      title: 'Babysitter profiles',
      summary: 'Approve student babysitter profiles, or add one yourself.',
      audiences: ['main_admin'],
      permission: 'manage_babysitters',
      keywords: ['babysitter', 'approve', 'reject', 'profile'],
      body: [
        { list: [
          '**Approvals**: approve or reject profiles families and students submit.',
          '**+ Add Babysitter Profile**: create one for a **Member**.',
          '**Settings**: **Require Main Admin approval for every member submission and edit**.',
        ] },
      ],
    },
    {
      slug: 'main-admin-documents',
      title: 'Documents',
      summary: 'Upload documents and choose who can see them.',
      audiences: ['main_admin'],
      permission: 'manage_documents',
      keywords: ['documents', 'upload', 'who can view', 'copy link', 'pdf', 'word'],
      body: [
        { steps: [
          'Open **Settings**, then **Documents**, and select **Add Documents**.',
          'Enter a **Title**, choose a **File (PDF or Word)** and an optional **Image**, and select **Upload**.',
          'Open **Who Can View** to choose which roles see it, and **Save**.',
        ] },
        { p: '**Copy Link** copies a link to share. Documents stay private: they\'re only opened through the site, with a link that expires after a few minutes.' },
      ],
    },
  ],
};
