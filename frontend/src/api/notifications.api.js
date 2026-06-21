import api from './axios';
export const getMyNotifications = () => api.get('/api/notifications').then(r => r.data);
export const markAsRead         = (id) => api.put(`/api/notifications/${id}/read`).then(r => r.data);
export const markAllAsRead      = () => api.put('/api/notifications/read-all').then(r => r.data);
