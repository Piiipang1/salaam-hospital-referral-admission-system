const db = require('../config/db');
const { isDoctorInCharge } = require('../utils/dic');

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

// GET /api/doctors/workload
// Per-doctor load counts — admin or Doctor-in-Charge only (checked live).
const getDoctorWorkload = async (req, res) => {
  try {
    const allowed = req.user.role === 'admin'
      || (req.user.role === 'doctor' && await isDoctorInCharge(req.user.user_id));
    if (!allowed) {
      return res.status(403).json({ success: false, message: 'Doctor-in-Charge mode required.' });
    }

    const [rows] = await db.query(
      `SELECT d.doctor_id,
              CONCAT(d.first_name, ' ', d.last_name) AS name,
              d.specialization,
              COALESCE(adm.cnt, 0) AS active_admissions,
              COALESCE(ref.cnt, 0) AS pending_referrals,
              COALESCE(dic.cnt, 0) AS patients_in_charge
       FROM doctors d
       LEFT JOIN (
         SELECT doctor_id, COUNT(*) AS cnt FROM admissions
         WHERE status IN ('Pending Room', 'Active') GROUP BY doctor_id
       ) adm ON adm.doctor_id = d.doctor_id
       LEFT JOIN (
         SELECT assigned_doctor_id AS doctor_id, COUNT(*) AS cnt FROM referrals
         WHERE status IN ('Pending', 'Accepted') GROUP BY assigned_doctor_id
       ) ref ON ref.doctor_id = d.doctor_id
       LEFT JOIN (
         SELECT doctor_id, COUNT(*) AS cnt FROM doctor_in_charge GROUP BY doctor_id
       ) dic ON dic.doctor_id = d.doctor_id
       WHERE d.employment_status = 'Active'
       ORDER BY (COALESCE(adm.cnt, 0) + COALESCE(ref.cnt, 0)) DESC`
    );
    return res.status(200).json({ success: true, data: rows });
  } catch (err) {
    console.error('getDoctorWorkload error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

module.exports = { getAllDoctors, getActiveDoctors, getDoctorWorkload };
