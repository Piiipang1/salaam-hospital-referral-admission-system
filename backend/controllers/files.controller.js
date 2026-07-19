const path = require('path');
const fs   = require('fs');

// Uploaded patient files (lab results, referral attachments) live here. These
// are PHI and must NEVER be served without authentication — the route is
// protected by the auth middleware.
const UPLOADS_DIR = path.join(__dirname, '../uploads');

// ─── GET /api/files/:filename ────────────────────────────────────────────────
// Auth-gated read of a single uploaded file. path.basename() collapses any
// path components so "../" traversal is impossible; the file must already exist
// inside backend/uploads.
const getFile = (req, res) => {
  const safeName = path.basename(req.params.filename);
  const filePath = path.join(UPLOADS_DIR, safeName);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ success: false, message: 'File not found.' });
  }

  return res.sendFile(filePath, (err) => {
    if (err && !res.headersSent) {
      console.error('getFile error:', err);
      res.status(500).json({ success: false, message: 'Could not read the file.' });
    }
  });
};

module.exports = { getFile };
