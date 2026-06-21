const express = require('express');
const router = express.Router();
const referralsController = require('../controllers/referrals.controller');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/roleGuard');

// POST /api/referrals
router.post('/', auth, requireRole('admin', 'doctor', 'nurse', 'staff'), referralsController.createReferral);

// GET /api/referrals
router.get('/', auth, referralsController.getAllReferrals);

// GET /api/referrals/history/:patient_id
router.get('/history/:patient_id', auth, referralsController.getReferralHistory);

// GET /api/referrals/:id
router.get('/:id', auth, referralsController.getReferralById);

// PUT /api/referrals/:id/status
router.put('/:id/status', auth, requireRole('admin', 'doctor'), referralsController.updateReferralStatus);

module.exports = router;
