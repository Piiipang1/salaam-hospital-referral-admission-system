// Shared constants sourced from backend ENUM definitions (schema.sql + controllers)

export const TRIAGE_LEVELS = ['Critical', 'Urgent', 'Non-Urgent'];

export const REFERRAL_STATUSES = ['Pending', 'Accepted', 'Completed', 'Cancelled'];

export const ADMISSION_STATUSES = ['Pending Room', 'Active', 'Pending Discharge', 'Discharged'];

export const ROOM_TYPES = ['General Ward', 'Private Room', 'ICU', 'Pediatric Ward', 'Emergency Room'];

export const ROOM_AVAILABILITY = ['available', 'occupied'];

export const ADMISSION_TYPES = ['Emergency', 'Medical', 'Surgical', 'Pediatric', 'Maternity', 'Elective'];

// 'Other' exists in the DB ENUM only as the internal placeholder sentinel for
// unidentified emergency patients — never offered as a user-selectable value.
export const PATIENT_SEX = ['Male', 'Female'];

export const USER_ROLES = ['admin', 'doctor', 'nurse'];

export const EMPLOYMENT_STATUSES = ['Active', 'Inactive'];

// Maps status values to CSS color variable names
export const STATUS_COLORS = {
  // Triage
  Critical:   'danger',
  Urgent:     'warning',
  'Non-Urgent': 'success',
  // Referral
  Pending:    'warning',
  Accepted:   'info',
  Completed:  'success',
  Cancelled:  'muted',
  // Admission
  'Pending Room':      'warning',
  Active:              'primary',
  'Pending Discharge': 'info',
  Discharged:          'muted',
  // Room
  available:  'success',
  occupied:   'danger',
  // Doctor assessment disposition
  Admit:      'primary',
  Discharge:  'success',
  Refer:      'info',
  Observe:    'warning',
  // Visit type
  Inpatient:  'info',
  Outpatient: 'success',
  // OPD follow-up (Completed / Cancelled reuse the referral colours above)
  Scheduled:  'info',
  Missed:     'danger',
  // Patient care status — the doctor's at-a-glance badge. Admitted reuses the
  // 'Active' primary colour so a patient in a bed reads the same on every
  // screen; 'Discharged' is already mapped to muted under Admission above.
  Admitted:   'primary',
  Waiting:    'warning',
};

// ── Patient care status ──────────────────────────────────────────────────────
// Derived server-side from admissions (patients.controller CARE_STATUS_EXPR) —
// never stored, so it cannot drift from the admission it describes.
export const CARE_STATUSES = ['Admitted', 'Waiting', 'Discharged'];

// ── OPD follow-ups ───────────────────────────────────────────────────────────
// Matches the `status` ENUM on opd_followups. Only a Scheduled follow-up can
// change state; Completed and Cancelled are terminal.
export const OPD_STATUSES = ['Scheduled', 'Completed', 'Missed', 'Cancelled'];

// Role display labels
export const ROLE_LABELS = {
  admin:  'Administrator',
  doctor: 'Doctor',
  nurse:  'Nurse',
};

export const API_BASE = '/api';
export const NOTIFICATION_POLL_MS = 30000; // 30 seconds

// ── Capacity ─────────────────────────────────────────────────────────────────
// Shown when zero beds are available. Must stay in sync with
// AT_CAPACITY_MESSAGE in backend/utils/capacity.js, which the API returns for
// registration / triage / admission attempts made while at capacity.
export const NO_ROOMS_MESSAGE =
  'No Rooms available. Patient registration, admission, and triaging are temporarily disabled.';

// Matches the 15s room-grid auto-refresh on the Rooms page, so the banner
// clears about as fast as a freed bed shows up there.
export const CAPACITY_POLL_MS = 15000; // 15 seconds

// Pre-filled reason when an external referral is raised at zero availability.
export const NO_BEDS_REASON = 'No available beds at this facility.';

// Typeahead debounce — one request per typing pause instead of per keystroke.
// 250ms is below the ~300ms most people read as lag, while collapsing a burst
// of typing into a single query.
export const PATIENT_SEARCH_DEBOUNCE_MS = 250;

// ── Pre-discharge clearance ──────────────────────────────────────────────────
// All three must be verified before a discharge can be confirmed. Keep in sync
// with CLEARANCE_ITEMS / ITEM_LABELS in backend/utils/dischargeClearance.js,
// which is where the rule is actually enforced.
export const CLEARANCE_ITEMS = ['Billing', 'Administrative', 'DoctorOrder'];

export const CLEARANCE_LABELS = {
  Billing:        'Billing clearance',
  Administrative: 'Administrative clearance',
  DoctorOrder:    "Doctor's discharge order",
};

export const CLEARANCE_HINTS = {
  Billing:        'Account settled or billing has signed off.',
  Administrative: 'Records, paperwork and patient property completed.',
  DoctorOrder:    'Recorded automatically when the doctor initiates the discharge.',
};

// ── Nursing ──────────────────────────────────────────────────────────────────
// Matches the `shift` ENUM on the endorsements table. The value recorded is the
// shift ENDING — the one being handed over.
export const SHIFTS = ['Morning', 'Afternoon', 'Night'];
