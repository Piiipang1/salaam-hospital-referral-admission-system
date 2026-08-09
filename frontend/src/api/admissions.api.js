import api from './axios';
export const getAllAdmissions  = (params = {}) => api.get('/api/admissions', { params }).then(r => r.data);
export const getAdmissionById = (id) => api.get(`/api/admissions/${id}`).then(r => r.data);
export const createAdmission  = (data) => api.post('/api/admissions', data).then(r => r.data);
export const dischargePatient  = (id, discharge_notes = '') => api.put(`/api/admissions/${id}/discharge`, { discharge_notes }).then(r => r.data);
/**
 * Step 2 of discharge. An OPD follow-up is REQUIRED: the API returns 400 with
 * { requires_followup: true } unless `followup_date` is supplied, and books the
 * follow-up in the same transaction as the discharge.
 *
 * @param {number} id
 * @param {{followup_date:string, clinic_id?:number, followup_notes?:string}} followup
 *   Omit clinic_id to let the server route automatically.
 */
export const confirmDischarge  = (id, followup = {}) =>
  api.put(`/api/admissions/${id}/confirm-discharge`, followup).then(r => r.data);

/** Which OPD clinic the discharge would route to, plus the default date. */
export const getFollowupSuggestion = (id) =>
  api.get(`/api/admissions/${id}/followup-suggestion`).then(r => r.data);
export const cancelDischarge   = (id) => api.put(`/api/admissions/${id}/cancel-discharge`).then(r => r.data);
export const assignRoom = (id, room_id) => api.put(`/api/admissions/${id}/assign-room`, { room_id }).then(r => r.data);

// ── Pre-discharge clearance checklist ────────────────────────────────────────
// confirmDischarge above returns 409 with { missing: [...] } until every item
// is verified, so the UI must never be the only thing enforcing this.

/** Full checklist for an admission — every item, verified or not. */
export const getDischargeClearance = (id) =>
  api.get(`/api/admissions/${id}/clearance`).then(r => r.data);

/**
 * Mark an item cleared.
 * @param {'Billing'|'Administrative'|'DoctorOrder'} item
 * DoctorOrder is doctor-only and normally recorded automatically when the
 * discharge is initiated — nurses get 403.
 */
export const verifyClearanceItem = (id, item, notes) =>
  api.put(`/api/admissions/${id}/clearance/${item}`, notes ? { notes } : {}).then(r => r.data);

/** Undo a tick made in error. Refused once the patient is discharged. */
export const unverifyClearanceItem = (id, item) =>
  api.delete(`/api/admissions/${id}/clearance/${item}`).then(r => r.data);
