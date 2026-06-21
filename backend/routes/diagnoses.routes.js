const express = require('express');
const router = express.Router();
const diagnosesController = require('../controllers/diagnoses.controller');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/roleGuard');
const multer = require('multer');
const path = require('path');

// Multer config for lab result file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, '../uploads')),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + '-' + file.originalname);
  },
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB limit

// POST /api/diagnoses
router.post('/', auth, requireRole('admin', 'doctor'), diagnosesController.createDiagnosis);

// GET /api/diagnoses/:id
router.get('/:id', auth, diagnosesController.getDiagnosisById);

// PUT /api/diagnoses/:id
router.put('/:id', auth, requireRole('admin', 'doctor'), diagnosesController.updateDiagnosis);

// POST /api/diagnoses/:id/treatments
router.post('/:id/treatments', auth, requireRole('admin', 'doctor'), diagnosesController.addTreatment);

// POST /api/diagnoses/:id/lab-results  (with file upload — clinical staff only)
router.post('/:id/lab-results', auth, requireRole('admin', 'doctor', 'nurse'), upload.single('file_attachment'), diagnosesController.addLabResult);

// GET /api/diagnoses/:id/lab-results
router.get('/:id/lab-results', auth, diagnosesController.getLabResults);

module.exports = router;
