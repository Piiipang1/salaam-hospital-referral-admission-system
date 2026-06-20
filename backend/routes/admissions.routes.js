const express = require('express');
const router = express.Router();
const admissionsController = require('../controllers/admissions.controller');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/roleGuard');

// GET /api/admissions
router.get('/', auth, admissionsController.getAllAdmissions);

// GET /api/admissions/:id
router.get('/:id', auth, admissionsController.getAdmissionById);

// POST /api/admissions
router.post('/', auth, requireRole('admin', 'nurse', 'staff', 'doctor'), admissionsController.createAdmission);

// PUT /api/admissions/:id/discharge
router.put('/:id/discharge', auth, requireRole('admin', 'nurse', 'staff', 'doctor'), admissionsController.dischargePatient);

module.exports = router;
