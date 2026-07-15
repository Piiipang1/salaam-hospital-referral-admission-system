const db = require('../config/db');
const { isDoctorInCharge } = require('../utils/dic');
const { scopeToAssignedPatients, doctorCanAccessPatient, scopeForDoctorInCharge, doctorInChargeCanAccessPatient, unassignedPatientsCondition, isPatientUnassigned } = require('../utils/scoping');

// POST /api/triages
// Assigning an attending doctor is a Doctor-in-Charge responsibility
// (assignTriageDoctor) — triage creation never writes doctor_in_charge, and
// any assigned_doctor_id in the body is ignored.
const createTriage = async (req, res) => {
  const { patient_id, visit_room_id, triage_level, notes } = req.body;

  // A nurse/staff is always recorded as their own employee_id (cannot spoof another
  // employee); an admin may record a triage on behalf of an employee via the body.
  const employee_id = (req.user.role === 'nurse' || req.user.role === 'staff')
    ? req.user.linked_id
    : req.body.employee_id;

  if (!patient_id || !triage_level) {
    return res.status(400).json({ success: false, message: 'patient_id and triage_level are required.' });
  }

  const validLevels = ['Critical', 'Urgent', 'Non-Urgent'];
  if (!validLevels.includes(triage_level)) {
    return res.status(400).json({ success: false, message: `triage_level must be one of: ${validLevels.join(', ')}.` });
  }

  try {
    const [result] = await db.query(
      `INSERT INTO triages (patient_id, employee_id, visit_room_id, triage_level, notes, triage_datetime)
       VALUES (?, ?, ?, ?, ?, NOW())`,
      [patient_id, employee_id || null, visit_room_id || null, triage_level, notes || null]
    );

    await db.query(
      "INSERT INTO activity_logs (user_id, action, target_table, target_id) VALUES (?, 'CREATE', 'triages', ?)",
      [req.user.user_id, result.insertId]
    );

    // ── Respond immediately ───────────────────────────────────────────────────
    res.status(201).json({ success: true, message: 'Triage created.', triage_id: result.insertId });

    // ── Post-insert notifications (best-effort, non-blocking) ─────────────────
    try {
      // Resolve patient name
      const [[patient]] = await db.query(
        'SELECT CONCAT(first_name, \' \', last_name) AS patient_name FROM patients WHERE patient_id = ?',
        [patient_id]
      );
      const patientName = patient?.patient_name ?? `Patient #${patient_id}`;

      const baseMsg = `New ${triage_level} triage recorded for ${patientName}. Triage ID: ${result.insertId}.`;

      const notifRows = [];

      // 1. Notify all active admins (except the actor if they are admin)
      const [admins] = await db.query(
        "SELECT user_id FROM users WHERE role = 'admin' AND is_active = 1"
      );
      for (const admin of admins) {
        if (admin.user_id !== req.user.user_id) {
          notifRows.push([admin.user_id, baseMsg, null]);
        }
      }

      // 2. For Critical or Urgent — also notify any doctor with an active admission for this patient
      if (triage_level === 'Critical' || triage_level === 'Urgent') {
        const [activeDoctors] = await db.query(
          `SELECT DISTINCT u.user_id
           FROM admissions a
           JOIN users u ON u.linked_id = a.doctor_id AND u.role = 'doctor' AND u.is_active = 1
           WHERE a.patient_id = ? AND a.status = 'Active'`,
          [patient_id]
        );
        for (const doc of activeDoctors) {
          // Avoid duplicate if doctor is the actor (unlikely but safe)
          if (doc.user_id !== req.user.user_id) {
            notifRows.push([
              doc.user_id,
              `Your patient ${patientName} has a new ${triage_level} triage. Triage ID: ${result.insertId}.`,
              null,
            ]);
          }
        }
      }

      // 3. If the patient has no doctor coordinating their care, alert every
      //    active Doctor-in-Charge so one of them assigns an attending doctor.
      if (await isPatientUnassigned(patient_id)) {
        const [dicUsers] = await db.query(
          "SELECT user_id FROM users WHERE role = 'doctor' AND is_doctor_in_charge = 1 AND is_active = 1"
        );
        for (const dic of dicUsers) {
          if (dic.user_id !== req.user.user_id) {
            notifRows.push([
              dic.user_id,
              `New ${triage_level} triage recorded for ${patientName} — needs an attending doctor. Triage ID: ${result.insertId}.`,
              null,
            ]);
          }
        }
      }

      if (notifRows.length > 0) {
        await db.query(
          'INSERT INTO notifications (user_id, message, referral_id) VALUES ?',
          [notifRows]
        );
      }
    } catch (notifErr) {
      console.warn('createTriage: notification insert failed (non-fatal):', notifErr.message);
    }

  } catch (err) {
    console.error('createTriage error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};


// GET /api/triages
const getAllTriages = async (req, res) => {
  const { level, from_date, to_date, page = 1, limit = 20 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  try {
    const conditions = [];
    const params     = [];

    // Triage level filter — 'Critical' | 'Urgent' | 'Non-Urgent'
    if (level) {
      conditions.push('t.triage_level = ?');
      params.push(level);
    }

    // Date range filter on triage_datetime
    if (from_date) {
      conditions.push('DATE(t.triage_datetime) >= ?');
      params.push(from_date);
    }
    if (to_date) {
      conditions.push('DATE(t.triage_datetime) <= ?');
      params.push(to_date);
    }

    // Doctors see triages of their assigned patients. A Doctor-in-Charge (ER
    // coordinator) also sees triages of currently-unassigned patients.
    // Admins unscoped. (Fresh DB read — never trust the JWT for the DIC flag.)
    if (req.user.role === 'doctor') {
      const scope = (await isDoctorInCharge(req.user.user_id))
        ? scopeForDoctorInCharge('t.patient_id', req.user.linked_id)
        : scopeToAssignedPatients('t.patient_id', req.user.linked_id);
      conditions.push(scope.sql);
      params.push(...scope.params);
    }

    // Optional "unassigned only" filter for the DIC/admin coordination views.
    if (['true', '1'].includes(String(req.query.unassigned))) {
      const cond = unassignedPatientsCondition('t.patient_id');
      conditions.push(cond.sql);
    }

    // Nurses and staff see ALL triages (operational policy — any nurse can act
    // on any patient's room assignment/discharge, and the dashboard already
    // shows hospital-wide triage counts). Writes stay strict: updateTriage and
    // addVitalSigns still require being the recording employee.

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

    // Run data + count in parallel
    const [[rows], [[{ total }]]] = await Promise.all([
      db.query(
        `SELECT t.*, CONCAT(p.first_name, ' ', p.last_name) AS patient_name,
                vs.blood_pressure, vs.heart_rate, vs.temperature, vs.respiratory_rate
         FROM triages t
         LEFT JOIN patients p ON t.patient_id = p.patient_id
         LEFT JOIN vital_signs vs ON t.triage_id = vs.triage_id
         ${where}
         ORDER BY t.triage_datetime DESC LIMIT ? OFFSET ?`,
        [...params, parseInt(limit), offset]
      ),
      db.query(
        `SELECT COUNT(*) AS total FROM triages t ${where}`,
        params
      ),
    ]);

    return res.status(200).json({
      success: true,
      data: rows,
      total,
      page: parseInt(page),
      limit: parseInt(limit),
    });
  } catch (err) {
    console.error('getAllTriages error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// GET /api/triages/:id
const getTriageById = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT t.*, CONCAT(p.first_name, ' ', p.last_name) AS patient_name,
              CONCAT(e.first_name, ' ', e.last_name) AS employee_name,
              vr.room_label AS visit_room_label,
              vs.blood_pressure, vs.heart_rate, vs.temperature, vs.respiratory_rate, vs.recorded_at, vs.updated_at
       FROM triages t
       LEFT JOIN patients p ON t.patient_id = p.patient_id
       LEFT JOIN employees e ON t.employee_id = e.employee_id
       LEFT JOIN visit_rooms vr ON t.visit_room_id = vr.visit_room_id
       LEFT JOIN vital_signs vs ON t.triage_id = vs.triage_id
       WHERE t.triage_id = ?`,
      [req.params.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Triage not found.' });
    }

    // Doctors may view triages of their assigned patients; a Doctor-in-Charge
    // may also view triages of currently-unassigned patients.
    if (req.user.role === 'doctor') {
      const allowed = (await isDoctorInCharge(req.user.user_id))
        ? await doctorInChargeCanAccessPatient(req.user.linked_id, rows[0].patient_id)
        : await doctorCanAccessPatient(req.user.linked_id, rows[0].patient_id);
      if (!allowed) {
        return res.status(403).json({ success: false, message: 'You are not assigned to this patient.' });
      }
    }

    // Nurses and staff may view any triage (operational policy — matches
    // getAllTriages and the hospital-wide dashboard). Writes stay strict.

    return res.status(200).json({ success: true, data: rows[0] });
  } catch (err) {
    console.error('getTriageById error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// PUT /api/triages/:id
const updateTriage = async (req, res) => {
  const { triage_level, notes, visit_room_id } = req.body;

  const validLevels = ['Critical', 'Urgent', 'Non-Urgent'];
  if (triage_level != null && !validLevels.includes(triage_level)) {
    return res.status(400).json({ success: false, message: `triage_level must be one of: ${validLevels.join(', ')}.` });
  }

  try {
    const [[triage]] = await db.query(
      'SELECT employee_id FROM triages WHERE triage_id = ?',
      [req.params.id]
    );
    if (!triage) {
      return res.status(404).json({ success: false, message: 'Triage not found.' });
    }

    // Reads are open to all nurses/staff, but edits stay strict: only the
    // employee who recorded the triage may change it.
    if ((req.user.role === 'nurse' || req.user.role === 'staff')
        && triage.employee_id !== req.user.linked_id) {
      return res.status(403).json({ success: false, message: 'You do not have access to this triage record.' });
    }

    await db.query(
      `UPDATE triages SET
        triage_level = COALESCE(?, triage_level),
        notes = COALESCE(?, notes),
        visit_room_id = COALESCE(?, visit_room_id)
       WHERE triage_id = ?`,
      [triage_level, notes, visit_room_id, req.params.id]
    );

    await db.query(
      "INSERT INTO activity_logs (user_id, action, target_table, target_id) VALUES (?, 'UPDATE', 'triages', ?)",
      [req.user.user_id, req.params.id]
    );

    return res.status(200).json({ success: true, message: 'Triage updated.' });
  } catch (err) {
    console.error('updateTriage error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// POST /api/triages/:id/vital-signs
const addVitalSigns = async (req, res) => {
  const { blood_pressure, heart_rate, temperature, respiratory_rate } = req.body;

  if (!blood_pressure || !heart_rate || !temperature || !respiratory_rate) {
    return res.status(400).json({ success: false, message: 'All vital sign fields are required.' });
  }

  try {
    const [[triage]] = await db.query(
      'SELECT employee_id FROM triages WHERE triage_id = ?',
      [req.params.id]
    );
    if (!triage) {
      return res.status(404).json({ success: false, message: 'Triage not found.' });
    }

    // Reads are open to all nurses/staff, but vitals writes stay strict: only
    // the employee who recorded the triage may add/update them.
    if ((req.user.role === 'nurse' || req.user.role === 'staff')
        && triage.employee_id !== req.user.linked_id) {
      return res.status(403).json({ success: false, message: 'You do not have access to this triage record.' });
    }

    // Upsert — re-recording updates the existing row so recorded_at (creation
    // time) is preserved and updated_at tracks the last modification.
    const [[existing]] = await db.query(
      'SELECT vs_id FROM vital_signs WHERE triage_id = ?',
      [req.params.id]
    );

    if (existing) {
      await db.query(
        `UPDATE vital_signs
         SET blood_pressure = ?, heart_rate = ?, temperature = ?, respiratory_rate = ?,
             updated_at = NOW()
         WHERE vs_id = ?`,
        [blood_pressure, heart_rate, temperature, respiratory_rate, existing.vs_id]
      );

      await db.query(
        "INSERT INTO activity_logs (user_id, action, target_table, target_id) VALUES (?, 'UPDATE', 'vital_signs', ?)",
        [req.user.user_id, existing.vs_id]
      );

      return res.status(200).json({ success: true, message: 'Vital signs updated.', vs_id: existing.vs_id });
    }

    const [result] = await db.query(
      `INSERT INTO vital_signs (triage_id, blood_pressure, heart_rate, temperature, respiratory_rate, recorded_at, updated_at)
       VALUES (?, ?, ?, ?, ?, NOW(), NULL)`,
      [req.params.id, blood_pressure, heart_rate, temperature, respiratory_rate]
    );

    await db.query(
      "INSERT INTO activity_logs (user_id, action, target_table, target_id) VALUES (?, 'CREATE', 'vital_signs', ?)",
      [req.user.user_id, result.insertId]
    );

    return res.status(201).json({ success: true, message: 'Vital signs recorded.', vs_id: result.insertId });
  } catch (err) {
    console.error('addVitalSigns error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// POST /api/triages/emergency
// Like createTriage, this never assigns an attending doctor — the patient
// lands in the unassigned pool and a Doctor-in-Charge assigns one via
// assignTriageDoctor.
const createEmergencyTriage = async (req, res) => {
  const triage_level = req.body.triage_level || 'Critical';
  const notes        = req.body.notes || null;

  const validLevels = ['Critical', 'Urgent', 'Non-Urgent'];
  if (!validLevels.includes(triage_level)) {
    return res.status(400).json({ success: false, message: `triage_level must be one of: ${validLevels.join(', ')}.` });
  }

  const employee_id = (req.user.role === 'nurse' || req.user.role === 'staff')
    ? req.user.linked_id
    : null;

  const connection = await db.getConnection();
  await connection.beginTransaction();

  let newPatientId, triageId;
  try {
    // 1. Placeholder patient — last_name uses timestamp+random for uniqueness
    const [patientResult] = await connection.query(
      `INSERT INTO patients (first_name, last_name, sex, date_of_birth, is_unidentified)
       VALUES ('Unknown', CONCAT('Patient-', UNIX_TIMESTAMP(), '-', FLOOR(RAND()*1000)), 'Other', '1900-01-01', 1)`
    );
    newPatientId = patientResult.insertId;

    await connection.query(
      "INSERT INTO activity_logs (user_id, action, target_table, target_id) VALUES (?, 'CREATE', 'patients', ?)",
      [req.user.user_id, newPatientId]
    );

    // 2. Triage record against the placeholder patient
    const [triageResult] = await connection.query(
      `INSERT INTO triages (patient_id, employee_id, triage_level, notes, triage_datetime)
       VALUES (?, ?, ?, ?, NOW())`,
      [newPatientId, employee_id, triage_level, notes]
    );
    triageId = triageResult.insertId;

    await connection.query(
      "INSERT INTO activity_logs (user_id, action, target_table, target_id) VALUES (?, 'CREATE', 'triages', ?)",
      [req.user.user_id, triageId]
    );

    await connection.commit();
    connection.release();
  } catch (txErr) {
    await connection.rollback();
    connection.release();
    console.error('createEmergencyTriage transaction error:', txErr);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }

  // ── Respond immediately ────────────────────────────────────────────────────
  res.status(201).json({
    success: true,
    patient_id: newPatientId,
    triage_id: triageId,
    message: 'Emergency triage recorded. Patient marked unidentified.',
  });

  // ── Post-commit notifications (best-effort, non-blocking) ─────────────────
  try {
    const notifMsg = `EMERGENCY: An unidentified patient has been triaged as ${triage_level}. Immediate attention required. Patient ID: ${newPatientId}.`;
    const notifRows = [];

    // Doctor-in-Charge users get a coordination message instead of the plain
    // broadcast — the new patient always starts unassigned.
    const [dicUsers] = await db.query(
      "SELECT user_id FROM users WHERE role = 'doctor' AND is_doctor_in_charge = 1 AND is_active = 1"
    );
    const dicUserIds = new Set(dicUsers.map((u) => u.user_id));

    const [admins] = await db.query(
      "SELECT user_id FROM users WHERE role = 'admin' AND is_active = 1"
    );
    for (const a of admins) {
      if (a.user_id !== req.user.user_id) notifRows.push([a.user_id, notifMsg, null]);
    }

    const [doctors] = await db.query(
      "SELECT user_id FROM users WHERE role = 'doctor' AND is_active = 1"
    );
    for (const d of doctors) {
      if (d.user_id === req.user.user_id) continue;
      if (dicUserIds.has(d.user_id)) {
        notifRows.push([
          d.user_id,
          `New ${triage_level} triage recorded for an unidentified patient — needs an attending doctor. Triage ID: ${triageId}.`,
          null,
        ]);
      } else {
        notifRows.push([d.user_id, notifMsg, null]);
      }
    }

    const [staff] = await db.query(
      "SELECT user_id FROM users WHERE role IN ('nurse','staff') AND is_active = 1"
    );
    for (const s of staff) {
      if (s.user_id !== req.user.user_id) notifRows.push([s.user_id, notifMsg, null]);
    }

    if (notifRows.length > 0) {
      await db.query(
        'INSERT INTO notifications (user_id, message, referral_id) VALUES ?',
        [notifRows]
      );
    }
  } catch (notifErr) {
    console.warn('createEmergencyTriage: notification insert failed (non-fatal):', notifErr.message);
  }
};

// GET /api/triages/visit-rooms/options — dropdown options for the triage form
const getVisitRoomOptions = async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT visit_room_id, room_label FROM visit_rooms ORDER BY room_label'
    );
    return res.status(200).json({ success: true, data: rows });
  } catch (err) {
    console.error('getVisitRoomOptions error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// PUT /api/triages/:id/assign-doctor
// ER-coordinator power: set (or change) the attending doctor for a triage's
// patient by writing doctor_in_charge. Allowed only for a live-checked
// Doctor-in-Charge. Once assigned, the patient leaves the unassigned pool.
const assignTriageDoctor = async (req, res) => {
  const { doctor_id } = req.body;

  if (!doctor_id) {
    return res.status(400).json({ success: false, message: 'doctor_id is required.' });
  }

  try {
    const allowed = req.user.role === 'doctor' && await isDoctorInCharge(req.user.user_id);
    if (!allowed) {
      return res.status(403).json({ success: false, message: 'Doctor-in-Charge mode required.' });
    }

    const [[triage]] = await db.query(
      `SELECT t.patient_id, CONCAT(p.first_name, ' ', p.last_name) AS patient_name
       FROM triages t LEFT JOIN patients p ON p.patient_id = t.patient_id
       WHERE t.triage_id = ?`,
      [req.params.id]
    );
    if (!triage) {
      return res.status(404).json({ success: false, message: 'Triage not found.' });
    }

    const [[targetDoctor]] = await db.query(
      "SELECT doctor_id, CONCAT(first_name, ' ', last_name) AS name FROM doctors WHERE doctor_id = ? AND employment_status = 'Active'",
      [doctor_id]
    );
    if (!targetDoctor) {
      return res.status(400).json({ success: false, message: 'Assigned doctor must exist and be Active.' });
    }

    // "Assign or change" — replace the patient's doctor_in_charge with the new
    // attending doctor, in a transaction.
    const connection = await db.getConnection();
    await connection.beginTransaction();
    try {
      await connection.query('DELETE FROM doctor_in_charge WHERE patient_id = ?', [triage.patient_id]);
      await connection.query(
        'INSERT INTO doctor_in_charge (doctor_id, patient_id, assigned_at) VALUES (?, ?, NOW())',
        [doctor_id, triage.patient_id]
      );
      await connection.query(
        "INSERT INTO activity_logs (user_id, action, target_table, target_id) VALUES (?, 'ASSIGN_DOCTOR', 'doctor_in_charge', ?)",
        [req.user.user_id, triage.patient_id]
      );
      await connection.commit();
      connection.release();
    } catch (txErr) {
      await connection.rollback();
      connection.release();
      throw txErr;
    }

    res.status(200).json({
      success: true,
      message: `Dr. ${targetDoctor.name} is now the attending doctor for ${triage.patient_name ?? 'this patient'}.`,
    });

    // Best-effort notification to the newly assigned doctor
    try {
      const [[docUser]] = await db.query(
        "SELECT user_id FROM users WHERE linked_id = ? AND role = 'doctor' AND is_active = 1 LIMIT 1",
        [doctor_id]
      );
      if (docUser && docUser.user_id !== req.user.user_id) {
        await db.query(
          'INSERT INTO notifications (user_id, message, referral_id) VALUES (?, ?, ?)',
          [docUser.user_id, `You have been assigned as the attending doctor for ${triage.patient_name ?? 'a patient'}.`, null]
        );
      }
    } catch (notifErr) {
      console.warn('assignTriageDoctor: notification insert failed (non-fatal):', notifErr.message);
    }
  } catch (err) {
    console.error('assignTriageDoctor error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

module.exports = { createTriage, getAllTriages, getTriageById, updateTriage, addVitalSigns, createEmergencyTriage, getVisitRoomOptions, assignTriageDoctor };
