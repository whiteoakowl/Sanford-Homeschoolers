// A real request: "Accounting information for each member never
// disappears. Even if the members account is deleted." Every "delete
// member" path goes through here: a member with any invoice on file is
// archived instead (hidden from active lists, accounting kept) - the
// database also refuses the delete outright (payment_charges' foreign key
// is ON DELETE RESTRICT), so nothing can slip past this.
const db = require('../db');

async function hasAccounting(memberId) {
  return !!(await db.prepare('SELECT 1 FROM payment_charges WHERE member_id = ? LIMIT 1').get(memberId));
}

// Returns { member, archived } (member null when it didn't exist).
// onDeleted(member) runs only when the row was really deleted (e.g. to
// remove its photo file).
async function removeMember(memberId, onDeleted) {
  const member = await db.prepare('SELECT * FROM members WHERE id = ?').get(memberId);
  if (!member) return { member: null, archived: false };
  if (await hasAccounting(memberId)) {
    await db.prepare('UPDATE members SET active = 0, archived_at = COALESCE(archived_at, now_text()) WHERE id = ?').run(memberId);
    return { member, archived: true };
  }
  await db.prepare('DELETE FROM members WHERE id = ?').run(memberId);
  if (onDeleted) await onDeleted(member);
  return { member, archived: false };
}

module.exports = { hasAccounting, removeMember };
