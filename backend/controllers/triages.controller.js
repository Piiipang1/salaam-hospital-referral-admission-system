const db = require('../config/db');

// POST /api/triages
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

      // Triage level emoji prefix for visual scanning
      const levelEmoji = triage_level === 'Critical'   ? '🚨'
                       : triage_level === 'Urgent'     ? '⚠️'
                       :                                  '🟢';

      const baseMsg = `${levelEmoji} New ${triage_level} triage recorded for ${patientName}. Triage ID: ${result.insertId}.`;

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
              `${levelEmoji} Your patient ${patientName} has a new ${triage_level} triage. Triage ID: ${result.insertId}.`,
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

module.exports = { createTriage, getAllTriages, getTriageById, updateTriage, addVitalSigns };
