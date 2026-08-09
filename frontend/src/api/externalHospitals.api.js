import api from './axios';

/**
 * The admin-managed directory of hospitals patients are referred OUT to.
 *
 * Reading it is open to admin/doctor/nurse (the external referral form
 * needs it); every write is admin-only.
 */

/** @param {boolean} includeInactive — admin only; adds retired entries. */
export const getAllExternalHospitals = (includeInactive = false) =>
  api.get('/api/external-hospitals', {
    params: includeInactive ? { include_inactive: true } : {},
  }).then(r => r.data);

export const createExternalHospital = (data) =>
  api.post('/api/external-hospitals', data).then(r => r.data);

/** Also the retire/revive switch — pass `{ is_active: 0 | 1 }`. */
export const updateExternalHospital = (id, data) =>
  api.put(`/api/external-hospitals/${id}`, data).then(r => r.data);

/** Refused with 409 once any referral points at the hospital — deactivate instead. */
export const deleteExternalHospital = (id) =>
  api.delete(`/api/external-hospitals/${id}`).then(r => r.data);
