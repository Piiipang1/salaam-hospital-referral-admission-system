const db = require('../config/db');
const { isDoctorInCharge } = require('../utils/dic');
const { assertCanAccessPatient } = require('../utils/scoping');
const { getRoomCapacity } = require('../utils/capacity');

// Every referral query resolves the patient the same way. Internal referrals
// have always reached the patient through their diagnosis; external ones may
// have no diagnosis at all and carry patient_id directly. The migration
// backfilled patient_id for pre-existing rows, so the COALESCE covers both.
const PATIENT_ID_EXPR = 'COALESCE(r.patient_id, diag.patient_id)';

// POST /api/referrals
const createReferral = async (req, res) => {
  const { diagnosis_id, assigned_doctor_id, e_signature, remarks } = req.body;

  // A doctor is always recorded as their own referrer (cannot spoof another doctor);
  // an admin may create a referral on behalf of a doctor via referring_doctor_id in the body.
  const referring_doctor_id = req.user.role === 'doctor' ? req.user.linked_id : req.body.referring_doctor_id;

  // Multer stores the file (if any) in req.file
  const file_attachment = req.file ? req.file.filename : null;

  if (!diagnosis_id || !assigned_doctor_id) {
    return res.status(400).json({ success: false, message: 'diagnosis_id and assigned_doctor_id are required.' });
  }

  // Remarks are mandatory: a referral hands a patient to someone who was not
  // managing them, and the receiving doctor needs to know WHY without having to
  // reconstruct it from the chart. Enforced here, not only in the form.
  const trimmedRemarks = String(remarks ?? '').trim();
  if (!trimmedRemarks) {
    return res.status(400).json({
      success: false,
      message: 'Notes/Remarks are required — state why this patient needs another doctor.',
      field: 'remarks',
    });
  }
  if (trimmedRemarks.length < 10) {
    return res.status(400).json({
      success: false,
      message: 'Notes/Remarks must be at least 10 characters — briefly describe why the referral is needed.',
      field: 'remarks',
    });
  }
  if (trimmedRemarks.length > 2000) {
    return res.status(400).json({
      success: false,
      message: 'Notes/Remarks must be 2000 characters or fewer.',
      field: 'remarks',
    });
  }

  // e_signature is a base64 PNG data URL from the signature canvas. Cap it before
  // it reaches the DB: even though the column is MEDIUMTEXT, a real signature is a
  // few KB, so anything over ~2 MB is malformed or abusive — reject it rather than
  // store a multi-MB blob per row.
  if (e_signature && Buffer.byteLength(e_signature, 'utf8') > 2 * 1024 * 1024) {
    return res.status(400).json({
      success: false,
      message: 'Signature image is too large (max 2 MB). Please re-capture a smaller signature.',
    });
  }

  try {
    // 1. Resolve the diagnosis and its patient. Without this a typo'd diagnosis_id
    //    reaches the FK and the user gets a generic 500 instead of a clear 400.
    const [[diag]] = await db.query(
      'SELECT patient_id FROM diagnoses WHERE diagnosis_id = ?',
      [diagnosis_id]
    );
    if (!diag) {
      return res.status(400).json({ success: false, message: 'Diagnosis not found.' });
    }

    // 2. The referring doctor must have a relationship with this patient — same
    //    per-patient scoping used across the clinical endpoints. forWrite: a
    //    doctor with only a Pending assignment proposal may not refer yet.
    const denied = await assertCanAccessPatient(req, diag.patient_id, { forWrite: true });
    if (denied) {
      return res.status(denied.status).json({ success: false, message: denied.message });
    }

    // 3. The assigned doctor must exist and be employed (mirrors reassignReferral).
    const [[targetDoctor]] = await db.query(
      `SELECT doctor_id, specialization, CONCAT(first_name, ' ', last_name) AS name
       FROM doctors WHERE doctor_id = ? AND employment_status = 'Active'`,
      [assigned_doctor_id]
    );
    if (!targetDoctor) {
      return res.status(400).json({ success: false, message: 'Assigned doctor must exist and be Active.' });
    }

    // 4. A referral hands a patient to a DIFFERENT doctor — reject self-referral.
    //    Authoritative check (must hold even if the UI is bypassed); the referrer
    //    is always req.user.linked_id for doctors. Compare as Numbers so '3' === 3.
    if (referring_doctor_id != null && Number(referring_doctor_id) === Number(assigned_doctor_id)) {
      return res.status(400).json({
        success: false,
        message: 'You cannot refer a patient to yourself. Choose a different doctor to receive the referral.',
      });
    }

    // 5. A referral must reach a doctor who can treat something the referring
    //    doctor cannot. Two doctors of the SAME specialization can treat the
    //    same conditions, so handing the case sideways has no clinical basis —
    //    that is a reassignment, not a referral. Specialization is the only
    //    signal the schema carries for "what this doctor can treat".
    //
    //    Skipped when either specialization is unrecorded: refusing on missing
    //    data would block legitimate referrals for a reason the user cannot see
    //    or fix from this form.
    if (referring_doctor_id != null) {
      const [[referringDoctor]] = await db.query(
        `SELECT doctor_id, specialization, CONCAT(first_name, ' ', last_name) AS name
         FROM doctors WHERE doctor_id = ?`,
        [referring_doctor_id]
      );

      const sameSpecialty =
        referringDoctor?.specialization &&
        targetDoctor.specialization &&
        referringDoctor.specialization.trim().toLowerCase() ===
          targetDoctor.specialization.trim().toLowerCase();

      if (sameSpecialty) {
        return res.status(400).json({
          success: false,
          message:
            `Dr. ${targetDoctor.name} is also a ${targetDoctor.specialization} specialist, ` +
            'so this referral would not reach anyone who can treat what you cannot. ' +
            'Refer to a different specialty, or hand the case over by reassigning it instead.',
          field: 'assigned_doctor_id',
          referring_specialization: referringDoctor.specialization,
          assigned_specialization: targetDoctor.specialization,
        });
      }
    }

    // patient_id is denormalised from the diagnosis so internal and external
    // referrals share one patient link (see PATIENT_ID_EXPR).
    const [result] = await db.query(
      `INSERT INTO referrals
         (diagnosis_id, patient_id, referring_doctor_id, assigned_doctor_id, referral_date, status, remarks, is_external, created_by, file_attachment, e_signature)
       VALUES (?, ?, ?, ?, NOW(), 'Pending', ?, 0, ?, ?, ?)`,
      [diagnosis_id, diag.patient_id, referring_doctor_id || null, assigned_doctor_id,
       trimmedRemarks, req.user.user_id, file_attachment, e_signature || null]
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

// POST /api/referrals/external
// Divert a patient to a hospital OUTSIDE this system — the escape hatch when
// this facility is at capacity and cannot admit. Unlike an internal referral
// there is no receiving doctor here, so assigned_doctor_id stays NULL and the
// destination is picked from the admin-managed external_hospitals directory.
//
// Open to doctors, nurses: turning a patient away happens at the
// intake desk, not only at the bedside. Nurses are linked to `employees`,
// not `doctors`, so they cannot be the referring_doctor — created_by records
// who actually wrote the record for them.
const createExternalReferral = async (req, res) => {
  const {
    patient_id, diagnosis_id, external_hospital_id,
    external_reason, e_signature,
  } = req.body;

  const file_attachment = req.file ? req.file.filename : null;

  if (!patient_id) {
    return res.status(400).json({ success: false, message: 'patient_id is required.' });
  }
  if (!external_hospital_id) {
    return res.status(400).json({ success: false, message: 'external_hospital_id is required.' });
  }

  // Same 2 MB signature cap as createReferral — a real signature is a few KB.
  if (e_signature && Buffer.byteLength(e_signature, 'utf8') > 2 * 1024 * 1024) {
    return res.status(400).json({
      success: false,
      message: 'Signature image is too large (max 2 MB). Please re-capture a smaller signature.',
    });
  }

  try {
    const [[patient]] = await db.query(
      "SELECT patient_id, CONCAT(first_name, ' ', last_name) AS patient_name FROM patients WHERE patient_id = ?",
      [patient_id]
    );
    if (!patient) {
      return res.status(400).json({ success: false, message: 'Patient not found.' });
    }

    // Doctors stay bound to their own patients (same per-patient scope as every
    // other clinical write). Nurses are NOT scoped here, matching triage
    // and room assignment: any nurse on shift may act on any patient at intake.
    if (req.user.role === 'doctor') {
      const denied = await assertCanAccessPatient(req, patient.patient_id, { forWrite: true });
      if (denied) {
        return res.status(denied.status).json({ success: false, message: denied.message });
      }
    }

    // An optional diagnosis must actually belong to this patient — otherwise a
    // typo'd id would silently attach another patient's clinical record.
    let linkedDiagnosisId = null;
    if (diagnosis_id) {
      const [[diag]] = await db.query(
        'SELECT diagnosis_id FROM diagnoses WHERE diagnosis_id = ? AND patient_id = ?',
        [diagnosis_id, patient.patient_id]
      );
      if (!diag) {
        return res.status(400).json({ success: false, message: 'Diagnosis not found for this patient.' });
      }
      linkedDiagnosisId = diag.diagnosis_id;
    }

    // The destination must be a live entry in the directory. A retired one is
    // refused rather than silently accepted: is_active = 0 means the admin has
    // said this facility no longer takes our transfers.
    const [[hospital]] = await db.query(
      'SELECT hospital_id, name, contact_number, address, is_active FROM external_hospitals WHERE hospital_id = ?',
      [external_hospital_id]
    );
    if (!hospital) {
      return res.status(400).json({ success: false, message: 'Receiving hospital not found.' });
    }
    if (!hospital.is_active) {
      return res.status(409).json({
        success: false,
        message: `${hospital.name} is no longer accepting transfers. Pick another hospital, or ask an admin to reactivate it.`,
      });
    }

    // A doctor is always their own referrer; nurses have no doctor_id.
    const referring_doctor_id = req.user.role === 'doctor' ? req.user.linked_id : null;

    // The external_hospital_* columns are a SNAPSHOT copied from the directory,
    // not a duplicate to keep in sync: if an admin later corrects this
    // hospital's phone number, this referral must still show the number the
    // transfer was actually arranged on.
    const [result] = await db.query(
      `INSERT INTO referrals
         (diagnosis_id, patient_id, referring_doctor_id, assigned_doctor_id, referral_date, status,
          is_external, external_hospital_id, external_hospital_name, external_hospital_contact,
          external_hospital_address, external_reason, created_by, file_attachment, e_signature)
       VALUES (?, ?, ?, NULL, NOW(), 'Pending', 1, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        linkedDiagnosisId, patient.patient_id, referring_doctor_id,
        hospital.hospital_id, hospital.name, hospital.contact_number, hospital.address,
        external_reason?.trim() || null,
        req.user.user_id, file_attachment, e_signature || null,
      ]
    );

    await db.query(
      "INSERT INTO activity_logs (user_id, action, target_table, target_id) VALUES (?, 'CREATE_EXTERNAL', 'referrals', ?)",
      [req.user.user_id, result.insertId]
    );

    // ── Respond immediately — notifications are best-effort ───────────────────
    res.status(201).json({
      success: true,
      message: `${patient.patient_name} referred to ${hospital.name}.`,
      referral_id: result.insertId,
      file_attachment,
    });

    // ── Post-insert notifications ────────────────────────────────────────────
    // Diverting a patient is an operational event the whole floor cares about:
    // admins for oversight, and Doctors-in-Charge because the patient may still
    // be sitting in their ER coordination queue.
    try {
      const message =
        `${patient.patient_name} has been referred to an external hospital (${hospital.name}). ` +
        `Referral ID: ${result.insertId}.`;

      const [recipients] = await db.query(
        `SELECT user_id FROM users
         WHERE is_active = 1
           AND (role = 'admin' OR (role = 'doctor' AND is_doctor_in_charge = 1))`
      );

      const notifRows = [];
      for (const recipient of recipients) {
        if (recipient.user_id !== req.user.user_id) {
          notifRows.push([recipient.user_id, message, result.insertId]);
        }
      }

      // The patient's attending doctor, if one has accepted them, should know
      // their patient is leaving — they are not necessarily an admin or a DIC.
      const [[attending]] = await db.query(
        `SELECT u.user_id
         FROM doctor_in_charge dic
         JOIN users u ON u.linked_id = dic.doctor_id AND u.role = 'doctor' AND u.is_active = 1
         WHERE dic.patient_id = ? AND dic.status = 'Accepted'
         LIMIT 1`,
        [patient.patient_id]
      );
      if (attending && attending.user_id !== req.user.user_id
          && !notifRows.some((row) => row[0] === attending.user_id)) {
        notifRows.push([attending.user_id, message, result.insertId]);
      }

      if (notifRows.length > 0) {
        await db.query('INSERT INTO notifications (user_id, message, referral_id) VALUES ?', [notifRows]);
      }
    } catch (notifErr) {
      console.warn('createExternalReferral: notification insert failed (non-fatal):', notifErr.message);
    }

  } catch (err) {
    console.error('createExternalReferral error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// GET /api/referrals/external/context?patient_id=…
// Everything the external-referral form needs in one round trip: current bed
// availability (so the form can state WHY the diversion is happening), the
// active hospital directory to choose a destination from, and the patient's
// diagnoses for the optional clinical link. Same role set as
// createExternalReferral, so nurses can open the form.
const getExternalReferralContext = async (req, res) => {
  const { patient_id } = req.query;

  try {
    const capacity = await getRoomCapacity();

    // Retired entries are excluded — createExternalReferral refuses them, so
    // offering one in the dropdown would only produce a dead end.
    const [hospitals] = await db.query(
      `SELECT hospital_id, name, contact_number, address
       FROM external_hospitals WHERE is_active = 1 ORDER BY name`
    );

    let diagnoses = [];
    if (patient_id) {
      if (req.user.role === 'doctor') {
        const denied = await assertCanAccessPatient(req, patient_id);
        if (denied) {
          return res.status(denied.status).json({ success: false, message: denied.message });
        }
      }
      const [rows] = await db.query(
        `SELECT diagnosis_id, medical_condition, diagnosis_date
         FROM diagnoses WHERE patient_id = ?
         ORDER BY diagnosis_date DESC`,
        [patient_id]
      );
      diagnoses = rows;
    }

    return res.status(200).json({ success: true, data: { capacity, hospitals, diagnoses } });
  } catch (err) {
    console.error('getExternalReferralContext error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// GET /api/referrals
const getAllReferrals = async (req, res) => {
  const { status, from_date, to_date, external, page = 1, limit = 20 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  try {
    const conditions = [];
    const params     = [];

    // Status filter
    if (status) {
      conditions.push('r.status = ?');
      params.push(status);
    }

    // Optional internal/external filter for the Referrals page tabs.
    if (external != null && external !== '') {
      conditions.push('r.is_external = ?');
      params.push(['true', '1'].includes(String(external)) ? 1 : 0);
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
    //
    // External referrals have no assigned doctor, and when a NURSE recorded one
    // no referring doctor either — the base scope alone would hide them from
    // every doctor. So a doctor also sees external referrals they recorded
    // (created_by), and a Doctor-in-Charge sees all of them, since coordinating
    // diversions is exactly the DIC role.
    if (req.user.role === 'doctor') {
      const scopeClauses = [
        'r.assigned_doctor_id = ?',
        'r.referring_doctor_id = ?',
        'r.created_by = ?',
      ];
      params.push(req.user.linked_id, req.user.linked_id, req.user.user_id);
      if (await isDoctorInCharge(req.user.user_id)) {
        scopeClauses.push('r.is_external = 1');
      }
      conditions.push(`(${scopeClauses.join(' OR ')})`);
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
         LEFT JOIN patients p ON p.patient_id = ${PATIENT_ID_EXPR}
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
              diag.medical_condition,
              CONCAT(e_cb.first_name, ' ', e_cb.last_name) AS created_by_name,
              u_cb.role AS created_by_role
       FROM referrals r
       LEFT JOIN diagnoses diag ON r.diagnosis_id = diag.diagnosis_id
       LEFT JOIN patients p ON p.patient_id = ${PATIENT_ID_EXPR}
       LEFT JOIN doctors ad ON r.assigned_doctor_id = ad.doctor_id
       LEFT JOIN doctors rd ON r.referring_doctor_id = rd.doctor_id
       LEFT JOIN users u_cb ON u_cb.user_id = r.created_by
       LEFT JOIN employees e_cb ON u_cb.linked_id = e_cb.employee_id AND u_cb.role = 'nurse'
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
      // created_by covers external referrals, which have no assigned doctor and
      // — when a nurse recorded one — no referring doctor either.
      const isParty = ref.referring_doctor_id === req.user.linked_id
        || ref.assigned_doctor_id === req.user.linked_id
        || ref.created_by === req.user.user_id;
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

  // External referrals skip 'Accepted' entirely — no doctor in THIS system
  // receives them, so there is nobody to accept. The transfer either happens
  // (Completed) or falls through (Cancelled).
  const allowedNextExternal = {
    Pending:   ['Completed', 'Cancelled'],
    Accepted:  ['Completed', 'Cancelled'],
    Completed: [],
    Cancelled: [],
  };

  try {
    // Load current state + parties for the transition/ownership checks
    const [[referral]] = await db.query(
      'SELECT status, assigned_doctor_id, referring_doctor_id, is_external, created_by FROM referrals WHERE referral_id = ?',
      [req.params.id]
    );
    if (!referral) {
      return res.status(404).json({ success: false, message: 'Referral not found.' });
    }

    const isExternal = referral.is_external === 1;

    // ── External branch: different state machine AND different ownership ──────
    // The parties are whoever arranged the transfer — the referring doctor or
    // the user who recorded it (a nurse at the intake desk). A DIC may
    // also resolve one, since they coordinate diversions.
    if (isExternal) {
      const nextOptions = allowedNextExternal[referral.status] ?? [];
      if (!nextOptions.includes(status)) {
        const message = nextOptions.length
          ? `Cannot change a ${referral.status} external referral to ${status}. Allowed next status: ${nextOptions.join(' or ')}.`
          : `This external referral is ${referral.status} and can no longer change status.`;
        return res.status(409).json({ success: false, message });
      }

      const isReferrer = req.user.role === 'doctor' && referral.referring_doctor_id === req.user.linked_id;
      const isRecorder = referral.created_by === req.user.user_id;
      const isDic      = req.user.role === 'doctor' && await isDoctorInCharge(req.user.user_id);
      if (!isReferrer && !isRecorder && !isDic) {
        return res.status(403).json({
          success: false,
          message: 'Only the nurse who arranged this transfer, or a Doctor-in-Charge, may update it.',
        });
      }

      await db.query('UPDATE referrals SET status = ? WHERE referral_id = ?', [status, req.params.id]);
      await db.query(
        "INSERT INTO activity_logs (user_id, action, target_table, target_id) VALUES (?, 'UPDATE_STATUS', 'referrals', ?)",
        [req.user.user_id, req.params.id]
      );
      return res.status(200).json({ success: true, message: `External referral marked ${status}.` });
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
       WHERE ${PATIENT_ID_EXPR} = ?
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

    // LEFT JOINs + PATIENT_ID_EXPR: an external referral may have no diagnosis,
    // and the old inner joins would have made it simply "not found" here.
    const [[referral]] = await db.query(
      `SELECT r.referral_id, r.status, r.referring_doctor_id, r.is_external,
              CONCAT(p.first_name, ' ', p.last_name) AS patient_name
       FROM referrals r
       LEFT JOIN diagnoses dx ON dx.diagnosis_id = r.diagnosis_id
       LEFT JOIN patients p ON p.patient_id = COALESCE(r.patient_id, dx.patient_id)
       WHERE r.referral_id = ?`,
      [req.params.id]
    );
    if (!referral) {
      return res.status(404).json({ success: false, message: 'Referral not found.' });
    }
    // Reassignment moves a referral between doctors in THIS system. An external
    // referral has no internal assignee; converting one would silently turn a
    // transfer-out into an internal consult.
    if (referral.is_external === 1) {
      return res.status(409).json({
        success: false,
        message: 'External referrals cannot be reassigned. Cancel it and create an internal referral instead.',
      });
    }
    if (!['Pending', 'Accepted'].includes(referral.status)) {
      return res.status(409).json({ success: false, message: 'Only Pending or Accepted referrals can be reassigned.' });
    }

    // A referral must hand the patient to a DIFFERENT doctor. Reassigning it back
    // to its own referring doctor recreates the self-referral state createReferral
    // explicitly forbids. Compare as Numbers so '3' === 3.
    if (referral.referring_doctor_id != null &&
        Number(assigned_doctor_id) === Number(referral.referring_doctor_id)) {
      return res.status(400).json({
        success: false,
        message: 'You cannot reassign a referral to its own referring doctor. Choose a different doctor.',
      });
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

module.exports = {
  createReferral,
  createExternalReferral,
  getExternalReferralContext,
  getAllReferrals,
  getReferralById,
  updateReferralStatus,
  getReferralHistory,
  reassignReferral,
};
