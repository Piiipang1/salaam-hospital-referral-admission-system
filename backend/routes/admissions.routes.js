const express = require('express');
const router = express.Router();
const admissionsController = require('../controllers/admissions.controller');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/roleGuard');

// Admissions are clinical — admins are oversight-only and have no access.

// GET /api/admissions
router.get('/', auth, requireRole('doctor', 'nurse', 'staff'), admissionsController.getAllAdmissions);

// GET /api/admissions/:id
router.get('/:id', auth, requireRole('doctor', 'nurse', 'staff'), admissionsController.getAdmissionById);

// POST /api/admissions
router.post('/', auth, requireRole('doctor'), admissionsController.createAdmission);

// PUT /api/admissions/:id/assign-room
router.put('/:id/assign-room', auth, requireRole('nurse', 'staff'), admissionsController.assignRoom);

// PUT /api/admissions/:id/discharge — step 1: assigned doctor initiates
router.put('/:id/discharge', auth, requireRole('doctor'), admissionsController.dischargePatient);

// PUT /api/admissions/:id/confirm-discharge — step 2: nurse/staff confirms
router.put('/:id/confirm-discharge', auth, requireRole('nurse', 'staff'), admissionsController.confirmDischarge);

// PUT /api/admissions/:id/cancel-discharge — mistaken initiation → back to Active
router.put('/:id/cancel-discharge', auth, requireRole('doctor'), admissionsController.cancelDischarge);

module.exports = router;
