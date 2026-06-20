const bcrypt = require('bcryptjs');
const db = require('../config/db');

// POST /api/users
const createUser = async (req, res) => {
  const { username, password, role, linked_id } = req.body;
  const validRoles = ['admin', 'doctor', 'nurse', 'staff'];

  if (!username || !password || !role) {
    return res.status(400).json({ success: false, message: 'Username, password, and role are required.' });
  }
  if (!validRoles.includes(role)) {
    return res.status(400).json({ success: false, message: `Role must be one of: ${validRoles.join(', ')}.` });
  }

  try {
    const [existing] = await db.query('SELECT user_id FROM users WHERE username = ?', [username]);
    if (existing.length > 0) {
      return res.status(409).json({ success: false, message: 'Username already exists.' });
    }

    const salt = await bcrypt.genSalt(10);
    const password_hash = await bcrypt.hash(password, salt);

    const [result] = await db.query(
      'INSERT INTO users (username, password_hash, role, linked_id) VALUES (?, ?, ?, ?)',
      [username, password_hash, role, linked_id || null]
    );

    await db.query(
      "INSERT INTO activity_logs (user_id, action, target_table, target_id) VALUES (?, 'CREATE', 'users', ?)",
      [req.user.user_id, result.insertId]
    );

    return res.status(201).json({ success: true, message: 'User created.', user_id: result.insertId });
  } catch (err) {
    console.error('createUser error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// GET /api/users
const getAllUsers = async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT user_id, username, role, linked_id, is_active, created_at FROM users ORDER BY created_at DESC'
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
      'SELECT user_id, username, role, linked_id, is_active, created_at FROM users WHERE user_id = ?',
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
  const { role, is_active, linked_id } = req.body;
  try {
    await db.query(
      'UPDATE users SET role = COALESCE(?, role), is_active = COALESCE(?, is_active), linked_id = COALESCE(?, linked_id) WHERE user_id = ?',
      [role, is_active, linked_id, req.params.id]
    );
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

module.exports = { createUser, getAllUsers, getUserById, updateUser, deactivateUser };
