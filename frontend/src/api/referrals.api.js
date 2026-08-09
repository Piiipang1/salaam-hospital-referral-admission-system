import api from './axios';

export const getAllReferrals      = (params = {}) => api.get('/api/referrals', { params }).then(r => r.data);
export const getReferralById      = (id)          => api.get(`/api/referrals/${id}`).then(r => r.data);
export const getReferralHistory   = (patientId)   => api.get(`/api/referrals/history/${patientId}`).then(r => r.data);
export const updateReferralStatus = (id, status)  => api.put(`/api/referrals/${id}/status`, { status }).then(r => r.data);
export const reassignReferral     = (id, assigned_doctor_id) => api.put(`/api/referrals/${id}/reassign`, { assigned_doctor_id }).then(r => r.data);

/**
 * createReferral — always sends multipart/form-data so multer can pick up
 * an optional file_attachment.
 *
 * @param {FormData} formData — built by ReferralForm before calling this
 */
export const createReferral = (formData) =>
  api.post('/api/referrals', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  }).then(r => r.data);

/**
 * createExternalReferral — refer a patient OUT to a hospital outside this
 * system (used when the facility has no available beds). Same multipart
 * contract as createReferral; unlike it, this endpoint is open to
 * nurses as well as doctors.
 *
 * @param {FormData} formData — built by ExternalReferralForm
 */
export const createExternalReferral = (formData) =>
  api.post('/api/referrals/external', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  }).then(r => r.data);

/** Bed availability + the patient's diagnoses, for the external-referral form. */
export const getExternalReferralContext = (patientId) =>
  api.get('/api/referrals/external/context', {
    params: patientId ? { patient_id: patientId } : {},
  }).then(r => r.data);
