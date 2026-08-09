import api from './axios';

/**
 * Departments (wards). Reading is open to any signed-in role; every write is
 * admin-only.
 */

/** @param {boolean} includeInactive — admin only; adds retired wards. */
export const getAllDepartments = (includeInactive = false) =>
  api.get('/api/departments', {
    params: includeInactive ? { include_inactive: true } : {},
  }).then(r => r.data);

export const createDepartment = (data) =>
  api.post('/api/departments', data).then(r => r.data);

/** Also the retire/revive switch — pass `{ is_active: 0 | 1 }`. */
export const updateDepartment = (id, data) =>
  api.put(`/api/departments/${id}`, data).then(r => r.data);

/** Refused with 409 once rooms, employees or endorsements reference it. */
export const deleteDepartment = (id) =>
  api.delete(`/api/departments/${id}`).then(r => r.data);

/** Assign a nurse to a ward. Pass null to clear. Admin only. */
export const setEmployeeDepartment = (employeeId, departmentId) =>
  api.put(`/api/departments/nurses/${employeeId}`, { department_id: departmentId }).then(r => r.data);
