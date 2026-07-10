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

// GET /api/referrals  — referrals are clinical; doctors only (nurses/staff/admin have no access)
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
