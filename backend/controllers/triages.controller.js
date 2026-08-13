const db = require('../config/db');
const { isDoctorInCharge } = require('../utils/dic');
const { scopeToAssignedPatients, doctorCanAccessPatient, scopeForDoctorInCharge, doctorInChargeCanAccessPatient, unassignedPatientsCondition, isPatientUnassigned } = require('../utils/scoping');
const { rejectIfAtCapacity } = require('../utils/capacity');
const { createAlert } = require('../utils/alerts');
const { getNurseContext, isDischargedTriageDepartment } = require('../utils/nursing');

// POST /api/triages
// Assigning an attending doctor is a Doctor-in-Charge responsibility
// (assignTriageDoctor) — triage creation never writes doctor_in_charge, and
// any assigned_doctor_id in the body is ignored.
const createTriage = async (req, res) => {
  const { patient_id, visit_room_id, triage_level, notes } = req.body;

  // A nurse is always recorded as their own employee_id (cannot spoof another
  // employee); an admin may record a triage on behalf of an employee via the body.
  const employee_id = (req.user.role === 'nurse')
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
    // Intake is closed while the hospital has no free bed — see utils/capacity.
    // Editing an existing triage (updateTriage) and recording vitals are never
    // blocked: they continue the care of patients already inside.
    if (await rejectIfAtCapacity(res)) return;

    // A discharged patient walking back in is a returning patient, not a
    // continuation of their old stay. Same "Discharged" definition as
    // CARE_STATUS_EXPR in patients.controller: no ongoing admission AND at
    // least one admission that reached 'Discharged'. Reused inline rather than
    // imported because CARE_STATUS_EXPR is written to run inside a join over
    // p.patient_id, not as a standalone per-patient boolean.
    //
    // Computed unconditionally (not just for nurses) because visit_number below
    // needs it regardless of who is recording the triage (e.g. an admin on
    // behalf of an employee).
    const [[careState]] = await db.query(
      `SELECT
         NOT EXISTS (
           SELECT 1 FROM admissions ad
           WHERE ad.patient_id = ?
             AND ad.status IN ('Pending Room','Active','Pending Discharge')
         ) AS no_ongoing_admission,
         EXISTS (
           SELECT 1 FROM admissions ad
           WHERE ad.patient_id = ? AND ad.status = 'Discharged'
         ) AS has_discharged_admission`,
      [patient_id, patient_id]
    );
    const isDischargedPatient = !!careState.no_ongoing_admission && !!careState.has_discharged_admission;

    // Only a front-door department (ER, and OPD once one exists) may triage a
    // discharged patient back in — enforced for nurses only; admins/doctors
    // recording on behalf of staff are not ward-scoped.
    if (isDischargedPatient && req.user.role === 'nurse') {
      const nurse = await getNurseContext(req.user.user_id, req.user.linked_id);
      if (!isDischargedTriageDepartment(nurse?.department_name)) {
        return res.status(403).json({
          success: false,
          message: 'Only Emergency Room/OPD nurses can triage a returning (discharged) patient.',
        });
      }
    }

    // visit_number: a returning (discharged) patient starts a new, higher
    // visit_number; anyone else's triage joins the visit already in progress
    // (same number as their most recent triage — COALESCE(...,1) covers a
    // patient with no prior triage at all).
    const [[visitRow]] = await db.query(
      isDischargedPatient
        ? 'SELECT COALESCE(MAX(visit_number), 0) + 1 AS visit_number FROM triages WHERE patient_id = ?'
        : 'SELECT COALESCE(MAX(visit_number), 1) AS visit_number FROM triages WHERE patient_id = ?',
      [patient_id]
    );
    const visitNumber = visitRow.visit_number;

    const [result] = await db.query(
      `INSERT INTO triages (patient_id, employee_id, visit_room_id, triage_level, visit_number, notes, triage_datetime)
       VALUES (?, ?, ?, ?, ?, ?, NOW())`,
      [patient_id, employee_id || null, visit_room_id || null, triage_level, visitNumber, notes || null]
    );

    await db.query(
      "INSERT INTO activity_logs (user_id, action, target_table, target_id) VALUES (?, 'CREATE', 'triages', ?)",
      [req.user.user_id, result.insertId]
    );

    // ── Respond immediately ───────────────────────────────────────────────────
    res.status(201).json({ success: true, message: 'Triage created.', triage_id: result.insertId });

    // ── Post-insert alerts (best-effort, non-blocking) ────────────────────────
    // A Critical triage is a High-priority alert: it also goes out by email, so
    // it reaches whoever is not at a screen. Urgent and Non-Urgent stay in-app —
    // an alert that fires for routine traffic stops being read.
    const alertPriority = triage_level === 'Critical' ? 'High' : 'Normal';

    try {
      const [[patient]] = await db.query(
        "SELECT CONCAT(first_name, ' ', last_name) AS patient_name FROM patients WHERE patient_id = ?",
        [patient_id]
      );
      const patientName = patient?.patient_name ?? `Patient #${patient_id}`;

      // 1. Admins — oversight.
      await createAlert({
        message: `New ${triage_level} triage recorded for ${patientName}. Triage ID: ${result.insertId}.`,
        priority: alertPriority,
        subject: `[${triage_level}] Triage recorded for ${patientName}`,
        target: { roles: ['admin'], excludeUserId: req.user.user_id },
      });

      // 2. Critical/Urgent — the doctor already caring for this patient.
      if (triage_level === 'Critical' || triage_level === 'Urgent') {
        const [activeDoctors] = await db.query(
          `SELECT DISTINCT u.user_id
           FROM admissions a
           JOIN users u ON u.linked_id = a.doctor_id AND u.role = 'doctor' AND u.is_active = 1
           WHERE a.patient_id = ? AND a.status = 'Active'`,
          [patient_id]
        );
        const doctorIds = activeDoctors.map((d) => d.user_id).filter((id) => id !== req.user.user_id);
        if (doctorIds.length > 0) {
          await createAlert({
            message: `Your patient ${patientName} has a new ${triage_level} triage. Triage ID: ${result.insertId}.`,
            priority: alertPriority,
            subject: `[${triage_level}] Your patient ${patientName} was re-triaged`,
            target: { userIds: doctorIds },
          });
        }
      }

      // 3. Nobody is coordinating this patient's care — the DICs assign one.
      if (await isPatientUnassigned(patient_id)) {
        await createAlert({
          message: `New ${triage_level} triage recorded for ${patientName} — needs an attending doctor. Triage ID: ${result.insertId}.`,
          priority: alertPriority,
          subject: `[${triage_level}] ${patientName} needs an attending doctor`,
          target: { roles: ['doctor'], doctorInChargeOnly: true, excludeUserId: req.user.user_id },
        });
      }
    } catch (notifErr) {
      console.warn('createTriage: alert dispatch failed (non-fatal):', notifErr.message);
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
      // userId enables the DIC "limbo ownership" branch — patients whose
      // Pending proposal this DIC created stay visible until accepted/declined.
      const scope = (await isDoctorInCharge(req.user.user_id))
        ? scopeForDoctorInCharge('t.patient_id', req.user.linked_id, req.user.user_id)
        : scopeToAssignedPatients('t.patient_id', req.user.linked_id);
      conditions.push(scope.sql);
      params.push(...scope.params);
    }

    // Optional "unassigned only" filter for the DIC/admin coordination views.
    if (['true', '1'].includes(String(req.query.unassigned))) {
      const cond = unassignedPatientsCondition('t.patient_id');
      conditions.push(cond.sql);
    }

    // Nurses see ALL triages (operational policy — any nurse can act
    // on any patient's room assignment/discharge, and the dashboard already
    // shows hospital-wide triage counts). Writes stay strict: updateTriage and
    // addVitalSigns still require being the recording employee.

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

    // Run data + count in parallel
    const [[rows], [[{ total }]]] = await Promise.all([
      db.query(
        // adic = the patient's CURRENT doctor_in_charge row (Pending proposal or
        // Accepted attending). The ordered single-row subquery — keyed on dic_id
        // — guarantees at most one row per triage even if stale duplicates ever
        // reappear; a plain LEFT JOIN doctor_in_charge would multiply triage rows.
        `SELECT t.*, CONCAT(p.first_name, ' ', p.last_name) AS patient_name,
                vs.blood_pressure, vs.heart_rate, vs.temperature, vs.respiratory_rate,
                adoc.doctor_id AS attending_doctor_id,
                CASE WHEN adoc.doctor_id IS NOT NULL
                     THEN CONCAT('Dr. ', adoc.first_name, ' ', adoc.last_name)
                END AS attending_doctor_name,
                adic.status AS assignment_status,
                adic.assigned_by AS assignment_assigned_by
         FROM triages t
         LEFT JOIN patients p ON t.patient_id = p.patient_id
         LEFT JOIN vital_signs vs ON t.triage_id = vs.triage_id
         LEFT JOIN doctor_in_charge adic ON adic.dic_id = (
           SELECT dc.dic_id FROM doctor_in_charge dc
           WHERE dc.patient_id = t.patient_id
           ORDER BY dc.assigned_at DESC LIMIT 1
         )
         LEFT JOIN doctors adoc ON adoc.doctor_id = adic.doctor_id
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
              vs.blood_pressure, vs.heart_rate, vs.temperature, vs.respiratory_rate, vs.recorded_at, vs.updated_at,
              adoc.doctor_id AS attending_doctor_id,
              CASE WHEN adoc.doctor_id IS NOT NULL
                   THEN CONCAT('Dr. ', adoc.first_name, ' ', adoc.last_name)
              END AS attending_doctor_name,
              adic.status AS assignment_status,
              adic.assigned_by AS assignment_assigned_by
       FROM triages t
       LEFT JOIN patients p ON t.patient_id = p.patient_id
       LEFT JOIN employees e ON t.employee_id = e.employee_id
       LEFT JOIN visit_rooms vr ON t.visit_room_id = vr.visit_room_id
       LEFT JOIN vital_signs vs ON t.triage_id = vs.triage_id
       LEFT JOIN doctor_in_charge adic ON adic.dic_id = (
         SELECT dc.dic_id FROM doctor_in_charge dc
         WHERE dc.patient_id = t.patient_id
         ORDER BY dc.assigned_at DESC LIMIT 1
       )
       LEFT JOIN doctors adoc ON adoc.doctor_id = adic.doctor_id
       WHERE t.triage_id = ?`,
      [req.params.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Triage not found.' });
    }

    // Doctors may view triages of their assigned patients (read scope includes
    // patients pending their acceptance); a Doctor-in-Charge may also view
    // triages of unassigned patients and of proposals they created (limbo).
    if (req.user.role === 'doctor') {
      const allowed = (await isDoctorInCharge(req.user.user_id))
        ? await doctorInChargeCanAccessPatient(req.user.linked_id, rows[0].patient_id, { userId: req.user.user_id, includePending: true })
        : await doctorCanAccessPatient(req.user.linked_id, rows[0].patient_id, { includePending: true });
      if (!allowed) {
        return res.status(403).json({ success: false, message: 'You are not assigned to this patient.' });
      }
    }

    // Nurses may view any triage (operational policy — matches
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

    // Reads are open to all nurses, but edits stay strict: only the
    // employee who recorded the triage may change it.
    if ((req.user.role === 'nurse')
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

    // Reads are open to all nurses, but vitals writes stay strict: only
    // the employee who recorded the triage may add/update them.
    if ((req.user.role === 'nurse')
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

  const employee_id = (req.user.role === 'nurse')
    ? req.user.linked_id
    : null;

  // Emergency triage registers a placeholder patient AND a triage in one step,
  // so the same capacity rule applies — otherwise it would be an open bypass of
  // the registration/triage guards.
  // Exempt from the discharged-patient department gate below: this always
  // INSERTs a brand-new placeholder patient (see step 1) and never accepts an
  // existing patient_id, so it can never target an already-discharged patient.
  try {
    if (await rejectIfAtCapacity(res)) return;
  } catch (capErr) {
    console.error('createEmergencyTriage capacity check error:', capErr);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }

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

  // ── Post-commit alerts (best-effort, non-blocking) ────────────────────────
  // Emergency priority: this is the case the multi-channel path exists for —
  // an unidentified patient nobody owns yet. It goes in-app AND out to email
  // and SMS, because the people who need to move may not be at a screen.
  const notifMsg = `EMERGENCY: An unidentified patient has been triaged as ${triage_level}. Immediate attention required. Patient ID: ${newPatientId}.`;

  // Doctors-in-Charge get the coordination wording instead — the new patient
  // always starts unassigned, and they are who assigns one.
  await createAlert({
    message: `New ${triage_level} triage recorded for an unidentified patient — needs an attending doctor. Triage ID: ${triageId}.`,
    priority: 'Emergency',
    subject: `[EMERGENCY] Unidentified ${triage_level} patient needs an attending doctor`,
    target: { roles: ['doctor'], doctorInChargeOnly: true, excludeUserId: req.user.user_id },
  });

  // Everyone else on duty: admins for oversight, non-DIC doctors and nurses to
  // respond. resolveRecipients excludes inactive accounts.
  const [dicRows] = await db.query(
    "SELECT user_id FROM users WHERE role = 'doctor' AND is_doctor_in_charge = 1 AND is_active = 1"
  );
  const dicIds = new Set(dicRows.map((u) => u.user_id));
  const [others] = await db.query(
    "SELECT user_id FROM users WHERE is_active = 1 AND role IN ('admin','doctor','nurse')"
  );
  const otherIds = others
    .map((u) => u.user_id)
    .filter((id) => id !== req.user.user_id && !dicIds.has(id));

  await createAlert({
    message: notifMsg,
    priority: 'Emergency',
    subject: `[EMERGENCY] Unidentified patient triaged ${triage_level}`,
    target: { userIds: otherIds },
  });
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

    // Acceptance workflow: assigning ANOTHER doctor creates a Pending PROPOSAL
    // they must accept or decline; assigning YOURSELF is immediately Accepted
    // (you don't accept your own proposal). A patient with a live Pending
    // proposal cannot be re-proposed — the DIC must cancel it first
    // (POST /api/assignments/:patientId/cancel). An Accepted row may be
    // replaced (reassign), which starts a new Pending handshake.
    // INVARIANT: at most one doctor_in_charge row per patient, of either status.
    const isSelfAssign = Number(doctor_id) === Number(req.user.linked_id);

    const [[existing]] = await db.query(
      'SELECT dic_id, status FROM doctor_in_charge WHERE patient_id = ? LIMIT 1',
      [triage.patient_id]
    );
    if (existing && existing.status === 'Pending') {
      return res.status(400).json({
        success: false,
        message: 'This patient already has an assignment awaiting acceptance. Cancel it before proposing another doctor.',
      });
    }

    const newStatus = isSelfAssign ? 'Accepted' : 'Pending';
    const connection = await db.getConnection();
    await connection.beginTransaction();
    try {
      await connection.query('DELETE FROM doctor_in_charge WHERE patient_id = ?', [triage.patient_id]);
      await connection.query(
        `INSERT INTO doctor_in_charge (doctor_id, patient_id, assigned_at, status, assigned_by, responded_at)
         VALUES (?, ?, NOW(), ?, ?, ${isSelfAssign ? 'NOW()' : 'NULL'})`,
        [doctor_id, triage.patient_id, newStatus, req.user.user_id]
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
      message: isSelfAssign
        ? `You are now the attending doctor for ${triage.patient_name ?? 'this patient'}.`
        : `Dr. ${targetDoctor.name} has been proposed as attending doctor for ${triage.patient_name ?? 'this patient'} — awaiting their acceptance.`,
    });

    // Best-effort notification to the proposed doctor (skip on self-assign)
    try {
      const [[docUser]] = await db.query(
        "SELECT user_id FROM users WHERE linked_id = ? AND role = 'doctor' AND is_active = 1 LIMIT 1",
        [doctor_id]
      );
      if (docUser && docUser.user_id !== req.user.user_id) {
        await db.query(
          'INSERT INTO notifications (user_id, message, referral_id) VALUES (?, ?, ?)',
          [
            docUser.user_id,
            `You have been proposed as the attending doctor for ${triage.patient_name ?? 'a patient'}. Review the chart and accept or decline from your dashboard.`,
            null,
          ]
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
