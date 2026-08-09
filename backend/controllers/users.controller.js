const bcrypt = require('bcryptjs');
const db = require('../config/db');
const { isEmail, toE164 } = require('../utils/notifier');

// Hard cap on concurrently enabled Doctor-in-Charge accounts
const MAX_DOCTORS_IN_CHARGE = 3;

// POST /api/users
// Creates the person record (doctors/employees) and the login account together —
// linked_id is no longer accepted from the client since there was previously no
// way to create the person record it's supposed to point to.
const createUser = async (req, res) => {
  const {
    username, password, role,
    first_name, last_name, specialization, contact_details,
    is_er_assigned,
  } = req.body;
  const validRoles = ['admin', 'doctor', 'nurse'];

  if (!username || !password || !role) {
    return res.status(400).json({ success: false, message: 'Username, password, and role are required.' });
  }
  if (password.length < 8) {
    return res.status(400).json({ success: false, message: 'Password must be at least 8 characters.' });
  }
  if (!validRoles.includes(role)) {
    return res.status(400).json({ success: false, message: `Role must be one of: ${validRoles.join(', ')}.` });
  }
  if (['doctor', 'nurse'].includes(role) && (!first_name || !last_name)) {
    return res.status(400).json({
      success: false,
      message: 'first_name and last_name are required for doctor and nurse roles.',
    });
  }

  try {
    const [existing] = await db.query('SELECT user_id FROM users WHERE username = ?', [username]);
    if (existing.length > 0) {
      return res.status(409).json({ success: false, message: 'Username already exists.' });
    }

    const salt = await bcrypt.genSalt(10);
    const password_hash = await bcrypt.hash(password, salt);

    // ── Transaction: create the person record (if any) + the login account ────
    const connection = await db.getConnection();
    await connection.beginTransaction();

    let userId;
    try {
      let linkedId = null;

      if (role === 'doctor') {
        const [docResult] = await connection.query(
          `INSERT INTO doctors (first_name, last_name, specialization, is_er_assigned, contact_details, employment_status)
           VALUES (?, ?, ?, ?, ?, 'Active')`,
          [first_name, last_name, specialization || null, is_er_assigned ? 1 : 0, contact_details || null]
        );
        linkedId = docResult.insertId;
      } else if (role === 'nurse') {
        const [empResult] = await connection.query(
          `INSERT INTO employees (first_name, last_name, role, contact_details, employment_status)
           VALUES (?, ?, ?, ?, 'Active')`,
          [first_name, last_name, role, contact_details || null]
        );
        linkedId = empResult.insertId;
      }
      // role === 'admin' → linkedId stays null; admin has no person record.

      const [userResult] = await connection.query(
        'INSERT INTO users (username, password_hash, role, linked_id) VALUES (?, ?, ?, ?)',
        [username, password_hash, role, linkedId]
      );
      userId = userResult.insertId;

      await connection.query(
        "INSERT INTO activity_logs (user_id, action, target_table, target_id) VALUES (?, 'CREATE', 'users', ?)",
        [req.user.user_id, userId]
      );

      await connection.commit();
      connection.release();
    } catch (txErr) {
      await connection.rollback();
      connection.release();
      throw txErr;
    }

    return res.status(201).json({ success: true, message: 'User created.', user_id: userId });
  } catch (err) {
    console.error('createUser error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// GET /api/users
const getAllUsers = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT u.user_id, u.username, u.role, u.linked_id, u.is_doctor_in_charge, u.is_active, u.created_at,
              d.is_er_assigned,
              COALESCE(CONCAT(d.first_name, ' ', d.last_name),
                       CONCAT(e.first_name, ' ', e.last_name)) AS linked_name,
              -- Alert contact details, so an admin can see at a glance who is
              -- actually reachable when a High/Emergency alert fires.
              u.email, u.phone, u.alerts_opt_out,
              -- Ward, for the nurse table's Department column and its editor
              e.department_id, dept.name AS department_name
       FROM users u
       LEFT JOIN doctors   d ON u.role = 'doctor' AND d.doctor_id = u.linked_id
       LEFT JOIN employees e ON u.role = 'nurse' AND e.employee_id = u.linked_id
       LEFT JOIN departments dept ON dept.department_id = e.department_id
       ORDER BY u.created_at DESC`
    );
    return res.status(200).json({ success: true, data: rows });
  } catch (err) {
    console.error('getAllUsers error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// GET /api/users/:id
const getUserById = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT u.user_id, u.username, u.role, u.linked_id, u.is_doctor_in_charge, u.is_active, u.created_at,
              d.is_er_assigned
       FROM users u
       LEFT JOIN doctors d ON u.role = 'doctor' AND d.doctor_id = u.linked_id
       WHERE u.user_id = ?`,
      [req.params.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }
    return res.status(200).json({ success: true, data: rows[0] });
  } catch (err) {
    console.error('getUserById error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// PUT /api/users/:id
const updateUser = async (req, res) => {
  // linked_id is deliberately NOT accepted from the client. It is set once, at
  // creation time (createUser), alongside the person record it points to.
  // Accepting it here would let a caller re-point an account at any doctors/
  // employees row and hijack the per-role scoping subqueries.
  const { role, is_active, is_er_assigned, password, email, phone, alerts_opt_out } = req.body;
  const validRoles = ['admin', 'doctor', 'nurse'];
  try {
    const [[target]] = await db.query(
      'SELECT role, linked_id FROM users WHERE user_id = ?',
      [req.params.id]
    );
    if (!target) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    // Role is immutable here. Changing it would desync linked_id (which still
    // points at a person record of the OLD role) and corrupt the scoping
    // subqueries. Validate the value, then reject any actual change.
    if (role !== undefined && role !== null) {
      if (!validRoles.includes(role)) {
        return res.status(400).json({ success: false, message: `Role must be one of: ${validRoles.join(', ')}.` });
      }
      if (role !== target.role) {
        return res.status(400).json({
          success: false,
          message: "Changing a user's role is not supported — deactivate the account and create a new one.",
        });
      }
    }

    // Optional password reset — hash only when a new password is supplied.
    let password_hash = null;
    if (password !== undefined && password !== null && password !== '') {
      if (password.length < 8) {
        return res.status(400).json({ success: false, message: 'Password must be at least 8 characters.' });
      }
      const salt = await bcrypt.genSalt(10);
      password_hash = await bcrypt.hash(password, salt);
    }

    // Alert contact details. Validated here because a malformed address means a
    // High/Emergency alert silently fails to reach a real person — the failure
    // mode this whole channel exists to prevent. Empty string clears the field.
    let normalizedEmail;
    if (email !== undefined) {
      const trimmed = String(email ?? '').trim();
      if (trimmed && !isEmail(trimmed)) {
        return res.status(400).json({ success: false, message: 'Enter a valid email address, or leave it blank.' });
      }
      normalizedEmail = trimmed || null;
    }

    let normalizedPhone;
    if (phone !== undefined) {
      const trimmed = String(phone ?? '').trim();
      if (trimmed && !toE164(trimmed)) {
        return res.status(400).json({
          success: false,
          message: 'Enter a valid mobile number (e.g. 09171234567 or +639171234567), or leave it blank.',
        });
      }
      normalizedPhone = trimmed || null;
    }

    try {
      await db.query(
        `UPDATE users SET
           is_active      = COALESCE(?, is_active),
           password_hash  = COALESCE(?, password_hash),
           email          = ${email !== undefined ? '?' : 'email'},
           phone          = ${phone !== undefined ? '?' : 'phone'},
           alerts_opt_out = COALESCE(?, alerts_opt_out)
         WHERE user_id = ?`,
        [
          is_active, password_hash,
          ...(email !== undefined ? [normalizedEmail] : []),
          ...(phone !== undefined ? [normalizedPhone] : []),
          alerts_opt_out === undefined ? null : (alerts_opt_out ? 1 : 0),
          req.params.id,
        ]
      );
    } catch (dupErr) {
      // uq_users_email — two accounts cannot share an alert destination.
      if (dupErr.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({ success: false, message: 'That email address is already used by another account.' });
      }
      throw dupErr;
    }

    // ER assignment lives on the doctors row — update it when provided and
    // the target account is a doctor with a person record.
    if (is_er_assigned !== undefined && is_er_assigned !== null) {
      if (target.role === 'doctor' && target.linked_id) {
        await db.query(
          'UPDATE doctors SET is_er_assigned = ? WHERE doctor_id = ?',
          [is_er_assigned ? 1 : 0, target.linked_id]
        );
      }
    }
    await db.query(
      "INSERT INTO activity_logs (user_id, action, target_table, target_id) VALUES (?, 'UPDATE', 'users', ?)",
      [req.user.user_id, req.params.id]
    );
    return res.status(200).json({ success: true, message: 'User updated.' });
  } catch (err) {
    console.error('updateUser error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// DELETE /api/users/:id  (soft delete — deactivate)
const deactivateUser = async (req, res) => {
  // Prevent an admin from locking themselves out
  if (String(req.params.id) === String(req.user.user_id)) {
    return res.status(400).json({
      success: false,
      message: 'You cannot deactivate your own account.',
    });
  }

  try {
    // Also clear is_doctor_in_charge: a deactivated doctor must not keep holding
    // one of the MAX_DOCTORS_IN_CHARGE slots (the count in setDoctorInCharge only
    // considers active users, so a stale flag here would strand a slot).
    await db.query('UPDATE users SET is_active = 0, is_doctor_in_charge = 0 WHERE user_id = ?', [req.params.id]);
    await db.query(
      "INSERT INTO activity_logs (user_id, action, target_table, target_id) VALUES (?, 'DEACTIVATE', 'users', ?)",
      [req.user.user_id, req.params.id]
    );

    // If the deactivated account was a doctor, any Pending doctor_in_charge
    // proposal addressed to them can never be answered — it would strand those
    // patients waiting on a doctor who can no longer respond. Delete those
    // proposals so the patients return to the unassigned pool. (Accepted rows are
    // left intact — reassigning active care is a separate clinical decision.)
    let cancelledProposals = [];
    const [[target]] = await db.query(
      'SELECT role, linked_id FROM users WHERE user_id = ?',
      [req.params.id]
    );
    if (target?.role === 'doctor' && target.linked_id) {
      // Capture who proposed each row before deleting so we can notify them.
      const [pending] = await db.query(
        `SELECT dic.assigned_by,
                CONCAT(p.first_name, ' ', p.last_name) AS patient_name
         FROM doctor_in_charge dic
         LEFT JOIN patients p ON p.patient_id = dic.patient_id
         WHERE dic.doctor_id = ? AND dic.status = 'Pending'`,
        [target.linked_id]
      );
      if (pending.length > 0) {
        await db.query(
          "DELETE FROM doctor_in_charge WHERE doctor_id = ? AND status = 'Pending'",
          [target.linked_id]
        );
        cancelledProposals = pending;
      }
    }

    // ── Respond immediately — proposer notifications are best-effort ──────────
    res.status(200).json({ success: true, message: 'User deactivated.' });

    if (cancelledProposals.length > 0) {
      try {
        const notifRows = [];
        for (const row of cancelledProposals) {
          if (row.assigned_by) {
            notifRows.push([
              row.assigned_by,
              `Your Doctor-in-Charge proposal for ${row.patient_name ?? 'a patient'} was cancelled because the assigned doctor was deactivated. The patient is back in the unassigned pool.`,
              null,
            ]);
          }
        }
        if (notifRows.length > 0) {
          await db.query(
            'INSERT INTO notifications (user_id, message, referral_id) VALUES ?',
            [notifRows]
          );
        }
      } catch (notifErr) {
        console.warn('deactivateUser: proposal-cancel notification failed (non-fatal):', notifErr.message);
      }
    }
    return;
  } catch (err) {
    console.error('deactivateUser error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// PUT /api/users/:id/reactivate
const reactivateUser = async (req, res) => {
  try {
    await db.query('UPDATE users SET is_active = 1 WHERE user_id = ?', [req.params.id]);
    await db.query(
      "INSERT INTO activity_logs (user_id, action, target_table, target_id) VALUES (?, 'RESTORE', 'users', ?)",
      [req.user.user_id, req.params.id]
    );
    return res.status(200).json({ success: true, message: 'User reactivated.' });
  } catch (err) {
    console.error('reactivateUser error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// PUT /api/users/:id/doctor-in-charge
// Toggles Doctor-in-Charge mode on a doctor account. Requires the CALLING
// admin to re-verify their password; capped at MAX_DOCTORS_IN_CHARGE.
const setDoctorInCharge = async (req, res) => {
  const { enabled, admin_password } = req.body;

  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ success: false, message: 'enabled (boolean) is required.' });
  }
  if (!admin_password) {
    return res.status(400).json({ success: false, message: 'Admin password is required.' });
  }

  try {
    // Re-verify the calling admin's password — this is a sensitive toggle
    const [[caller]] = await db.query(
      'SELECT password_hash FROM users WHERE user_id = ?',
      [req.user.user_id]
    );
    const passwordOk = caller && await bcrypt.compare(admin_password, caller.password_hash);
    if (!passwordOk) {
      return res.status(401).json({ success: false, message: 'Password verification failed.' });
    }

    const [[target]] = await db.query(
      'SELECT user_id, role, is_doctor_in_charge, is_active FROM users WHERE user_id = ?',
      [req.params.id]
    );
    if (!target || target.role !== 'doctor') {
      return res.status(400).json({ success: false, message: 'Doctor-in-Charge mode can only be enabled for doctor accounts.' });
    }

    if (enabled) {
      // A deactivated account cannot hold a DIC slot.
      if (target.is_active !== 1) {
        return res.status(400).json({ success: false, message: 'Cannot enable Doctor-in-Charge on a deactivated account.' });
      }
      // Only active doctors count toward the cap — deactivated ones don't occupy a slot.
      const [[{ cnt }]] = await db.query(
        'SELECT COUNT(*) AS cnt FROM users WHERE is_doctor_in_charge = 1 AND is_active = 1 AND user_id != ?',
        [req.params.id]
      );
      if (cnt >= MAX_DOCTORS_IN_CHARGE) {
        return res.status(409).json({ success: false, message: 'Maximum of 3 doctors-in-charge already enabled.' });
      }
    }

    await db.query(
      'UPDATE users SET is_doctor_in_charge = ? WHERE user_id = ?',
      [enabled ? 1 : 0, req.params.id]
    );

    await db.query(
      "INSERT INTO activity_logs (user_id, action, target_table, target_id) VALUES (?, 'UPDATE', 'users', ?)",
      [req.user.user_id, req.params.id]
    );

    res.status(200).json({ success: true, message: `Doctor-in-Charge mode ${enabled ? 'enabled' : 'disabled'}.` });

    // Best-effort notification to the affected doctor (after the response)
    try {
      await db.query(
        'INSERT INTO notifications (user_id, message, referral_id) VALUES (?, ?, ?)',
        [target.user_id, `Doctor-in-Charge mode was ${enabled ? 'enabled' : 'disabled'} on your account.`, null]
      );
    } catch (notifErr) {
      console.warn('setDoctorInCharge: notification insert failed (non-fatal):', notifErr.message);
    }
  } catch (err) {
    console.error('setDoctorInCharge error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

module.exports = { createUser, getAllUsers, getUserById, updateUser, deactivateUser, reactivateUser, setDoctorInCharge };
