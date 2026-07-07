const express = require('express');
const router = express.Router();
const doctorsController = require('../controllers/doctors.controller');
const auth = require('../middleware/auth');

// GET /api/doctors          — all doctors (admin view)
router.get('/', auth, doctorsController.getAllDoctors);

// GET /api/doctors/active   — active doctors only (for form dropdowns)
// IMPORTANT: must be defined before /:id to avoid route conflict
router.get('/active', auth, doctorsController.getActiveDoctors);

// GET /api/doctors/workload — admin or Doctor-in-Charge (checked in controller)
// Must also precede any /:id route.
router.get('/workload', auth, doctorsController.getDoctorWorkload);

module.exports = router;
