import api from './axios';
export const getAllDoctors    = () => api.get('/api/doctors').then(r => r.data);
export const getActiveDoctors = () => api.get('/api/doctors/active').then(r => r.data);
