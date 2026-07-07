const express = require('express');
const router = express.Router();
const triagesController = require('../controllers/triages.controller');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/roleGuard');

// POST /api/triages/emergency  — must be declared before /:id routes
router.post('/emergency', auth, requireRole('doctor', 'nurse', 'staff'), triagesController.createEmergencyTriage);

// GET /api/triages/visit-rooms/options — must also precede /:id
router.get('/visit-rooms/options', auth, requireRole('doctor', 'nurse', 'staff', 'admin'), triagesController.getVisitRoomOptions);

// POST /api/triages
router.post('/', auth, requireRole('nurse', 'staff'), triagesController.createTriage);

// GET /api/triages
router.get('/', auth, triagesController.getAllTriages);

// GET /api/triages/:id
router.get('/:id', auth, triagesController.getTriageById);

// PUT /api/triages/:id
router.put('/:id', auth, requireRole('nurse', 'staff'), triagesController.updateTriage);

// POST /api/triages/:id/vital-signs
router.post('/:id/vital-signs', auth, requireRole('nurse', 'staff'), triagesController.addVitalSigns);

module.exports = router;
