const db = require('../config/db');
const { getNurseContext, requireNurseDepartment, OCCUPYING_STATUSES, isDischargedTriageDepartment } = require('../utils/nursing');

// ── Ward roster + patient-to-nurse assignments ───────────────────────────────
// A nurse's ward is derived, never hand-maintained: patient → admission → room
// → department. On top of that derived list sits an explicit assignment saying
// which nurse is personally responsible for which patient this shift.

// The ward roster row shape, shared by the ward list and the endorsement form
// so both always show the same facts about a patient.
const WARD_PATIENT_COLUMNS = `
  a.admission_id,
  a.status        AS admission_status,
  a.admission_date,
  p.patient_id,
  CONCAT(p.first_name, ' ', p.last_name) AS patient_name,
  p.sex,
  p.date_of_birth,
  p.is_unidentified,
  r.room_id,
  r.bed_number,
  r.room_type,
  na.assignment_id,
  na.nurse_id      AS assigned_nurse_id,
  na.assigned_at,
  CONCAT(en.first_name, ' ', en.last_name) AS assigned_nurse_name,
  lt.triage_level,
  ld.medical_condition
`;

// Single-row ordered subqueries for "latest triage"/"latest diagnosis" — a bare
// JOIN would multiply the row out once per historical record.
const WARD_PATIENT_JOINS = `
  FROM admissions a
  JOIN patients p ON p.patient_id = a.patient_id
  JOIN rooms    r ON r.room_id    = a.room_id
  LEFT JOIN nurse_assignments na
         ON na.patient_id = p.patient_id AND na.released_at IS NULL
  LEFT JOIN employees en ON en.employee_id = na.nurse_id
  LEFT JOIN triages lt ON lt.triage_id = (
    SELECT t.triage_id FROM triages t
    WHERE t.patient_id = p.patient_id
    ORDER BY t.triage_datetime DESC LIMIT 1
  )
  LEFT JOIN diagnoses ld ON ld.diagnosis_id = (
    SELECT dg.diagnosis_id FROM diagnoses dg
    WHERE dg.patient_id = p.patient_id
    ORDER BY dg.diagnosis_date DESC LIMIT 1
  )
`;

