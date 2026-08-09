const db = require('../config/db');
const { dispatchAlert } = require('./notifier');

// ── Raising an alert ─────────────────────────────────────────────────────────
// One entry point for every notification in the system. It writes the in-app
// rows, then — for High and Emergency only — mirrors them to email/SMS.
//
// Call it AFTER responding to the request. Delivery is best-effort by design:
// a provider outage must never turn into a failed triage, so createAlert
// resolves with a summary and never rejects.

const VALID_PRIORITIES = ['Normal', 'High', 'Emergency'];

/**
 * Resolve who to alert, with the contact details each channel needs.
 * Inactive accounts are excluded: an alert to a disabled login reaches nobody.
 *
 * @param {object} target
 * @param {number[]} [target.userIds] — explicit recipients
 * @param {string[]} [target.roles]   — every active account in these roles
 * @param {boolean}  [target.doctorInChargeOnly] — narrow doctors to the DIC(s)
 * @param {number}   [target.excludeUserId]      — usually the actor
 */
const resolveRecipients = async ({ userIds, roles, doctorInChargeOnly, excludeUserId }) => {
  const conditions = ['u.is_active = 1'];
  const params = [];

  if (Array.isArray(userIds) && userIds.length > 0) {
    conditions.push(`u.user_id IN (${userIds.map(() => '?').join(',')})`);
    params.push(...userIds);
  } else if (Array.isArray(roles) && roles.length > 0) {
    if (doctorInChargeOnly) {
      // Admins keep full visibility; doctors narrow to whoever is coordinating.
      conditions.push(
        `(u.role = 'admin' AND u.role IN (${roles.map(() => '?').join(',')})
          OR (u.role = 'doctor' AND u.is_doctor_in_charge = 1 AND 'doctor' IN (${roles.map(() => '?').join(',')}))
          OR (u.role = 'nurse' AND 'nurse' IN (${roles.map(() => '?').join(',')})))`
      );
      params.push(...roles, ...roles, ...roles);
    } else {
      conditions.push(`u.role IN (${roles.map(() => '?').join(',')})`);
      params.push(...roles);
    }
  } else {
    return [];
  }

  if (excludeUserId) {
    conditions.push('u.user_id <> ?');
    params.push(excludeUserId);
  }

  const [rows] = await db.query(
    `SELECT u.user_id, u.username, u.role, u.email, u.phone, u.alerts_opt_out
     FROM users u
     WHERE ${conditions.join(' AND ')}`,
    params
  );
  return rows;
};

/**
 * Create an alert: in-app rows for everyone, plus email/SMS when the priority
 * calls for it.
 *
 * @param {object} alert
 * @param {string} alert.message
 * @param {'Normal'|'High'|'Emergency'} [alert.priority='Normal']
 * @param {string} [alert.subject]    — email subject
 * @param {number} [alert.referralId] — links the in-app row to a referral
 * @param {object} alert.target       — see resolveRecipients
 * @returns {Promise<{recipients:number, delivery:object}>}
 */
const createAlert = async ({ message, priority = 'Normal', subject, referralId = null, target = {} }) => {
  const level = VALID_PRIORITIES.includes(priority) ? priority : 'Normal';
  const result = { recipients: 0, delivery: { attempted: 0, sent: 0, failed: 0, skipped: 0 } };

  try {
    const recipients = await resolveRecipients(target);
    if (recipients.length === 0) return result;
    result.recipients = recipients.length;

    // In-app first: it is the durable record, and the one channel that cannot
    // be knocked out by a third party being down.
    await db.query(
      'INSERT INTO notifications (user_id, message, priority, referral_id) VALUES ?',
      [recipients.map((r) => [r.user_id, message, level, referralId])]
    );

    // Tie each delivery row back to the in-app notification it mirrors. Read
    // back rather than assuming ids, so a concurrent insert cannot misalign them.
    const notificationIds = new Map();
    try {
      const [rows] = await db.query(
        `SELECT notification_id, user_id FROM notifications
         WHERE user_id IN (${recipients.map(() => '?').join(',')})
           AND priority = ? AND message = ?
         ORDER BY notification_id DESC
         LIMIT ?`,
        [...recipients.map((r) => r.user_id), level, message, recipients.length]
      );
      for (const row of rows) {
        if (!notificationIds.has(row.user_id)) notificationIds.set(row.user_id, row.notification_id);
      }
    } catch (mapErr) {
      console.warn('createAlert: could not map notification ids (non-fatal):', mapErr.message);
    }

    if (level !== 'Normal') {
      result.delivery = await dispatchAlert({ message, priority: level, subject, recipients, notificationIds });
      const { sent, failed, skipped } = result.delivery;
      if (failed > 0 || sent > 0) {
        console.log(`alerts: ${level} → ${recipients.length} recipient(s); sent ${sent}, failed ${failed}, skipped ${skipped}`);
      }
    }
  } catch (err) {
    // Swallowed on purpose: callers run this after responding, and an alerting
    // fault must not surface as a clinical failure.
    console.warn('createAlert failed (non-fatal):', err.message);
  }

  return result;
};

module.exports = { createAlert, resolveRecipients, VALID_PRIORITIES };
