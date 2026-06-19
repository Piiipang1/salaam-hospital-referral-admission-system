const db = require('../config/db');

// POST /api/diagnoses
const createDiagnosis = async (req, res) => {
  const { patient_id, triage_id, doctor_id, medical_condition } = req.body;

  if (!patient_id || !doctor_id || !medical_condition) {
    return res.status(400).json({ success: false, message: 'patient_id, doctor_id, and medical_condition are required.' });
  }

  try {
    const [result] = await db.query(
      `INSERT INTO diagnoses (patient_id, triage_id, doctor_id, medical_condition, diagnosis_date)
       VALUES (?, ?, ?, ?, CURDATE())`,
      [patient_id, triage_id || null, doctor_id, medical_condition]
    );

    // Set Doctor_In_Charge
    await db.query(
      'INSERT INTO doctor_in_charge (doctor_id, patient_id, assigned_at) VALUES (?, ?, NOW())',
      [doctor_id, patient_id]
    );

    await db.query(
      "INSERT INTO activity_logs (user_id, action, target_table, target_id) VALUES (?, 'CREATE', 'diagnoses', ?)",
      [req.user.user_id, result.insertId]
    );

    return res.status(201).json({ success: true, message: 'Diagnosis created.', diagnosis_id: result.insertId });
  } catch (err) {
    console.error('createDiagnosis error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// GET /api/diagnoses/:id
const getDiagnosisById = async (req, res) => {
  try {
    const [diagnosis] = await db.query(
      `SELECT d.*, CONCAT(doc.first_name, ' ', doc.last_name) AS doctor_name,
              CONCAT(p.first_name, ' ', p.last_name) AS patient_name
       FROM diagnoses d
       LEFT JOIN doctors doc ON d.doctor_id = doc.doctor_id
       LEFT JOIN patients p ON d.patient_id = p.patient_id
       WHERE d.diagnosis_id = ?`,
      [req.params.id]
    );
    if (diagnosis.length === 0) {
      return res.status(404).json({ success: false, message: 'Diagnosis not found.' });
    }

    const [treatments] = await db.query(
      'SELECT * FROM treatments WHERE diagnosis_id = ?',
      [req.params.id]
    );
    const [labResults] = await db.query(
      'SELECT * FROM lab_results WHERE diagnosis_id = ?',
      [req.params.id]
    );

    return res.status(200).json({
      success: true,
      data: { ...diagnosis[0], treatments, lab_results: labResults },
    });
  } catch (err) {
    console.error('getDiagnosisById error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// PUT /api/diagnoses/:id
const updateDiagnosis = async (req, res) => {
  const { medical_condition, doctor_id } = req.body;
  try {
    await db.query(
      `UPDATE diagnoses SET
        medical_condition = COALESCE(?, medical_condition),
        doctor_id = COALESCE(?, doctor_id)
       WHERE diagnosis_id = ?`,
      [medical_condition, doctor_id, req.params.id]
    );
    return res.status(200).json({ success: true, message: 'Diagnosis updated.' });
  } catch (err) {
    console.error('updateDiagnosis error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// POST /api/diagnoses/:id/treatments
const addTreatment = async (req, res) => {
  const { prescribed_medications, dosage, frequency, treatment_duration } = req.body;

  if (!prescribed_medications) {
    return res.status(400).json({ success: false, message: 'prescribed_medications is required.' });
  }

  try {
    const [result] = await db.query(
      `INSERT INTO treatments (diagnosis_id, prescribed_medications, dosage, frequency, treatment_duration)
       VALUES (?, ?, ?, ?, ?)`,
      [req.params.id, prescribed_medications, dosage || null, frequency || null, treatment_duration || null]
    );
    return res.status(201).json({ success: true, message: 'Treatment added.', treatment_id: result.insertId });
  } catch (err) {
    console.error('addTreatment error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// POST /api/diagnoses/:id/lab-results
const addLabResult = async (req, res) => {
  const { patient_id, test_type, results, date_conducted } = req.body;
  const file_attachment = req.file ? req.file.filename : null;

  if (!patient_id || !test_type) {
    return res.status(400).json({ success: false, message: 'patient_id and test_type are required.' });
  }

  try {
    const [result] = await db.query(
      `INSERT INTO lab_results (patient_id, diagnosis_id, test_type, results, file_attachment, date_conducted)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [patient_id, req.params.id, test_type, results || null, file_attachment, date_conducted || new Date()]
    );
    return res.status(201).json({ success: true, message: 'Lab result added.', lab_result_id: result.insertId });
  } catch (err) {
    console.error('addLabResult error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// GET /api/diagnoses/:id/lab-results
const getLabResults = async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM lab_results WHERE diagnosis_id = ? ORDER BY date_conducted DESC',
      [req.params.id]
    );
    return res.status(200).json({ success: true, data: rows });
  } catch (err) {
    console.error('getLabResults error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

module.exports = { createDiagnosis, getDiagnosisById, updateDiagnosis, addTreatment, addLabResult, getLabResults };
