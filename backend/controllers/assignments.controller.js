const db = require('../config/db');
const { isDoctorInCharge } = require('../utils/dic');

// ─── Attending-doctor assignment lifecycle ────────────────────────────────────
// A Doctor-in-Charge PROPOSES an attending doctor (assignTriageDoctor inserts a
// doctor_in_charge row with status='Pending'); the proposed doctor accepts or
// declines here, and the proposing DIC may cancel a proposal that hasn't been
// answered yet. Endpoints are keyed by patient_id because the assignment is a
// PATIENT-level fact (the triage is just where the proposal is made from).
// INVARIANT: at most one doctor_in_charge row per patient, of either status.

// GET /api/assignments/pending — proposals awaiting MY acceptance.
// Powers the doctor dashboard "Pending assignments" section: patient name,
// latest triage level (single-row ordered subquery — never a bare JOIN),
// proposal time, and the proposing DIC's name.
const getMyPendingAssignments = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT dic.dic_id, dic.patient_id, dic.assigned_at,
              CONCAT(p.first_name, ' ', p.last_name) AS patient_name,
              p.is_unidentified,
              lt.triage_level,
              lt.triage_datetime,
              CASE
                WHEN ad.doctor_id IS NOT NULL THEN CONCAT('Dr. ', ad.first_name, ' ', ad.last_name)
                ELSE au.username
              END AS assigned_by_name
       FROM doctor_in_charge dic
       JOIN patients p ON p.patient_id = dic.patient_id
       LEFT JOIN users au ON au.user_id = dic.assigned_by
       LEFT JOIN doctors ad ON au.role = 'doctor' AND ad.doctor_id = au.linked_id
       LEFT JOIN triages lt ON lt.triage_id = (
         SELECT t.triage_id FROM triages t
         WHERE t.patient_id = dic.patient_id
         ORDER BY t.triage_datetime DESC LIMIT 1
       )
       WHERE dic.doctor_id = ? AND dic.status = 'Pending'
       ORDER BY dic.assigned_at DESC`,
      [req.user.linked_id]
    );
    return res.status(200).json({ success: true, data: rows });
  } catch (err) {
    console.error('getMyPendingAssignments error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// Shared: lock the patient's Pending row inside a transaction so two
// simultaneous responses (or a response racing a cancel) can't both proceed.
// Returns { connection, row } with the transaction OPEN, or null after having
// sent the error response and cleaned up the connection.
const lockPendingRow = async (req, res, patientId) => {
  const connection = await db.getConnection();
  await connection.beginTransaction();
  try {
    const [[row]] = await connection.query(
      `SELECT dic_id, doctor_id, patient_id, assigned_by
       FROM doctor_in_charge
       WHERE patient_id = ? AND status = 'Pending' LIMIT 1 FOR UPDATE`,
      [patientId]
    );
    if (!row) {
      await connection.rollback();
      connection.release();
      res.status(404).json({ success: false, message: 'No assignment awaiting acceptance for this patient.' });
      return null;
    }
    return { connection, row };
  } catch (err) {
    await connection.rollback();
    connection.release();
    throw err;
  }
};

// Best-effort notification to the DIC who proposed the assignment.
const notifyAssigner = async (assignedByUserId, actorUserId, message) => {
  try {
    if (!assignedByUserId || assignedByUserId === actorUserId) return;
    await db.query(
      'INSERT INTO notifications (user_id, message, referral_id) VALUES (?, ?, ?)',
      [assignedByUserId, message, null]
    );
  } catch (notifErr) {
    console.warn('assignments: notification insert failed (non-fatal):', notifErr.message);
  }
};

// POST /api/assignments/:patientId/accept — proposed doctor takes the patient.
const acceptAssignment = async (req, res) => {
  try {
    const locked = await lockPendingRow(req, res, req.params.patientId);
    if (!locked) return;
    const { connection, row } = locked;

    // Only the doctor the proposal names may respond (fresh row read, never JWT).
    if (Number(row.doctor_id) !== Number(req.user.linked_id)) {
      await connection.rollback();
      connection.release();
      return res.status(403).json({ success: false, message: 'This assignment is not proposed to you.' });
    }

    try {
      await connection.query(
        "UPDATE doctor_in_charge SET status = 'Accepted', responded_at = NOW() WHERE dic_id = ?",
        [row.dic_id]
      );
      await connection.query(
        "INSERT INTO activity_logs (user_id, action, target_table, target_id) VALUES (?, 'ACCEPT_ASSIGNMENT', 'doctor_in_charge', ?)",
        [req.user.user_id, row.patient_id]
      );
      await connection.commit();
      connection.release();
    } catch (txErr) {
      await connection.rollback();
      connection.release();
      throw txErr;
    }

    const [[patient]] = await db.query(
      "SELECT CONCAT(first_name, ' ', last_name) AS name FROM patients WHERE patient_id = ?",
      [row.patient_id]
    );
    res.status(200).json({
      success: true,
      message: `You are now the attending doctor for ${patient?.name ?? 'this patient'}.`,
    });

    await notifyAssigner(
      row.assigned_by, req.user.user_id,
      `Your attending-doctor assignment for ${patient?.name ?? 'a patient'} was accepted.`
    );
  } catch (err) {
    console.error('acceptAssignment error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// POST /api/assignments/:patientId/decline — proposed doctor declines with a
// reason. The row is DELETED so the patient returns to the unassigned pool;
// the reason travels in the DIC's notification (activity_logs has no free-text
// context column, so the notification is the durable record of the reason).
const declineAssignment = async (req, res) => {
  const reason = String(req.body?.reason ?? '').trim();
  if (!reason) {
    return res.status(400).json({ success: false, message: 'A reason is required to decline an assignment.' });
  }
  if (reason.length > 255) {
    return res.status(400).json({ success: false, message: 'Decline reason must be 255 characters or fewer.' });
  }

  try {
    const locked = await lockPendingRow(req, res, req.params.patientId);
    if (!locked) return;
    const { connection, row } = locked;

    if (Number(row.doctor_id) !== Number(req.user.linked_id)) {
      await connection.rollback();
      connection.release();
      return res.status(403).json({ success: false, message: 'This assignment is not proposed to you.' });
    }

    try {
      await connection.query('DELETE FROM doctor_in_charge WHERE dic_id = ?', [row.dic_id]);
      await connection.query(
        "INSERT INTO activity_logs (user_id, action, target_table, target_id) VALUES (?, 'DECLINE_ASSIGNMENT', 'doctor_in_charge', ?)",
        [req.user.user_id, row.patient_id]
      );
      await connection.commit();
      connection.release();
    } catch (txErr) {
      await connection.rollback();
      connection.release();
      throw txErr;
    }

    const [[patient]] = await db.query(
      "SELECT CONCAT(first_name, ' ', last_name) AS name FROM patients WHERE patient_id = ?",
      [row.patient_id]
    );
    res.status(200).json({
      success: true,
      message: `Assignment declined. ${patient?.name ?? 'The patient'} has returned to the unassigned pool.`,
    });

    await notifyAssigner(
      row.assigned_by, req.user.user_id,
      `Your attending-doctor assignment for ${patient?.name ?? 'a patient'} was DECLINED. Reason: ${reason}. The patient is back in the coordination queue.`
    );
  } catch (err) {
    console.error('declineAssignment error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// POST /api/assignments/:patientId/cancel — a live-checked Doctor-in-Charge
// withdraws a Pending proposal. ANY live DIC may cancel (not only the creator):
// DICs are a small trusted coordination group and the creator's flag can be
// revoked mid-proposal, which would otherwise strand the row in limbo. The
// activity log records who cancelled.
const cancelAssignment = async (req, res) => {
  try {
    const allowed = req.user.role === 'doctor' && await isDoctorInCharge(req.user.user_id);
    if (!allowed) {
      return res.status(403).json({ success: false, message: 'Doctor-in-Charge mode required.' });
    }

    const locked = await lockPendingRow(req, res, req.params.patientId);
    if (!locked) return;
    const { connection, row } = locked;

    try {
      await connection.query('DELETE FROM doctor_in_charge WHERE dic_id = ?', [row.dic_id]);
      await connection.query(
        "INSERT INTO activity_logs (user_id, action, target_table, target_id) VALUES (?, 'CANCEL_ASSIGNMENT', 'doctor_in_charge', ?)",
        [req.user.user_id, row.patient_id]
      );
      await connection.commit();
      connection.release();
    } catch (txErr) {
      await connection.rollback();
      connection.release();
      throw txErr;
    }

    const [[patient]] = await db.query(
      "SELECT CONCAT(first_name, ' ', last_name) AS name FROM patients WHERE patient_id = ?",
      [row.patient_id]
    );
    res.status(200).json({
      success: true,
      message: `Assignment proposal cancelled. ${patient?.name ?? 'The patient'} has returned to the unassigned pool.`,
    });

    // Best-effort: tell the proposed doctor the proposal was withdrawn.
    try {
      const [[docUser]] = await db.query(
        "SELECT user_id FROM users WHERE linked_id = ? AND role = 'doctor' AND is_active = 1 LIMIT 1",
        [row.doctor_id]
      );
      if (docUser && docUser.user_id !== req.user.user_id) {
        await db.query(
          'INSERT INTO notifications (user_id, message, referral_id) VALUES (?, ?, ?)',
          [docUser.user_id, `The attending-doctor proposal for ${patient?.name ?? 'a patient'} was withdrawn by the coordinator.`, null]
        );
      }
    } catch (notifErr) {
      console.warn('cancelAssignment: notification insert failed (non-fatal):', notifErr.message);
    }
  } catch (err) {
    console.error('cancelAssignment error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

module.exports = { getMyPendingAssignments, acceptAssignment, declineAssignment, cancelAssignment };
