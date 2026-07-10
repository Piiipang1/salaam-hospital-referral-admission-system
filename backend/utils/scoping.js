const db = require('../config/db');

// The canonical definition of the patients a doctor is "assigned" to, used
// across access-control checks: patients they are doctor-in-charge of, patients
// from referrals assigned to them, or patients they have admitted.
// The three `?` each bind the doctor_id (one per UNION branch).
const ASSIGNED_PATIENTS_SUBQUERY = `
  SELECT patient_id FROM doctor_in_charge WHERE doctor_id = ?
  UNION
  SELECT d.patient_id FROM referrals r
    JOIN diagnoses d ON d.diagnosis_id = r.diagnosis_id
    WHERE r.assigned_doctor_id = ?
  UNION
  SELECT patient_id FROM admissions WHERE doctor_id = ?
`;

/**
 * Build a WHERE-clause fragment restricting `patientColumn` to a doctor's
 * assigned patients, for use in list queries (e.g. getAllPatients,
 * getAllTriages).
 *
 * `patientColumn` is a caller-controlled SQL identifier (never user input,
 * e.g. 'p.patient_id') so it is safe to interpolate; the doctor_id is bound.
 *
 * @param {string} patientColumn  qualified patient_id column, e.g. 't.patient_id'
 * @param {number} doctorId       doctor_id (req.user.linked_id)
 * @returns {{ sql: string, params: number[] }}
 */
const scopeToAssignedPatients = (patientColumn, doctorId) => ({
  sql: `${patientColumn} IN (${ASSIGNED_PATIENTS_SUBQUERY})`,
  params: [doctorId, doctorId, doctorId],
});

/**
 * Whether `patientId` is in `doctorId`'s assigned-patients set. Used by detail
 * endpoints to guard against IDOR (returns 403 when false).
 *
 * @param {number} doctorId
 * @param {number|string} patientId
 * @returns {Promise<boolean>}
 */
const doctorCanAccessPatient = async (doctorId, patientId) => {
  const [[row]] = await db.query(
    `SELECT 1 AS ok FROM (${ASSIGNED_PATIENTS_SUBQUERY}) AS assigned
     WHERE assigned.patient_id = ? LIMIT 1`,
    [doctorId, doctorId, doctorId, patientId]
  );
  return !!row;
};

// A patient is "unassigned" (no doctor coordinating their care yet) when they
// have no doctor_in_charge row, no non-discharged admission, and no accepted
// referral. This is the extra pool an ER-coordinator (Doctor-in-Charge) sees
// on top of their own assigned patients. Takes no parameters.
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
 * WHERE-clause fragment for a Doctor-in-Charge: their own assigned patients
 * OR any currently-unassigned patient. Once the DIC assigns another doctor,
 * that patient gains a doctor_in_charge row and drops out of the unassigned
 * pool (leaving the DIC's view unless the DIC assigned themselves).
 *
 * @param {string} patientColumn  qualified patient_id column, e.g. 't.patient_id'
 * @param {number} doctorId       doctor_id (req.user.linked_id)
 * @returns {{ sql: string, params: number[] }}
 */
const scopeForDoctorInCharge = (patientColumn, doctorId) => ({
  sql: `(${patientColumn} IN (${ASSIGNED_PATIENTS_SUBQUERY})`
     + ` OR ${patientColumn} IN (${UNASSIGNED_PATIENTS_SUBQUERY}))`,
  params: [doctorId, doctorId, doctorId],
});

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

/**
 * Detail-endpoint guard for a Doctor-in-Charge: allowed if the patient is one
 * of the DIC's own assigned patients OR is currently unassigned.
 */
const doctorInChargeCanAccessPatient = async (doctorId, patientId) =>
  (await doctorCanAccessPatient(doctorId, patientId)) || (await isPatientUnassigned(patientId));

module.exports = {
  ASSIGNED_PATIENTS_SUBQUERY,
  UNASSIGNED_PATIENTS_SUBQUERY,
  scopeToAssignedPatients,
  doctorCanAccessPatient,
  scopeForDoctorInCharge,
  unassignedPatientsCondition,
  isPatientUnassigned,
  doctorInChargeCanAccessPatient,
};
