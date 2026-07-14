const jwt = require('jsonwebtoken');
const db = require('../config/db');
require('dotenv').config();

const auth = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer <token>

  if (!token) {
    return res.status(401).json({ success: false, message: 'Access denied. No token provided.' });
  }

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Invalid or expired token.' });
  }

  // Tokens live 8h, but deactivation must take effect immediately — re-check
  // is_active on every request. One primary-key SELECT per request is an
  // acceptable cost for this system; do not cache.
  try {
    const [[row]] = await db.query(
      'SELECT is_active FROM users WHERE user_id = ?',
      [decoded.user_id]
    );
    if (!row || !row.is_active) {
      return res.status(401).json({ success: false, message: 'Account is deactivated.' });
    }
  } catch (err) {
    console.error('auth middleware: is_active check failed:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }

  req.user = decoded; // { user_id, role, linked_id }
  next();
};

module.exports = auth;
