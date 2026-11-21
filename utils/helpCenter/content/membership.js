module.exports = {
  slug: 'membership',
  title: 'Membership',
  icon: 'badge',
  description: 'How membership works, your membership status, and the Policy Handbook.',
  articles: [
    {
      slug: 'how-membership-works',
      title: 'How membership works',
      summary: 'New families request membership online, and a co-op admin approves it.',
      audiences: ['member'],
      keywords: ['membership', 'join', 'request membership', 'register', 'new family', 'approval', 'fee'],
      body: [
        { p: 'New families join by filling out the **Request Membership** form, reached from **Member Registration** on the public website. The form asks for:' },
        { list: [
          '**Parent / Guardian** details, a photo, and a password for signing in.',
          'Any **Additional Parents / Guardians** (**+ Add Adult**) and **Children** (**+ Add Child**).',
          '**SMS Notifications** consent, if you want text messages.',
          'Agreement to the **Policy Handbook**, **Privacy Policy** and **Terms and Conditions**.',
          'A **Payment** section showing the membership fee and how to pay it, when the co-op charges one.',
        ] },
        { p: 'After **Submit Registration**, the request waits for a co-op admin to approve it. Until then, signing in shows "Your registration is still awaiting admin approval."' },
        { tip: 'Know a family who wants to join? Point them to **Member Registration** on the website\'s home page.' },
      ],
      related: ['membership-status', 'policy-handbook', 'view-your-account-balance'],
    },
    {
      slug: 'membership-status',
      title: 'Checking your membership status',
      summary: 'Pending, active and locked accounts.',
      audiences: ['member'],
      keywords: ['status', 'pending', 'approved', 'locked', 'suspended', 'membership status', 'renew', 'renewal', 'expire'],
      body: [
        { table: { head: ['What you see', 'What it means'], rows: [
          ['"Your registration is still awaiting admin approval" when signing in', 'Your membership request hasn\'t been approved yet.'],
          ['You sign in normally', 'Your membership is active.'],
          ['"Your account has been locked by an administrator"', 'The co-op has locked your account. You can still view your balance on **Accounting**. Use **Contact Admins** for anything else.'],
        ] } },
        { p: 'Your account details, including its status, are shown at the bottom of **My Profile**, **Edit**.' },
        { note: 'The website doesn\'t have a membership renewal form. Ask a co-op admin with **Contact Admins** about renewing or ending your membership.' },
      ],
      related: ['how-membership-works', 'view-your-account-balance'],
    },
    {
      slug: 'policy-handbook',
      title: 'Reading the Policy Handbook',
      summary: 'The co-op\'s rules and policies.',
      audiences: ['parent'],
      permission: 'view_parent_handbook',
      keywords: ['handbook', 'policy', 'policies', 'rules', 'guidelines'],
      body: [
        { steps: ['In the Parent Portal, open **Co-op Classes**.', 'Select **Policy Handbook**.'] },
        { p: 'This is the same handbook you agreed to when you requested membership.' },
      ],
      related: ['documents'],
    },
  ],
};
