const bcrypt = require('bcryptjs');
const db = require('../config/db');

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
  const validRoles = ['admin', 'doctor', 'nurse', 'staff'];

  if (!username || !password || !role) {
    return res.status(400).json({ success: false, message: 'Username, password, and role are required.' });
  }
  if (!validRoles.includes(role)) {
    return res.status(400).json({ success: false, message: `Role must be one of: ${validRoles.join(', ')}.` });
  }
  if (['doctor', 'nurse', 'staff'].includes(role) && (!first_name || !last_name)) {
    return res.status(400).json({
      success: false,
      message: 'first_name and last_name are required for doctor, nurse, and staff roles.',
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
      } else if (role === 'nurse' || role === 'staff') {
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
                       CONCAT(e.first_name, ' ', e.last_name)) AS linked_name
       FROM users u
       LEFT JOIN doctors   d ON u.role = 'doctor' AND d.doctor_id = u.linked_id
       LEFT JOIN employees e ON u.role IN ('nurse','staff') AND e.employee_id = u.linked_id
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
  const { role, is_active, linked_id, is_er_assigned } = req.body;
  try {
    await db.query(
      'UPDATE users SET role = COALESCE(?, role), is_active = COALESCE(?, is_active), linked_id = COALESCE(?, linked_id) WHERE user_id = ?',
      [role, is_active, linked_id, req.params.id]
    );

    // ER assignment lives on the doctors row — update it when provided and
    // the target account is a doctor with a person record.
    if (is_er_assigned !== undefined && is_er_assigned !== null) {
      const [[target]] = await db.query(
        "SELECT role, linked_id FROM users WHERE user_id = ?",
        [req.params.id]
      );
      if (target?.role === 'doctor' && target.linked_id) {
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
    await db.query('UPDATE users SET is_active = 0 WHERE user_id = ?', [req.params.id]);
    await db.query(
      "INSERT INTO activity_logs (user_id, action, target_table, target_id) VALUES (?, 'DEACTIVATE', 'users', ?)",
      [req.user.user_id, req.params.id]
    );
    return res.status(200).json({ success: true, message: 'User deactivated.' });
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
      'SELECT user_id, role, is_doctor_in_charge FROM users WHERE user_id = ?',
      [req.params.id]
    );
    if (!target || target.role !== 'doctor') {
      return res.status(400).json({ success: false, message: 'Doctor-in-Charge mode can only be enabled for doctor accounts.' });
    }

    if (enabled) {
      const [[{ cnt }]] = await db.query(
        'SELECT COUNT(*) AS cnt FROM users WHERE is_doctor_in_charge = 1 AND user_id != ?',
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
