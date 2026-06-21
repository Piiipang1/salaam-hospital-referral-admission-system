import api from './axios';
export const getAllPatients  = (search = '') => api.get(`/api/patients?search=${search}`).then(r => r.data);
export const getPatientById = (id) => api.get(`/api/patients/${id}`).then(r => r.data);
export const getPatientHistory = (id) => api.get(`/api/patients/${id}/history`).then(r => r.data);
export const createPatient  = (data) => api.post('/api/patients', data).then(r => r.data);
export const updatePatient  = (id, data) => api.put(`/api/patients/${id}`, data).then(r => r.data);
