const db = require('../config/db');

// POST /api/triages
const createTriage = async (req, res) => {
  const { patient_id, visit_room_id, triage_level, notes, assigned_doctor_id } = req.body;

  // A nurse/staff is always recorded as their own employee_id (cannot spoof another
  // employee); an admin may record a triage on behalf of an employee via the body.
  const employee_id = (req.user.role === 'nurse' || req.user.role === 'staff')
    ? req.user.linked_id
    : req.body.employee_id;

  if (!patient_id || !triage_level) {
    return res.status(400).json({ success: false, message: 'patient_id and triage_level are required.' });
  }
  if (!assigned_doctor_id) {
    return res.status(400).json({ success: false, message: 'An attending doctor must be assigned at triage.' });
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

    // Optional: assign a doctor to this patient at triage time.
    // Guard with SELECT to avoid duplicate rows (no unique constraint on doctor_in_charge).
    if (assigned_doctor_id) {
      const [[existing]] = await db.query(
        'SELECT dic_id FROM doctor_in_charge WHERE doctor_id = ? AND patient_id = ? LIMIT 1',
        [assigned_doctor_id, patient_id]
      );
      if (!existing) {
        await db.query(
          'INSERT INTO doctor_in_charge (doctor_id, patient_id, assigned_at) VALUES (?, ?, NOW())',
          [assigned_doctor_id, patient_id]
        );
      }
    }

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

      // 3. Notify the doctor assigned at triage (if any)
      if (assigned_doctor_id) {
        const [[docUser]] = await db.query(
          "SELECT user_id FROM users WHERE linked_id = ? AND role = 'doctor' AND is_active = 1 LIMIT 1",
          [assigned_doctor_id]
        );
        if (docUser && docUser.user_id !== req.user.user_id) {
          notifRows.push([
            docUser.user_id,
            `You have been assigned a new patient at triage: ${patientName} (${triage_level}).`,
            null,
          ]);
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
              vs.blood_pressure, vs.heart_rate, vs.temperature, vs.respiratory_rate, vs.recorded_at
       FROM triages t
       LEFT JOIN patients p ON t.patient_id = p.patient_id
       LEFT JOIN vital_signs vs ON t.triage_id = vs.triage_id
       WHERE t.triage_id = ?`,
      [req.params.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Triage not found.' });
    }
    return res.status(200).json({ success: true, data: rows[0] });
  } catch (err) {
    console.error('getTriageById error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// PUT /api/triages/:id
const updateTriage = async (req, res) => {
  const { triage_level, notes, visit_room_id } = req.body;
  try {
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
    // Remove existing vital signs for this triage if re-recorded
    await db.query('DELETE FROM vital_signs WHERE triage_id = ?', [req.params.id]);

    const [result] = await db.query(
      `INSERT INTO vital_signs (triage_id, blood_pressure, heart_rate, temperature, respiratory_rate, recorded_at)
       VALUES (?, ?, ?, ?, ?, NOW())`,
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
const createEmergencyTriage = async (req, res) => {
  const triage_level       = req.body.triage_level || 'Critical';
  const notes              = req.body.notes || null;
  const assigned_doctor_id = req.body.assigned_doctor_id || null;

  if (!assigned_doctor_id) {
    return res.status(400).json({ success: false, message: 'An attending doctor must be assigned at triage.' });
  }

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

    // Optional doctor assignment — inside the transaction so it rolls back with the rest
    if (assigned_doctor_id) {
      const [[existing]] = await connection.query(
        'SELECT dic_id FROM doctor_in_charge WHERE doctor_id = ? AND patient_id = ? LIMIT 1',
        [assigned_doctor_id, newPatientId]
      );
      if (!existing) {
        await connection.query(
          'INSERT INTO doctor_in_charge (doctor_id, patient_id, assigned_at) VALUES (?, ?, NOW())',
          [assigned_doctor_id, newPatientId]
        );
      }
    }

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

    // Resolve the assigned doctor's user_id so we can personalise their notification
    let assignedDoctorUserId = null;
    if (assigned_doctor_id) {
      const [[docUser]] = await db.query(
        "SELECT user_id FROM users WHERE linked_id = ? AND role = 'doctor' AND is_active = 1 LIMIT 1",
        [assigned_doctor_id]
      );
      assignedDoctorUserId = docUser?.user_id ?? null;
    }

    const [admins] = await db.query(
      "SELECT user_id FROM users WHERE role = 'admin' AND is_active = 1"
    );
    for (const a of admins) {
      if (a.user_id !== req.user.user_id) notifRows.push([a.user_id, notifMsg, null]);
    }

    // Doctors: assigned doctor gets a personal assignment message; all others get the broadcast
    const [doctors] = await db.query(
      "SELECT user_id FROM users WHERE role = 'doctor' AND is_active = 1"
    );
    for (const d of doctors) {
      if (d.user_id === req.user.user_id) continue;
      if (d.user_id === assignedDoctorUserId) {
        notifRows.push([
          d.user_id,
          `You have been assigned a new patient at triage: Patient #${newPatientId} (${triage_level}).`,
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

module.exports = { createTriage, getAllTriages, getTriageById, updateTriage, addVitalSigns, createEmergencyTriage };
