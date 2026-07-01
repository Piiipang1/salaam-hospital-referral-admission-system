import api from './axios';

/**
 * GET /api/patients
 * @param {object} params — { search, sex, from_date, to_date, page, limit }
 */
export const getAllPatients  = (params = {}) => api.get('/api/patients', { params }).then(r => r.data);
export const getPatientById = (id) => api.get(`/api/patients/${id}`).then(r => r.data);
export const getPatientHistory = (id) => api.get(`/api/patients/${id}/history`).then(r => r.data);
export const createPatient        = (data) => api.post('/api/patients', data).then(r => r.data);
export const updatePatient        = (id, data) => api.put(`/api/patients/${id}`, data).then(r => r.data);
export const getUnassignedPatients = () => api.get('/api/patients/unassigned').then(r => r.data);
export const claimPatient         = (id) => api.post(`/api/patients/${id}/claim`).then(r => r.data);
