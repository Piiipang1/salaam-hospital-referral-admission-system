const db = require('../config/db');
const { assertCanAccessPatient } = require('../utils/scoping');

// Resolve a diagnosis's patient_id and enforce per-patient access. Returns the
// patient_id when allowed, or sends the 404/403 response and returns null so the
// caller can bail out. The diagnosis's own patient_id is the authoritative link
// (never trust a patient_id from the request body/query).
// Pass { forWrite: true } from mutation handlers: a doctor with only a Pending
// assignment proposal may READ the chart but not write to it.
const guardDiagnosisAccess = async (req, res, { forWrite = false } = {}) => {
  const [[diag]] = await db.query(
    'SELECT patient_id FROM diagnoses WHERE diagnosis_id = ?',
    [req.params.id]
  );
  if (!diag) {
    res.status(404).json({ success: false, message: 'Diagnosis not found.' });
    return null;
  }
  const denied = await assertCanAccessPatient(req, diag.patient_id, { forWrite });
  if (denied) {
    res.status(denied.status).json({ success: false, message: denied.message });
    return null;
  }
  return diag.patient_id;
};

// POST /api/diagnoses
const createDiagnosis = async (req, res) => {
  const { patient_id, triage_id, medical_condition } = req.body;

  // A doctor always records the diagnosis as themselves (cannot spoof another
  // doctor); an admin may record one on behalf of a doctor via doctor_id in the body.
  const doctor_id = req.user.role === 'doctor' ? req.user.linked_id : req.body.doctor_id;

  if (!patient_id || !doctor_id || !medical_condition) {
    return res.status(400).json({ success: false, message: 'patient_id, doctor_id, and medical_condition are required.' });
  }

  const connection = await db.getConnection();
  await connection.beginTransaction();

  let diagnosisId;
  try {
    const [result] = await connection.query(
      `INSERT INTO diagnoses (patient_id, triage_id, doctor_id, medical_condition, diagnosis_date)
       VALUES (?, ?, ?, ?, CURDATE())`,
      [patient_id, triage_id || null, doctor_id, medical_condition]
    );
    diagnosisId = result.insertId;

    // Invariant: at most one doctor_in_charge row per patient — the current
    // attending doctor. Replace, same semantics as assignTriageDoctor.
    // Recording a diagnosis is an act of taking clinical responsibility, so the
    // row is written directly as 'Accepted' (an implicit acceptance — there is
    // no proposal handshake to wait on, and any live Pending proposal for this
    // patient is superseded by the doctor actually treating them).
    await connection.query('DELETE FROM doctor_in_charge WHERE patient_id = ?', [patient_id]);
    await connection.query(
      `INSERT INTO doctor_in_charge (doctor_id, patient_id, assigned_at, status, responded_at)
       VALUES (?, ?, NOW(), 'Accepted', NOW())`,
      [doctor_id, patient_id]
    );

    await connection.query(
      "INSERT INTO activity_logs (user_id, action, target_table, target_id) VALUES (?, 'CREATE', 'diagnoses', ?)",
      [req.user.user_id, diagnosisId]
    );

    await connection.commit();
    connection.release();
  } catch (err) {
    await connection.rollback();
    connection.release();
    console.error('createDiagnosis error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }

  return res.status(201).json({ success: true, message: 'Diagnosis created.', diagnosis_id: diagnosisId });
};

// GET /api/diagnoses/:id
const getDiagnosisById = async (req, res) => {
  try {
    if ((await guardDiagnosisAccess(req, res)) === null) return;

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
  // Only medical_condition is editable. doctor_id (the attributed author) is
  // deliberately NOT updatable here — allowing it would let any editor reattribute
  // a diagnosis to another doctor, contradicting the "cannot spoof another doctor"
  // rule enforced in createDiagnosis / createReferral.
  const { medical_condition } = req.body;
  try {
    if ((await guardDiagnosisAccess(req, res, { forWrite: true })) === null) return;

    await db.query(
      `UPDATE diagnoses SET
        medical_condition = COALESCE(?, medical_condition)
       WHERE diagnosis_id = ?`,
      [medical_condition, req.params.id]
    );

    await db.query(
      "INSERT INTO activity_logs (user_id, action, target_table, target_id) VALUES (?, 'UPDATE', 'diagnoses', ?)",
      [req.user.user_id, req.params.id]
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
    if ((await guardDiagnosisAccess(req, res, { forWrite: true })) === null) return;

    const [result] = await db.query(
      `INSERT INTO treatments (diagnosis_id, prescribed_medications, dosage, frequency, treatment_duration)
       VALUES (?, ?, ?, ?, ?)`,
      [req.params.id, prescribed_medications, dosage || null, frequency || null, treatment_duration || null]
    );

    await db.query(
      "INSERT INTO activity_logs (user_id, action, target_table, target_id) VALUES (?, 'CREATE', 'treatments', ?)",
      [req.user.user_id, result.insertId]
    );

    // ── Respond immediately — notifications are best-effort ───────────────────
    res.status(201).json({ success: true, message: 'Treatment added.', treatment_id: result.insertId });

    // ── Post-insert: notify nurses/staff to prepare administration ────────────
    try {
      const [[diag]] = await db.query(
        `SELECT d.patient_id, CONCAT(p.first_name, ' ', p.last_name) AS patient_name
         FROM diagnoses d
         JOIN patients p ON p.patient_id = d.patient_id
         WHERE d.diagnosis_id = ?`,
        [req.params.id]
      );

      const [staffUsers] = await db.query(
        "SELECT user_id FROM users WHERE role IN ('nurse','staff') AND is_active = 1"
      );

      const patientName = diag?.patient_name ?? 'a patient';
      const message = `New treatment prescribed for ${patientName}: ${prescribed_medications}. Please prepare for administration.`;

      const notifRows = [];
      for (const su of staffUsers) {
        if (su.user_id !== req.user.user_id) {
          notifRows.push([su.user_id, message, null]);
        }
      }

      if (notifRows.length > 0) {
        await db.query(
          'INSERT INTO notifications (user_id, message, referral_id) VALUES ?',
          [notifRows]
        );
      }
    } catch (notifErr) {
      console.warn('addTreatment: notification insert failed (non-fatal):', notifErr.message);
    }

  } catch (err) {
    console.error('addTreatment error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// GET /api/diagnoses/:id/treatments
const getTreatments = async (req, res) => {
  try {
    if ((await guardDiagnosisAccess(req, res)) === null) return;

    const [rows] = await db.query(
      'SELECT * FROM treatments WHERE diagnosis_id = ? ORDER BY created_at DESC',
      [req.params.id]
    );
    return res.status(200).json({ success: true, data: rows });
  } catch (err) {
    console.error('getTreatments error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// POST /api/diagnoses/:id/assessment — create or update the doctor's assessment for a diagnosis
const saveAssessment = async (req, res) => {
  const { doctor_id, clinical_notes, disposition } = req.body;
  const validDispositions = ['Admit', 'Discharge', 'Refer', 'Observe'];

  if (!doctor_id || !disposition) {
    return res.status(400).json({ success: false, message: 'doctor_id and disposition are required.' });
  }
  if (!validDispositions.includes(disposition)) {
    return res.status(400).json({ success: false, message: `disposition must be one of: ${validDispositions.join(', ')}.` });
  }

  try {
    if ((await guardDiagnosisAccess(req, res, { forWrite: true })) === null) return;

    const [existing] = await db.query(
      'SELECT assessment_id FROM doctor_assessments WHERE diagnosis_id = ?',
      [req.params.id]
    );

    let assessmentId, statusCode, message;

    if (existing.length > 0) {
      await db.query(
        `UPDATE doctor_assessments
         SET doctor_id = ?, clinical_notes = ?, disposition = ?, assessed_at = NOW()
         WHERE diagnosis_id = ?`,
        [doctor_id, clinical_notes || null, disposition, req.params.id]
      );

      await db.query(
        "INSERT INTO activity_logs (user_id, action, target_table, target_id) VALUES (?, 'UPDATE', 'doctor_assessments', ?)",
        [req.user.user_id, existing[0].assessment_id]
      );

      assessmentId = existing[0].assessment_id;
      statusCode = 200;
      message = 'Assessment updated.';
    } else {
      const [result] = await db.query(
        `INSERT INTO doctor_assessments (diagnosis_id, doctor_id, clinical_notes, disposition)
         VALUES (?, ?, ?, ?)`,
        [req.params.id, doctor_id, clinical_notes || null, disposition]
      );

      await db.query(
        "INSERT INTO activity_logs (user_id, action, target_table, target_id) VALUES (?, 'CREATE', 'doctor_assessments', ?)",
        [req.user.user_id, result.insertId]
      );

      assessmentId = result.insertId;
      statusCode = 201;
      message = 'Assessment created.';
    }

    // ── Respond immediately — notifications are best-effort ───────────────────
    res.status(statusCode).json({ success: true, message, assessment_id: assessmentId });

    // ── Post-save: notify nurses/staff to act on the doctor's disposition ─────
    // Applies to both the create and update paths above.
    try {
      const [[diag]] = await db.query(
        `SELECT d.patient_id, CONCAT(p.first_name, ' ', p.last_name) AS patient_name
         FROM diagnoses d
         JOIN patients p ON p.patient_id = d.patient_id
         WHERE d.diagnosis_id = ?`,
        [req.params.id]
      );

      const patientName = diag?.patient_name ?? 'a patient';
      // Referrals are clinical and hidden from nurse/staff — the 'Refer'
      // disposition intentionally generates no nurse/staff notification.
      // (Guarding on notifMessage also skips any unrecognized disposition.)
      const dispositionMessages = {
        Admit:     `Doctor has ordered ADMISSION for ${patientName}. Please prepare bed assignment.`,
        Discharge: `Doctor has ordered DISCHARGE for ${patientName}. Please prepare discharge documents.`,
        Observe:   `Doctor has ordered OBSERVATION for ${patientName}. Please monitor the patient.`,
      };
      const notifMessage = dispositionMessages[disposition];

      if (notifMessage) {
        const [staffUsers] = await db.query(
          "SELECT user_id FROM users WHERE role IN ('nurse','staff') AND is_active = 1"
        );

        const notifRows = [];
        for (const su of staffUsers) {
          if (su.user_id !== req.user.user_id) {
            notifRows.push([su.user_id, notifMessage, null]);
          }
        }

        if (notifRows.length > 0) {
          await db.query(
            'INSERT INTO notifications (user_id, message, referral_id) VALUES ?',
            [notifRows]
          );
        }
      }
    } catch (notifErr) {
      console.warn('saveAssessment: notification insert failed (non-fatal):', notifErr.message);
    }

  } catch (err) {
    console.error('saveAssessment error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// GET /api/diagnoses/:id/assessment
const getAssessment = async (req, res) => {
  try {
    if ((await guardDiagnosisAccess(req, res)) === null) return;

    const [rows] = await db.query(
      `SELECT da.*, CONCAT(doc.first_name, ' ', doc.last_name) AS doctor_name
       FROM doctor_assessments da
       LEFT JOIN doctors doc ON da.doctor_id = doc.doctor_id
       WHERE da.diagnosis_id = ?`,
      [req.params.id]
    );
    return res.status(200).json({ success: true, data: rows[0] || null });
  } catch (err) {
    console.error('getAssessment error:', err);
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
    // Access is checked against the diagnosis's own patient (the authoritative
    // link) — not the patient_id in the body. nurse is allowed on this route,
    // so the guard applies the nurse "personally registered" rule to them too.
    if ((await guardDiagnosisAccess(req, res, { forWrite: true })) === null) return;

    const [result] = await db.query(
      `INSERT INTO lab_results (patient_id, diagnosis_id, test_type, results, file_attachment, date_conducted)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [patient_id, req.params.id, test_type, results || null, file_attachment, date_conducted || new Date()]
    );

    await db.query(
      "INSERT INTO activity_logs (user_id, action, target_table, target_id) VALUES (?, 'CREATE', 'lab_results', ?)",
      [req.user.user_id, result.insertId]
    );

    // ── Respond immediately — notification is best-effort ─────────────────────
    res.status(201).json({ success: true, message: 'Lab result added.', lab_result_id: result.insertId });

    // ── Post-insert: notify the doctor in charge (best-effort, non-blocking) ──
    try {
      const [[doctorUser]] = await db.query(
        `SELECT u.user_id
         FROM doctor_in_charge dic
         JOIN users u ON u.linked_id = dic.doctor_id AND u.role = 'doctor' AND u.is_active = 1
         WHERE dic.patient_id = ?
         ORDER BY dic.assigned_at DESC LIMIT 1`,
        [patient_id]
      );

      if (doctorUser?.user_id && doctorUser.user_id !== req.user.user_id) {
        const [[patient]] = await db.query(
          "SELECT CONCAT(first_name, ' ', last_name) AS patient_name FROM patients WHERE patient_id = ?",
          [patient_id]
        );
        const patientName = patient?.patient_name ?? `Patient #${patient_id}`;

        await db.query(
          'INSERT INTO notifications (user_id, message, referral_id) VALUES (?, ?, ?)',
          [
            doctorUser.user_id,
            `Lab result ready for review: ${test_type} for ${patientName}. Lab Result ID: ${result.insertId}.`,
            null,
          ]
        );
      }
    } catch (notifErr) {
      console.warn('addLabResult: notification insert failed (non-fatal):', notifErr.message);
    }

  } catch (err) {
    console.error('addLabResult error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// GET /api/diagnoses/:id/lab-results
const getLabResults = async (req, res) => {
  try {
    if ((await guardDiagnosisAccess(req, res)) === null) return;

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

module.exports = { createDiagnosis, getDiagnosisById, updateDiagnosis, addTreatment, getTreatments, saveAssessment, getAssessment, addLabResult, getLabResults };
