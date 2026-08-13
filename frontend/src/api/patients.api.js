import api from './axios';

/**
 * GET /api/patients
 * @param {object} params — { search, sex, from_date, to_date, page, limit }
 */
export const getAllPatients  = (params = {}) => api.get('/api/patients', { params }).then(r => r.data);
/**
 * GET /api/patients/search — lightweight typeahead lookup for pickers.
 *
 * Matches name tokens in any order, or an EXACT patient id when `q` is all
 * digits. Role scoping is identical to getAllPatients, so this never surfaces a
 * patient the list would hide. Capped at 25 rows server-side.
 *
 * @param {string} q      — name fragment(s) or a patient id; '' returns the first page
 * @param {number} limit  — max rows (default 10, hard cap 25)
 * @param {object} config — extra axios config, e.g. { signal } to cancel a stale keystroke
 * @param {object} extra  — extra query params, e.g. { returning: true } for the
 *                          "Receive Returning Patient" picker (nurse-only, unscoped,
 *                          Discharged patients only — see backend searchPatients)
 */
export const searchPatients = (q = '', limit = 10, config = {}, extra = {}) =>
  api.get('/api/patients/search', { params: { q, limit, ...extra }, ...config }).then(r => r.data);

export const getPatientById = (id) => api.get(`/api/patients/${id}`).then(r => r.data);
export const getPatientHistory = (id) => api.get(`/api/patients/${id}/history`).then(r => r.data);
export const createPatient        = (data) => api.post('/api/patients', data).then(r => r.data);
export const updatePatient        = (id, data) => api.put(`/api/patients/${id}`, data).then(r => r.data);
