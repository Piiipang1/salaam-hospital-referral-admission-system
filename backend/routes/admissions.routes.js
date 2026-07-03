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
router.post('/', auth, requireRole('doctor'), admissionsController.createAdmission);

// PUT /api/admissions/:id/assign-room
router.put('/:id/assign-room', auth, requireRole('nurse', 'staff'), admissionsController.assignRoom);

// PUT /api/admissions/:id/discharge
router.put('/:id/discharge', auth, requireRole('doctor'), admissionsController.dischargePatient);

module.exports = router;
