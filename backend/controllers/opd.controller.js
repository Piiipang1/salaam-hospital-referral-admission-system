const db = require('../config/db');
const { validateFollowupDate, getActiveClinic } = require('../utils/opdRouting');

// ── Outpatient Department follow-ups ─────────────────────────────────────────
// Follow-ups are CREATED by confirmDischarge (admissions.controller) — never
// here. This module is for reading the OPD book and keeping it current:
// rescheduling, re-routing, and closing a visit out as Completed or Missed.

const VALID_STATUSES = ['Scheduled', 'Completed', 'Missed', 'Cancelled'];

// Shared row shape so the list and the single read always agree.
const FOLLOWUP_SELECT = `
  SELECT f.followup_id, f.patient_id, f.admission_id, f.clinic_id, f.diagnosis_id,
         f.doctor_id, f.visit_type, f.followup_date, f.status,
         f.classified_by, f.routing_basis, f.notes, f.created_at, f.updated_at,
         CONCAT(p.first_name, ' ', p.last_name) AS patient_name,
         p.is_unidentified,
         c.name AS clinic_name,
         c.specialization AS clinic_specialization,
         CONCAT(doc.first_name, ' ', doc.last_name) AS doctor_name,
         doc.specialization AS doctor_specialization,
         dg.medical_condition,
         a.discharge_date
  FROM opd_followups f
  JOIN patients p         ON p.patient_id  = f.patient_id
  LEFT JOIN opd_clinics c ON c.clinic_id   = f.clinic_id
  LEFT JOIN doctors doc   ON doc.doctor_id = f.doctor_id
  LEFT JOIN diagnoses dg  ON dg.diagnosis_id = f.diagnosis_id
  LEFT JOIN admissions a  ON a.admission_id = f.admission_id
`;

