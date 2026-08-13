import api from './axios';

/**
 * Ward roster and patient-to-nurse assignments. Every endpoint is scoped to the
 * calling nurse's own department on the server — there is no ward parameter to
 * pass, and none to tamper with.
 */

/** My ward + workload counts. Returns department_id: null when unassigned. */
export const getMyNursingContext = () =>
  api.get('/api/nursing/me').then(r => r.data);

/** @param {boolean} mine — true narrows the ward list to my own patients. */
export const getWardPatients = (mine = false) =>
  api.get('/api/nursing/ward', { params: mine ? { mine: true } : {} }).then(r => r.data);

/** Other active nurses in my ward — the "hand off to" list. */
export const getWardNurses = () =>
  api.get('/api/nursing/colleagues').then(r => r.data);

/** Take a patient. Omit nurseId to assign to yourself. */
export const assignPatient = (patientId, nurseId) =>
  api.post('/api/nursing/assignments', {
    patient_id: patientId,
    ...(nurseId ? { nurse_id: nurseId } : {}),
  }).then(r => r.data);

/** Give up a patient you hold. */
export const releasePatient = (patientId) =>
  api.delete(`/api/nursing/assignments/${patientId}`).then(r => r.data);

/** Take custody of a discharged patient's record — the front door of a new visit. */
export const receiveReturningPatient = (patientId) =>
  api.post('/api/nursing/returning-patient', { patient_id: patientId }).then(r => r.data);
