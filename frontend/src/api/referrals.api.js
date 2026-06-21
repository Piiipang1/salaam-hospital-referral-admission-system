import api from './axios';
export const getAllReferrals     = (params = {}) => api.get('/api/referrals', { params }).then(r => r.data);
export const getReferralById    = (id) => api.get(`/api/referrals/${id}`).then(r => r.data);
export const getReferralHistory = (patientId) => api.get(`/api/referrals/history/${patientId}`).then(r => r.data);
export const createReferral     = (data) => api.post('/api/referrals', data).then(r => r.data);
export const updateReferralStatus = (id, status) => api.put(`/api/referrals/${id}/status`, { status }).then(r => r.data);
