const express = require('express');
const router = express.Router();
const patientsController = require('../controllers/patients.controller');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/roleGuard');

// Patient records are clinical — admins are oversight-only and have no access
// (they use /api/reports and /api/dashboard aggregates instead).

// GET /api/patients
router.get('/', auth, requireRole('doctor', 'nurse', 'staff'), patientsController.getAllPatients);

// GET /api/patients/:id
router.get('/:id', auth, requireRole('doctor', 'nurse', 'staff'), patientsController.getPatientById);

// GET /api/patients/:id/history  — full clinical timeline
router.get('/:id/history', auth, requireRole('doctor', 'nurse', 'staff'), patientsController.getPatientHistory);

// POST /api/patients  — nurse or staff only
router.post('/', auth, requireRole('nurse', 'staff'), patientsController.createPatient);

// PUT /api/patients/:id  — nurse or staff only
router.put('/:id', auth, requireRole('nurse', 'staff'), patientsController.updatePatient);


module.exports = router;
