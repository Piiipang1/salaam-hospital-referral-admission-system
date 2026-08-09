const db = require('../config/db');

// ── Automatic OPD clinic routing ─────────────────────────────────────────────
// Given the admission being discharged, decide which outpatient clinic the
// follow-up belongs to. The rule is deliberately explainable: every result
// carries the basis it was chosen on, so a wrong routing can be diagnosed from
// the record rather than guessed at.
//
// Order of preference:
//   1. the attending doctor's specialization → the clinic carrying that
//      specialization. Whoever managed the admission is who should review it.
//   2. the admission_type → a clinic by specialization (Surgical → Surgery,
//      Pediatric → Pediatrics, Maternity → OB-GYN…). Covers admissions whose
//      doctor has a specialization with no clinic of its own.
//   3. the default clinic (is_default = 1).

// admission_type values come from ADMISSION_TYPES in the frontend constants and
// are free text in the DB, so the lookup is case-insensitive.
const ADMISSION_TYPE_SPECIALIZATION = {
  surgical:  'Surgery',
  pediatric: 'Pediatrics',
  maternity: 'Obstetrics and Gynecology',
  emergency: 'Emergency Medicine',
  medical:   'Internal Medicine',
  elective:  'General Medicine',
};

const DEFAULT_FOLLOWUP_DAYS = 7;

/** ISO date (YYYY-MM-DD) `days` from today — the default follow-up date. */
const defaultFollowupDate = (days = DEFAULT_FOLLOWUP_DAYS) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

/**
 * Resolve the clinic for an admission.
 * @param {{specialization?: string, admission_type?: string}} admission
 * @param {object} executor — pooled connection, so this can run inside the
 *   discharge transaction rather than on a second connection that cannot see it.
 * @returns {{clinic_id, name, basis}|null} null only when no clinic exists at all.
 */
const resolveClinicForAdmission = async (admission, executor = db) => {
  // 1. Attending doctor's specialization
  if (admission?.specialization) {
    const [[bySpec]] = await executor.query(
      'SELECT clinic_id, name FROM opd_clinics WHERE is_active = 1 AND specialization = ? LIMIT 1',
      [admission.specialization]
    );
    if (bySpec) {
      return { ...bySpec, basis: `specialization: ${admission.specialization}` };
    }
  }

  // 2. Admission type
  const typeKey = String(admission?.admission_type ?? '').trim().toLowerCase();
  const mappedSpec = ADMISSION_TYPE_SPECIALIZATION[typeKey];
  if (mappedSpec) {
    const [[byType]] = await executor.query(
      'SELECT clinic_id, name FROM opd_clinics WHERE is_active = 1 AND specialization = ? LIMIT 1',
      [mappedSpec]
    );
    if (byType) {
      return { ...byType, basis: `admission type: ${admission.admission_type}` };
    }
  }

  // 3. Catch-all
  const [[fallback]] = await executor.query(
    `SELECT clinic_id, name FROM opd_clinics
     WHERE is_active = 1 ORDER BY is_default DESC, clinic_id LIMIT 1`
  );
  return fallback ? { ...fallback, basis: 'default clinic' } : null;
};

/**
 * Validate a caller-supplied clinic id. Returns the clinic, or null when the id
 * is unknown or the clinic is retired — the caller turns that into a 400 rather
 * than silently falling back, so a nurse's explicit choice is never quietly
 * replaced with a different one.
 */
const getActiveClinic = async (clinicId, executor = db) => {
  const [[clinic]] = await executor.query(
    'SELECT clinic_id, name FROM opd_clinics WHERE clinic_id = ? AND is_active = 1',
    [clinicId]
  );
  return clinic ?? null;
};

// A follow-up date in the past is almost always a typo, and one years out is
// not a real appointment. Returns an error string, or null when acceptable.
const validateFollowupDate = (value) => {
  if (!value) return 'A follow-up date is required to discharge this patient.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return 'Follow-up date must be a valid date (YYYY-MM-DD).';

  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return 'Follow-up date must be a valid date.';

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (date < today) return 'Follow-up date cannot be in the past.';

  const limit = new Date(today);
  limit.setFullYear(limit.getFullYear() + 1);
  if (date > limit) return 'Follow-up date cannot be more than a year ahead.';

  return null;
};

module.exports = {
  ADMISSION_TYPE_SPECIALIZATION,
  DEFAULT_FOLLOWUP_DAYS,
  defaultFollowupDate,
  resolveClinicForAdmission,
  getActiveClinic,
  validateFollowupDate,
};
