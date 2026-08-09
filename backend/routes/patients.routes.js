const express = require('express');
const router = express.Router();
const patientsController = require('../controllers/patients.controller');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/roleGuard');

// Patient records are clinical — admins are oversight-only and have no access
// (they use /api/reports and /api/dashboard aggregates instead).

// GET /api/patients
router.get('/', auth, requireRole('doctor', 'nurse'), patientsController.getAllPatients);

// GET /api/patients/search?q=… — lightweight typeahead lookup for pickers.
// Declared before '/:id' so "search" is never parsed as a patient id.
router.get('/search', auth, requireRole('doctor', 'nurse'), patientsController.searchPatients);

// GET /api/patients/:id
router.get('/:id', auth, requireRole('doctor', 'nurse'), patientsController.getPatientById);

// GET /api/patients/:id/history  — full clinical timeline
router.get('/:id/history', auth, requireRole('doctor', 'nurse'), patientsController.getPatientHistory);

// POST /api/patients  — nurse only
router.post('/', auth, requireRole('nurse'), patientsController.createPatient);

// PUT /api/patients/:id  — nurse only
router.put('/:id', auth, requireRole('nurse'), patientsController.updatePatient);


module.exports = router;
