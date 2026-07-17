import api from './axios';
export const getMyPendingAssignments = () => api.get('/api/assignments/pending').then(r => r.data);
export const acceptAssignment  = (patientId)         => api.post(`/api/assignments/${patientId}/accept`).then(r => r.data);
export const declineAssignment = (patientId, reason) => api.post(`/api/assignments/${patientId}/decline`, { reason }).then(r => r.data);
export const cancelAssignment  = (patientId)         => api.post(`/api/assignments/${patientId}/cancel`).then(r => r.data);
