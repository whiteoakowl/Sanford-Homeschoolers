// Everything views/partials/class-registration-log.ejs needs - the shared
// Class Registration Log table on Classes > Class Registration Log
// (routes/admin-schedule.js) and Logs > Class Registration (routes/
// admin-logs.js). ?q= searches student/class/family names, ?date= is the day it
// was registered, paginated per family.
const { classRegistrationLogRows, classRegistrationLogCounts, groupClassRegistrationLogByFamily } = require('./classRegistration');
const { paginate, parsePage, parsePageSize, DEFAULT_PAGE_SIZE } = require('./pagination');
const { formatDateLabel } = require('./dates');

async function classRegistrationLogLocals(req, { formAction, tabParam, exportBase, isFullAdmin }) {
  const dateFilter = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || '') ? req.query.date : '';
  const search = String(req.query.q || '').trim().slice(0, 100);
  const rows = await classRegistrationLogRows({ dateFilter, search });
  const pageSize = parsePageSize(req.query.pageSize, DEFAULT_PAGE_SIZE);
  // Paginated by family, so a family's registrations never split across pages.
  const pagination = paginate(groupClassRegistrationLogByFamily(rows), parsePage(req.query.page), pageSize);
  const params = new URLSearchParams({ tab: tabParam });
  if (dateFilter) params.set('date', dateFilter);
  if (search) params.set('q', search);
  return {
    families: pagination.items,
    counts: classRegistrationLogCounts(rows),
    search,
    dateFilter,
    dateFilterLabel: dateFilter ? formatDateLabel(dateFilter) : 'All dates',
    formAction,
    tabParam,
    exportBase,
    pagination,
    viewingAll: pageSize === Infinity,
    baseHref: `${formAction}?${params.toString()}&`,
    canCancel: Boolean(isFullAdmin),
    // Where the trash button comes back to - this view, minus any notice/error.
    returnTo: `${formAction}?${params.toString()}${pagination.currentPage > 1 ? `&page=${pagination.currentPage}` : ''}`,
  };
}

module.exports = { classRegistrationLogLocals };
