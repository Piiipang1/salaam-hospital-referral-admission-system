const db = require('../config/db');
const { isDoctorInCharge } = require('../utils/dic');
const { doctorCanAccessPatient, doctorInChargeCanAccessPatient } = require('../utils/scoping');
const { rejectIfAtCapacity } = require('../utils/capacity');
const {
  CLEARANCE_ITEMS, ITEM_LABELS, ITEM_ROLES, isValidItem,
  getClearanceState, blockIfNotCleared,
} = require('../utils/dischargeClearance');
const {
  resolveClinicForAdmission, getActiveClinic, validateFollowupDate, defaultFollowupDate,
} = require('../utils/opdRouting');
const { resolveDischargeNotificationTargets } = require('../utils/nursing');

// GET /api/admissions
const getAllAdmissions = async (req, res) => {
  const { status, from_date, to_date, page = 1, limit = 20 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  try {
    const conditions = [];
    const params = [];

    // status may be a single value or a comma-separated list — the doctor
    // "Current" tab needs Pending Room,Active,Pending Discharge in one query so
    // its pagination + total are correct. A single value yields IN (?) which is
    // equivalent to the old '='. data + count share this WHERE and its params.
    if (status) {
      const statuses = String(status).split(',').map((s) => s.trim()).filter(Boolean);
      if (statuses.length) {
        conditions.push(`a.status IN (${statuses.map(() => '?').join(',')})`);
        params.push(...statuses);
      }
    }

    // Date range filter on admission_date
    if (from_date) {
      conditions.push('DATE(a.admission_date) >= ?');
      params.push(from_date);
    }
    if (to_date) {
      conditions.push('DATE(a.admission_date) <= ?');
      params.push(to_date);
    }

    // Doctors only see admissions they are assigned to
    if (req.user.role === 'doctor') {
      conditions.push('a.doctor_id = ?');
      params.push(req.user.linked_id);
    }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

    // Run data + count in parallel. Every condition references a.* only, so the
    // count needs no joins. (Mirrors getAllReferrals / getAllTriages.)
    const [[rows], [[{ total }]]] = await Promise.all([
      db.query(
        `SELECT a.*, a.discharge_notes,
                CONCAT(p.first_name, ' ', p.last_name) AS patient_name,
                CONCAT(d.first_name, ' ', d.last_name) AS doctor_name,
                r.room_type, r.bed_number,
                CONCAT(e_conf.first_name, ' ', e_conf.last_name) AS confirmed_by_name,
                -- Clearance state, so the list can disable "Confirm Discharge"
                -- without a round trip per row. ENUM values contain no commas,
                -- so GROUP_CONCAT is safe to split on the client.
                (SELECT COUNT(*) FROM discharge_clearance_items ci
                  WHERE ci.admission_id = a.admission_id) AS cleared_count,
                (SELECT GROUP_CONCAT(ci.item) FROM discharge_clearance_items ci
                  WHERE ci.admission_id = a.admission_id) AS cleared_items
         FROM admissions a
         LEFT JOIN patients p ON a.patient_id = p.patient_id
         LEFT JOIN doctors d ON a.doctor_id = d.doctor_id
         LEFT JOIN rooms r ON a.room_id = r.room_id
         LEFT JOIN users u_conf ON a.discharge_confirmed_by = u_conf.user_id
         LEFT JOIN employees e_conf ON u_conf.linked_id = e_conf.employee_id
         ${where}
         ORDER BY a.admission_date DESC LIMIT ? OFFSET ?`,
        [...params, parseInt(limit), offset]
      ),
      db.query(
        `SELECT COUNT(*) AS total FROM admissions a ${where}`,
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
    console.error('getAllAdmissions error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// GET /api/admissions/:id
const getAdmissionById = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT a.*, a.discharge_notes,
              CONCAT(p.first_name, ' ', p.last_name) AS patient_name,
              p.date_of_birth, p.sex,
              CONCAT(d.first_name, ' ', d.last_name) AS doctor_name,
              r.room_type, r.bed_number,
              CONCAT(e_conf.first_name, ' ', e_conf.last_name) AS confirmed_by_name
       FROM admissions a
       LEFT JOIN patients p ON a.patient_id = p.patient_id
       LEFT JOIN doctors d ON a.doctor_id = d.doctor_id
       LEFT JOIN rooms r ON a.room_id = r.room_id
       LEFT JOIN users u_conf ON a.discharge_confirmed_by = u_conf.user_id
       LEFT JOIN employees e_conf ON u_conf.linked_id = e_conf.employee_id
       WHERE a.admission_id = ?`,
      [req.params.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Admission not found.' });
    }

    // Doctors may only view their own admissions (Doctor-in-Charge bypasses).
    if (req.user.role === 'doctor' && !(await isDoctorInCharge(req.user.user_id))) {
      if (rows[0].doctor_id !== req.user.linked_id) {
        return res.status(403).json({ success: false, message: 'You are not the assigned doctor for this admission.' });
      }
    }

    return res.status(200).json({ success: true, data: rows[0] });
  } catch (err) {
    console.error('getAdmissionById error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// POST /api/admissions
const createAdmission = async (req, res) => {
  // Route guard restricts this to doctors; the check here is defense in depth.
  if (req.user.role !== 'doctor') {
    return res.status(403).json({
      success: false,
      message: 'Only doctors may admit patients.',
    });
  }

  const { patient_id, diagnosis_id, admission_type, admission_date } = req.body;

  // A doctor always admits as themselves (cannot spoof another doctor).
  const admittingDoctorId = req.user.linked_id;

  if (!patient_id || !admission_type) {
    return res.status(400).json({
      success: false,
      message: 'patient_id and admission_type are required.',
    });
  }

  try {
    // ── Guard: the hospital must have at least one free bed ──────────────────
    // An admission starts as 'Pending Room', so admitting with zero available
    // beds only builds an unassignable queue. assignRoom stays the authoritative
    // atomic claim — this is the early, user-facing refusal.
    if (await rejectIfAtCapacity(res)) return;

    // ── Guard: a doctor may only admit patients assigned or referred to them.
    // A Doctor-in-Charge (live-checked, never from the JWT) may additionally
    // admit currently-unassigned patients — the ER-coordinator flow for new/
    // unidentified emergency arrivals — and, via limbo ownership (userId),
    // patients whose Pending assignment proposal they created. A doctor with
    // only a Pending proposal TO them may not admit before accepting
    // (includePending stays false — this is a write).
    const allowed = (await isDoctorInCharge(req.user.user_id))
      ? await doctorInChargeCanAccessPatient(req.user.linked_id, patient_id, { userId: req.user.user_id })
      : await doctorCanAccessPatient(req.user.linked_id, patient_id);
    if (!allowed) {
      return res.status(403).json({
        success: false,
        message: 'You can only admit patients assigned or referred to you.',
      });
    }

    // ── Fast-fail: reject if the patient already has an ongoing admission ─────
    // (Authoritative re-check happens inside the transaction below.)
    const [[ongoing]] = await db.query(
      `SELECT admission_id FROM admissions
       WHERE patient_id = ? AND status IN ('Pending Room', 'Active')
       LIMIT 1`,
      [patient_id]
    );
    if (ongoing) {
      return res.status(409).json({
        success: false,
        message: 'This patient already has an ongoing admission. Discharge the current admission before admitting again.',
      });
    }

    // ── Transaction: re-check under a lock, then insert (no room yet) + log ────
    // Room assignment happens later via the dedicated assign-room endpoint.
    const connection = await db.getConnection();
    await connection.beginTransaction();

    let admissionId;
    try {
      // Locking re-check — a FOR UPDATE read on the patient's ongoing admissions
      // gap-locks the patient_id range, so two simultaneous requests can't both
      // create an ongoing admission for the same patient.
      const [[ongoingTx]] = await connection.query(
        `SELECT admission_id FROM admissions
         WHERE patient_id = ? AND status IN ('Pending Room', 'Active')
         LIMIT 1 FOR UPDATE`,
        [patient_id]
      );
      if (ongoingTx) {
        await connection.rollback();
        connection.release();
        return res.status(409).json({
          success: false,
          message: 'This patient already has an ongoing admission. Discharge the current admission before admitting again.',
        });
      }

      const [result] = await connection.query(
        `INSERT INTO admissions (patient_id, diagnosis_id, doctor_id, room_id, admission_type, admission_date, status)
         VALUES (?, ?, ?, NULL, ?, ?, 'Pending Room')`,
        [patient_id, diagnosis_id || null, admittingDoctorId,
         admission_type, admission_date || new Date()]
      );
      admissionId = result.insertId;

      await connection.query(
        "INSERT INTO activity_logs (user_id, action, target_table, target_id) VALUES (?, 'CREATE', 'admissions', ?)",
        [req.user.user_id, admissionId]
      );

      await connection.commit();
      connection.release();
    } catch (txErr) {
      await connection.rollback();
      connection.release();
      // A deadlock / lock-wait here means a concurrent request is admitting the
      // same patient (the FOR UPDATE re-check serializes them) — surface it as
      // the duplicate-admission conflict rather than a 500.
      if (txErr.code === 'ER_LOCK_DEADLOCK' || txErr.code === 'ER_LOCK_WAIT_TIMEOUT') {
        return res.status(409).json({
          success: false,
          message: 'This patient already has an ongoing admission. Discharge the current admission before admitting again.',
        });
      }
      throw txErr;
    }

    // ── Mark the patient's latest triage as Inpatient ────────────────────────
    // An actual admission is stronger evidence of visit type than a disposition,
    // so it overrides any value saveAssessment set. Best-effort — never let this
    // break a completed admission.
    try {
      await db.query(
        `UPDATE triages SET visit_type = 'Inpatient'
         WHERE patient_id = ?
         ORDER BY triage_datetime DESC LIMIT 1`,
        [patient_id]
      );
    } catch (vtErr) {
      console.warn('createAdmission: visit_type update failed (non-fatal):', vtErr.message);
    }

    // ── Respond immediately — notifications are best-effort ──────────────────
    res.status(201).json({ success: true, message: 'Patient admitted. Awaiting room assignment.', admission_id: admissionId });

    // ── Post-commit notifications (outside transaction, non-blocking) ─────────
    // Any failure here is logged but does NOT affect the completed admission.
    try {
      // 1. Resolve patient name and the admitting doctor's user account id
      const [[detail]] = await db.query(
        `SELECT CONCAT(p.first_name, ' ', p.last_name) AS patient_name,
                u.user_id AS doctor_user_id
         FROM   patients  p
         LEFT JOIN users  u ON u.linked_id  = ? AND u.role = 'doctor' AND u.is_active = 1
         WHERE  p.patient_id = ?`,
        [admittingDoctorId, patient_id]
      );

      const patientName = detail?.patient_name ?? `Patient #${patient_id}`;

      // 2. Fetch all active admin user ids
      const [admins] = await db.query(
        "SELECT user_id FROM users WHERE role = 'admin' AND is_active = 1"
      );

      // 3. Build notification rows
      const notifRows = [];

      if (detail?.doctor_user_id) {
        notifRows.push([
          detail.doctor_user_id,
          `Your patient ${patientName} has been admitted (${admission_type}) and is awaiting room assignment. ` +
          `Admission ID: ${admissionId}.`,
          null, // referral_id — not applicable here
        ]);
      }

      const adminMsg =
        `New admission: ${patientName} has been admitted and is awaiting room assignment. ` +
        `Admission ID: ${admissionId}.`;

      for (const admin of admins) {
        // Avoid duplicate if the acting user is also an admin (they already know)
        if (admin.user_id !== req.user.user_id) {
          notifRows.push([admin.user_id, adminMsg, null]);
        }
      }

      // 3b. Notify the doctor who originally referred this patient, if any
      const [[referral]] = await db.query(
        `SELECT u.user_id AS referring_user_id
         FROM referrals ref
         JOIN diagnoses diag ON diag.diagnosis_id = ref.diagnosis_id
         JOIN users u ON u.linked_id = ref.referring_doctor_id AND u.role = 'doctor' AND u.is_active = 1
         WHERE diag.patient_id = ? AND ref.status IN ('Accepted','Pending')
         ORDER BY ref.referral_date DESC LIMIT 1`,
        [patient_id]
      );

      if (referral?.referring_user_id && referral.referring_user_id !== detail?.doctor_user_id) {
        notifRows.push([
          referral.referring_user_id,
          `Your referred patient ${patientName} has been admitted and is awaiting room assignment. ` +
          `Admission ID: ${admissionId}.`,
          null,
        ]);
      }

      // 3c. Notify all active nurses that a room needs to be assigned
      const [nurseUsers] = await db.query(
        "SELECT user_id FROM users WHERE role = 'nurse' AND is_active = 1"
      );
      const nurseMsg = `${patientName} has been admitted and is awaiting room assignment.`;
      for (const su of nurseUsers) {
        if (su.user_id !== req.user.user_id) {
          notifRows.push([su.user_id, nurseMsg, null]);
        }
      }

      // 4. Bulk insert all notifications in one round-trip
      if (notifRows.length > 0) {
        await db.query(
          'INSERT INTO notifications (user_id, message, referral_id) VALUES ?',
          [notifRows]
        );
      }
    } catch (notifErr) {
      // Log but do not propagate — the admission already succeeded
      console.warn('createAdmission: notification insert failed (non-fatal):', notifErr.message);
    }

  } catch (err) {
    console.error('createAdmission error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};


// PUT /api/admissions/:id/assign-room
const assignRoom = async (req, res) => {
  const { room_id } = req.body;

  if (!room_id) {
    return res.status(400).json({ success: false, message: 'room_id is required.' });
  }

  try {
    const [admRows] = await db.query(
      `SELECT a.status, a.doctor_id, a.patient_id,
              CONCAT(p.first_name, ' ', p.last_name) AS patient_name
       FROM admissions a
       LEFT JOIN patients p ON a.patient_id = p.patient_id
       WHERE a.admission_id = ?`,
      [req.params.id]
    );
    if (admRows.length === 0) {
      return res.status(404).json({ success: false, message: 'Admission not found.' });
    }
    const adm = admRows[0];
    if (adm.status !== 'Pending Room') {
      return res.status(409).json({ success: false, message: 'This admission already has a room assigned.' });
    }

    const [room] = await db.query(
      // department_id drives the auto nurse-assignment below.
      'SELECT room_type, bed_number, availability_status, department_id FROM rooms WHERE room_id = ?',
      [room_id]
    );
    if (room.length === 0) {
      return res.status(404).json({ success: false, message: 'Room not found.' });
    }
    // Fast-fail for the common case; the atomic claim below is authoritative.
    if (room[0].availability_status === 'occupied') {
      return res.status(409).json({ success: false, message: 'Room is currently occupied.' });
    }

    // ── Transaction: atomically claim the room, then assign it ────────────────
    const connection = await db.getConnection();
    await connection.beginTransaction();
    try {
      // Atomic claim — the conditional UPDATE only succeeds if the room is still
      // available, closing the race where two requests both pass the check above.
      const [roomClaim] = await connection.query(
        "UPDATE rooms SET availability_status = 'occupied' WHERE room_id = ? AND availability_status = 'available'",
        [room_id]
      );
      if (roomClaim.affectedRows === 0) {
        await connection.rollback();
        connection.release();
        return res.status(409).json({ success: false, message: 'Room was just taken. Please choose another room.' });
      }

      // Guard the admission too, so the same admission can't be assigned twice.
      const [admClaim] = await connection.query(
        "UPDATE admissions SET room_id = ?, status = 'Active' WHERE admission_id = ? AND status = 'Pending Room'",
        [room_id, req.params.id]
      );
      if (admClaim.affectedRows === 0) {
        await connection.rollback();
        connection.release();
        return res.status(409).json({ success: false, message: 'This admission already has a room assigned.' });
      }

      // ── Auto-assign the rooming nurse to this patient ─────────────────────
      // The ward's "My Patients" list is built from active nurse_assignments
      // rows, and those were only ever created by the manual "Assign to Me"
      // endpoint or by accepting an endorsement. A patient who had just been
      // given a bed therefore landed in the ward with nobody attached, showing
      // as Unassigned to the very nurse who roomed them.
      //
      // Same invariants as assignPatient in nursing.controller: nurses only,
      // and only into their OWN ward. Anything that does not qualify — an admin
      // assigning the room, a nurse from another ward, a room with no
      // department — leaves the patient Unassigned rather than failing. Rooming
      // the patient is what the caller asked for; the assignment is a bonus.
      if (req.user.role === 'nurse' && req.user.linked_id && room[0].department_id) {
        // A nurse's linked_id IS their employees.employee_id (see getNurseContext
        // in utils/nursing, which resolves the employee row by linked_id).
        const [[actingNurse]] = await connection.query(
          'SELECT department_id FROM employees WHERE employee_id = ?',
          [req.user.linked_id]
        );

        const sameWard =
          actingNurse?.department_id != null &&
          Number(actingNurse.department_id) === Number(room[0].department_id);

        if (sameWard) {
          // Locked read, mirroring assignPatient: if anyone already holds this
          // patient, skip rather than collide with the unique key on
          // active_patient_id.
          const [[current]] = await connection.query(
            `SELECT assignment_id FROM nurse_assignments
             WHERE patient_id = ? AND released_at IS NULL LIMIT 1 FOR UPDATE`,
            [adm.patient_id]
          );

          if (!current) {
            await connection.query(
              `INSERT INTO nurse_assignments (patient_id, nurse_id, department_id, admission_id, assigned_by)
               VALUES (?, ?, ?, ?, ?)`,
              [adm.patient_id, req.user.linked_id, room[0].department_id, req.params.id, req.user.user_id]
            );
            // target_id is the PATIENT, matching how assignPatient logs it.
            await connection.query(
              "INSERT INTO activity_logs (user_id, action, target_table, target_id) VALUES (?, 'ASSIGN_NURSE', 'nurse_assignments', ?)",
              [req.user.user_id, adm.patient_id]
            );
          }
        }
      }

      await connection.query(
        "INSERT INTO activity_logs (user_id, action, target_table, target_id) VALUES (?, 'UPDATE', 'admissions', ?)",
        [req.user.user_id, req.params.id]
      );
      await connection.commit();
      connection.release();
    } catch (txErr) {
      await connection.rollback();
      connection.release();
      throw txErr;
    }

    // ── Respond immediately — notifications are best-effort ───────────────────
    res.status(200).json({ success: true, message: 'Room assigned.' });

    // ── Post-commit notifications ──────────────────────────────────────────────
    try {
      const patientName = adm.patient_name ?? `Patient #${adm.patient_id}`;
      const message =
        `Room ${room[0].room_type} Bed ${room[0].bed_number} has been assigned to your patient ${patientName}.`;

      const [[doctorUser]] = await db.query(
        "SELECT user_id FROM users WHERE role = 'doctor' AND linked_id = ? AND is_active = 1",
        [adm.doctor_id]
      );
      const [admins] = await db.query(
        "SELECT user_id FROM users WHERE role = 'admin' AND is_active = 1"
      );

      const notifRows = [];

      if (doctorUser) {
        notifRows.push([doctorUser.user_id, message, null]);
      }

      for (const admin of admins) {
        if (admin.user_id !== req.user.user_id) {
          notifRows.push([admin.user_id, message, null]);
        }
      }

      if (notifRows.length > 0) {
        await db.query(
          'INSERT INTO notifications (user_id, message, referral_id) VALUES ?',
          [notifRows]
        );
      }
    } catch (notifErr) {
      console.warn('assignRoom: notification insert failed (non-fatal):', notifErr.message);
    }

  } catch (err) {
    console.error('assignRoom error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// PUT /api/admissions/:id/discharge
// Two-step discharge, step 1 (doctor initiates): Active → Pending Discharge.
// Does NOT set discharge_date and does NOT free the room — the patient is
// still physically in it until a nurse confirms (confirmDischarge).
const dischargePatient = async (req, res) => {
  const { discharge_notes } = req.body;
  try {
    const [admRows] = await db.query(
      `SELECT a.room_id, a.status, a.doctor_id, a.patient_id,
              CONCAT(p.first_name, ' ', p.last_name) AS patient_name,
              r.room_type, r.bed_number
       FROM admissions a
       LEFT JOIN patients p ON a.patient_id = p.patient_id
       LEFT JOIN rooms r ON a.room_id = r.room_id
       WHERE a.admission_id = ?`,
      [req.params.id]
    );
    if (admRows.length === 0) {
      return res.status(404).json({ success: false, message: 'Admission not found.' });
    }
    const adm = admRows[0];
    if (adm.status !== 'Active') {
      return res.status(409).json({ success: false, message: 'Only Active admissions can be sent for discharge.' });
    }

    if (req.user.role === 'doctor' && req.user.linked_id !== adm.doctor_id) {
      return res.status(403).json({ success: false, message: 'You are not the assigned doctor for this admission.' });
    }

    await db.query(
      "UPDATE admissions SET status = 'Pending Discharge', discharge_notes = ? WHERE admission_id = ?",
      [discharge_notes?.trim() || null, req.params.id]
    );

    // THIS ACTION IS the doctor's discharge order, so it satisfies that
    // checklist item directly — a nurse is never asked to assert that a doctor
    // ordered something. INSERT IGNORE covers re-initiation after a cancel.
    await db.query(
      `INSERT IGNORE INTO discharge_clearance_items (admission_id, item, verified_by, notes)
       VALUES (?, 'DoctorOrder', ?, ?)`,
      [req.params.id, req.user.user_id, 'Recorded automatically when the discharge was ordered']
    );

    await db.query(
      "INSERT INTO activity_logs (user_id, action, target_table, target_id) VALUES (?, 'UPDATE', 'admissions', ?)",
      [req.user.user_id, req.params.id]
    );

    // ── Respond immediately — notifications are best-effort ───────────────────
    res.status(200).json({ success: true, message: 'Discharge initiated. Awaiting nurse confirmation.' });

    // Notify the nurse responsible for this patient — NOT every nurse on shift.
    // A discharge order that alerts the whole floor is an alert nobody owns, so
    // it gets dismissed rather than acted on. Targeting falls back to the ward,
    // and only then to everyone (see resolveDischargeNotificationTargets).
    try {
      const { userIds, basis, departmentName } =
        await resolveDischargeNotificationTargets(adm.patient_id, adm.room_id);

      const roomLabel = adm.room_type ? `${adm.room_type} — ${adm.bed_number}` : 'no room assigned';

      // The wording tells the recipient why THEY got it, so a ward-wide or
      // floor-wide fallback is never mistaken for a personal assignment.
      const message = {
        assigned: `Discharge ordered for your patient ${adm.patient_name} — ${roomLabel}. Please complete the clearance checklist and confirm.`,
        ward:     `Discharge ordered for ${adm.patient_name} — ${roomLabel}. No nurse is currently assigned to this patient, so any ${departmentName ?? 'ward'} nurse can review and confirm.`,
        all:      `Discharge ordered for ${adm.patient_name} — ${roomLabel}. No assigned nurse or ward nurse could be identified — please review and confirm.`,
      }[basis];

      if (userIds.length > 0) {
        await db.query(
          'INSERT INTO notifications (user_id, message, referral_id) VALUES ?',
          [userIds.map((id) => [id, message, null])]
        );
      }

      // A fallback means the ward roster has a gap worth fixing — surface it
      // rather than letting the wide alert look like normal routing.
      if (basis !== 'assigned') {
        console.warn(
          `dischargePatient: no assigned nurse for patient ${adm.patient_id}; ` +
          `notified ${userIds.length} recipient(s) via '${basis}' fallback.`
        );
      }
    } catch (notifErr) {
      console.warn('dischargePatient: notification insert failed (non-fatal):', notifErr.message);
    }

  } catch (err) {
    console.error('dischargePatient error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// Two-step discharge, step 2 (nurse confirms): Pending Discharge → Discharged,
// discharge_date stamped, room freed.
//
// Also the point at which the patient's OPD follow-up is booked. The follow-up
// is REQUIRED and is written in the same transaction as the discharge, so a
// discharged patient with no follow-up on record is not a reachable state.
// Body: { followup_date (required), clinic_id (optional override), followup_notes }
const confirmDischarge = async (req, res) => {
  const { followup_date, clinic_id, followup_notes } = req.body ?? {};

  try {
    const [admRows] = await db.query(
      `SELECT a.room_id, a.status, a.doctor_id, a.patient_id, a.admission_type,
              CONCAT(p.first_name, ' ', p.last_name) AS patient_name,
              d.specialization
       FROM admissions a
       LEFT JOIN patients p ON a.patient_id = p.patient_id
       LEFT JOIN doctors  d ON d.doctor_id  = a.doctor_id
       WHERE a.admission_id = ?`,
      [req.params.id]
    );
    if (admRows.length === 0) {
      return res.status(404).json({ success: false, message: 'Admission not found.' });
    }
    const adm = admRows[0];
    if (adm.status !== 'Pending Discharge') {
      return res.status(409).json({ success: false, message: 'Only admissions pending discharge can be confirmed.' });
    }

    // Validate the follow-up BEFORE opening the transaction — a bad date should
    // cost nothing and change nothing.
    const dateError = validateFollowupDate(followup_date);
    if (dateError) {
      return res.status(400).json({ success: false, message: dateError, requires_followup: true });
    }

    // An explicit clinic choice is honoured or rejected — never silently
    // replaced with a different clinic than the one the nurse picked.
    let chosenClinic = null;
    if (clinic_id) {
      chosenClinic = await getActiveClinic(clinic_id);
      if (!chosenClinic) {
        return res.status(400).json({ success: false, message: 'That OPD clinic was not found or is no longer active.' });
      }
    }

    // Populated inside the transaction, reported in the response so the UI can
    // tell the nurse which clinic the patient was routed to.
    let followupSummary = null;

    const connection = await db.getConnection();
    await connection.beginTransaction();
    try {
      // Re-read the admission under a lock and re-check the checklist INSIDE
      // the transaction. Checking before opening it would leave a window where
      // an item is unticked, or a second confirm lands, between the check and
      // the discharge — and this is the guard that must not be bypassable.
      const [[locked]] = await connection.query(
        'SELECT status FROM admissions WHERE admission_id = ? FOR UPDATE',
        [req.params.id]
      );
      if (!locked || locked.status !== 'Pending Discharge') {
        await connection.rollback(); connection.release();
        return res.status(409).json({ success: false, message: 'Only admissions pending discharge can be confirmed.' });
      }

      const blocked = await blockIfNotCleared(req.params.id, connection);
      if (blocked) {
        await connection.rollback(); connection.release();
        return res.status(blocked.status).json({
          success: false,
          message: blocked.message,
          missing: blocked.missing,
        });
      }

      await connection.query(
        "UPDATE admissions SET status = 'Discharged', discharge_date = NOW(), discharge_confirmed_by = ? WHERE admission_id = ?",
        [req.user.user_id, req.params.id]
      );
      await connection.query(
        "UPDATE rooms SET availability_status = 'available' WHERE room_id = ?",
        [adm.room_id]
      );
      // The patient has left the ward, so the nurse holding them is no longer
      // responsible. Released in the same transaction as the discharge, so a
      // discharged patient can never linger on a nurse's active caseload.
      await connection.query(
        `UPDATE nurse_assignments SET released_at = NOW(), release_reason = 'Discharged'
         WHERE patient_id = ? AND released_at IS NULL`,
        [adm.patient_id]
      );
      // ── OPD follow-up routing ───────────────────────────────────────────
      // Booked inside the discharge transaction: if the follow-up cannot be
      // written, the discharge does not happen either. That is the whole point
      // of the requirement — it must not degrade into "discharged, booking
      // failed silently".
      //
      // The clinic is resolved automatically from the attending doctor's
      // specialization, then the admission type, then the default clinic;
      // an explicit choice by the nurse overrides all of it.
      const routed = chosenClinic
        ? { ...chosenClinic, basis: null }
        : await resolveClinicForAdmission(adm, connection);

      // Continue the most recent diagnosis, so the follow-up sits on the same
      // clinical thread rather than floating free of the reason for admission.
      const [[latestDiagnosis]] = await connection.query(
        `SELECT diagnosis_id FROM diagnoses
         WHERE patient_id = ? ORDER BY diagnosis_date DESC LIMIT 1`,
        [adm.patient_id]
      );

      const [followupResult] = await connection.query(
        `INSERT INTO opd_followups
           (patient_id, admission_id, clinic_id, diagnosis_id, doctor_id,
            visit_type, followup_date, status, classified_by, routing_basis, notes, created_by)
         VALUES (?, ?, ?, ?, ?, 'Outpatient', ?, 'Scheduled', ?, ?, ?, ?)`,
        [
          adm.patient_id, req.params.id, routed?.clinic_id ?? null,
          latestDiagnosis?.diagnosis_id ?? null, adm.doctor_id,
          followup_date,
          chosenClinic ? 'Manual' : 'Auto',
          chosenClinic ? null : (routed?.basis ?? null),
          followup_notes?.trim() || null,
          req.user.user_id,
        ]
      );
      followupSummary = {
        followup_id:   followupResult.insertId,
        clinic_id:     routed?.clinic_id ?? null,
        clinic_name:   routed?.name ?? null,
        followup_date,
        classified_by: chosenClinic ? 'Manual' : 'Auto',
        routing_basis: chosenClinic ? null : (routed?.basis ?? null),
      };

      await connection.query(
        "INSERT INTO activity_logs (user_id, action, target_table, target_id) VALUES (?, 'DISCHARGE', 'admissions', ?)",
        [req.user.user_id, req.params.id]
      );
      await connection.query(
        "INSERT INTO activity_logs (user_id, action, target_table, target_id) VALUES (?, 'CREATE_OPD_FOLLOWUP', 'opd_followups', ?)",
        [req.user.user_id, followupResult.insertId]
      );
      await connection.commit();
      connection.release();
    } catch (txErr) {
      await connection.rollback();
      connection.release();
      throw txErr;
    }

    // ── Respond immediately — notifications are best-effort ───────────────────
    res.status(200).json({
      success: true,
      message: followupSummary?.clinic_name
        ? `Discharge confirmed. Room is now available. OPD follow-up booked at ${followupSummary.clinic_name} on ${followupSummary.followup_date}.`
        : 'Discharge confirmed. Room is now available.',
      followup: followupSummary,
    });

    // Notify the admitting doctor that the discharge was confirmed
    try {
      const [[doctorUser]] = await db.query(
        "SELECT user_id FROM users WHERE role = 'doctor' AND linked_id = ? AND is_active = 1",
        [adm.doctor_id]
      );
      if (doctorUser) {
        await db.query(
          'INSERT INTO notifications (user_id, message, referral_id) VALUES (?, ?, ?)',
          [doctorUser.user_id, `Discharge confirmed for your patient ${adm.patient_name}. The room has been freed.`, null]
        );
      }
    } catch (notifErr) {
      console.warn('confirmDischarge: notification insert failed (non-fatal):', notifErr.message);
    }

  } catch (err) {
    console.error('confirmDischarge error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// Escape hatch: a mistaken initiation returns to Active (assigned doctor).
const cancelDischarge = async (req, res) => {
  try {
    const [[adm]] = await db.query(
      'SELECT status, doctor_id FROM admissions WHERE admission_id = ?',
      [req.params.id]
    );
    if (!adm) {
      return res.status(404).json({ success: false, message: 'Admission not found.' });
    }
    if (adm.status !== 'Pending Discharge') {
      return res.status(409).json({ success: false, message: 'Only admissions pending discharge can be cancelled.' });
    }
    if (req.user.role === 'doctor' && req.user.linked_id !== adm.doctor_id) {
      return res.status(403).json({ success: false, message: 'You are not the assigned doctor for this admission.' });
    }

    await db.query(
      "UPDATE admissions SET status = 'Active' WHERE admission_id = ?",
      [req.params.id]
    );

    // The order has been withdrawn, so the item it satisfied must go with it —
    // otherwise a re-initiated discharge would inherit a stale doctor's order.
    // Billing and Administrative ticks are kept: that work really was done.
    await db.query(
      "DELETE FROM discharge_clearance_items WHERE admission_id = ? AND item = 'DoctorOrder'",
      [req.params.id]
    );

    await db.query(
      "INSERT INTO activity_logs (user_id, action, target_table, target_id) VALUES (?, 'UPDATE', 'admissions', ?)",
      [req.user.user_id, req.params.id]
    );
    return res.status(200).json({ success: true, message: 'Discharge cancelled. Admission is Active again.' });
  } catch (err) {
    console.error('cancelDischarge error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// GET /api/admissions/:id/followup-suggestion
// What the OPD routing WOULD choose for this admission, plus the default date.
// Lets the discharge dialog show the nurse where the patient is being sent
// before they commit, instead of finding out from the success message.
const getFollowupSuggestion = async (req, res) => {
  try {
    const [[adm]] = await db.query(
      `SELECT a.admission_id, a.admission_type, a.doctor_id, a.status,
              CONCAT(d.first_name, ' ', d.last_name) AS doctor_name,
              d.specialization
       FROM admissions a
       LEFT JOIN doctors d ON d.doctor_id = a.doctor_id
       WHERE a.admission_id = ?`,
      [req.params.id]
    );
    if (!adm) {
      return res.status(404).json({ success: false, message: 'Admission not found.' });
    }

    const routed = await resolveClinicForAdmission(adm);

    // An already-discharged admission has a real booking; show that instead of
    // a hypothetical one.
    const [[existing]] = await db.query(
      `SELECT f.followup_id, f.followup_date, f.status, f.clinic_id, c.name AS clinic_name
       FROM opd_followups f
       LEFT JOIN opd_clinics c ON c.clinic_id = f.clinic_id
       WHERE f.admission_id = ?`,
      [req.params.id]
    );

    return res.status(200).json({
      success: true,
      data: {
        admission_id:      adm.admission_id,
        admission_type:    adm.admission_type,
        doctor_name:       adm.doctor_name,
        specialization:    adm.specialization,
        suggested_clinic:  routed ? { clinic_id: routed.clinic_id, name: routed.name } : null,
        routing_basis:     routed?.basis ?? null,
        default_date:      defaultFollowupDate(),
        existing_followup: existing ?? null,
      },
    });
  } catch (err) {
    console.error('getFollowupSuggestion error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// ── Pre-discharge clearance checklist ────────────────────────────────────────
// Billing and Administrative are ticked by whoever does that work (nurse or
// nurses). DoctorOrder is written automatically when a doctor initiates the
// discharge and is not offered to nurses — see utils/dischargeClearance.

// GET /api/admissions/:id/clearance — the full checklist, verified or not.
const getDischargeClearance = async (req, res) => {
  try {
    const [[adm]] = await db.query(
      'SELECT admission_id, status FROM admissions WHERE admission_id = ?',
      [req.params.id]
    );
    if (!adm) {
      return res.status(404).json({ success: false, message: 'Admission not found.' });
    }

    const state = await getClearanceState(adm.admission_id);
    return res.status(200).json({ success: true, data: { ...state, status: adm.status } });
  } catch (err) {
    console.error('getDischargeClearance error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// PUT /api/admissions/:id/clearance/:item — mark an item cleared.
const verifyClearanceItem = async (req, res) => {
  const { item } = req.params;
  const { notes } = req.body ?? {};

  if (!isValidItem(item)) {
    return res.status(400).json({
      success: false,
      message: `Unknown clearance item. Expected one of: ${CLEARANCE_ITEMS.join(', ')}.`,
    });
  }
  if (!ITEM_ROLES[item].includes(req.user.role)) {
    return res.status(403).json({
      success: false,
      message: item === 'DoctorOrder'
        ? "The doctor's discharge order is recorded when a doctor initiates the discharge — it cannot be ticked here."
        : `Your role cannot clear ${ITEM_LABELS[item]}.`,
    });
  }
  if (notes && String(notes).length > 255) {
    return res.status(400).json({ success: false, message: 'Notes must be 255 characters or fewer.' });
  }

  try {
    const [[adm]] = await db.query(
      'SELECT admission_id, status FROM admissions WHERE admission_id = ?',
      [req.params.id]
    );
    if (!adm) {
      return res.status(404).json({ success: false, message: 'Admission not found.' });
    }
    // Clearing an already-closed discharge would be recording work on a record
    // nobody can act on.
    if (adm.status === 'Discharged') {
      return res.status(409).json({ success: false, message: 'This patient has already been discharged.' });
    }

    // Idempotent: re-ticking keeps the original verifier and timestamp rather
    // than silently rewriting who signed it off.
    await db.query(
      `INSERT IGNORE INTO discharge_clearance_items (admission_id, item, verified_by, notes)
       VALUES (?, ?, ?, ?)`,
      [adm.admission_id, item, req.user.user_id, notes?.trim() || null]
    );
    await db.query(
      "INSERT INTO activity_logs (user_id, action, target_table, target_id) VALUES (?, 'CLEAR_DISCHARGE_ITEM', 'admissions', ?)",
      [req.user.user_id, adm.admission_id]
    );

    const state = await getClearanceState(adm.admission_id);
    return res.status(200).json({
      success: true,
      message: state.complete
        ? `${ITEM_LABELS[item]} cleared. All clearances complete — this patient can now be discharged.`
        : `${ITEM_LABELS[item]} cleared. ${state.missing.length} item(s) still outstanding.`,
      data: state,
    });
  } catch (err) {
    console.error('verifyClearanceItem error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// DELETE /api/admissions/:id/clearance/:item — undo a tick made in error.
const unverifyClearanceItem = async (req, res) => {
  const { item } = req.params;

  if (!isValidItem(item)) {
    return res.status(400).json({
      success: false,
      message: `Unknown clearance item. Expected one of: ${CLEARANCE_ITEMS.join(', ')}.`,
    });
  }
  if (!ITEM_ROLES[item].includes(req.user.role)) {
    return res.status(403).json({
      success: false,
      message: item === 'DoctorOrder'
        ? "The doctor's discharge order is withdrawn by cancelling the discharge, not from this checklist."
        : `Your role cannot change ${ITEM_LABELS[item]}.`,
    });
  }

  try {
    const [[adm]] = await db.query(
      'SELECT admission_id, status FROM admissions WHERE admission_id = ?',
      [req.params.id]
    );
    if (!adm) {
      return res.status(404).json({ success: false, message: 'Admission not found.' });
    }
    // Once discharged the checklist is the record of why it was allowed.
    if (adm.status === 'Discharged') {
      return res.status(409).json({
        success: false,
        message: 'This patient has already been discharged — their clearance record cannot be changed.',
      });
    }

    await db.query(
      'DELETE FROM discharge_clearance_items WHERE admission_id = ? AND item = ?',
      [adm.admission_id, item]
    );
    await db.query(
      "INSERT INTO activity_logs (user_id, action, target_table, target_id) VALUES (?, 'UNCLEAR_DISCHARGE_ITEM', 'admissions', ?)",
      [req.user.user_id, adm.admission_id]
    );

    const state = await getClearanceState(adm.admission_id);
    return res.status(200).json({
      success: true,
      message: `${ITEM_LABELS[item]} marked outstanding again.`,
      data: state,
    });
  } catch (err) {
    console.error('unverifyClearanceItem error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

module.exports = {
  getAllAdmissions, getAdmissionById, createAdmission, assignRoom,
  dischargePatient, confirmDischarge, cancelDischarge,
  getDischargeClearance, verifyClearanceItem, unverifyClearanceItem,
  getFollowupSuggestion,
};
