import api from './axios';

/**
 * Outpatient Department follow-ups.
 *
 * Follow-ups are CREATED by confirming a discharge — see confirmDischarge in
 * admissions.api, which now requires a follow-up date and returns the booked
 * clinic. These endpoints read the OPD book and keep it current.
 */

/** Clinics a follow-up can be routed to. */
export const getClinics = (includeInactive = false) =>
  api.get('/api/opd/clinics', {
    params: includeInactive ? { include_inactive: true } : {},
  }).then(r => r.data);

/**
 * @param {object} params — { patient_id, clinic_id, status, from_date, to_date, page, limit }
 * Scoped server-side: doctors see their own patients' follow-ups, nurses
 * see the ones they booked.
 */
export const getFollowups = (params = {}) =>
  api.get('/api/opd/followups', { params }).then(r => r.data);

export const getFollowupById = (id) =>
  api.get(`/api/opd/followups/${id}`).then(r => r.data);

/** Reschedule, re-route, or amend notes. Re-routing marks it Manual. */
export const updateFollowup = (id, data) =>
  api.put(`/api/opd/followups/${id}`, data).then(r => r.data);

/** @param {'Completed'|'Missed'|'Cancelled'} status — only a Scheduled one can move. */
export const updateFollowupStatus = (id, status) =>
  api.put(`/api/opd/followups/${id}/status`, { status }).then(r => r.data);
