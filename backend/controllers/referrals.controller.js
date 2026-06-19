const db = require('../config/db');

// POST /api/referrals
const createReferral = async (req, res) => {
  const { diagnosis_id, referring_doctor_id, assigned_doctor_id } = req.body;

  if (!diagnosis_id || !assigned_doctor_id) {
    return res.status(400).json({ success: false, message: 'diagnosis_id and assigned_doctor_id are required.' });
  }

  try {
    const [result] = await db.query(
      `INSERT INTO referrals (diagnosis_id, referring_doctor_id, assigned_doctor_id, referral_date, status)
       VALUES (?, ?, ?, NOW(), 'Pending')`,
      [diagnosis_id, referring_doctor_id || null, assigned_doctor_id]
    );

    // Notify the assigned doctor
    const [doctor] = await db.query(
      'SELECT linked_id FROM users WHERE role = "doctor" AND linked_id = ?',
      [assigned_doctor_id]
    );
    if (doctor.length > 0) {
      const userRes = await db.query('SELECT user_id FROM users WHERE linked_id = ? AND role = "doctor"', [assigned_doctor_id]);
      if (userRes[0].length > 0) {
        await db.query(
          `INSERT INTO notifications (user_id, message, referral_id) VALUES (?, ?, ?)`,
          [userRes[0][0].user_id, `You have a new referral assigned to you. Referral ID: ${result.insertId}`, result.insertId]
        );
      }
    }

    await db.query(
      "INSERT INTO activity_logs (user_id, action, target_table, target_id) VALUES (?, 'CREATE', 'referrals', ?)",
      [req.user.user_id, result.insertId]
    );

    return res.status(201).json({ success: true, message: 'Referral created.', referral_id: result.insertId });
  } catch (err) {
    console.error('createReferral error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// GET /api/referrals
const getAllReferrals = async (req, res) => {
  const { status, page = 1, limit = 20 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  try {
    const params = [];
    let where = '';

    if (status) {
      where = 'WHERE r.status = ?';
      params.push(status);
    }

    // Doctors only see their own referrals
    if (req.user.role === 'doctor') {
      where = where ? `${where} AND r.assigned_doctor_id = ?` : 'WHERE r.assigned_doctor_id = ?';
      params.push(req.user.linked_id);
    }

    // Run data query and count query in parallel
    const [[rows], [[{ total }]]] = await Promise.all([
      db.query(
        `SELECT r.*,
                CONCAT(p.first_name, ' ', p.last_name) AS patient_name,
                CONCAT(ad.first_name, ' ', ad.last_name) AS assigned_doctor_name,
                CONCAT(rd.first_name, ' ', rd.last_name) AS referring_doctor_name,
                diag.medical_condition
         FROM referrals r
         LEFT JOIN diagnoses diag ON r.diagnosis_id = diag.diagnosis_id
         LEFT JOIN patients p ON diag.patient_id = p.patient_id
         LEFT JOIN doctors ad ON r.assigned_doctor_id = ad.doctor_id
         LEFT JOIN doctors rd ON r.referring_doctor_id = rd.doctor_id
         ${where}
         ORDER BY r.referral_date DESC LIMIT ? OFFSET ?`,
        [...params, parseInt(limit), offset]
      ),
      db.query(
        `SELECT COUNT(*) AS total
         FROM referrals r
         LEFT JOIN diagnoses diag ON r.diagnosis_id = diag.diagnosis_id
         ${where}`,
        params
      ),
    ]);

    return res.status(200).json({ success: true, data: rows, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    console.error('getAllReferrals error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// GET /api/referrals/:id
const getReferralById = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT r.*,
              CONCAT(p.first_name, ' ', p.last_name) AS patient_name,
              p.date_of_birth, p.sex, p.contact_number,
              CONCAT(ad.first_name, ' ', ad.last_name) AS assigned_doctor_name,
              ad.specialization,
              diag.medical_condition
       FROM referrals r
       LEFT JOIN diagnoses diag ON r.diagnosis_id = diag.diagnosis_id
       LEFT JOIN patients p ON diag.patient_id = p.patient_id
       LEFT JOIN doctors ad ON r.assigned_doctor_id = ad.doctor_id
       WHERE r.referral_id = ?`,
      [req.params.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Referral not found.' });
    }
    return res.status(200).json({ success: true, data: rows[0] });
  } catch (err) {
    console.error('getReferralById error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// PUT /api/referrals/:id/status
const updateReferralStatus = async (req, res) => {
  const { status } = req.body;
  const validStatuses = ['Pending', 'Accepted', 'Completed', 'Cancelled'];

  if (!status || !validStatuses.includes(status)) {
    return res.status(400).json({ success: false, message: `status must be one of: ${validStatuses.join(', ')}.` });
  }

  try {
    await db.query('UPDATE referrals SET status = ? WHERE referral_id = ?', [status, req.params.id]);

    await db.query(
      "INSERT INTO activity_logs (user_id, action, target_table, target_id) VALUES (?, 'UPDATE_STATUS', 'referrals', ?)",
      [req.user.user_id, req.params.id]
    );

    return res.status(200).json({ success: true, message: `Referral status updated to ${status}.` });
  } catch (err) {
    console.error('updateReferralStatus error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// GET /api/referrals/history/:patient_id
const getReferralHistory = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT r.*,
              CONCAT(ad.first_name, ' ', ad.last_name) AS assigned_doctor_name,
              ad.specialization,
              diag.medical_condition
       FROM referrals r
       LEFT JOIN diagnoses diag ON r.diagnosis_id = diag.diagnosis_id
       LEFT JOIN doctors ad ON r.assigned_doctor_id = ad.doctor_id
       WHERE diag.patient_id = ?
       ORDER BY r.referral_date DESC`,
      [req.params.patient_id]
    );
    return res.status(200).json({ success: true, data: rows });
  } catch (err) {
    console.error('getReferralHistory error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

module.exports = { createReferral, getAllReferrals, getReferralById, updateReferralStatus, getReferralHistory };
