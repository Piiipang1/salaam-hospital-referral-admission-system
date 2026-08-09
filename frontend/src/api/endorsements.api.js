import api from './axios';

/**
 * Nursing shift handoffs.
 *
 * An endorsement is Pending until the receiving nurse acknowledges it, and
 * acknowledging is what actually moves the patient assignments — so a handoff
 * nobody accepted has changed nothing.
 */

/**
 * @param {{to_nurse_id:number, shift:'Morning'|'Afternoon'|'Night',
 *          shift_date?:string, general_notes?:string,
 *          patients:{patient_id:number, notes?:string}[]}} data
 */
export const createEndorsement = (data) =>
  api.post('/api/endorsements', data).then(r => r.data);

/** Handoffs waiting for me. `status` optionally filters Pending/Acknowledged. */
export const getIncomingEndorsements = (status) =>
  api.get('/api/endorsements/incoming', { params: status ? { status } : {} }).then(r => r.data);

/** Handoffs I submitted. */
export const getOutgoingEndorsements = (status) =>
  api.get('/api/endorsements/outgoing', { params: status ? { status } : {} }).then(r => r.data);

/** Full handoff with per-patient notes — readable only by the two nurses on it. */
export const getEndorsementById = (id) =>
  api.get(`/api/endorsements/${id}`).then(r => r.data);

/** Take over. This is the call that transfers the patients. */
export const acknowledgeEndorsement = (id) =>
  api.post(`/api/endorsements/${id}/acknowledge`).then(r => r.data);

/** Withdraw a handoff that has not been acknowledged yet. */
export const cancelEndorsement = (id) =>
  api.delete(`/api/endorsements/${id}`).then(r => r.data);
