/**
 * upload.js — shared Multer middleware for file uploads.
 * Stores files in backend/uploads/ with a unique timestamped filename.
 * Enforces: PDF, JPG, PNG, WebP, GIF — max 10 MB.
 *
 * Usage in any route file:
 *   const { upload } = require('../middleware/upload');
 *   router.post('/route', auth, upload.single('file_attachment'), controller.handler);
 */

const multer = require('multer');
const path   = require('path');

const ALLOWED_MIME = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, '../uploads')),
  filename:    (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    // Keep the original extension, replace spaces with underscores
    const ext  = path.extname(file.originalname);
    const base = path.basename(file.originalname, ext).replace(/\s+/g, '_');
    cb(null, `${unique}-${base}${ext}`);
  },
});

const fileFilter = (req, file, cb) => {
  if (ALLOWED_MIME.has(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'Only PDF and image files (JPG, PNG, WebP, GIF) are allowed.'));
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
});

module.exports = { upload };
