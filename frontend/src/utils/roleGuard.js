/**
 * Check if the current user's role is in the allowed list.
 * @param {string} userRole  — role from JWT (admin | doctor | nurse)
 * @param {string[]} allowed — array of allowed roles
 */
export const hasRole = (userRole, allowed = []) => allowed.includes(userRole);

/** Returns true if user can create/edit patients */
export const canManagePatients = (role) => hasRole(role, ['nurse']);

/** Returns true if user can create/edit triage and vital signs */
export const canManageTriage = (role) => hasRole(role, ['nurse']);

/** Returns true if user can create diagnoses */
export const canDiagnose = (role) => hasRole(role, ['doctor']);

/** Returns true if user can update referral status */
export const canUpdateReferralStatus = (role) => hasRole(role, ['doctor']);

/** Returns true if user can create referrals */
export const canCreateReferral = (role) => hasRole(role, ['doctor']);

/**
 * Returns true if user can refer a patient OUT to an external hospital.
 * Wider than canCreateReferral on purpose: diverting a patient happens at the
 * intake desk when the facility is full, so nurses need it too.
 * Mirrors requireRole on POST /api/referrals/external.
 */
export const canCreateExternalReferral = (role) => hasRole(role, ['doctor', 'nurse']);

/** Returns true if user can manage rooms */
export const canManageRooms = (role) => hasRole(role, ['admin']);

/**
 * Returns true if user can maintain the external hospital directory.
 * Admin-only — clinical roles pick from the list, they don't edit it.
 * Mirrors the write routes on /api/external-hospitals.
 */
export const canManageExternalHospitals = (role) => hasRole(role, ['admin']);

/**
 * Returns true if user has a ward roster and shift endorsements of their own.
 * Nurse-only: the API resolves the caller to an `employees` row and scopes
 * everything to that nurse's department. Mirrors /api/nursing and
 * /api/endorsements.
 */
export const canUseWard = (role) => hasRole(role, ['nurse']);

/** Returns true if user can assign nurses to departments (admin only). */
export const canAssignDepartments = (role) => hasRole(role, ['admin']);

/** Returns true if user can assign a room to a pending admission */
export const canAssignRoom = (role) => hasRole(role, ['nurse']);

/** Returns true if user can admit a patient */
export const canAdmitPatient = (role) => hasRole(role, ['doctor']);

/**
 * Returns true if this USER may see admit actions. Any doctor may admit;
 * WHICH patients they may admit (assigned/referred only, plus unassigned for
 * a Doctor-in-Charge) is enforced server-side in createAdmission — the
 * patient lists doctors see are already scoped to that same set.
 */
export const canUserAdmit = (user) => canAdmitPatient(user?.role);

/** Returns true if user can upload lab results */
export const canUploadLabResult = (role) => hasRole(role, ['doctor', 'nurse']);

/** Returns true if user can manage user accounts */
export const canManageUsers = (role) => hasRole(role, ['admin']);

/** Returns true if user can access reports */
export const canViewReports = (role) => hasRole(role, ['admin']);

/** Returns true if user can initiate an emergency triage for an unidentified patient */
export const canEmergencyTriage = (role) => hasRole(role, ['nurse']);

