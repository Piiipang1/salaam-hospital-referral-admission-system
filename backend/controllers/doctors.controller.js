const db = require('../config/db');

// GET /api/doctors
// Returns all active doctors — used to populate dropdowns in forms
const getAllDoctors = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT doctor_id, first_name, last_name, specialization, employment_status
       FROM doctors
       ORDER BY last_name, first_name`
    );
    return res.status(200).json({ success: true, data: rows });
  } catch (err) {
    console.error('getAllDoctors error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// GET /api/doctors/active
// Returns only active doctors (for admission / referral dropdowns)
const getActiveDoctors = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT doctor_id, first_name, last_name, specialization
       FROM doctors
       WHERE employment_status = 'Active'
       ORDER BY last_name, first_name`
    );
    return res.status(200).json({ success: true, data: rows });
  } catch (err) {
    console.error('getActiveDoctors error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

module.exports = { getAllDoctors, getActiveDoctors };
