// Member-initiated account deletion (a real request: "Under parent
// settings. There should be a tab for delete account, in red...").
// closeAccount runs from Parent Portal Settings; Main Admin > Members >
// Member Delete Requests then finishes (removes the member record) or
// dismisses each one.
const db = require('../db');
const payments = require('./payments');
const { primaryParentForBilling } = require('./members');
const { notifyMainAdmins } = require('./adminNotify');

async function closeAccount(accountId) {
  const account = await db.prepare('SELECT * FROM member_accounts WHERE id = ?').get(accountId);
  if (!account || account.status === 'closed') return null;
  const member = account.member_id ? await db.prepare('SELECT m.*, f.name AS "familyName" FROM members m LEFT JOIN families f ON f.id = m.family_id WHERE m.id = ?').get(account.member_id) : null;
  let balance = 0;
  if (member) {
    try {
      balance = await payments.balanceForMember(await primaryParentForBilling(member.id));
    } catch (err) {
      balance = 0;
    }
  }
  const row = await db
    .prepare('INSERT INTO member_delete_requests (account_id, member_id, member_name, email, family_name, balance_cents) VALUES (?, ?, ?, ?, ?, ?) RETURNING id')
    .get(account.id, member ? member.id : null, member ? member.name : account.email, account.email, member ? member.familyName : null, balance || 0);
  // Closed at once - and the email freed, so "if you want to return ...
  // create a new account" works with the same address.
  await db.prepare("UPDATE member_accounts SET status = 'closed', email = ? WHERE id = ?").run(`closed-${account.id}@deleted.invalid`, account.id);
  await notifyMainAdmins('member_delete_request', {
    title: `${member ? member.name : account.email} deleted their account`,
    body: `${member ? member.name : 'A member'} (${account.email}) deleted their account${balance > 0 ? ` with ${payments.formatCents(balance)} still owed` : ''}. Review it in Members > Member Delete Requests.`,
    linkUrl: '/main-admin/members/delete-requests',
  }, { permissionKey: 'manage_members' });
  return row.id;
}

async function listRequests() {
  return db.prepare("SELECT * FROM member_delete_requests ORDER BY (status <> 'pending'), created_at DESC, id DESC").all();
}

async function pendingCount() {
  const row = await db.prepare("SELECT COUNT(*) AS c FROM member_delete_requests WHERE status = 'pending'").get();
  return Number(row.c);
}

async function decide(id, status, adminAccountId) {
  return db
    .prepare("UPDATE member_delete_requests SET status = ?, decided_at = now_text(), decided_by_account_id = ? WHERE id = ? AND status = 'pending' RETURNING *")
    .get(status, adminAccountId || null, id);
}

module.exports = { closeAccount, listRequests, pendingCount, decide };
