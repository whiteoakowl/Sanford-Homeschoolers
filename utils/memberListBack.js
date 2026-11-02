// A real request: "When editing a member profile in admin portals... When
// clicking the back button after saving it should still go back to the
// same filtered page of members." The member list remembers its own last
// URL (filters, search, page) in the session, and every Back/Cancel link
// on the profile/edit pages returns there instead of the bare list.
function rememberMemberListUrl(req, listPath) {
  if (!req.session) return;
  const url = new URL(req.originalUrl, 'http://x');
  url.searchParams.delete('notice');
  url.searchParams.delete('error');
  const query = url.searchParams.toString();
  req.session.memberListUrls = { ...(req.session.memberListUrls || {}), [listPath]: listPath + (query ? '?' + query : '') };
}

function memberListBackUrl(req, listPath) {
  const saved = req.session && req.session.memberListUrls && req.session.memberListUrls[listPath];
  return typeof saved === 'string' && saved.startsWith(listPath) ? saved : listPath;
}

module.exports = { rememberMemberListUrl, memberListBackUrl };
