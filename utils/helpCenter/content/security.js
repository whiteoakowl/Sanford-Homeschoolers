module.exports = {
  slug: 'security',
  title: 'Account Security',
  icon: 'lock',
  description: 'Passwords, signing out, and keeping your account safe.',
  articles: [
    {
      slug: 'change-password',
      title: 'Changing your password',
      summary: 'Set a new password on your Edit Profile page.',
      audiences: ['member'],
      keywords: ['password', 'change password', 'new password', 'reset password', 'update password'],
      body: [
        { steps: [
          'Select **My Profile**, then **Edit**.',
          'Type your new password in **New Password (leave blank to keep the current one)**, and again in **Confirm Password**.',
          'Select **Save**.',
        ] },
        { p: 'Passwords must be at least 8 characters. If the two don\'t match, you\'ll see "Passwords do not match."' },
        { tip: 'Use a password you don\'t use anywhere else.' },
      ],
      related: ['forgot-password', 'sign-out'],
    },
    {
      slug: 'forgot-password',
      title: 'I forgot my password',
      summary: 'Ask the co-op, or another parent in your family, to reset it.',
      audiences: ['member'],
      keywords: ['forgot password', 'reset password', 'locked out', 'can\'t sign in', 'password recovery'],
      body: [
        { p: 'The website doesn\'t have a "forgot password" email. To get back in:' },
        { list: [
          'Ask the co-op to reset your password. Talk to a co-op leader in person, or have a family member send a request with **Contact Admins**.',
          'If another parent in your family can sign in, they can set a new password for you on their **My Profile**, **Edit** page, under **Additional Parents / Guardians**.',
          'Students: ask your parent. They can reset your password the same way.',
        ] },
        { p: 'After you\'re back in, change your password to one only you know.' },
      ],
      related: ['change-password', 'sign-in'],
    },
    {
      slug: 'sign-out',
      title: 'Signing out',
      summary: 'Use Log out, especially on shared devices.',
      audiences: ['member'],
      keywords: ['sign out', 'log out', 'logout', 'shared computer', 'stay signed in'],
      body: [
        { p: 'You stay signed in on a device until you sign out.' },
        { list: [
          'Computer: select **Log out** at the bottom of the left menu.',
          'Phone or tablet: select the **Log out** icon at the top right.',
        ] },
        { note: 'Always log out on a shared or co-op device, so the next person can\'t use your account.' },
      ],
      related: ['account-security-tips'],
    },
    {
      slug: 'account-security-tips',
      title: 'Keeping your account safe',
      summary: 'Simple habits, and what to do if something looks wrong.',
      audiences: ['member'],
      keywords: ['security', 'suspicious', 'hacked', 'safe', 'unknown activity', 'protect account'],
      body: [
        { list: [
          'Use a password that\'s at least 8 characters and not used anywhere else.',
          'Don\'t share your password. Give each parent and student their own login instead.',
          'Log out on shared devices.',
          'After several wrong passwords, sign-in for that email pauses for about 15 minutes. If you didn\'t cause that, change your password once you\'re back in.',
        ] },
        { h: 'If something looks wrong' },
        { p: 'If you see a registration, post or change you didn\'t make, change your password right away and tell the co-op with **Contact Admins**.' },
      ],
      related: ['change-password', 'who-can-see-what'],
    },
  ],
};
