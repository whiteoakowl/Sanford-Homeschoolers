module.exports = {
  slug: 'printing',
  title: 'Printing & Exporting',
  icon: 'printer',
  description: 'Where to print, save as PDF, or export to a spreadsheet.',
  articles: [
    {
      slug: 'print-and-export',
      title: 'Printing, saving as PDF, and exporting',
      summary: 'Look for the Print, Download PDF and Export CSV buttons.',
      audiences: ['member'],
      keywords: ['print', 'pdf', 'download', 'export', 'csv', 'spreadsheet', 'excel', 'save'],
      body: [
        { p: 'Many pages have small buttons near the top:' },
        { list: [
          '**Print** (printer icon) opens a printer-friendly page.',
          '**Download PDF** saves a PDF file.',
          '**Export CSV** downloads a file that opens in Excel, Google Sheets or Numbers.',
        ] },
        { h: 'Where you\'ll find them' },
        { table: { head: ['What', 'Where'], rows: [
          ['Your family\'s schedules', '**My Profile**, **Schedules** tab'],
          ['Events calendar', '**Events** (Print, Download PDF, Export CSV)'],
          ['Event ticket', '**My Event Registrations**, **Print Ticket**'],
          ['Name tags', '**Name Tags**, **Print Selected**'],
          ['Your balance and invoices', '**Accounting** (Print, Download PDF)'],
          ['Student co-op schedule', 'Student Portal, **Co-op Schedule**'],
          ['Teacher class schedule', 'Co-op Teacher Portal, **Class Schedule**'],
          ['Homeschool grades, attendance, learning log, planners, volunteer hours, portfolio', 'Each **Family School Management** page'],
          ['Transcripts, diplomas and rewards certificates', 'Family School Management, **Transcripts**, **Diplomas**, **Rewards Certificates**'],
          ['Documents', '**Documents**: open the document, then print or download it'],
        ] } },
        { tip: 'To save any printer-friendly page as a PDF, choose "Save as PDF" as the printer in your browser\'s print window.' },
      ],
      related: ['view-your-schedule', 'print-your-name-tags'],
    },
  ],
};
