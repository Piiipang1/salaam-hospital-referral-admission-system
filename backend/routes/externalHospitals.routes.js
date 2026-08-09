const express = require('express');
const router = express.Router();
const externalHospitalsController = require('../controllers/externalHospitals.controller');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/roleGuard');

// GET /api/external-hospitals — the directory the external referral form reads.
// Same roles as POST /api/referrals/external, plus admin, who maintains it.
// The controller honours ?include_inactive=true for admins only.
router.get(
  '/',
  auth,
  requireRole('admin', 'doctor', 'nurse'),
  externalHospitalsController.getAllExternalHospitals
);

// POST /api/external-hospitals — admin only
router.post('/', auth, requireRole('admin'), externalHospitalsController.createExternalHospital);

// PUT /api/external-hospitals/:id — admin only (also the retire/revive switch)
router.put('/:id', auth, requireRole('admin'), externalHospitalsController.updateExternalHospital);

// DELETE /api/external-hospitals/:id — admin only; refuses once referrals exist
router.delete('/:id', auth, requireRole('admin'), externalHospitalsController.deleteExternalHospital);

module.exports = router;
