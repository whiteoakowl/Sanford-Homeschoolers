// A real bug report: "I can't change portal access under each member" -
// the member edit pages render the Portals/Sections multi-select
// dropdowns (partials/member-portal-roles.ejs) but never loaded
// public/js/multi-select-checkbox.js, so clicking them did nothing.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

for (const view of ['main-admin-member-edit.ejs', 'admin-member-edit.ejs']) {
  test(`${view} loads the multi-select dropdown script its Portals/Sections controls need`, () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'views', view), 'utf8');
    assert.match(src, /include\('partials\/member-edit-admin-section'|member-edit-admin-section/);
    assert.match(src, /<script src="\/js\/multi-select-checkbox\.js"><\/script>/);
  });
}
