// Every contextual "?" help link in a view must point at an article that
// exists in the help center it links to (member /help or /admin-help).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const memberHelp = require('../utils/helpCenter');
const adminHelp = require('../utils/helpCenter/admin');

function viewFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? viewFiles(path.join(dir, e.name)) : e.name.endsWith('.ejs') ? [path.join(dir, e.name)] : []));
}

test('contextual help links point at real articles', () => {
  let count = 0;
  for (const file of viewFiles(path.join(__dirname, '..', 'views'))) {
    const src = fs.readFileSync(file, 'utf8');
    for (const m of src.matchAll(/include\('partials\/help\/link', \{([^}]*)\}\)/g)) {
      const slug = /slug: '([^']+)'/.exec(m[1])[1];
      const base = (/base: '([^']+)'/.exec(m[1]) || [])[1] || '/help';
      const center = base === '/admin-help' ? adminHelp : memberHelp;
      assert.ok(center.articleExists(slug), `${path.basename(file)} links to missing ${base}/a/${slug}`);
      count += 1;
    }
  }
  assert.ok(count >= 20, `expected many contextual links, found ${count}`);
});
