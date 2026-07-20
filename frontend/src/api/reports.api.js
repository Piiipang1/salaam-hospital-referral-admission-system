import api from './axios';
export const getAdmissionsReport = (params = {}) => api.get('/api/reports/admissions', { params }).then(r => r.data);
export const getReferralsReport  = (params = {}) => api.get('/api/reports/referrals',  { params }).then(r => r.data);
export const getTurnaroundReport = (params = {}) => api.get('/api/reports/turnaround', { params }).then(r => r.data);
export const getOutpatientsReport = (params = {}) => api.get('/api/reports/outpatients', { params }).then(r => r.data);
