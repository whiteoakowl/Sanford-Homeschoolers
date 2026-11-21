module.exports = {
  slug: 'payments',
  title: 'Payments & Accounting',
  icon: 'coin',
  description: 'Your family\'s balance, invoices, payments, receipts and how to pay.',
  articles: [
    {
      slug: 'view-your-account-balance',
      title: 'Viewing your balance, invoices and payments',
      summary: 'The Accounting page shows what you owe and what you\'ve paid.',
      audiences: ['parent'],
      permission: 'view_parent_accounting',
      keywords: ['accounting', 'balance', 'invoice', 'bill', 'payment', 'paid', 'owe', 'due', 'receipt', 'payment history', 'class fee', 'event fee'],
      body: [
        { steps: ['In the Parent Portal, open **Accounting**.', 'Choose the **Account Year**: **Current Year** or **All Years**.'] },
        { p: 'The badge at the top shows how much is **due**, or **Paid in full**. Below it:' },
        { list: [
          '**Invoices**: each charge (class fees, event fees, store orders, membership) with its **Description**, **Amount**, **Paid** and **Status**.',
          '**Payments**: payments the co-op has recorded for your family.',
          '**Adjustments, Credits & Refunds**: credits, refunds and cancelled charges.',
        ] },
        { tip: 'Use the **Print** and **Download PDF** buttons to keep a copy, for example as a receipt.' },
      ],
      related: ['how-to-pay'],
    },
    {
      slug: 'how-to-pay',
      title: 'How do I pay?',
      summary: 'The website records charges and payments; you pay the co-op directly.',
      audiences: ['parent'],
      keywords: ['pay', 'payment', 'how to pay', 'credit card', 'check', 'cash', 'pay online', 'membership fee', 'failed payment'],
      body: [
        { p: 'The website doesn\'t take card payments. When you register for something with a fee, the charge is added to your **Accounting** page, and you pay the co-op directly.' },
        { list: [
          'Event pages and the membership form show the co-op\'s **payment instructions**.',
          'Once the co-op receives your payment, they record it, and it shows under **Payments** on your **Accounting** page.',
          'Questions about a charge? Use **Contact Admins**.',
        ] },
        { p: 'Charges always go to the family\'s **Primary Parent**, even if another family member registered.' },
      ],
      related: ['view-your-account-balance', 'primary-parent'],
    },
    {
      slug: 'locked-account',
      title: 'My account is locked',
      summary: 'You can still view your balance on Accounting.',
      audiences: ['member'],
      keywords: ['locked', 'suspended', 'blocked', 'cannot access', 'account locked'],
      body: [
        { p: 'If the co-op locks your account, you\'re taken to **Accounting** with the message "Your account has been locked by an administrator." You can still see your balance and print or download it. Every other page stays closed until the co-op unlocks you.' },
        { p: 'Use **Contact Admins**, or talk to a co-op admin, to sort it out.' },
      ],
      related: ['view-your-account-balance', 'membership-status'],
    },
  ],
};
