import { toInputDate, formatDate, calcAge } from './formatDate';

/**
 * Human-readable patient labels for pickers (datalists, dropdowns).
 * Numeric patient IDs must never be shown to end users, but combobox
 * labels still need to be unique so a typed label can be resolved back
 * to exactly one patient — when two patients share a full name, the
 * date of birth is appended to disambiguate.
 */

const fullName = (p) => `${p.first_name} ${p.last_name}`;

// Emergency triage creates placeholder patients with intentional server-side
// sentinels: is_unidentified=1, date_of_birth '1900-01-01', sex 'Other', name
// "Unknown Patient-<timestamp>-<rand>". The frontend must never surface these
// as a real ~126-year-old / 1900 birth date. The helpers below map them to
// "Unknown" and drive the Unidentified badge.

/** True when a patient record is an unidentified emergency placeholder. */
export const isUnidentifiedPatient = (p) =>
  !!p?.is_unidentified || String(p?.date_of_birth ?? '').startsWith('1900-01-01');

/**
 * True when a display name matches the emergency-triage sentinel shape.
 * Used where only the composed name is available (e.g. the triage detail
 * endpoint returns patient_name but not the is_unidentified flag).
 */
export const isUnidentifiedName = (name) => /^Unknown Patient-\d/.test(name ?? '');

/** Age for display: 'Unknown' for unidentified placeholders, else the real age. */
export const formatPatientAge = (p) =>
  isUnidentifiedPatient(p) ? 'Unknown' : calcAge(p?.date_of_birth);

/** Date of birth for display: 'Unknown' for placeholders, else formatted date. */
export const formatPatientDob = (p) =>
  isUnidentifiedPatient(p) ? 'Unknown' : formatDate(p?.date_of_birth);

/** Sex for display: 'Unknown' for placeholders (sentinel 'Other'), else the value. */
export const formatPatientSex = (p) =>
  (isUnidentifiedPatient(p) || p?.sex === 'Other') ? 'Unknown' : p?.sex;

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
  return hasDuplicate && p.date_of_birth && !isUnidentifiedPatient(p)
    ? `${name} (DOB: ${toInputDate(p.date_of_birth)})`
    : name;
};

/** Resolve a typed combobox label back to its patient record (exact match). */
export const findPatientByLabel = (patients, label) =>
  patients.find((p) => patientLabel(p, patients) === label);
