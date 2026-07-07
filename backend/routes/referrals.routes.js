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

// GET /api/referrals
router.get('/', auth, referralsController.getAllReferrals);

// GET /api/referrals/history/:patient_id
router.get('/history/:patient_id', auth, referralsController.getReferralHistory);

// GET /api/referrals/:id
router.get('/:id', auth, referralsController.getReferralById);

// PUT /api/referrals/:id/status
router.put('/:id/status', auth, requireRole('doctor'), referralsController.updateReferralStatus);

// PUT /api/referrals/:id/reassign — admin or Doctor-in-Charge (checked in controller)
router.put('/:id/reassign', auth, requireRole('admin', 'doctor'), referralsController.reassignReferral);

module.exports = router;
