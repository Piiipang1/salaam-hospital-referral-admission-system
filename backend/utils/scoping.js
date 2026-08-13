const db = require('../config/db');
const { isDoctorInCharge } = require('./dic');

// The canonical definition of the patients a doctor is "assigned" to, used
// across access-control checks: patients they are the ACCEPTED attending
// doctor of, patients from referrals assigned to them, or patients they have
// admitted. A Pending doctor_in_charge row is a PROPOSAL, not an assignment —
// it grants read-only review access via READABLE_PATIENTS_SUBQUERY below,
// never write access. (INVARIANT: at most one doctor_in_charge row per
// patient, of either status.)
// The three `?` each bind the doctor_id (one per UNION branch).
const ASSIGNED_PATIENTS_SUBQUERY = `
  SELECT patient_id FROM doctor_in_charge WHERE doctor_id = ? AND status = 'Accepted'
  UNION
  SELECT d.patient_id FROM referrals r
    JOIN diagnoses d ON d.diagnosis_id = r.diagnosis_id
    WHERE r.assigned_doctor_id = ?
  UNION
  SELECT patient_id FROM admissions WHERE doctor_id = ?
`;

// Patients PROPOSED to a doctor (assignment awaiting their acceptance). The
// proposed doctor must be able to review the chart before deciding, so this
// extends the doctor's READ scope only. One `?` binding the doctor_id.
const PENDING_FOR_DOCTOR_SUBQUERY = `
  SELECT patient_id FROM doctor_in_charge WHERE doctor_id = ? AND status = 'Pending'
`;

// Read scope = assigned set ∪ pending proposals to me. Four doctor_id params.
const READABLE_PATIENTS_SUBQUERY = `
  ${ASSIGNED_PATIENTS_SUBQUERY}
  UNION
  ${PENDING_FOR_DOCTOR_SUBQUERY}
`;

/**
 * Build a WHERE-clause fragment restricting `patientColumn` to the patients a
 * doctor may SEE, for use in list queries (e.g. getAllPatients, getAllTriages).
 * Lists are reads, so this includes patients pending the doctor's acceptance —
 * they appear in lists so the doctor can review them before deciding.
 *
 * `patientColumn` is a caller-controlled SQL identifier (never user input,
 * e.g. 'p.patient_id') so it is safe to interpolate; the doctor_id is bound.
 *
 * @param {string} patientColumn  qualified patient_id column, e.g. 't.patient_id'
 * @param {number} doctorId       doctor_id (req.user.linked_id)
 * @returns {{ sql: string, params: number[] }}
 */
const scopeToAssignedPatients = (patientColumn, doctorId) => ({
  sql: `${patientColumn} IN (${READABLE_PATIENTS_SUBQUERY})`,
  params: [doctorId, doctorId, doctorId, doctorId],
});

/**
 * Whether `patientId` is in `doctorId`'s assigned-patients set. Used by detail
 * endpoints to guard against IDOR (returns 403 when false).
 *
 * Strict (write-grade) by default: a Pending proposal does NOT count. Read
 * endpoints opt in with { includePending: true } so a proposed doctor can
 * review the chart before accepting — forgetting the flag fails closed.
 *
 * @param {number} doctorId
 * @param {number|string} patientId
 * @param {{ includePending?: boolean }} [opts]
 * @returns {Promise<boolean>}
 */
const doctorCanAccessPatient = async (doctorId, patientId, { includePending = false } = {}) => {
  const subquery = includePending ? READABLE_PATIENTS_SUBQUERY : ASSIGNED_PATIENTS_SUBQUERY;
  const doctorParams = includePending
    ? [doctorId, doctorId, doctorId, doctorId]
    : [doctorId, doctorId, doctorId];
  const [[row]] = await db.query(
    `SELECT 1 AS ok FROM (${subquery}) AS assigned
     WHERE assigned.patient_id = ? LIMIT 1`,
    [...doctorParams, patientId]
  );
  return !!row;
};

// A patient is "unassigned" (no doctor coordinating their care yet) when they
// have NO doctor_in_charge row of EITHER status — a Pending proposal already
// removes them from the pool so two DICs can't double-assign — plus no
// non-discharged admission and no accepted referral. This is the extra pool an
// ER-coordinator (Doctor-in-Charge) sees on top of their own assigned
// patients. Takes no parameters.
const UNASSIGNED_PATIENTS_SUBQUERY = `
  SELECT pt.patient_id FROM patients pt
  WHERE pt.patient_id NOT IN (SELECT patient_id FROM doctor_in_charge)
    AND pt.patient_id NOT IN (
      SELECT patient_id FROM admissions
      WHERE status IN ('Pending Room', 'Active', 'Pending Discharge')
    )
    AND pt.patient_id NOT IN (
      SELECT dg.patient_id FROM referrals r
        JOIN diagnoses dg ON dg.diagnosis_id = r.diagnosis_id
        WHERE r.status = 'Accepted'
    )
`;

