import api from './axios';
export const getAllAdmissions  = (params = {}) => api.get('/api/admissions', { params }).then(r => r.data);
export const getAdmissionById = (id) => api.get(`/api/admissions/${id}`).then(r => r.data);
export const createAdmission  = (data) => api.post('/api/admissions', data).then(r => r.data);
export const dischargePatient  = (id) => api.put(`/api/admissions/${id}/discharge`).then(r => r.data);
export const confirmDischarge  = (id) => api.put(`/api/admissions/${id}/confirm-discharge`).then(r => r.data);
export const cancelDischarge   = (id) => api.put(`/api/admissions/${id}/cancel-discharge`).then(r => r.data);
export const assignRoom = (id, room_id) => api.put(`/api/admissions/${id}/assign-room`, { room_id }).then(r => r.data);