// GET /api/opd/clinics — the routing targets. Open to any clinical role; the
// discharge dialog needs it to offer an override.
const getClinics = async (req, res) => {
  const includeInactive =
    req.user.role === 'admin' && ['true', '1'].includes(String(req.query.include_inactive));

  try {
    const [rows] = await db.query(
      `SELECT c.clinic_id, c.name, c.specialization, c.description, c.is_default, c.is_active,
              (SELECT COUNT(*) FROM opd_followups f
                WHERE f.clinic_id = c.clinic_id AND f.status = 'Scheduled') AS scheduled_count
       FROM opd_clinics c
       ${includeInactive ? '' : 'WHERE c.is_active = 1'}
       ORDER BY c.is_default DESC, c.name`
    );
    return res.status(200).json({ success: true, data: rows });
  } catch (err) {
    console.error('getClinics error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// GET /api/opd/followups?patient_id=&clinic_id=&status=&from_date=&to_date=
// The OPD book. Doctors see their own patients' follow-ups; nurses
// see the ones they booked — mirroring how each role's other clinical lists are
// scoped, so this never becomes a back door to the full patient list.
const getFollowups = async (req, res) => {
  const { patient_id, clinic_id, status, from_date, to_date, page = 1, limit = 20 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  try {
    const conditions = [];
    const params     = [];

    if (patient_id) { conditions.push('f.patient_id = ?'); params.push(patient_id); }
    if (clinic_id)  { conditions.push('f.clinic_id = ?');  params.push(clinic_id); }
    if (status && VALID_STATUSES.includes(status)) { conditions.push('f.status = ?'); params.push(status); }
    if (from_date)  { conditions.push('f.followup_date >= ?'); params.push(from_date); }
    if (to_date)    { conditions.push('f.followup_date <= ?'); params.push(to_date); }

    if (req.user.role === 'doctor') {
      conditions.push('f.doctor_id = ?');
      params.push(req.user.linked_id);
    } else if (req.user.role === 'nurse') {
      conditions.push('f.created_by = ?');
      params.push(req.user.user_id);
    }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

    const [rows] = await db.query(
      `${FOLLOWUP_SELECT} ${where}
       ORDER BY f.followup_date ASC, f.followup_id ASC
       LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), offset]
    );
    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total FROM opd_followups f ${where}`,
      params
    );

    return res.status(200).json({
      success: true, data: rows, total, page: parseInt(page), limit: parseInt(limit),
    });
  } catch (err) {
    console.error('getFollowups error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// GET /api/opd/followups/:id
const getFollowupById = async (req, res) => {
  try {
    const [[row]] = await db.query(`${FOLLOWUP_SELECT} WHERE f.followup_id = ?`, [req.params.id]);
    if (!row) {
      return res.status(404).json({ success: false, message: 'Follow-up not found.' });
    }
    return res.status(200).json({ success: true, data: row });
  } catch (err) {
    console.error('getFollowupById error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// PUT /api/opd/followups/:id — reschedule, re-route, or amend the notes.
// Re-routing by hand flips classified_by to 'Manual' and drops routing_basis:
// the automatic reasoning no longer describes this record, and leaving it in
// place would misreport how well the routing performs.
const updateFollowup = async (req, res) => {
  const { followup_date, clinic_id, notes } = req.body ?? {};

  try {
    const [[existing]] = await db.query(
      'SELECT followup_id, status FROM opd_followups WHERE followup_id = ?',
      [req.params.id]
    );
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Follow-up not found.' });
    }
    if (['Completed', 'Cancelled'].includes(existing.status)) {
      return res.status(409).json({
        success: false,
        message: `A ${existing.status.toLowerCase()} follow-up cannot be edited.`,
      });
    }

    const sets   = [];
    const params = [];

    if (followup_date !== undefined) {
      const dateError = validateFollowupDate(followup_date);
      if (dateError) return res.status(400).json({ success: false, message: dateError });
      sets.push('followup_date = ?'); params.push(followup_date);
    }

    if (clinic_id !== undefined) {
      const clinic = await getActiveClinic(clinic_id);
      if (!clinic) {
        return res.status(400).json({ success: false, message: 'That OPD clinic was not found or is no longer active.' });
      }
      sets.push('clinic_id = ?', "classified_by = 'Manual'", 'routing_basis = NULL');
      params.push(clinic.clinic_id);
    }

    if (notes !== undefined) { sets.push('notes = ?'); params.push(notes?.trim() || null); }

    if (sets.length === 0) {
      return res.status(400).json({ success: false, message: 'No fields to update.' });
    }

    params.push(req.params.id);
    await db.query(`UPDATE opd_followups SET ${sets.join(', ')} WHERE followup_id = ?`, params);
    await db.query(
      "INSERT INTO activity_logs (user_id, action, target_table, target_id) VALUES (?, 'UPDATE_OPD_FOLLOWUP', 'opd_followups', ?)",
      [req.user.user_id, req.params.id]
    );

    const [[row]] = await db.query(`${FOLLOWUP_SELECT} WHERE f.followup_id = ?`, [req.params.id]);
    return res.status(200).json({ success: true, message: 'Follow-up updated.', data: row });
  } catch (err) {
    console.error('updateFollowup error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// PUT /api/opd/followups/:id/status — close the visit out.
// Only a Scheduled follow-up can move: Completed and Cancelled are terminal, and
// a Missed one is reopened by rescheduling it rather than by flipping a status.
const updateFollowupStatus = async (req, res) => {
  const { status } = req.body ?? {};

  if (!status || !VALID_STATUSES.includes(status)) {
    return res.status(400).json({
      success: false,
      message: `status must be one of: ${VALID_STATUSES.join(', ')}.`,
    });
  }

  try {
    const [[existing]] = await db.query(
      'SELECT followup_id, status FROM opd_followups WHERE followup_id = ?',
      [req.params.id]
    );
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Follow-up not found.' });
    }
    if (existing.status === status) {
      return res.status(409).json({ success: false, message: `This follow-up is already ${status}.` });
    }
    if (existing.status !== 'Scheduled') {
      return res.status(409).json({
        success: false,
        message: `A ${existing.status.toLowerCase()} follow-up cannot change status. Reschedule it instead.`,
      });
    }

    await db.query('UPDATE opd_followups SET status = ? WHERE followup_id = ?', [status, req.params.id]);
    await db.query(
      "INSERT INTO activity_logs (user_id, action, target_table, target_id) VALUES (?, 'UPDATE_OPD_STATUS', 'opd_followups', ?)",
      [req.user.user_id, req.params.id]
    );

    return res.status(200).json({ success: true, message: `Follow-up marked ${status}.` });
  } catch (err) {
    console.error('updateFollowupStatus error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

module.exports = { getClinics, getFollowups, getFollowupById, updateFollowup, updateFollowupStatus };
