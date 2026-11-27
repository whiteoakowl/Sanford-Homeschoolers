// Sends an in-app notification (plus email/text, per Main Admin >
// Notifications) to every active Main Admin account - optionally only
// those holding `permissionKey`. Used for things that need an admin's
// attention but have no single owner: a public contact message, a member
// asking to delete their account.
const db = require('../db');
const notifications = require('./notifications');

async function mainAdminAccountIds(permissionKey) {
  const rows = await db
    .prepare(
      `SELECT DISTINCT ma.id FROM member_accounts ma
       JOIN member_account_roles mar ON mar.member_account_id = ma.id
       JOIN roles r ON r.id = mar.role_id
       WHERE r.key = 'main_admin' AND ma.status = 'active'`
    )
    .all();
  if (!permissionKey) return rows.map((r) => r.id);
  const { permissionsForAccount } = require('./portalAuth');
  const out = [];
  for (const r of rows) {
    try {
      const perms = await permissionsForAccount(r.id);
      if (!perms || perms.has(permissionKey)) out.push(r.id);
    } catch (err) {
      out.push(r.id);
    }
  }
  return out;
}

async function notifyMainAdmins(typeKey, payload, { permissionKey } = {}) {
  for (const id of await mainAdminAccountIds(permissionKey)) {
    try {
      await notifications.notify(id, typeKey, payload);
    } catch (err) {
      console.error(`Admin notification ${typeKey} failed:`, err.message);
    }
  }
}

module.exports = { mainAdminAccountIds, notifyMainAdmins };
