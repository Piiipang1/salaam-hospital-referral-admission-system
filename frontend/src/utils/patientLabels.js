import { toInputDate } from './formatDate';

/**
 * Human-readable patient labels for pickers (datalists, dropdowns).
 * Numeric patient IDs must never be shown to end users, but combobox
 * labels still need to be unique so a typed label can be resolved back
 * to exactly one patient — when two patients share a full name, the
 * date of birth is appended to disambiguate.
 */

const fullName = (p) => `${p.first_name} ${p.last_name}`;

/**
 * Display label for patient `p`, unique within `patients`.
 * "Juan Cruz" — or "Juan Cruz (DOB: 1990-05-14)" when another patient
 * in the list shares the same full name.
 */
export const patientLabel = (p, patients = []) => {
  const name = fullName(p);
  const hasDuplicate = patients.some(
    (other) => other.patient_id !== p.patient_id && fullName(other) === name
  );
  return hasDuplicate && p.date_of_birth
    ? `${name} (DOB: ${toInputDate(p.date_of_birth)})`
    : name;
};

/** Resolve a typed combobox label back to its patient record (exact match). */
export const findPatientByLabel = (patients, label) =>
  patients.find((p) => patientLabel(p, patients) === label);
