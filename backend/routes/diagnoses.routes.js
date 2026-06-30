const express = require('express');
const router  = express.Router();
const diagnosesController = require('../controllers/diagnoses.controller');
const auth        = require('../middleware/auth');
const requireRole = require('../middleware/roleGuard');
const { upload }  = require('../middleware/upload');

// POST /api/diagnoses
router.post('/', auth, requireRole('admin', 'doctor'), diagnosesController.createDiagnosis);

// GET /api/diagnoses/:id
router.get('/:id', auth, diagnosesController.getDiagnosisById);

// PUT /api/diagnoses/:id
router.put('/:id', auth, requireRole('admin', 'doctor'), diagnosesController.updateDiagnosis);

// POST /api/diagnoses/:id/treatments
router.post('/:id/treatments', auth, requireRole('admin', 'doctor'), diagnosesController.addTreatment);

// GET /api/diagnoses/:id/treatments
router.get('/:id/treatments', auth, diagnosesController.getTreatments);

// POST /api/diagnoses/:id/assessment
router.post('/:id/assessment', auth, requireRole('admin', 'doctor'), diagnosesController.saveAssessment);

// GET /api/diagnoses/:id/assessment
router.get('/:id/assessment', auth, diagnosesController.getAssessment);

// POST /api/diagnoses/:id/lab-results  (with file upload — clinical staff only)
router.post('/:id/lab-results', auth, requireRole('admin', 'doctor', 'nurse'), upload.single('file_attachment'), diagnosesController.addLabResult);

// GET /api/diagnoses/:id/lab-results
router.get('/:id/lab-results', auth, diagnosesController.getLabResults);

module.exports = router;
