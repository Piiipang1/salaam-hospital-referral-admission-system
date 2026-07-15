const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../config/db');
// Env vars are loaded centrally by server.js — see backend/server.js.

// Resolve a user's real name from doctors/employees based on role + linked_id.
// admin has no linked name record, so both come back null.
const getNameForUser = async (role, linkedId) => {
  if (role === 'doctor') {
    const [[doc]] = await db.query(
      'SELECT first_name, last_name FROM doctors WHERE doctor_id = ?',
      [linkedId]
    );
    return { firstName: doc?.first_name ?? null, lastName: doc?.last_name ?? null };
  }
  if (role === 'nurse' || role === 'staff') {
    const [[emp]] = await db.query(
      'SELECT first_name, last_name FROM employees WHERE employee_id = ?',
      [linkedId]
    );
    return { firstName: emp?.first_name ?? null, lastName: emp?.last_name ?? null };
  }
  return { firstName: null, lastName: null };
};

// POST /api/auth/login
const login = async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ success: false, message: 'Username and password are required.' });
  }

  try {
    const [rows] = await db.query(
      'SELECT * FROM users WHERE username = ? AND is_active = 1',
      [username]
    );

    if (rows.length === 0) {
      return res.status(401).json({ success: false, message: 'Invalid credentials.' });
    }

    const user = rows[0];
    const isMatch = await bcrypt.compare(password, user.password_hash);

    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid credentials.' });
    }

    const token = jwt.sign(
      { user_id: user.user_id, role: user.role, linked_id: user.linked_id },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN }
    );

    // Log login activity
    await db.query(
      "INSERT INTO activity_logs (user_id, action, target_table, target_id) VALUES (?, 'LOGIN', 'users', ?)",
      [user.user_id, user.user_id]
    );

    const { firstName, lastName } = await getNameForUser(user.role, user.linked_id);

    // Doctors: surface ER assignment so the UI can hide the Admit action.
    // The real gate is a fresh DB read in admissions.controller createAdmission.
    let isErAssigned = false;
    if (user.role === 'doctor' && user.linked_id) {
      const [[doc]] = await db.query(
        'SELECT is_er_assigned FROM doctors WHERE doctor_id = ?',
        [user.linked_id]
      );
      isErAssigned = !!doc?.is_er_assigned;
    }

    return res.status(200).json({
      success: true,
      message: 'Login successful.',
      token,
      user: {
        user_id:    user.user_id,
        username:   user.username,
        role:       user.role,
        linked_id:  user.linked_id,
        // NOT in the JWT — admins can toggle it anytime; server-side checks
        // re-read the flag from the DB (utils/dic.js) so revokes apply live.
        is_doctor_in_charge: !!user.is_doctor_in_charge,
        is_er_assigned: isErAssigned,
        first_name: firstName ?? null,
        last_name:  lastName  ?? null,
      },
    });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// POST /api/auth/logout
const logout = async (req, res) => {
  try {
    await db.query(
      "INSERT INTO activity_logs (user_id, action, target_table, target_id) VALUES (?, 'LOGOUT', 'users', ?)",
      [req.user.user_id, req.user.user_id]
    );
    return res.status(200).json({ success: true, message: 'Logged out successfully.' });
  } catch (err) {
    console.error('Logout error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// GET /api/auth/me
// User row (never password_hash) + the linked person record: doctors get
// specialization / ER / DIC details, nurse/staff get their employee record.
const getMe = async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT user_id, username, role, linked_id, is_doctor_in_charge, created_at FROM users WHERE user_id = ?',
      [req.user.user_id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    const userRow = rows[0];
    let person = {};

    if (userRow.role === 'doctor' && userRow.linked_id) {
      const [[doc]] = await db.query(
        `SELECT first_name, last_name, specialization, is_er_assigned, contact_details, employment_status
         FROM doctors WHERE doctor_id = ?`,
        [userRow.linked_id]
      );
      if (doc) person = { ...doc, is_er_assigned: !!doc.is_er_assigned };
    } else if ((userRow.role === 'nurse' || userRow.role === 'staff') && userRow.linked_id) {
      const [[emp]] = await db.query(
        'SELECT first_name, last_name, contact_details, employment_status FROM employees WHERE employee_id = ?',
        [userRow.linked_id]
      );
      if (emp) person = emp;
    }

    return res.status(200).json({
      success: true,
      user: {
        ...userRow,
        is_doctor_in_charge: !!userRow.is_doctor_in_charge,
        first_name: person.first_name ?? null,
        last_name:  person.last_name  ?? null,
        specialization:    person.specialization    ?? null,
        is_er_assigned:    person.is_er_assigned    ?? false,
        contact_details:   person.contact_details   ?? null,
        employment_status: person.employment_status ?? null,
      },
    });
  } catch (err) {
    console.error('getMe error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// PUT /api/auth/change-password
const changePassword = async (req, res) => {
  const { current_password, new_password } = req.body;

  if (!current_password || !new_password) {
    return res.status(400).json({ success: false, message: 'current_password and new_password are required.' });
  }
  if (new_password.length < 8) {
    return res.status(400).json({ success: false, message: 'New password must be at least 8 characters.' });
  }

  try {
    const [[user]] = await db.query(
      'SELECT password_hash FROM users WHERE user_id = ?',
      [req.user.user_id]
    );
    const isMatch = user && await bcrypt.compare(current_password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Current password is incorrect.' });
    }

    const salt = await bcrypt.genSalt(10);
    const password_hash = await bcrypt.hash(new_password, salt);
    await db.query('UPDATE users SET password_hash = ? WHERE user_id = ?', [password_hash, req.user.user_id]);

    await db.query(
      "INSERT INTO activity_logs (user_id, action, target_table, target_id) VALUES (?, 'UPDATE', 'users', ?)",
      [req.user.user_id, req.user.user_id]
    );

    return res.status(200).json({ success: true, message: 'Password changed successfully.' });
  } catch (err) {
    console.error('changePassword error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

module.exports = { login, logout, getMe, changePassword };
