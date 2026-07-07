import api from './axios';
export const login = (data) => api.post('/api/auth/login', data).then(r => r.data);
export const logout = () => api.post('/api/auth/logout').then(r => r.data);
export const getMe = () => api.get('/api/auth/me').then(r => r.data);
export const changePassword = (data) => api.put('/api/auth/change-password', data).then(r => r.data);
