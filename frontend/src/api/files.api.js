import api from './axios';

// Uploaded patient files (lab results, referral attachments) are PHI and are
// served only from the authenticated GET /api/files/:filename endpoint. An
// <a href> can't attach the Authorization header, so we fetch the file as a
// Blob through the axios instance (which injects the JWT) and let the caller
// open or download it via URL.createObjectURL.
export const fetchFileBlob = (filename) =>
  api
    .get(`/api/files/${encodeURIComponent(filename)}`, { responseType: 'blob' })
    .then((r) => r.data);
