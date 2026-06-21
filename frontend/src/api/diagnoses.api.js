import api from './axios';
export const createDiagnosis = (data) => api.post('/api/diagnoses', data).then(r => r.data);
export const getDiagnosisById = (id) => api.get(`/api/diagnoses/${id}`).then(r => r.data);
export const updateDiagnosis = (id, data) => api.put(`/api/diagnoses/${id}`, data).then(r => r.data);
export const addTreatment   = (id, data) => api.post(`/api/diagnoses/${id}/treatments`, data).then(r => r.data);
export const addLabResult   = (id, formData) => api.post(`/api/diagnoses/${id}/lab-results`, formData, {
  headers: { 'Content-Type': 'multipart/form-data' },
}).then(r => r.data);
export const getLabResults  = (id) => api.get(`/api/diagnoses/${id}/lab-results`).then(r => r.data);
