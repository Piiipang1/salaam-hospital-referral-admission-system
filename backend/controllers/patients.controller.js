const db = require('../config/db');
const { isDoctorInCharge } = require('../utils/dic');
const { scopeToAssignedPatients, doctorCanAccessPatient, scopeForDoctorInCharge, doctorInChargeCanAccessPatient, unassignedPatientsCondition } = require('../utils/scoping');

// GET /api/patients
const getAllPatients = async (req, res) => {
  const { search, sex, from_date, to_date, page = 1, limit = 20 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  try {
    const conditions = [];
    const params     = [];

    // Text search — full name OR patient_id
    if (search) {
      conditions.push("(CONCAT(p.first_name, ' ', p.last_name) LIKE ? OR p.patient_id LIKE ?)");
      params.push(`%${search}%`, `%${search}%`);
    }

    // Sex filter — 'Male' | 'Female' | 'Other'
    if (sex) {
      conditions.push('p.sex = ?');
      params.push(sex);
    }

    // Registration date range
    if (from_date) {
      conditions.push('DATE(p.created_at) >= ?');
      params.push(from_date);
    }
    if (to_date) {
      conditions.push('DATE(p.created_at) <= ?');
      params.push(to_date);
    }

    // Doctors only see patients they are/were assigned to (doctor_in_charge,
    // referrals assigned to them, or admissions under their care) — for
    // continuity of care this includes past as well as active assignments.
    // Doctor-in-Charge mode (fresh DB read, so admin toggles apply live)
    // bypasses this scoping entirely; nurse scoping is never bypassed.
    // Doctors are scoped to their assigned patients. A Doctor-in-Charge (ER
    // coordinator) also sees currently-unassigned patients. (Fresh DB read —
    // never trust the JWT for the DIC flag.)
    if (req.user.role === 'doctor') {
      const scope = (await isDoctorInCharge(req.user.user_id))
        ? scopeForDoctorInCharge('p.patient_id', req.user.linked_id)
        : scopeToAssignedPatients('p.patient_id', req.user.linked_id);
      conditions.push(scope.sql);
      params.push(...scope.params);
    }

    // Optional "unassigned only" filter (used by the DIC/admin coordination
    // views). AND-composes with the role scope above.
    if (['true', '1'].includes(String(req.query.unassigned))) {
      const cond = unassignedPatientsCondition('p.patient_id');
      conditions.push(cond.sql);
    }

    // Nurses and staff only see patients they personally registered (issue #10)
    if (req.user.role === 'nurse' || req.user.role === 'staff') {
      conditions.push(
        `p.patient_id IN (
          SELECT CAST(target_id AS UNSIGNED) FROM activity_logs
          WHERE user_id = ? AND action = 'CREATE' AND target_table = 'patients'
        )`
      );
      params.push(req.user.user_id);
    }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

    // Ongoing-admission join is 1:0..1 — a patient can have at most one
    // admission in ('Pending Room','Active') (enforced by the 409 guard in
    // admissions.controller createAdmission), so it never duplicates rows.
    const [rows] = await db.query(
      `SELECT p.patient_id, p.first_name, p.last_name, p.sex, p.date_of_birth,
              p.contact_number, p.address,
              p.emergency_contact_name, p.emergency_contact_number,
              p.is_unidentified, p.created_at,
              a.status AS admission_status,
              rm.room_type, rm.bed_number,
              CONCAT(d.first_name, ' ', d.last_name) AS attending_doctor
       FROM patients p
       LEFT JOIN admissions a
         ON a.patient_id = p.patient_id AND a.status IN ('Pending Room','Active')
       LEFT JOIN rooms   rm ON rm.room_id  = a.room_id
       LEFT JOIN doctors d  ON d.doctor_id = a.doctor_id
       ${where}
       ORDER BY p.created_at DESC LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), offset]
    );

    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total FROM patients p ${where}`,
      params
    );

    return res.status(200).json({
      success: true,
      data: rows,
      total,
      page: parseInt(page),
      limit: parseInt(limit),
    });
  } catch (err) {
    console.error('getAllPatients error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// GET /api/patients/:id
const getPatientById = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT p.*,
              a.status AS admission_status,
              rm.room_type, rm.bed_number,
              CONCAT(d.first_name, ' ', d.last_name) AS attending_doctor
       FROM patients p
       LEFT JOIN admissions a
         ON a.patient_id = p.patient_id AND a.status IN ('Pending Room','Active')
       LEFT JOIN rooms   rm ON rm.room_id  = a.room_id
       LEFT JOIN doctors d  ON d.doctor_id = a.doctor_id
       WHERE p.patient_id = ?`,
      [req.params.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Patient not found.' });
    }

    if (req.user.role === 'doctor') {
      const allowed = (await isDoctorInCharge(req.user.user_id))
        ? await doctorInChargeCanAccessPatient(req.user.linked_id, req.params.id)
        : await doctorCanAccessPatient(req.user.linked_id, req.params.id);
      if (!allowed) {
        return res.status(403).json({ success: false, message: 'You are not assigned to this patient.' });
      }
    }

    // Nurses and staff only see patients they personally registered (issue #10)
    if (req.user.role === 'nurse' || req.user.role === 'staff') {
      const [[nurseAccess]] = await db.query(
        `SELECT 1 AS allowed FROM activity_logs
         WHERE user_id = ? AND action = 'CREATE' AND target_table = 'patients'
         AND CAST(target_id AS UNSIGNED) = ? LIMIT 1`,
        [req.user.user_id, req.params.id]
      );
      if (!nurseAccess) {
        return res.status(403).json({ success: false, message: 'You do not have access to this patient record.' });
      }
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
    // Same doctor scoping as getPatientById — Doctor-in-Charge bypasses it so
    // the patient detail page (info + history) works for unassigned patients.
    if (req.user.role === 'doctor') {
      const allowed = (await isDoctorInCharge(req.user.user_id))
        ? await doctorInChargeCanAccessPatient(req.user.linked_id, id)
        : await doctorCanAccessPatient(req.user.linked_id, id);
      if (!allowed) {
        return res.status(403).json({ success: false, message: 'You are not assigned to this patient.' });
      }
    }

    // Nurses and staff only see history for patients they personally registered (issue #10)
    if (req.user.role === 'nurse' || req.user.role === 'staff') {
      const [[nurseAccess]] = await db.query(
        `SELECT 1 AS allowed FROM activity_logs
         WHERE user_id = ? AND action = 'CREATE' AND target_table = 'patients'
         AND CAST(target_id AS UNSIGNED) = ? LIMIT 1`,
        [req.user.user_id, id]
      );
      if (!nurseAccess) {
        return res.status(403).json({ success: false, message: 'You do not have access to this patient record.' });
      }
    }

    const [triages] = await db.query(
      `SELECT t.*, vs.blood_pressure, vs.heart_rate, vs.temperature, vs.respiratory_rate,
              vs.recorded_at AS vitals_recorded_at, vs.updated_at AS vitals_updated_at
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
      `SELECT r.*, CONCAT(d.first_name, ' ', d.last_name) AS assigned_doctor_name,
              d.specialization
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

  // 'Other' is reserved as the internal placeholder sentinel for unidentified
  // emergency patients (createEmergencyTriage) — not user-selectable.
  if (sex !== 'Male' && sex !== 'Female') {
    return res.status(400).json({ success: false, message: 'Sex must be Male or Female.' });
  }

  if (date_of_birth) {
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    if (date_of_birth > todayStr) {
      return res.status(400).json({ success: false, message: 'Date of birth cannot be in the future.' });
    }
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

    // ── Respond immediately — notifications are best-effort ───────────────────
    res.status(201).json({ success: true, message: 'Patient registered.', patient_id: result.insertId });

    // ── Post-insert: notify all active admins (best-effort, non-blocking) ─────
    try {
      const [admins] = await db.query(
        "SELECT user_id FROM users WHERE role = 'admin' AND is_active = 1"
      );

      const message = `New patient registered: ${first_name} ${last_name}. Patient ID: ${result.insertId}.`;

      for (const admin of admins) {
        if (admin.user_id !== req.user.user_id) {
          await db.query(
            'INSERT INTO notifications (user_id, message, referral_id) VALUES (?, ?, ?)',
            [admin.user_id, message, null]
          );
        }
      }
    } catch (notifErr) {
      console.warn('createPatient: notification insert failed (non-fatal):', notifErr.message);
    }

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
    is_unidentified,
  } = req.body;

  if (date_of_birth) {
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    if (date_of_birth > todayStr) {
      return res.status(400).json({ success: false, message: 'Date of birth cannot be in the future.' });
    }
  }

  // Whitelist the incoming sex value only — omitted/null sex must pass through
  // for the COALESCE partial-update pattern below.
  if (sex != null && sex !== 'Male' && sex !== 'Female') {
    return res.status(400).json({ success: false, message: 'Sex must be Male or Female.' });
  }

  // When completing registration of an unidentified patient, the real identity
  // fields must be present and must not still be the placeholder sentinel values.
  const completingRegistration = is_unidentified === 0 || is_unidentified === '0';
  if (completingRegistration) {
    const placeholderFirstName  = !first_name  || first_name.trim()  === 'Unknown';
    const placeholderLastName   = !last_name   || /^Patient-\d/.test(last_name.trim());
    const placeholderSex        = !sex         || sex === 'Other';
    const placeholderDob        = !date_of_birth || date_of_birth === '1900-01-01';

    if (placeholderFirstName || placeholderLastName || placeholderSex || placeholderDob) {
      return res.status(400).json({
        success: false,
        message: "Please provide the patient's real identity details to complete registration.",
      });
    }
  }

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
        emergency_contact_number = COALESCE(?, emergency_contact_number),
        is_unidentified = COALESCE(?, is_unidentified)
       WHERE patient_id = ?`,
      [first_name, last_name, sex, date_of_birth, contact_number, address,
       emergency_contact_name, emergency_contact_number,
       is_unidentified ?? null, req.params.id]
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
