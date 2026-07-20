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

export const USER_ROLES = ['admin', 'doctor', 'nurse', 'staff'];

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
};

// Role display labels
export const ROLE_LABELS = {
  admin:  'Administrator',
  doctor: 'Doctor',
  nurse:  'Nurse',
  staff:  'Staff',
};

export const API_BASE = '/api';
export const NOTIFICATION_POLL_MS = 30000; // 30 seconds
