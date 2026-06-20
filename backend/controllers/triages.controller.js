const db = require('../config/db');

// POST /api/triages
const createTriage = async (req, res) => {
  const { patient_id, employee_id, visit_room_id, triage_level, notes } = req.body;

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

    return res.status(201).json({ success: true, message: 'Triage created.', triage_id: result.insertId });
  } catch (err) {
    console.error('createTriage error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// GET /api/triages
const getAllTriages = async (req, res) => {
  const { level, date, page = 1, limit = 20 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  try {
    let conditions = [];
    const params = [];

    if (level) { conditions.push('t.triage_level = ?'); params.push(level); }
    if (date)  { conditions.push('DATE(t.triage_datetime) = ?'); params.push(date); }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

    const [rows] = await db.query(
      `SELECT t.*, CONCAT(p.first_name, ' ', p.last_name) AS patient_name,
              vs.blood_pressure, vs.heart_rate, vs.temperature, vs.respiratory_rate
       FROM triages t
       LEFT JOIN patients p ON t.patient_id = p.patient_id
       LEFT JOIN vital_signs vs ON t.triage_id = vs.triage_id
       ${where}
       ORDER BY t.triage_datetime DESC LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), offset]
    );

    return res.status(200).json({ success: true, data: rows });
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

    return res.status(201).json({ success: true, message: 'Vital signs recorded.', vs_id: result.insertId });
  } catch (err) {
    console.error('addVitalSigns error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

module.exports = { createTriage, getAllTriages, getTriageById, updateTriage, addVitalSigns };
