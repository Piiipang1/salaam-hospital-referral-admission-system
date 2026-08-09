const express = require('express');
const router  = express.Router();
const referralsController = require('../controllers/referrals.controller');
const auth        = require('../middleware/auth');
const requireRole = require('../middleware/roleGuard');
const { upload }  = require('../middleware/upload');

// POST /api/referrals  — accepts optional file_attachment via multipart/form-data
router.post(
  '/',
  auth,
  requireRole('doctor'),
  upload.single('file_attachment'),
  referralsController.createReferral
);

// POST /api/referrals/external — divert a patient to an OUTSIDE hospital when
// this facility is at capacity. Deliberately wider than the doctor-only rule
// above: turning a patient away happens at the intake desk, so nurses
// need it too. Internal referrals (POST /) stay doctor-only — this route can
// never assign a patient to a doctor in this system.
router.post(
  '/external',
  auth,
  requireRole('doctor', 'nurse'),
  upload.single('file_attachment'),
  referralsController.createExternalReferral
);

// GET /api/referrals/external/context — bed availability + the patient's
// diagnoses for the external-referral form. Same roles as the POST above.
// Declared before '/:id' so "external" is never parsed as a referral id.
router.get(
  '/external/context',
  auth,
  requireRole('doctor', 'nurse'),
  referralsController.getExternalReferralContext
);

// GET /api/referrals  — referrals are clinical; doctors only (nurses/admin have no access)
router.get('/', auth, requireRole('doctor'), referralsController.getAllReferrals);

// GET /api/referrals/history/:patient_id
router.get('/history/:patient_id', auth, requireRole('doctor'), referralsController.getReferralHistory);

// GET /api/referrals/:id
router.get('/:id', auth, requireRole('doctor'), referralsController.getReferralById);

// PUT /api/referrals/:id/status  — assigned doctor accepts/completes; referring doctor cancels
router.put('/:id/status', auth, requireRole('doctor'), referralsController.updateReferralStatus);

// PUT /api/referrals/:id/reassign — Doctor-in-Charge only (checked in controller)
router.put('/:id/reassign', auth, requireRole('doctor'), referralsController.reassignReferral);

module.exports = router;
