const db = require('../config/db');

// GET /api/employees
// Returns only active employees (for triage / form dropdowns)
const getActiveEmployees = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT employee_id, first_name, last_name, role
       FROM employees
       WHERE employment_status = 'Active'
       ORDER BY first_name`
    );
    return res.status(200).json({ success: true, data: rows });
  } catch (err) {
    console.error('getActiveEmployees error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

module.exports = { getActiveEmployees };
