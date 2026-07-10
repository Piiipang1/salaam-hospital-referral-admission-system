const express = require('express');
const router = express.Router();
const triagesController = require('../controllers/triages.controller');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/roleGuard');

// POST /api/triages/emergency  — must be declared before /:id routes
router.post('/emergency', auth, requireRole('doctor', 'nurse', 'staff'), triagesController.createEmergencyTriage);

// GET /api/triages/visit-rooms/options — must also precede /:id
router.get('/visit-rooms/options', auth, requireRole('doctor', 'nurse', 'staff'), triagesController.getVisitRoomOptions);

// POST /api/triages
router.post('/', auth, requireRole('nurse', 'staff'), triagesController.createTriage);

// Triage data is clinical — admins are oversight-only and have no access.

// GET /api/triages
router.get('/', auth, requireRole('doctor', 'nurse', 'staff'), triagesController.getAllTriages);

// GET /api/triages/:id
router.get('/:id', auth, requireRole('doctor', 'nurse', 'staff'), triagesController.getTriageById);

// PUT /api/triages/:id
router.put('/:id', auth, requireRole('nurse', 'staff'), triagesController.updateTriage);

// PUT /api/triages/:id/assign-doctor — Doctor-in-Charge only (checked in controller)
router.put('/:id/assign-doctor', auth, requireRole('doctor'), triagesController.assignTriageDoctor);

// POST /api/triages/:id/vital-signs
router.post('/:id/vital-signs', auth, requireRole('nurse', 'staff'), triagesController.addVitalSigns);

module.exports = router;
