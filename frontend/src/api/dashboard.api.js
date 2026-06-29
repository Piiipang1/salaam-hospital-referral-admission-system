import api from './axios';

export const getDashboardStats          = () => api.get('/api/dashboard/stats').then(r => r.data);
export const getDashboardRecentActivity = () => api.get('/api/dashboard/recent-activity').then(r => r.data);
export const getDashboardMyStats        = () => api.get('/api/dashboard/my-stats').then(r => r.data);
