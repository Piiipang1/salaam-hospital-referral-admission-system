const express = require('express');
const router = express.Router();
const triagesController = require('../controllers/triages.controller');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/roleGuard');

// POST /api/triages
router.post('/', auth, requireRole('admin', 'nurse', 'staff', 'doctor'), triagesController.createTriage);

// GET /api/triages
router.get('/', auth, triagesController.getAllTriages);

// GET /api/triages/:id
router.get('/:id', auth, triagesController.getTriageById);

// PUT /api/triages/:id
router.put('/:id', auth, requireRole('admin', 'nurse', 'staff', 'doctor'), triagesController.updateTriage);

// POST /api/triages/:id/vital-signs
router.post('/:id/vital-signs', auth, requireRole('admin', 'nurse', 'staff', 'doctor'), triagesController.addVitalSigns);

module.exports = router;