/**
 * WHERE-clause fragment for a Doctor-in-Charge list view: their own readable
 * patients (assigned + pending-their-acceptance) OR any currently-unassigned
 * patient OR — limbo ownership — patients whose Pending proposal THEY created
 * (the patient stays in the DIC's view as "awaiting acceptance" until the
 * proposed doctor accepts or declines).
 *
 * @param {string} patientColumn  qualified patient_id column, e.g. 't.patient_id'
 * @param {number} doctorId       doctor_id (req.user.linked_id)
 * @param {number|null} [userId]  users.user_id (req.user.user_id) — enables the
 *                                limbo branch; omit for legacy behavior.
 * @returns {{ sql: string, params: (number|string)[] }}
 */
const scopeForDoctorInCharge = (patientColumn, doctorId, userId = null) => {
  let sql = `(${patientColumn} IN (${READABLE_PATIENTS_SUBQUERY})`
          + ` OR ${patientColumn} IN (${UNASSIGNED_PATIENTS_SUBQUERY})`;
  const params = [doctorId, doctorId, doctorId, doctorId];
  if (userId != null) {
    sql += ` OR ${patientColumn} IN (
      SELECT patient_id FROM doctor_in_charge WHERE status = 'Pending' AND assigned_by = ?
    )`;
    params.push(userId);
  }
  sql += ')';
  return { sql, params };
};

/**
 * WHERE-clause fragment restricting `patientColumn` to currently-unassigned
 * patients. AND-composes safely with any role's base scope (a patient can't be
 * both assigned-to-me and unassigned), so it works as a plain list filter.
 * Takes no bind parameters.
 */
const unassignedPatientsCondition = (patientColumn) => ({
  sql: `${patientColumn} IN (${UNASSIGNED_PATIENTS_SUBQUERY})`,
  params: [],
});

/** Whether `patientId` currently has no doctor coordinating their care. */
const isPatientUnassigned = async (patientId) => {
  const [[row]] = await db.query(
    `SELECT 1 AS ok FROM (${UNASSIGNED_PATIENTS_SUBQUERY}) AS unassigned
     WHERE unassigned.patient_id = ? LIMIT 1`,
    [patientId]
  );
  return !!row;
};

/** Whether `userId` (a DIC) created the patient's current Pending proposal. */
const dicHasPendingProposalFor = async (userId, patientId) => {
  const [[row]] = await db.query(
    `SELECT 1 AS ok FROM doctor_in_charge
     WHERE patient_id = ? AND status = 'Pending' AND assigned_by = ? LIMIT 1`,
    [patientId, userId]
  );
  return !!row;
};

/**
 * Detail-endpoint guard for a Doctor-in-Charge: allowed if the patient is one
 * of the DIC's own patients, OR is currently unassigned, OR — limbo ownership —
 * has a Pending proposal created by this DIC (`userId`). The DIC keeps full
 * clinical access to a patient they proposed until the assignment is accepted
 * or declined; once ACCEPTED the patient leaves all three branches and the DIC
 * loses access (unless also their referral/admitting doctor).
 *
 * @param {number} doctorId
 * @param {number|string} patientId
 * @param {{ userId?: number|null, includePending?: boolean }} [opts]
 */
const doctorInChargeCanAccessPatient = async (doctorId, patientId, { userId = null, includePending = false } = {}) =>
  (await doctorCanAccessPatient(doctorId, patientId, { includePending }))
  || (await isPatientUnassigned(patientId))
  || (userId != null && await dicHasPendingProposalFor(userId, patientId));

// ── Nurse access to a patient's MEDICAL RECORD ───────────────────────────────
// Custody, not authorship. A nurse may open a record when they currently hold
// the patient (an active nurse_assignments row), NOT because they happened to
// register them months ago. The registration fallback exists only for the gap
// between intake and the first assignment — the intake nurse must be able to
// finish what they started.
//
// THE RULE, applied everywhere for role === 'nurse':
//   (a) an ACTIVE assignment for this patient names me                → allow
//   (b) NO active assignment exists at all AND I registered them,
//       OR I received them back as a returning discharged patient
//       (activity_logs action='RECEIVE_RETURNING', see
//       nursing.controller receiveReturningPatient)                   → allow
//   otherwise                                                        → deny
//
// Clause (b) switches OFF the moment ANY nurse holds the patient — not just
// when I do. That is what makes the endorsement handoff actually transfer
// access: once Nurse 2 acknowledges, Nurse 1 loses the record even though
// activity_logs still shows they registered the patient.
//
// This does NOT govern ward presence (nursing.controller getWardPatients stays
// department-scoped so every ward nurse still sees who is in which bed).
//
// req.user.linked_id is the nurse's employees.employee_id; registration is
// recorded against req.user.user_id — the two are different keys, which is why
// both are needed.

