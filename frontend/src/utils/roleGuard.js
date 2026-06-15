/**
 * Check if the current user's role is in the allowed list.
 * @param {string} userRole  — role from JWT (admin | doctor | nurse | staff)
 * @param {string[]} allowed — array of allowed roles
 */
export const hasRole = (userRole, allowed = []) => allowed.includes(userRole);

/** Returns true if user can create/edit patients */
export const canManagePatients = (role) => hasRole(role, ['admin', 'nurse', 'staff']);

/** Returns true if user can create diagnoses */
export const canDiagnose = (role) => hasRole(role, ['admin', 'doctor']);

/** Returns true if user can update referral status */
export const canUpdateReferralStatus = (role) => hasRole(role, ['admin', 'doctor']);

/** Returns true if user can manage rooms */
export const canManageRooms = (role) => hasRole(role, ['admin']);

/** Returns true if user can manage user accounts */
export const canManageUsers = (role) => hasRole(role, ['admin']);

/** Returns true if user can access reports */
export const canViewReports = (role) => hasRole(role, ['admin', 'doctor']);
