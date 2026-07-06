import api from './axios';
export const getAllTriages        = (params = {}) => api.get('/api/triages', { params }).then(r => r.data);
export const getTriageById       = (id) => api.get(`/api/triages/${id}`).then(r => r.data);
export const createTriage        = (data) => api.post('/api/triages', data).then(r => r.data);
export const createEmergencyTriage = (data) => api.post('/api/triages/emergency', data).then(r => r.data);
export const updateTriage        = (id, data) => api.put(`/api/triages/${id}`, data).then(r => r.data);
export const addVitalSigns       = (id, data) => api.post(`/api/triages/${id}/vital-signs`, data).then(r => r.data);
export const getVisitRoomOptions = () => api.get('/api/triages/visit-rooms/options').then(r => r.data);
