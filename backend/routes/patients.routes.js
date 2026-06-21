const express = require('express');
const router = express.Router();
const patientsController = require('../controllers/patients.controller');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/roleGuard');

// GET /api/patients
router.get('/', auth, patientsController.getAllPatients);

// GET /api/patients/:id
router.get('/:id', auth, patientsController.getPatientById);

// GET /api/patients/:id/history  — full clinical timeline
router.get('/:id/history', auth, patientsController.getPatientHistory);

// POST /api/patients  — nurse or admin only
router.post('/', auth, requireRole('admin', 'nurse', 'staff'), patientsController.createPatient);

// PUT /api/patients/:id  — nurse or admin only
router.put('/:id', auth, requireRole('admin', 'nurse', 'staff'), patientsController.updatePatient);

module.exports = router;
