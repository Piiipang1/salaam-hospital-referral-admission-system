const db = require('../config/db');
const { isDoctorInCharge } = require('../utils/dic');

// GET /api/admissions
const getAllAdmissions = async (req, res) => {
  const { status, from_date, to_date, page = 1, limit = 20 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  try {
    const conditions = [];
    const params = [];

    if (status) {
      conditions.push('a.status = ?');
      params.push(status);
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

    const [rows] = await db.query(
      `SELECT a.*, a.discharge_notes,
              CONCAT(p.first_name, ' ', p.last_name) AS patient_name,
              CONCAT(d.first_name, ' ', d.last_name) AS doctor_name,
              r.room_type, r.bed_number
       FROM admissions a
       LEFT JOIN patients p ON a.patient_id = p.patient_id
       LEFT JOIN doctors d ON a.doctor_id = d.doctor_id
       LEFT JOIN rooms r ON a.room_id = r.room_id
       ${where}
       ORDER BY a.admission_date DESC LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), offset]
    );

    return res.status(200).json({ success: true, data: rows });
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
              r.room_type, r.bed_number
       FROM admissions a
       LEFT JOIN patients p ON a.patient_id = p.patient_id
       LEFT JOIN doctors d ON a.doctor_id = d.doctor_id
       LEFT JOIN rooms r ON a.room_id = r.room_id
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
  // ── Role guard: only doctors and admins may admit patients (issue #8) ────────
  if (!['doctor', 'admin'].includes(req.user.role)) {
    return res.status(403).json({
      success: false,
      message: 'Only doctors may admit patients.',
    });
  }

  const { patient_id, diagnosis_id, doctor_id, admission_type, admission_date } = req.body;

  // A doctor always admits as themselves (cannot spoof another doctor); an
  // admin may admit on behalf of a doctor via doctor_id in the body.
  const admittingDoctorId = req.user.role === 'doctor' ? req.user.linked_id : doctor_id;

  if (!patient_id || !admission_type || (req.user.role !== 'doctor' && !admittingDoctorId)) {
    return res.status(400).json({
      success: false,
      message: 'patient_id, doctor_id, and admission_type are required.',
    });
  }

  try {
    // ── Guard: only ER-assigned doctors may admit (fresh DB read — admins
    // toggle the flag at runtime; admins themselves are unaffected) ───────────
    if (req.user.role === 'doctor') {
      const [[doc]] = await db.query(
        'SELECT is_er_assigned FROM doctors WHERE doctor_id = ?',
        [req.user.linked_id]
      );
      if (!doc?.is_er_assigned) {
        return res.status(403).json({ success: false, message: 'Only ER-assigned doctors can admit patients.' });
      }
    }

    // ── Guard: reject if the patient already has an ongoing admission ──────────
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

    // ── Transaction: insert admission (no room yet) + log ─────────────────────
    // Room assignment happens later via the dedicated assign-room endpoint.
    const connection = await db.getConnection();
    await connection.beginTransaction();

    let admissionId;
    try {
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
      throw txErr;
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

      // 3c. Notify all active nurses/staff that a room needs to be assigned
      const [staffUsers] = await db.query(
        "SELECT user_id FROM users WHERE role IN ('nurse','staff') AND is_active = 1"
      );
      const staffMsg = `${patientName} has been admitted and is awaiting room assignment.`;
      for (const su of staffUsers) {
        if (su.user_id !== req.user.user_id) {
          notifRows.push([su.user_id, staffMsg, null]);
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
      'SELECT room_type, bed_number, availability_status FROM rooms WHERE room_id = ?',
      [room_id]
    );
    if (room.length === 0) {
      return res.status(404).json({ success: false, message: 'Room not found.' });
    }
    if (room[0].availability_status === 'occupied') {
      return res.status(409).json({ success: false, message: 'Room is currently occupied.' });
    }

    // ── Transaction: assign room + mark occupied + log ────────────────────────
    const connection = await db.getConnection();
    await connection.beginTransaction();
    try {
      await connection.query(
        "UPDATE admissions SET room_id = ?, status = 'Active' WHERE admission_id = ?",
        [room_id, req.params.id]
      );
      await connection.query(
        "UPDATE rooms SET availability_status = 'occupied' WHERE room_id = ?",
        [room_id]
      );
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
    await db.query(
      "INSERT INTO activity_logs (user_id, action, target_table, target_id) VALUES (?, 'UPDATE', 'admissions', ?)",
      [req.user.user_id, req.params.id]
    );

    // ── Respond immediately — notifications are best-effort ───────────────────
    res.status(200).json({ success: true, message: 'Discharge initiated. Awaiting nurse confirmation.' });

    // Notify all active nurses to review and confirm
    try {
      const [nurses] = await db.query(
        "SELECT user_id FROM users WHERE role = 'nurse' AND is_active = 1"
      );
      const roomLabel = adm.room_type ? `${adm.room_type} — ${adm.bed_number}` : 'no room assigned';
      const notifRows = nurses.map((n) => [
        n.user_id,
        `Discharge requested for ${adm.patient_name} — ${roomLabel}. Please review and confirm.`,
        null,
      ]);
      if (notifRows.length > 0) {
        await db.query('INSERT INTO notifications (user_id, message, referral_id) VALUES ?', [notifRows]);
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
const confirmDischarge = async (req, res) => {
  try {
    const [admRows] = await db.query(
      `SELECT a.room_id, a.status, a.doctor_id, a.patient_id,
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
    if (adm.status !== 'Pending Discharge') {
      return res.status(409).json({ success: false, message: 'Only admissions pending discharge can be confirmed.' });
    }

    const connection = await db.getConnection();
    await connection.beginTransaction();
    try {
      await connection.query(
        "UPDATE admissions SET status = 'Discharged', discharge_date = NOW() WHERE admission_id = ?",
        [req.params.id]
      );
      await connection.query(
        "UPDATE rooms SET availability_status = 'available' WHERE room_id = ?",
        [adm.room_id]
      );
      await connection.query(
        "INSERT INTO activity_logs (user_id, action, target_table, target_id) VALUES (?, 'DISCHARGE', 'admissions', ?)",
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
    res.status(200).json({ success: true, message: 'Discharge confirmed. Room is now available.' });

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

// Escape hatch: a mistaken initiation returns to Active (doctor or admin).
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

module.exports = { getAllAdmissions, getAdmissionById, createAdmission, assignRoom, dischargePatient, confirmDischarge, cancelDischarge };
