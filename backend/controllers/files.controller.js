const path = require('path');
const fs   = require('fs');
const db   = require('../config/db');
const { assertCanAccessPatient } = require('../utils/scoping');

// Uploaded patient files (lab results, referral attachments) live here. These
// are PHI and must NEVER be served without authentication — the route is
// protected by the auth middleware.
const UPLOADS_DIR = path.join(__dirname, '../uploads');

// ─── GET /api/files/:filename ────────────────────────────────────────────────
// Auth-gated read of a single uploaded file. path.basename() collapses any
// path components so "../" traversal is impossible; the file must already exist
// inside backend/uploads.
//
// Authentication alone is not enough: every file here is one patient's PHI
// (a lab result or a referral attachment), so it must obey the same
// per-patient access rule as the rest of that patient's record — otherwise a
// nurse who no longer has custody of a patient (or never did) could still
// pull their lab/referral files straight off disk by filename. Resolve the
// owning patient from whichever table references this filename and apply the
// same assertCanAccessPatient check used everywhere else. A filename with no
// owning record is refused rather than served, since a legitimate upload
// always has one.
const getFile = async (req, res) => {
  const safeName = path.basename(req.params.filename);
  const filePath = path.join(UPLOADS_DIR, safeName);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ success: false, message: 'File not found.' });
  }

  try {
    const [[labRow]] = await db.query(
      'SELECT patient_id FROM lab_results WHERE file_attachment = ? LIMIT 1',
      [safeName]
    );
    let patientId = labRow?.patient_id ?? null;

    if (!patientId) {
      const [[refRow]] = await db.query(
        `SELECT COALESCE(r.patient_id, d.patient_id) AS patient_id
         FROM referrals r
         LEFT JOIN diagnoses d ON d.diagnosis_id = r.diagnosis_id
         WHERE r.file_attachment = ? LIMIT 1`,
        [safeName]
      );
      patientId = refRow?.patient_id ?? null;
    }

    if (!patientId) {
      return res.status(404).json({ success: false, message: 'File not found.' });
    }

    const denied = await assertCanAccessPatient(req, patientId);
    if (denied) {
      return res.status(denied.status).json({ success: false, message: denied.message });
    }
  } catch (err) {
    console.error('getFile access-check error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }

  return res.sendFile(filePath, (err) => {
    if (err && !res.headersSent) {
      console.error('getFile error:', err);
      res.status(500).json({ success: false, message: 'Could not read the file.' });
    }
  });
};

module.exports = { getFile };
