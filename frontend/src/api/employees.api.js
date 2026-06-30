import api from './axios';
export const getActiveEmployees = () => api.get('/api/employees').then(r => r.data);
