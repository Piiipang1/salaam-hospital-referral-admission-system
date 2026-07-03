import api from './axios';
export const getAllUsers    = () => api.get('/api/users').then(r => r.data);
export const getUserById   = (id) => api.get(`/api/users/${id}`).then(r => r.data);
export const createUser    = (data) => api.post('/api/users', data).then(r => r.data);
export const updateUser    = (id, data) => api.put(`/api/users/${id}`, data).then(r => r.data);
export const deactivateUser  = (id) => api.delete(`/api/users/${id}`).then(r => r.data);
export const reactivateUser  = (id) => api.put(`/api/users/${id}/reactivate`).then(r => r.data);
