const db = require('../config/db');

// GET /api/admissions
const getAllAdmissions = async (req, res) => {
  const { status, page = 1, limit = 20 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  try {
    const params = [];
    let where = '';

    if (status) {
      where = 'WHERE a.status = ?';
      params.push(status);
    }

    const [rows] = await db.query(
      `SELECT a.*,
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
      `SELECT a.*,
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
    return res.status(200).json({ success: true, data: rows[0] });
  } catch (err) {
    console.error('getAdmissionById error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// POST /api/admissions
const createAdmission = async (req, res) => {
  const { patient_id, diagnosis_id, doctor_id, room_id, admission_type, admission_date } = req.body;

  if (!patient_id || !doctor_id || !room_id || !admission_type) {
    return res.status(400).json({
      success: false,
      message: 'patient_id, doctor_id, room_id, and admission_type are required.',
    });
  }

  try {
    // Check room availability
    const [room] = await db.query(
      'SELECT availability_status FROM rooms WHERE room_id = ?',
      [room_id]
    );
    if (room.length === 0) {
      return res.status(404).json({ success: false, message: 'Room not found.' });
    }
    if (room[0].availability_status === 'occupied') {
      return res.status(409).json({ success: false, message: 'Room is currently occupied. Please select another room.' });
    }

    // ── Transaction: insert admission + mark room occupied + log ──────────────
    const connection = await db.getConnection();
    await connection.beginTransaction();

    let admissionId;
    try {
      const [result] = await connection.query(
        `INSERT INTO admissions (patient_id, diagnosis_id, doctor_id, room_id, admission_type, admission_date, status)
         VALUES (?, ?, ?, ?, ?, ?, 'Active')`,
        [patient_id, diagnosis_id || null, doctor_id, room_id,
         admission_type, admission_date || new Date()]
      );
      admissionId = result.insertId;

      await connection.query(
        "UPDATE rooms SET availability_status = 'occupied' WHERE room_id = ?",
        [room_id]
      );

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
    res.status(201).json({ success: true, message: 'Patient admitted.', admission_id: admissionId });

    // ── Post-commit notifications (outside transaction, non-blocking) ─────────
    // Any failure here is logged but does NOT affect the completed admission.
    try {
      // 1. Resolve patient name, room details, and the doctor's user account id
      //    in a single query so we have everything needed for the message text.
      const [[detail]] = await db.query(
        `SELECT CONCAT(p.first_name, ' ', p.last_name) AS patient_name,
                r.room_type,
                r.bed_number,
                u.user_id AS doctor_user_id
         FROM   patients  p
         JOIN   rooms     r ON r.room_id    = ?
         LEFT JOIN users  u ON u.linked_id  = ? AND u.role = 'doctor' AND u.is_active = 1
         WHERE  p.patient_id = ?`,
        [room_id, doctor_id, patient_id]
      );

      // 2. Fetch all active admin user ids
      const [admins] = await db.query(
        "SELECT user_id FROM users WHERE role = 'admin' AND is_active = 1"
      );

      // 3. Build notification rows
      const notifRows = [];

      if (detail?.doctor_user_id) {
        notifRows.push([
          detail.doctor_user_id,
          `Your patient ${detail.patient_name} has been admitted ` +
          `(${req.body.admission_type}) and assigned to ` +
          `${detail.room_type} — Bed ${detail.bed_number}. ` +
          `Admission ID: ${admissionId}.`,
          null, // referral_id — not applicable here
        ]);
      }

      const adminMsg =
        `New admission: ${detail?.patient_name ?? `Patient #${patient_id}`} ` +
        `admitted to ${detail?.room_type ?? 'Room'} — Bed ${detail?.bed_number ?? room_id}. ` +
        `Admission ID: ${admissionId}.`;

      for (const admin of admins) {
        // Avoid duplicate if the acting user is also an admin (they already know)
        if (admin.user_id !== req.user.user_id) {
          notifRows.push([admin.user_id, adminMsg, null]);
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


// PUT /api/admissions/:id/discharge
const dischargePatient = async (req, res) => {
  try {
    // Fetch admission + patient + doctor in one shot — needed for notification text
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
    if (adm.status === 'Discharged') {
      return res.status(409).json({ success: false, message: 'Patient is already discharged.' });
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
    res.status(200).json({ success: true, message: 'Patient discharged. Room is now available.' });

    // ── Post-commit discharge notifications ───────────────────────────────────
    try {
      const dischargeDate = new Date().toLocaleDateString('en-US', {
        year: 'numeric', month: 'short', day: 'numeric',
      });

      // Resolve assigned doctor's user account
      const [[doctorUser]] = await db.query(
        "SELECT user_id FROM users WHERE role = 'doctor' AND linked_id = ? AND is_active = 1",
        [adm.doctor_id]
      );
      const [admins] = await db.query(
        "SELECT user_id FROM users WHERE role = 'admin' AND is_active = 1"
      );

      const notifRows = [];

      if (doctorUser) {
        notifRows.push([
          doctorUser.user_id,
          `🏥 Your patient ${adm.patient_name} has been discharged on ${dischargeDate}. Admission ID: ${req.params.id}.`,
          null,
        ]);
      }

      const adminMsg =
        `🏥 Patient ${adm.patient_name} has been discharged. Admission ID: ${req.params.id}.`;

      for (const admin of admins) {
        if (admin.user_id !== req.user.user_id) {
          notifRows.push([admin.user_id, adminMsg, null]);
        }
      }

      if (notifRows.length > 0) {
        await db.query(
          'INSERT INTO notifications (user_id, message, referral_id) VALUES ?',
          [notifRows]
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

module.exports = { getAllAdmissions, getAdmissionById, createAdmission, dischargePatient };
