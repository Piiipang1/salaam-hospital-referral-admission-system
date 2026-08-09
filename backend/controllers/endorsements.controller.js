const db = require('../config/db');
const { requireNurseDepartment, OCCUPYING_STATUSES } = require('../utils/nursing');

// ── Shift endorsements ───────────────────────────────────────────────────────
// The nursing handoff. The outgoing nurse names the incoming nurse, attaches
// the patients being handed over with a note each, and submits. The endorsement
// is Pending until the incoming nurse acknowledges it — and acknowledging is
// what actually MOVES the patient assignments. An unacknowledged handoff leaves
// responsibility exactly where it was, which is the whole point: a shift is not
// handed over because someone typed it, but because someone accepted it.
//
// Mirrors the doctor_in_charge propose/accept pattern already in the system.

const VALID_SHIFTS = ['Morning', 'Afternoon', 'Night'];

// POST /api/endorsements
// { to_nurse_id, shift, shift_date?, general_notes?, patients: [{patient_id, notes}] }
const createEndorsement = async (req, res) => {
  const { to_nurse_id, shift, shift_date, general_notes, patients } = req.body;

  if (!to_nurse_id) {
    return res.status(400).json({ success: false, message: 'Select the nurse taking over.' });
  }
  if (!shift || !VALID_SHIFTS.includes(shift)) {
    return res.status(400).json({ success: false, message: `shift must be one of: ${VALID_SHIFTS.join(', ')}.` });
  }
  if (patients !== undefined && !Array.isArray(patients)) {
    return res.status(400).json({ success: false, message: 'patients must be an array.' });
  }

  try {
    const nurse = await requireNurseDepartment(req, res);
    if (!nurse) return;

    if (Number(to_nurse_id) === Number(nurse.employee_id)) {
      return res.status(400).json({ success: false, message: 'You cannot endorse a shift to yourself.' });
    }

    // The receiving nurse must be an active nurse in the same ward with a live
    // login — endorsing to an account that cannot sign in would strand the
    // handoff as permanently Pending.
    const [[recipient]] = await db.query(
      `SELECT e.employee_id, CONCAT(e.first_name, ' ', e.last_name) AS name
       FROM employees e
       JOIN users u ON u.linked_id = e.employee_id AND u.role = 'nurse' AND u.is_active = 1
       WHERE e.employee_id = ? AND e.department_id = ? AND e.employment_status = 'Active'`,
      [to_nurse_id, nurse.department_id]
    );
    if (!recipient) {
      return res.status(400).json({
        success: false,
        message: 'That nurse is not an active member of your department with a login.',
      });
    }

    // Every endorsed patient must currently be assigned to ME. You can only
    // hand over what you are actually holding.
    const patientList = Array.isArray(patients) ? patients : [];
    const patientIds = patientList
      .map((p) => Number(p?.patient_id))
      .filter((id) => Number.isInteger(id) && id > 0);

    if (patientIds.length !== patientList.length) {
      return res.status(400).json({ success: false, message: 'Every endorsed patient needs a valid patient_id.' });
    }
    if (new Set(patientIds).size !== patientIds.length) {
      return res.status(400).json({ success: false, message: 'The same patient was listed twice.' });
    }

    if (patientIds.length > 0) {
      const [held] = await db.query(
        `SELECT patient_id FROM nurse_assignments
         WHERE nurse_id = ? AND released_at IS NULL AND patient_id IN (?)`,
        [nurse.employee_id, patientIds]
      );
      const heldIds = new Set(held.map((r) => Number(r.patient_id)));
      const notMine = patientIds.filter((id) => !heldIds.has(id));
      if (notMine.length > 0) {
        return res.status(409).json({
          success: false,
          message: `You are not currently responsible for ${notMine.length} of the selected patients. Refresh and try again.`,
        });
      }
    }

    const shiftDate = shift_date || new Date().toISOString().slice(0, 10);

    const connection = await db.getConnection();
    await connection.beginTransaction();
    let endorsementId;
    try {
      const [result] = await connection.query(
        `INSERT INTO endorsements
           (from_nurse_id, to_nurse_id, department_id, shift, shift_date, general_notes, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [nurse.employee_id, recipient.employee_id, nurse.department_id, shift, shiftDate,
         general_notes?.trim() || null, req.user.user_id]
      );
      endorsementId = result.insertId;

      if (patientList.length > 0) {
        const rows = patientList.map((p) => [endorsementId, Number(p.patient_id), p.notes?.trim() || null]);
        await connection.query(
          'INSERT INTO endorsement_patients (endorsement_id, patient_id, notes) VALUES ?',
          [rows]
        );
      }

      await connection.query(
        "INSERT INTO activity_logs (user_id, action, target_table, target_id) VALUES (?, 'CREATE_ENDORSEMENT', 'endorsements', ?)",
        [req.user.user_id, endorsementId]
      );

      await connection.commit();
      connection.release();
    } catch (txErr) {
      await connection.rollback();
      connection.release();
      throw txErr;
    }

    res.status(201).json({
      success: true,
      message: `Shift endorsed to ${recipient.name}. It is pending their acknowledgement.`,
      endorsement_id: endorsementId,
    });

    // Best-effort: tell the incoming nurse there is a handoff waiting.
    try {
      const [[recipientUser]] = await db.query(
        "SELECT user_id FROM users WHERE linked_id = ? AND role = 'nurse' AND is_active = 1 LIMIT 1",
        [recipient.employee_id]
      );
      if (recipientUser && recipientUser.user_id !== req.user.user_id) {
        await db.query(
          'INSERT INTO notifications (user_id, message, referral_id) VALUES (?, ?, ?)',
          [
            recipientUser.user_id,
            `${nurse.first_name} ${nurse.last_name} endorsed the ${shift} shift to you ` +
            `(${patientIds.length} patient${patientIds.length === 1 ? '' : 's'}) in ${nurse.department_name}. ` +
            'Acknowledge it to take over.',
            null,
          ]
        );
      }
    } catch (notifErr) {
      console.warn('createEndorsement: notification insert failed (non-fatal):', notifErr.message);
    }
  } catch (err) {
    console.error('createEndorsement error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// Shared list query — `direction` picks which side of the handoff I am on.
const listEndorsements = async (req, res, direction) => {
  try {
    const nurse = await requireNurseDepartment(req, res);
    if (!nurse) return;

    const { status } = req.query;
    const conditions = [direction === 'incoming' ? 'e.to_nurse_id = ?' : 'e.from_nurse_id = ?'];
    const params = [nurse.employee_id];

    if (status && ['Pending', 'Acknowledged'].includes(status)) {
      conditions.push('e.status = ?');
      params.push(status);
    }

    const [rows] = await db.query(
      `SELECT e.endorsement_id, e.shift, e.shift_date, e.status, e.general_notes,
              e.created_at, e.acknowledged_at,
              e.from_nurse_id, e.to_nurse_id,
              CONCAT(fn.first_name, ' ', fn.last_name) AS from_nurse_name,
              CONCAT(tn.first_name, ' ', tn.last_name) AS to_nurse_name,
              d.name AS department_name,
              (SELECT COUNT(*) FROM endorsement_patients ep
                WHERE ep.endorsement_id = e.endorsement_id) AS patient_count
       FROM endorsements e
       JOIN employees fn ON fn.employee_id = e.from_nurse_id
       JOIN employees tn ON tn.employee_id = e.to_nurse_id
       LEFT JOIN departments d ON d.department_id = e.department_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY e.status = 'Acknowledged', e.created_at DESC
       LIMIT 100`,
      params
    );

    return res.status(200).json({ success: true, data: rows });
  } catch (err) {
    console.error(`list ${direction} endorsements error:`, err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// GET /api/endorsements/incoming — handoffs waiting for ME
const getIncomingEndorsements = (req, res) => listEndorsements(req, res, 'incoming');

// GET /api/endorsements/outgoing — handoffs I submitted
const getOutgoingEndorsements = (req, res) => listEndorsements(req, res, 'outgoing');

// GET /api/endorsements/:id — full handoff with its patients and notes.
// Readable only by the two nurses involved: an endorsement note is clinical
// handover content, not ward-wide reading.
const getEndorsementById = async (req, res) => {
  try {
    const nurse = await requireNurseDepartment(req, res);
    if (!nurse) return;

    const [[endorsement]] = await db.query(
      `SELECT e.*,
              CONCAT(fn.first_name, ' ', fn.last_name) AS from_nurse_name,
              CONCAT(tn.first_name, ' ', tn.last_name) AS to_nurse_name,
              d.name AS department_name
       FROM endorsements e
       JOIN employees fn ON fn.employee_id = e.from_nurse_id
       JOIN employees tn ON tn.employee_id = e.to_nurse_id
       LEFT JOIN departments d ON d.department_id = e.department_id
       WHERE e.endorsement_id = ?`,
      [req.params.id]
    );
    if (!endorsement) {
      return res.status(404).json({ success: false, message: 'Endorsement not found.' });
    }

    const involved = [Number(endorsement.from_nurse_id), Number(endorsement.to_nurse_id)]
      .includes(Number(nurse.employee_id));
    if (!involved) {
      return res.status(403).json({ success: false, message: 'This endorsement was not addressed to you.' });
    }

    const [patients] = await db.query(
      `SELECT ep.patient_id, ep.notes,
              CONCAT(p.first_name, ' ', p.last_name) AS patient_name,
              p.is_unidentified,
              r.bed_number, r.room_type,
              a.status AS admission_status
       FROM endorsement_patients ep
       JOIN patients p ON p.patient_id = ep.patient_id
       LEFT JOIN admissions a ON a.admission_id = (
         SELECT ad.admission_id FROM admissions ad
         WHERE ad.patient_id = ep.patient_id
         ORDER BY ad.admission_date DESC LIMIT 1
       )
       LEFT JOIN rooms r ON r.room_id = a.room_id
       WHERE ep.endorsement_id = ?
       ORDER BY p.first_name`,
      [req.params.id]
    );

    return res.status(200).json({ success: true, data: { ...endorsement, patients } });
  } catch (err) {
    console.error('getEndorsementById error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// POST /api/endorsements/:id/acknowledge
// The incoming nurse takes over. This is the step that moves responsibility:
// each endorsed patient's active assignment is released and re-created against
// the incoming nurse, inside one transaction with the status change.
const acknowledgeEndorsement = async (req, res) => {
  try {
    const nurse = await requireNurseDepartment(req, res);
    if (!nurse) return;

    const connection = await db.getConnection();
    await connection.beginTransaction();

    let summary;
    try {
      // Lock the row so two taps on "Acknowledge" cannot both transfer.
      const [[endorsement]] = await connection.query(
        `SELECT endorsement_id, from_nurse_id, to_nurse_id, department_id, shift, status
         FROM endorsements WHERE endorsement_id = ? FOR UPDATE`,
        [req.params.id]
      );

      if (!endorsement) {
        await connection.rollback(); connection.release();
        return res.status(404).json({ success: false, message: 'Endorsement not found.' });
      }
      if (Number(endorsement.to_nurse_id) !== Number(nurse.employee_id)) {
        await connection.rollback(); connection.release();
        return res.status(403).json({ success: false, message: 'This endorsement was not addressed to you.' });
      }
      if (endorsement.status === 'Acknowledged') {
        await connection.rollback(); connection.release();
        return res.status(409).json({ success: false, message: 'This endorsement has already been acknowledged.' });
      }

      const [endorsed] = await connection.query(
        'SELECT patient_id FROM endorsement_patients WHERE endorsement_id = ?',
        [endorsement.endorsement_id]
      );

      let transferred = 0;
      let skipped = 0;

      for (const { patient_id } of endorsed) {
        // Re-read each assignment under the lock. A patient may have been
        // discharged or reassigned since the endorsement was written — those
        // are skipped rather than forced, and reported back in the message.
        const [[current]] = await connection.query(
          `SELECT assignment_id, nurse_id, admission_id, department_id
           FROM nurse_assignments
           WHERE patient_id = ? AND released_at IS NULL
           LIMIT 1 FOR UPDATE`,
          [patient_id]
        );

        if (!current || Number(current.nurse_id) !== Number(endorsement.from_nurse_id)) {
          skipped += 1;
          continue;
        }

        await connection.query(
          "UPDATE nurse_assignments SET released_at = NOW(), release_reason = 'Endorsed' WHERE assignment_id = ?",
          [current.assignment_id]
        );
        await connection.query(
          `INSERT INTO nurse_assignments (patient_id, nurse_id, department_id, admission_id, assigned_by)
           VALUES (?, ?, ?, ?, ?)`,
          [patient_id, endorsement.to_nurse_id, current.department_id ?? endorsement.department_id,
           current.admission_id, req.user.user_id]
        );
        transferred += 1;
      }

      await connection.query(
        "UPDATE endorsements SET status = 'Acknowledged', acknowledged_at = NOW() WHERE endorsement_id = ?",
        [endorsement.endorsement_id]
      );
      await connection.query(
        "INSERT INTO activity_logs (user_id, action, target_table, target_id) VALUES (?, 'ACKNOWLEDGE_ENDORSEMENT', 'endorsements', ?)",
        [req.user.user_id, endorsement.endorsement_id]
      );

      await connection.commit();
      connection.release();
      summary = { transferred, skipped, from_nurse_id: endorsement.from_nurse_id, shift: endorsement.shift };
    } catch (txErr) {
      await connection.rollback();
      connection.release();
      throw txErr;
    }

    const message = summary.skipped > 0
      ? `Endorsement acknowledged. ${summary.transferred} patient(s) transferred to you; ${summary.skipped} skipped (discharged or already reassigned).`
      : `Endorsement acknowledged. ${summary.transferred} patient(s) are now yours.`;

    res.status(200).json({ success: true, message, ...summary });

    // Best-effort: close the loop for the outgoing nurse.
    try {
      const [[fromUser]] = await db.query(
        "SELECT user_id FROM users WHERE linked_id = ? AND role = 'nurse' AND is_active = 1 LIMIT 1",
        [summary.from_nurse_id]
      );
      if (fromUser && fromUser.user_id !== req.user.user_id) {
        await db.query(
          'INSERT INTO notifications (user_id, message, referral_id) VALUES (?, ?, ?)',
          [fromUser.user_id,
           `${nurse.first_name} ${nurse.last_name} acknowledged your ${summary.shift} shift endorsement. ` +
           `${summary.transferred} patient(s) are now theirs.`,
           null]
        );
      }
    } catch (notifErr) {
      console.warn('acknowledgeEndorsement: notification insert failed (non-fatal):', notifErr.message);
    }
  } catch (err) {
    console.error('acknowledgeEndorsement error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// DELETE /api/endorsements/:id — the outgoing nurse withdraws a handoff the
// incoming nurse has not acknowledged yet. Acknowledged ones are history and
// cannot be withdrawn; nothing has moved yet, so nothing needs unwinding.
const cancelEndorsement = async (req, res) => {
  try {
    const nurse = await requireNurseDepartment(req, res);
    if (!nurse) return;

    const [[endorsement]] = await db.query(
      'SELECT endorsement_id, from_nurse_id, status FROM endorsements WHERE endorsement_id = ?',
      [req.params.id]
    );
    if (!endorsement) {
      return res.status(404).json({ success: false, message: 'Endorsement not found.' });
    }
    if (Number(endorsement.from_nurse_id) !== Number(nurse.employee_id)) {
      return res.status(403).json({ success: false, message: 'Only the nurse who submitted it can withdraw it.' });
    }
    if (endorsement.status === 'Acknowledged') {
      return res.status(409).json({ success: false, message: 'This endorsement has been acknowledged and cannot be withdrawn.' });
    }

    // endorsement_patients cascades.
    await db.query('DELETE FROM endorsements WHERE endorsement_id = ?', [req.params.id]);
    await db.query(
      "INSERT INTO activity_logs (user_id, action, target_table, target_id) VALUES (?, 'CANCEL_ENDORSEMENT', 'endorsements', ?)",
      [req.user.user_id, req.params.id]
    );

    return res.status(200).json({ success: true, message: 'Endorsement withdrawn.' });
  } catch (err) {
    console.error('cancelEndorsement error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

module.exports = {
  createEndorsement,
  getIncomingEndorsements,
  getOutgoingEndorsements,
  getEndorsementById,
  acknowledgeEndorsement,
  cancelEndorsement,
};
