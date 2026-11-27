// A real request: "Add co-op class procedures under settings on co-op
// admin portal. Parent information page policies links to this instead."
// Rich text a Co-op Admin writes (Settings > Co-op Class Procedures);
// parents read it at /parent/classes/procedures.
const { appSetting, setAppSetting } = require('./appSettings');
const { sanitizePostBody } = require('./sanitizeHtml');

const KEY = 'coop_class_procedures_html';

async function getProceduresHtml() {
  return (await appSetting(KEY, '')) || '';
}

async function saveProceduresHtml(html) {
  await setAppSetting(KEY, sanitizePostBody(String(html || '')));
}

module.exports = { getProceduresHtml, saveProceduresHtml };