// GET /api/nursing/me — who am I, which ward, and how much is on my plate.
// Never 409s on a missing department: this is the endpoint the UI uses to find
// out whether a department is missing in the first place.
const getMyNursingContext = async (req, res) => {
  try {
    const nurse = await getNurseContext(req.user.user_id, req.user.linked_id);
    if (!nurse) {
      return res.status(403).json({ success: false, message: 'No employee record is linked to this account.' });
    }

    let wardPatients = 0;
    let myPatients = 0;
    let pendingEndorsements = 0;

    if (nurse.department_id) {
      const [[counts]] = await db.query(
        `SELECT
           (SELECT COUNT(*) FROM admissions a
              JOIN rooms r ON r.room_id = a.room_id
             WHERE r.department_id = ? AND a.status IN (?)) AS ward_patients,
           (SELECT COUNT(*) FROM nurse_assignments
             WHERE nurse_id = ? AND released_at IS NULL) AS my_patients,
           (SELECT COUNT(*) FROM endorsements
             WHERE to_nurse_id = ? AND status = 'Pending') AS pending_endorsements`,
        [nurse.department_id, OCCUPYING_STATUSES, nurse.employee_id, nurse.employee_id]
      );
      wardPatients        = Number(counts.ward_patients);
      myPatients          = Number(counts.my_patients);
      pendingEndorsements = Number(counts.pending_endorsements);
    }

    return res.status(200).json({
      success: true,
      data: {
        employee_id:     nurse.employee_id,
        nurse_name:      `${nurse.first_name} ${nurse.last_name}`,
        department_id:   nurse.department_id,
        department_name: nurse.department_name,
        ward_patients:        wardPatients,
        my_patients:          myPatients,
        pending_endorsements: pendingEndorsements,
        // UI hint only — createTriage re-checks this server-side, so this can
        // never be the actual authorization boundary, only what drives the
        // "+ Triage" button for a discharged patient. false when unassigned.
        can_triage_discharged: isDischargedTriageDepartment(nurse.department_name),
      },
    });
  } catch (err) {
    console.error('getMyNursingContext error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// GET /api/nursing/ward?mine=true — patients currently in my ward.
// `mine=true` narrows to the ones assigned to me.
const getWardPatients = async (req, res) => {
  try {
    const nurse = await requireNurseDepartment(req, res);
    if (!nurse) return;

    const mineOnly = ['true', '1'].includes(String(req.query.mine));

    const [rows] = await db.query(
      `SELECT ${WARD_PATIENT_COLUMNS}
       ${WARD_PATIENT_JOINS}
       WHERE r.department_id = ?
         AND a.status IN (?)
         ${mineOnly ? 'AND na.nurse_id = ?' : ''}
       ORDER BY FIELD(lt.triage_level, 'Critical', 'Urgent', 'Non-Urgent'), r.bed_number`,
      mineOnly
        ? [nurse.department_id, OCCUPYING_STATUSES, nurse.employee_id]
        : [nurse.department_id, OCCUPYING_STATUSES]
    );

    // Presence vs. record. Every ward nurse legitimately sees WHO is in WHICH
    // bed — that is what this list is for. The diagnosis text is medical record,
    // and only the nurse holding the patient should read it here.
    //
    // Masked in JS after the query rather than in the SELECT because
    // WARD_PATIENT_COLUMNS / WARD_PATIENT_JOINS are shared with other callers.
    // triage_level is deliberately KEPT for everyone: acuity is operational
    // safety information — any nurse on the floor needs to know who is Critical.
    const visible = rows.map((row) => (
      Number(row.assigned_nurse_id) === Number(nurse.employee_id)
        ? row
        : { ...row, medical_condition: null }
    ));

    return res.status(200).json({
      success: true,
      data: visible,
      department: { department_id: nurse.department_id, department_name: nurse.department_name },
    });
  } catch (err) {
    console.error('getWardPatients error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// GET /api/nursing/colleagues — active nurses in my ward, excluding me.
// Powers the "hand off to" picker; a handoff to yourself is not a handoff.
const getWardNurses = async (req, res) => {
  try {
    const nurse = await requireNurseDepartment(req, res);
    if (!nurse) return;

    const [rows] = await db.query(
      `SELECT e.employee_id, e.first_name, e.last_name,
              (SELECT COUNT(*) FROM nurse_assignments na
                WHERE na.nurse_id = e.employee_id AND na.released_at IS NULL) AS current_patients
       FROM employees e
       JOIN users u ON u.linked_id = e.employee_id AND u.role = 'nurse' AND u.is_active = 1
       WHERE e.department_id = ?
         AND e.employment_status = 'Active'
         AND e.employee_id <> ?
       ORDER BY e.first_name, e.last_name`,
      [nurse.department_id, nurse.employee_id]
    );

    return res.status(200).json({ success: true, data: rows });
  } catch (err) {
    console.error('getWardNurses error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// POST /api/nursing/assignments  { patient_id, nurse_id? }
// Take responsibility for a patient in my ward, or hand it to a colleague in
// the same ward. Omitting nurse_id means "me".
const assignPatient = async (req, res) => {
  const { patient_id, nurse_id } = req.body;

  if (!patient_id) {
    return res.status(400).json({ success: false, message: 'patient_id is required.' });
  }

  try {
    const nurse = await requireNurseDepartment(req, res);
    if (!nurse) return;

    // The patient must actually be in a bed in MY ward — this is what stops a
    // nurse claiming patients from another department.
    const [[admission]] = await db.query(
      `SELECT a.admission_id, a.patient_id, r.department_id,
              CONCAT(p.first_name, ' ', p.last_name) AS patient_name
       FROM admissions a
       JOIN rooms r    ON r.room_id = a.room_id
       JOIN patients p ON p.patient_id = a.patient_id
       WHERE a.patient_id = ? AND a.status IN (?)
       LIMIT 1`,
      [patient_id, OCCUPYING_STATUSES]
    );
    if (!admission) {
      return res.status(404).json({ success: false, message: 'That patient is not currently admitted to a bed.' });
    }
    if (Number(admission.department_id) !== Number(nurse.department_id)) {
      return res.status(403).json({ success: false, message: 'That patient is in another department.' });
    }

    // Target nurse defaults to me; a colleague must be in the same ward.
    let targetNurseId = nurse.employee_id;
    if (nurse_id && Number(nurse_id) !== Number(nurse.employee_id)) {
      const [[colleague]] = await db.query(
        `SELECT employee_id FROM employees
         WHERE employee_id = ? AND department_id = ? AND employment_status = 'Active'`,
        [nurse_id, nurse.department_id]
      );
      if (!colleague) {
        return res.status(400).json({ success: false, message: 'That nurse is not an active member of your department.' });
      }
      targetNurseId = colleague.employee_id;
    }

    // Reassignment releases the incumbent first. Done in a transaction so the
    // patient is never left with two active nurses or none — the unique key on
    // active_patient_id would reject the second insert anyway, but this makes
    // the intended reassignment succeed rather than fail.
    const connection = await db.getConnection();
    await connection.beginTransaction();
    try {
      const [[current]] = await connection.query(
        `SELECT assignment_id, nurse_id FROM nurse_assignments
         WHERE patient_id = ? AND released_at IS NULL LIMIT 1 FOR UPDATE`,
        [admission.patient_id]
      );

      if (current && Number(current.nurse_id) === Number(targetNurseId)) {
        await connection.rollback();
        connection.release();
        return res.status(409).json({ success: false, message: 'That patient is already assigned to this nurse.' });
      }

      if (current) {
        await connection.query(
          "UPDATE nurse_assignments SET released_at = NOW(), release_reason = 'Reassigned' WHERE assignment_id = ?",
          [current.assignment_id]
        );
      }

      await connection.query(
        `INSERT INTO nurse_assignments (patient_id, nurse_id, department_id, admission_id, assigned_by)
         VALUES (?, ?, ?, ?, ?)`,
        [admission.patient_id, targetNurseId, nurse.department_id, admission.admission_id, req.user.user_id]
      );

      await connection.query(
        "INSERT INTO activity_logs (user_id, action, target_table, target_id) VALUES (?, 'ASSIGN_NURSE', 'nurse_assignments', ?)",
        [req.user.user_id, admission.patient_id]
      );

      await connection.commit();
      connection.release();
    } catch (txErr) {
      await connection.rollback();
      connection.release();
      throw txErr;
    }

    const mine = Number(targetNurseId) === Number(nurse.employee_id);
    return res.status(201).json({
      success: true,
      message: mine
        ? `You are now responsible for ${admission.patient_name}.`
        : `${admission.patient_name} assigned.`,
    });
  } catch (err) {
    console.error('assignPatient error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// DELETE /api/nursing/assignments/:patientId — give up responsibility.
// Restricted to the assigned nurse: a nurse must not be able to quietly drop a
// colleague's patient. Reassigning (POST above) is the way to move one.
const releasePatient = async (req, res) => {
  try {
    const nurse = await requireNurseDepartment(req, res);
    if (!nurse) return;

    const [[current]] = await db.query(
      `SELECT na.assignment_id, na.nurse_id,
              CONCAT(p.first_name, ' ', p.last_name) AS patient_name
       FROM nurse_assignments na
       JOIN patients p ON p.patient_id = na.patient_id
       WHERE na.patient_id = ? AND na.released_at IS NULL
       LIMIT 1`,
      [req.params.patientId]
    );
    if (!current) {
      return res.status(404).json({ success: false, message: 'That patient is not currently assigned to anyone.' });
    }
    if (Number(current.nurse_id) !== Number(nurse.employee_id)) {
      return res.status(403).json({ success: false, message: 'That patient is assigned to another nurse.' });
    }

    await db.query(
      "UPDATE nurse_assignments SET released_at = NOW(), release_reason = 'Released' WHERE assignment_id = ?",
      [current.assignment_id]
    );
    await db.query(
      "INSERT INTO activity_logs (user_id, action, target_table, target_id) VALUES (?, 'RELEASE_NURSE', 'nurse_assignments', ?)",
      [req.user.user_id, req.params.patientId]
    );

    return res.status(200).json({ success: true, message: `You are no longer responsible for ${current.patient_name}.` });
  } catch (err) {
    console.error('releasePatient error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// POST /api/nursing/returning-patient  { patient_id }
// A discharged patient walking back in belongs to no active assignment and was
// (most likely) registered months ago by someone else — this is the front
// door's way of taking custody of that record without touching the original
// registration or creating a nurse_assignments row (that stays reserved for
// patients physically admitted to a bed).
const receiveReturningPatient = async (req, res) => {
  const { patient_id } = req.body;

  if (!patient_id) {
    return res.status(400).json({ success: false, message: 'patient_id is required.' });
  }

  try {
    const nurse = await requireNurseDepartment(req, res);
    if (!nurse) return;

    // Same "Discharged" definition as CARE_STATUS_EXPR in patients.controller
    // and the discharged gate in triages.controller createTriage: no ongoing
    // admission AND at least one admission that reached 'Discharged'.
    const [[patient]] = await db.query(
      `SELECT p.patient_id, CONCAT(p.first_name, ' ', p.last_name) AS patient_name,
         NOT EXISTS (
           SELECT 1 FROM admissions ad
           WHERE ad.patient_id = p.patient_id
             AND ad.status IN ('Pending Room','Active','Pending Discharge')
         ) AS no_ongoing_admission,
         EXISTS (
           SELECT 1 FROM admissions ad
           WHERE ad.patient_id = p.patient_id AND ad.status = 'Discharged'
         ) AS has_discharged_admission
       FROM patients p
       WHERE p.patient_id = ?`,
      [patient_id]
    );
    if (!patient) {
      return res.status(404).json({ success: false, message: 'Patient not found.' });
    }

    const isDischarged = !!patient.no_ongoing_admission && !!patient.has_discharged_admission;
    if (!isDischarged) {
      return res.status(409).json({
        success: false,
        message: 'This patient has an ongoing admission and is not a returning patient.',
      });
    }

    await db.query(
      "INSERT INTO activity_logs (user_id, action, target_table, target_id) VALUES (?, 'RECEIVE_RETURNING', 'patients', ?)",
      [req.user.user_id, patient_id]
    );

    return res.status(200).json({
      success: true,
      message: `You now have access to ${patient.patient_name}'s record.`,
      patient_id: patient.patient_id,
    });
  } catch (err) {
    console.error('receiveReturningPatient error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

module.exports = {
  getMyNursingContext,
  getWardPatients,
  getWardNurses,
  assignPatient,
  releasePatient,
  receiveReturningPatient,
  WARD_PATIENT_COLUMNS,
  WARD_PATIENT_JOINS,
};