/**
 * @param {object} req Express request (reads req.user.linked_id / user_id)
 * @param {number|string} patientId
 * @returns {Promise<boolean>}
 */
const nurseCanAccessPatient = async (req, patientId) => {
  const [[flags]] = await db.query(
    `SELECT
       EXISTS(SELECT 1 FROM nurse_assignments
               WHERE patient_id = ? AND released_at IS NULL AND nurse_id = ?) AS assigned_to_me,
       EXISTS(SELECT 1 FROM nurse_assignments
               WHERE patient_id = ? AND released_at IS NULL)                  AS any_active,
       EXISTS(SELECT 1 FROM activity_logs
               WHERE user_id = ? AND action IN ('CREATE', 'RECEIVE_RETURNING') AND target_table = 'patients'
                 AND CAST(target_id AS UNSIGNED) = ?)                         AS i_registered`,
    [patientId, req.user.linked_id, patientId, req.user.user_id, patientId]
  );
  return !!flags.assigned_to_me || (!flags.any_active && !!flags.i_registered);
};

/**
 * List-scope form of the same rule, for WHERE clauses.
 * Returns { sql, params } to AND into a query.
 *
 * The NOT IN on the registration branch is what enforces clause (b): a patient
 * someone else now holds drops out of my list even if I registered them.
 *
 * @param {string} patientColumn e.g. 'p.patient_id'
 * @param {number} nurseEmployeeId req.user.linked_id
 * @param {number} nurseUserId     req.user.user_id
 */
const scopeToNurseAccessiblePatients = (patientColumn, nurseEmployeeId, nurseUserId) => ({
  sql: `${patientColumn} IN (
          SELECT patient_id FROM nurse_assignments
           WHERE released_at IS NULL AND nurse_id = ?
          UNION
          SELECT CAST(target_id AS UNSIGNED) FROM activity_logs
           WHERE user_id = ? AND action IN ('CREATE', 'RECEIVE_RETURNING') AND target_table = 'patients'
             AND CAST(target_id AS UNSIGNED) NOT IN (
                   SELECT patient_id FROM nurse_assignments WHERE released_at IS NULL
                 )
        )`,
  params: [nurseEmployeeId, nurseUserId],
});

/**
 * Per-patient access guard, mirroring patients.controller getPatientById exactly,
 * for any detail/mutation handler that has already resolved a patient_id. Keeps
 * the same policy (and the same two 403 messages) in one place instead of
 * copy-pasting it across the diagnoses/referrals handlers.
 *
 * Returns null when access is allowed, or a { status, message } object to send
 * when denied. Roles other than doctor/nurse fall through as allowed —
 * the clinical routes already gate which roles can reach these handlers.
 *
 * Pass { forWrite: true } from mutation handlers: a Pending assignment proposal
 * grants the proposed doctor READ access only — any clinical write requires
 * having accepted (or one of the referral/admission relationships).
 *
 * @param {object} req        Express request (reads req.user.role/user_id/linked_id)
 * @param {number|string} patientId
 * @param {{ forWrite?: boolean }} [opts]
 * @returns {Promise<null | { status: number, message: string }>}
 */
const assertCanAccessPatient = async (req, patientId, { forWrite = false } = {}) => {
  if (req.user.role === 'doctor') {
    // ASSIGNED_PATIENTS_SUBQUERY includes referral-assigned patients regardless
    // of referral status, so a doctor can open a diagnosis attached to a referral
    // assigned to them before accepting it.
    const includePending = !forWrite;
    const allowed = (await isDoctorInCharge(req.user.user_id))
      ? await doctorInChargeCanAccessPatient(req.user.linked_id, patientId, { userId: req.user.user_id, includePending })
      : await doctorCanAccessPatient(req.user.linked_id, patientId, { includePending });
    return allowed ? null : { status: 403, message: 'You are not assigned to this patient.' };
  }

  if (req.user.role === 'nurse') {
    const allowed = await nurseCanAccessPatient(req, patientId);
    return allowed ? null : { status: 403, message: 'You do not have access to this patient record.' };
  }

  return null;
};

module.exports = {
  ASSIGNED_PATIENTS_SUBQUERY,
  UNASSIGNED_PATIENTS_SUBQUERY,
  PENDING_FOR_DOCTOR_SUBQUERY,
  dicHasPendingProposalFor,
  scopeToAssignedPatients,
  doctorCanAccessPatient,
  scopeForDoctorInCharge,
  unassignedPatientsCondition,
  isPatientUnassigned,
  doctorInChargeCanAccessPatient,
  assertCanAccessPatient,
  nurseCanAccessPatient,
  scopeToNurseAccessiblePatients,
};
