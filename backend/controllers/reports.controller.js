const db = require('../config/db');

// GET /api/reports/admissions
// Optional query params: ?from=YYYY-MM-DD&to=YYYY-MM-DD
const admissionsReport = async (req, res) => {
  const { from, to } = req.query;

  try {
    const conditions = [];
    const params = [];

    if (from) { conditions.push('a.admission_date >= ?'); params.push(from); }
    if (to)   { conditions.push('a.admission_date <= ?'); params.push(to); }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

    const [rows] = await db.query(
      `SELECT a.admission_id,
              CONCAT(p.first_name, ' ', p.last_name) AS patient_name,
              CONCAT(d.first_name, ' ', d.last_name) AS doctor_name,
              r.room_type, r.bed_number,
              a.admission_type, a.admission_date, a.discharge_date, a.status
       FROM admissions a
       LEFT JOIN patients p ON a.patient_id = p.patient_id
       LEFT JOIN doctors  d ON a.doctor_id  = d.doctor_id
       LEFT JOIN rooms    r ON a.room_id    = r.room_id
       ${where}
       ORDER BY a.admission_date DESC`,
      params
    );

    return res.status(200).json({ success: true, data: rows, total: rows.length });
  } catch (err) {
    console.error('admissionsReport error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// GET /api/reports/referrals
// Optional query params: ?status=Pending|Accepted|Completed|Cancelled&from=YYYY-MM-DD&to=YYYY-MM-DD
const referralsReport = async (req, res) => {
  const { status, from, to } = req.query;

  const validStatuses = ['Pending', 'Accepted', 'Completed', 'Cancelled'];

  if (status && !validStatuses.includes(status)) {
    return res.status(400).json({
      success: false,
      message: `status must be one of: ${validStatuses.join(', ')}.`,
    });
  }

  try {
    const conditions = [];
    const params = [];

    if (status) { conditions.push('r.status = ?');             params.push(status); }
    if (from)   { conditions.push('r.referral_date >= ?');     params.push(from); }
    if (to)     { conditions.push('r.referral_date <= ?');     params.push(to); }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

    const [rows] = await db.query(
      `SELECT r.referral_id, r.referral_date, r.status,
              CONCAT(p.first_name,  ' ', p.last_name)  AS patient_name,
              diag.medical_condition,
              CONCAT(ad.first_name, ' ', ad.last_name) AS assigned_doctor_name,
              ad.specialization
       FROM referrals r
       LEFT JOIN diagnoses diag ON r.diagnosis_id       = diag.diagnosis_id
       LEFT JOIN patients  p    ON diag.patient_id      = p.patient_id
       LEFT JOIN doctors   ad   ON r.assigned_doctor_id = ad.doctor_id
       ${where}
       ORDER BY r.referral_date DESC`,
      params
    );

    return res.status(200).json({ success: true, data: rows, total: rows.length });
  } catch (err) {
    console.error('referralsReport error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// GET /api/reports/turnaround
// Optional query params: ?from=YYYY-MM-DD&to=YYYY-MM-DD
// Only includes patients who completed the full triage → diagnosis → admission pipeline
const turnaroundReport = async (req, res) => {
  const { from, to } = req.query;

  try {
    const conditions = [];
    const params = [];

    if (from) { conditions.push('DATE(t.triage_datetime) >= ?'); params.push(from); }
    if (to)   { conditions.push('DATE(t.triage_datetime) <= ?'); params.push(to); }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

    const [rows] = await db.query(
      `SELECT CONCAT(p.first_name, ' ', p.last_name) AS patient_name,
              t.triage_datetime,
              t.triage_level,
              a.admission_date,
              TIMESTAMPDIFF(MINUTE, t.triage_datetime, a.admission_date) AS turnaround_minutes
       FROM triages t
       INNER JOIN patients   p    ON t.patient_id    = p.patient_id
       INNER JOIN diagnoses  diag ON diag.triage_id  = t.triage_id
       INNER JOIN admissions a    ON a.diagnosis_id  = diag.diagnosis_id
       ${where}
       ORDER BY t.triage_datetime DESC`,
      params
    );

    // Compute average from the result set (only over valid positive values)
    const validRows = rows.filter(r => r.turnaround_minutes !== null && r.turnaround_minutes >= 0);
    const average_turnaround_minutes = validRows.length > 0
      ? Math.round(validRows.reduce((sum, r) => sum + r.turnaround_minutes, 0) / validRows.length)
      : null;

    return res.status(200).json({
      success: true,
      data: rows,
      total: rows.length,
      average_turnaround_minutes,
    });
  } catch (err) {
    console.error('turnaroundReport error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

module.exports = { admissionsReport, referralsReport, turnaroundReport };
