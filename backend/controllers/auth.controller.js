const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../config/db');
require('dotenv').config();

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

    return res.status(200).json({
      success: true,
      message: 'Login successful.',
      token,
      user: {
        user_id:    user.user_id,
        username:   user.username,
        role:       user.role,
        linked_id:  user.linked_id,
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
const getMe = async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT user_id, username, role, linked_id, created_at FROM users WHERE user_id = ?',
      [req.user.user_id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    const userRow = rows[0];
    const { firstName, lastName } = await getNameForUser(userRow.role, userRow.linked_id);

    return res.status(200).json({
      success: true,
      user: { ...userRow, first_name: firstName ?? null, last_name: lastName ?? null },
    });
  } catch (err) {
    console.error('getMe error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

module.exports = { login, logout, getMe };
