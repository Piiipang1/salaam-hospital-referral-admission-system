/**
 * Check if the current user's role is in the allowed list.
 * @param {string} userRole  — role from JWT (admin | doctor | nurse | staff)
 * @param {string[]} allowed — array of allowed roles
 */
export const hasRole = (userRole, allowed = []) => allowed.includes(userRole);

/** Returns true if user can create/edit patients */
export const canManagePatients = (role) => hasRole(role, ['nurse', 'staff']);

/** Returns true if user can create/edit triage and vital signs */
export const canManageTriage = (role) => hasRole(role, ['nurse', 'staff']);

/** Returns true if user can create diagnoses */
export const canDiagnose = (role) => hasRole(role, ['doctor']);

/** Returns true if user can update referral status */
export const canUpdateReferralStatus = (role) => hasRole(role, ['doctor']);

/** Returns true if user can create referrals */
export const canCreateReferral = (role) => hasRole(role, ['doctor']);

/** Returns true if user can manage rooms */
export const canManageRooms = (role) => hasRole(role, ['admin']);

/** Returns true if user can assign a room to a pending admission */
export const canAssignRoom = (role) => hasRole(role, ['nurse', 'staff']);

/** Returns true if user can admit a patient */
export const canAdmitPatient = (role) => hasRole(role, ['doctor']);

/**
 * Returns true if this specific USER may admit right now — doctors must also
 * be ER-assigned (user.is_er_assigned from login). Takes the whole user
 * object, not just the role. Server enforces the same rule in createAdmission.
 */
export const canUserAdmit = (user) =>
  canAdmitPatient(user?.role) && (user?.role !== 'doctor' || !!user?.is_er_assigned);

/** Returns true if user can upload lab results */
export const canUploadLabResult = (role) => hasRole(role, ['doctor', 'nurse']);

/** Returns true if user can manage user accounts */
export const canManageUsers = (role) => hasRole(role, ['admin']);

/** Returns true if user can access reports */
export const canViewReports = (role) => hasRole(role, ['admin']);

/** Returns true if user can initiate an emergency triage for an unidentified patient */
export const canEmergencyTriage = (role) => hasRole(role, ['doctor', 'nurse', 'staff']);

