const db = require('../config/db');

// GET /api/patients
const getAllPatients = async (req, res) => {
  const { search, page = 1, limit = 20 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  try {
    let query = `
      SELECT patient_id, first_name, last_name, sex, date_of_birth,
             contact_number, address, created_at
      FROM patients
    `;
    const params = [];

    if (search) {
      query += ` WHERE CONCAT(first_name, ' ', last_name) LIKE ?
                 OR patient_id LIKE ?`;
      params.push(`%${search}%`, `%${search}%`);
    }

    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), offset);

    const [rows] = await db.query(query, params);

    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total FROM patients ${search ? "WHERE CONCAT(first_name, ' ', last_name) LIKE ? OR patient_id LIKE ?" : ''}`,
      search ? [`%${search}%`, `%${search}%`] : []
    );

    return res.status(200).json({ success: true, data: rows, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    console.error('getAllPatients error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// GET /api/patients/:id
const getPatientById = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM patients WHERE patient_id = ?', [req.params.id]);
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Patient not found.' });
    }
    return res.status(200).json({ success: true, data: rows[0] });
  } catch (err) {
    console.error('getPatientById error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// GET /api/patients/:id/history
const getPatientHistory = async (req, res) => {
  const { id } = req.params;
  try {
    const [triages] = await db.query(
      `SELECT t.*, vs.blood_pressure, vs.heart_rate, vs.temperature, vs.respiratory_rate
       FROM triages t
       LEFT JOIN vital_signs vs ON t.triage_id = vs.triage_id
       WHERE t.patient_id = ? ORDER BY t.triage_datetime DESC`,
      [id]
    );
    const [diagnoses] = await db.query(
      `SELECT d.*, CONCAT(doc.first_name, ' ', doc.last_name) AS doctor_name
       FROM diagnoses d
       LEFT JOIN doctors doc ON d.doctor_id = doc.doctor_id
       WHERE d.patient_id = ? ORDER BY d.diagnosis_date DESC`,
      [id]
    );

    // Attach treatments and lab_results to each diagnosis
    if (diagnoses.length > 0) {
      const diagIds = diagnoses.map((d) => d.diagnosis_id);
      const placeholders = diagIds.map(() => '?').join(',');

      const [treatments] = await db.query(
        `SELECT * FROM treatments WHERE diagnosis_id IN (${placeholders})`,
        diagIds
      );
      const [labResults] = await db.query(
        `SELECT * FROM lab_results WHERE diagnosis_id IN (${placeholders}) ORDER BY date_conducted DESC`,
        diagIds
      );

      // Group by diagnosis_id
      const treatmentMap = {};
      const labMap = {};
      for (const tx of treatments) {
        if (!treatmentMap[tx.diagnosis_id]) treatmentMap[tx.diagnosis_id] = [];
        treatmentMap[tx.diagnosis_id].push(tx);
      }
      for (const lr of labResults) {
        if (!labMap[lr.diagnosis_id]) labMap[lr.diagnosis_id] = [];
        labMap[lr.diagnosis_id].push(lr);
      }
      for (const d of diagnoses) {
        d.treatments  = treatmentMap[d.diagnosis_id]  || [];
        d.lab_results = labMap[d.diagnosis_id] || [];
      }
    }

    const [referrals] = await db.query(
      `SELECT r.*, CONCAT(d.first_name, ' ', d.last_name) AS assigned_doctor_name
       FROM referrals r
       LEFT JOIN doctors d ON r.assigned_doctor_id = d.doctor_id
       WHERE r.diagnosis_id IN (SELECT diagnosis_id FROM diagnoses WHERE patient_id = ?)
       ORDER BY r.referral_date DESC`,
      [id]
    );
    const [admissions] = await db.query(
      `SELECT a.*, r.room_type, r.bed_number,
              CONCAT(d.first_name, ' ', d.last_name) AS doctor_name
       FROM admissions a
       LEFT JOIN rooms r ON a.room_id = r.room_id
       LEFT JOIN doctors d ON a.doctor_id = d.doctor_id
       WHERE a.patient_id = ? ORDER BY a.admission_date DESC`,
      [id]
    );

    return res.status(200).json({ success: true, data: { triages, diagnoses, referrals, admissions } });
  } catch (err) {
    console.error('getPatientHistory error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// POST /api/patients
const createPatient = async (req, res) => {
  const {
    first_name, last_name, sex, date_of_birth,
    contact_number, address,
    emergency_contact_name, emergency_contact_number,
  } = req.body;

  if (!first_name || !last_name || !sex || !date_of_birth) {
    return res.status(400).json({ success: false, message: 'First name, last name, sex, and date of birth are required.' });
  }

  try {
    const [result] = await db.query(
      `INSERT INTO patients
       (first_name, last_name, sex, date_of_birth, contact_number, address, emergency_contact_name, emergency_contact_number)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [first_name, last_name, sex, date_of_birth, contact_number, address, emergency_contact_name, emergency_contact_number]
    );

    await db.query(
      "INSERT INTO activity_logs (user_id, action, target_table, target_id) VALUES (?, 'CREATE', 'patients', ?)",
      [req.user.user_id, result.insertId]
    );

    return res.status(201).json({ success: true, message: 'Patient registered.', patient_id: result.insertId });
  } catch (err) {
    console.error('createPatient error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// PUT /api/patients/:id
const updatePatient = async (req, res) => {
  const {
    first_name, last_name, sex, date_of_birth,
    contact_number, address,
    emergency_contact_name, emergency_contact_number,
  } = req.body;

  try {
    await db.query(
      `UPDATE patients SET
        first_name = COALESCE(?, first_name),
        last_name = COALESCE(?, last_name),
        sex = COALESCE(?, sex),
        date_of_birth = COALESCE(?, date_of_birth),
        contact_number = COALESCE(?, contact_number),
        address = COALESCE(?, address),
        emergency_contact_name = COALESCE(?, emergency_contact_name),
        emergency_contact_number = COALESCE(?, emergency_contact_number)
       WHERE patient_id = ?`,
      [first_name, last_name, sex, date_of_birth, contact_number, address,
       emergency_contact_name, emergency_contact_number, req.params.id]
    );

    await db.query(
      "INSERT INTO activity_logs (user_id, action, target_table, target_id) VALUES (?, 'UPDATE', 'patients', ?)",
      [req.user.user_id, req.params.id]
    );

    return res.status(200).json({ success: true, message: 'Patient updated.' });
  } catch (err) {
    console.error('updatePatient error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

module.exports = { getAllPatients, getPatientById, getPatientHistory, createPatient, updatePatient };
