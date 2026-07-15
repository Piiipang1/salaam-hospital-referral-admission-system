const db = require('../config/db');
const { isDoctorInCharge } = require('../utils/dic');
const { assertCanAccessPatient } = require('../utils/scoping');

// POST /api/referrals
const createReferral = async (req, res) => {
  const { diagnosis_id, assigned_doctor_id, e_signature } = req.body;

  // A doctor is always recorded as their own referrer (cannot spoof another doctor);
  // an admin may create a referral on behalf of a doctor via referring_doctor_id in the body.
  const referring_doctor_id = req.user.role === 'doctor' ? req.user.linked_id : req.body.referring_doctor_id;

  // Multer stores the file (if any) in req.file
  const file_attachment = req.file ? req.file.filename : null;

  if (!diagnosis_id || !assigned_doctor_id) {
    return res.status(400).json({ success: false, message: 'diagnosis_id and assigned_doctor_id are required.' });
  }

  try {
    const [result] = await db.query(
      `INSERT INTO referrals
         (diagnosis_id, referring_doctor_id, assigned_doctor_id, referral_date, status, file_attachment, e_signature)
       VALUES (?, ?, ?, NOW(), 'Pending', ?, ?)`,
      [diagnosis_id, referring_doctor_id || null, assigned_doctor_id, file_attachment, e_signature || null]
    );

    await db.query(
      "INSERT INTO activity_logs (user_id, action, target_table, target_id) VALUES (?, 'CREATE', 'referrals', ?)",
      [req.user.user_id, result.insertId]
    );

    // ── Respond immediately ────────────────────────────────────────────────────
    res.status(201).json({
      success: true,
      message: 'Referral created.',
      referral_id: result.insertId,
      file_attachment,
    });

    // ── Post-insert: notify assigned doctor (best-effort) ─────────────────────
    try {
      // Resolve patient name + condition + assigned doctor's user account in one query
      const [[detail]] = await db.query(
        `SELECT CONCAT(p.first_name, ' ', p.last_name) AS patient_name,
                diag.medical_condition,
                u.user_id AS assigned_user_id
         FROM   diagnoses diag
         LEFT JOIN patients p ON p.patient_id      = diag.patient_id
         LEFT JOIN users    u ON u.linked_id        = ? AND u.role = 'doctor' AND u.is_active = 1
         WHERE  diag.diagnosis_id = ?`,
        [assigned_doctor_id, diagnosis_id]
      );

      if (detail?.assigned_user_id) {
        const condPart = detail.medical_condition ? ` for ${detail.medical_condition}` : '';
        await db.query(
          'INSERT INTO notifications (user_id, message, referral_id) VALUES (?, ?, ?)',
          [
            detail.assigned_user_id,
            `You have a new referral assigned: ${detail.patient_name ?? `Patient #`}${condPart}. Referral ID: ${result.insertId}.`,
            result.insertId,
          ]
        );
      }

      // Also notify all active admins for oversight of referral activity
      const [admins] = await db.query(
        "SELECT user_id FROM users WHERE role = 'admin' AND is_active = 1"
      );
      const adminMsg =
        `New referral created: ${detail?.patient_name ?? 'a patient'} referred for ` +
        `${detail?.medical_condition ?? 'an unspecified condition'}. Referral ID: ${result.insertId}.`;
      const notifRows = [];
      for (const admin of admins) {
        if (admin.user_id !== req.user.user_id) {
          notifRows.push([admin.user_id, adminMsg, result.insertId]);
        }
      }
      if (notifRows.length > 0) {
        await db.query(
          'INSERT INTO notifications (user_id, message, referral_id) VALUES ?',
          [notifRows]
        );
      }
    } catch (notifErr) {
      console.warn('createReferral: notification insert failed (non-fatal):', notifErr.message);
    }

  } catch (err) {
    console.error('createReferral error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// GET /api/referrals
const getAllReferrals = async (req, res) => {
  const { status, from_date, to_date, page = 1, limit = 20 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  try {
    const conditions = [];
    const params     = [];

    // Status filter
    if (status) {
      conditions.push('r.status = ?');
      params.push(status);
    }

    // Date range filter on referral_date
    if (from_date) {
      conditions.push('DATE(r.referral_date) >= ?');
      params.push(from_date);
    }
    if (to_date) {
      conditions.push('DATE(r.referral_date) <= ?');
      params.push(to_date);
    }

    // Doctors see referrals they are involved in — assigned to them (incoming)
    // OR referred by them (outgoing). Matches the dashboard recent-activity
    // scope so the two lists always show the same population.
    if (req.user.role === 'doctor') {
      conditions.push('(r.assigned_doctor_id = ? OR r.referring_doctor_id = ?)');
      params.push(req.user.linked_id, req.user.linked_id);
    }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

    // Run data query and count query in parallel
    const [[rows], [[{ total }]]] = await Promise.all([
      db.query(
        `SELECT r.*,
                CONCAT(p.first_name, ' ', p.last_name) AS patient_name,
                CONCAT(ad.first_name, ' ', ad.last_name) AS assigned_doctor_name,
                CONCAT(rd.first_name, ' ', rd.last_name) AS referring_doctor_name,
                diag.medical_condition
         FROM referrals r
         LEFT JOIN diagnoses diag ON r.diagnosis_id = diag.diagnosis_id
         LEFT JOIN patients p ON diag.patient_id = p.patient_id
         LEFT JOIN doctors ad ON r.assigned_doctor_id = ad.doctor_id
         LEFT JOIN doctors rd ON r.referring_doctor_id = rd.doctor_id
         ${where}
         ORDER BY r.referral_date DESC LIMIT ? OFFSET ?`,
        [...params, parseInt(limit), offset]
      ),
      db.query(
        `SELECT COUNT(*) AS total
         FROM referrals r
         LEFT JOIN diagnoses diag ON r.diagnosis_id = diag.diagnosis_id
         ${where}`,
        params
      ),
    ]);

    return res.status(200).json({ success: true, data: rows, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    console.error('getAllReferrals error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// GET /api/referrals/:id
const getReferralById = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT r.*,
              CONCAT(p.first_name, ' ', p.last_name) AS patient_name,
              p.date_of_birth, p.sex, p.contact_number,
              CONCAT(ad.first_name, ' ', ad.last_name) AS assigned_doctor_name,
              ad.specialization,
              CONCAT(rd.first_name, ' ', rd.last_name) AS referring_doctor_name,
              rd.specialization AS referring_specialization,
              diag.medical_condition
       FROM referrals r
       LEFT JOIN diagnoses diag ON r.diagnosis_id = diag.diagnosis_id
       LEFT JOIN patients p ON diag.patient_id = p.patient_id
       LEFT JOIN doctors ad ON r.assigned_doctor_id = ad.doctor_id
       LEFT JOIN doctors rd ON r.referring_doctor_id = rd.doctor_id
       WHERE r.referral_id = ?`,
      [req.params.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Referral not found.' });
    }

    // Doctors may only view referrals where they are the referring or the
    // assigned doctor (Doctor-in-Charge bypasses this).
    if (req.user.role === 'doctor' && !(await isDoctorInCharge(req.user.user_id))) {
      const ref = rows[0];
      const isParty = ref.referring_doctor_id === req.user.linked_id
        || ref.assigned_doctor_id === req.user.linked_id;
      if (!isParty) {
        return res.status(403).json({ success: false, message: 'You do not have access to this referral.' });
      }
    }

    return res.status(200).json({ success: true, data: rows[0] });
  } catch (err) {
    console.error('getReferralById error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// PUT /api/referrals/:id/status
const updateReferralStatus = async (req, res) => {
  const { status } = req.body;
  const validStatuses = ['Pending', 'Accepted', 'Completed', 'Cancelled'];

  if (!status || !validStatuses.includes(status)) {
    return res.status(400).json({ success: false, message: `status must be one of: ${validStatuses.join(', ')}.` });
  }

  // Referral status lifecycle — the only forward transitions permitted.
  // Completed and Cancelled are terminal.
  const allowedNext = {
    Pending:   ['Accepted', 'Cancelled'],
    Accepted:  ['Completed', 'Cancelled'],
    Completed: [],
    Cancelled: [],
  };

  try {
    // Load current state + parties for the transition/ownership checks
    const [[referral]] = await db.query(
      'SELECT status, assigned_doctor_id, referring_doctor_id FROM referrals WHERE referral_id = ?',
      [req.params.id]
    );
    if (!referral) {
      return res.status(404).json({ success: false, message: 'Referral not found.' });
    }

    // 1. Transition validity (state machine)
    const nextOptions = allowedNext[referral.status] ?? [];
    if (!nextOptions.includes(status)) {
      const message = nextOptions.length
        ? `Cannot change a ${referral.status} referral to ${status}. Allowed next status: ${nextOptions.join(' or ')}.`
        : `This referral is ${referral.status} and can no longer change status.`;
      return res.status(409).json({ success: false, message });
    }

    // 2. Ownership
    //   - Accepted / Completed: only the assigned doctor (takes responsibility /
    //     finishes the consultation).
    //   - Cancelled: only the referring doctor (the assigned doctor never
    //     cancels; they either accept+complete or leave it). Admins are
    //     oversight-only and cannot touch referrals.
    const isAssignedDoctor  = req.user.role === 'doctor' && referral.assigned_doctor_id  === req.user.linked_id;
    const isReferringDoctor = req.user.role === 'doctor' && referral.referring_doctor_id === req.user.linked_id;

    if (status === 'Accepted' || status === 'Completed') {
      if (!isAssignedDoctor) {
        return res.status(403).json({ success: false, message: `Only the assigned doctor may set a referral to ${status}.` });
      }
    } else if (status === 'Cancelled') {
      if (!isReferringDoctor) {
        return res.status(403).json({ success: false, message: 'Only the referring doctor may cancel a referral.' });
      }
    }

    await db.query('UPDATE referrals SET status = ? WHERE referral_id = ?', [status, req.params.id]);

    await db.query(
      "INSERT INTO activity_logs (user_id, action, target_table, target_id) VALUES (?, 'UPDATE_STATUS', 'referrals', ?)",
      [req.user.user_id, req.params.id]
    );

    // ── Respond immediately ────────────────────────────────────────────────────
    res.status(200).json({ success: true, message: `Referral status updated to ${status}.` });

    // ── Notify referring doctor on meaningful status changes ──────────────────
    // Only send when status is something the referring doctor needs to act on.
    if (['Accepted', 'Completed', 'Cancelled'].includes(status)) {
      try {
        // Fetch referral detail in one query: patient name, condition, referring doctor id
        const [[detail]] = await db.query(
          `SELECT CONCAT(p.first_name, ' ', p.last_name) AS patient_name,
                  diag.medical_condition,
                  r.referring_doctor_id,
                  u.user_id AS referring_user_id
           FROM   referrals r
           LEFT JOIN diagnoses diag ON r.diagnosis_id   = diag.diagnosis_id
           LEFT JOIN patients  p    ON diag.patient_id  = p.patient_id
           LEFT JOIN users     u    ON u.linked_id       = r.referring_doctor_id
                                    AND u.role = 'doctor' AND u.is_active = 1
           WHERE  r.referral_id = ?`,
          [req.params.id]
        );

        if (detail?.referring_user_id) {
          const condPart = detail.medical_condition ? ` for ${detail.medical_condition}` : '';
          await db.query(
            'INSERT INTO notifications (user_id, message, referral_id) VALUES (?, ?, ?)',
            [
              detail.referring_user_id,
              `Your referral${condPart} for ${detail.patient_name ?? 'a patient'} has been marked ${status}. Referral ID: ${req.params.id}.`,
              parseInt(req.params.id),
            ]
          );
        }

        // Also notify all active admins for oversight of referral activity
        const [admins] = await db.query(
          "SELECT user_id FROM users WHERE role = 'admin' AND is_active = 1"
        );
        const adminMsg = `Referral #${req.params.id} for ${detail?.patient_name ?? 'a patient'} has been marked ${status}.`;
        const notifRows = [];
        for (const admin of admins) {
          if (admin.user_id !== req.user.user_id) {
            notifRows.push([admin.user_id, adminMsg, parseInt(req.params.id)]);
          }
        }
        if (notifRows.length > 0) {
          await db.query(
            'INSERT INTO notifications (user_id, message, referral_id) VALUES ?',
            [notifRows]
          );
        }
      } catch (notifErr) {
        console.warn('updateReferralStatus: notification insert failed (non-fatal):', notifErr.message);
      }
    }

  } catch (err) {
    console.error('updateReferralStatus error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// GET /api/referrals/history/:patient_id
const getReferralHistory = async (req, res) => {
  try {
    // Same per-patient scoping as the diagnoses/patient detail endpoints — only
    // doctors reach this route, so the doctor branch of the guard applies.
    const denied = await assertCanAccessPatient(req, req.params.patient_id);
    if (denied) {
      return res.status(denied.status).json({ success: false, message: denied.message });
    }

    const [rows] = await db.query(
      `SELECT r.*,
              CONCAT(ad.first_name, ' ', ad.last_name) AS assigned_doctor_name,
              ad.specialization,
              diag.medical_condition
       FROM referrals r
       LEFT JOIN diagnoses diag ON r.diagnosis_id = diag.diagnosis_id
       LEFT JOIN doctors ad ON r.assigned_doctor_id = ad.doctor_id
       WHERE diag.patient_id = ?
       ORDER BY r.referral_date DESC`,
      [req.params.patient_id]
    );
    return res.status(200).json({ success: true, data: rows });
  } catch (err) {
    console.error('getReferralHistory error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// PUT /api/referrals/:id/reassign — Doctor-in-Charge only (checked live)
const reassignReferral = async (req, res) => {
  const { assigned_doctor_id } = req.body;

  if (!assigned_doctor_id) {
    return res.status(400).json({ success: false, message: 'assigned_doctor_id is required.' });
  }

  try {
    const allowed = req.user.role === 'doctor' && await isDoctorInCharge(req.user.user_id);
    if (!allowed) {
      return res.status(403).json({ success: false, message: 'Doctor-in-Charge mode required.' });
    }

    const [[referral]] = await db.query(
      `SELECT r.referral_id, r.status, r.referring_doctor_id,
              CONCAT(p.first_name, ' ', p.last_name) AS patient_name
       FROM referrals r
       JOIN diagnoses dx ON dx.diagnosis_id = r.diagnosis_id
       JOIN patients p ON p.patient_id = dx.patient_id
       WHERE r.referral_id = ?`,
      [req.params.id]
    );
    if (!referral) {
      return res.status(404).json({ success: false, message: 'Referral not found.' });
    }
    if (!['Pending', 'Accepted'].includes(referral.status)) {
      return res.status(409).json({ success: false, message: 'Only Pending or Accepted referrals can be reassigned.' });
    }

    const [[targetDoctor]] = await db.query(
      "SELECT doctor_id, CONCAT(first_name, ' ', last_name) AS name FROM doctors WHERE doctor_id = ? AND employment_status = 'Active'",
      [assigned_doctor_id]
    );
    if (!targetDoctor) {
      return res.status(400).json({ success: false, message: 'Assigned doctor must exist and be Active.' });
    }

    await db.query(
      'UPDATE referrals SET assigned_doctor_id = ? WHERE referral_id = ?',
      [assigned_doctor_id, req.params.id]
    );

    await db.query(
      "INSERT INTO activity_logs (user_id, action, target_table, target_id) VALUES (?, 'UPDATE', 'referrals', ?)",
      [req.user.user_id, req.params.id]
    );

    res.status(200).json({ success: true, message: `Referral reassigned to Dr. ${targetDoctor.name}.` });

    // Best-effort notifications: new assignee + referring doctor
    try {
      const notifRows = [];
      const [[assigneeUser]] = await db.query(
        "SELECT user_id FROM users WHERE linked_id = ? AND role = 'doctor' AND is_active = 1 LIMIT 1",
        [assigned_doctor_id]
      );
      if (assigneeUser) {
        notifRows.push([
          assigneeUser.user_id,
          `A referral for ${referral.patient_name} has been reassigned to you.`,
          referral.referral_id,
        ]);
      }
      if (referral.referring_doctor_id) {
        const [[referrerUser]] = await db.query(
          "SELECT user_id FROM users WHERE linked_id = ? AND role = 'doctor' AND is_active = 1 LIMIT 1",
          [referral.referring_doctor_id]
        );
        if (referrerUser && referrerUser.user_id !== assigneeUser?.user_id) {
          notifRows.push([
            referrerUser.user_id,
            `Your referral for ${referral.patient_name} was reassigned to Dr. ${targetDoctor.name}.`,
            referral.referral_id,
          ]);
        }
      }
      if (notifRows.length > 0) {
        await db.query('INSERT INTO notifications (user_id, message, referral_id) VALUES ?', [notifRows]);
      }
    } catch (notifErr) {
      console.warn('reassignReferral: notification insert failed (non-fatal):', notifErr.message);
    }
  } catch (err) {
    console.error('reassignReferral error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

module.exports = { createReferral, getAllReferrals, getReferralById, updateReferralStatus, getReferralHistory, reassignReferral };
