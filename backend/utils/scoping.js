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

module.exports = {
  ASSIGNED_PATIENTS_SUBQUERY,
  scopeToAssignedPatients,
  doctorCanAccessPatient,
};
