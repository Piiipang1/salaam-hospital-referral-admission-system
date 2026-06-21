const express = require('express');
const router = express.Router();
const reportsController = require('../controllers/reports.controller');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/roleGuard');

// GET /api/reports/admissions
router.get('/admissions', auth, requireRole('admin', 'doctor'), reportsController.admissionsReport);

// GET /api/reports/referrals
router.get('/referrals', auth, requireRole('admin', 'doctor'), reportsController.referralsReport);

// GET /api/reports/turnaround
router.get('/turnaround', auth, requireRole('admin', 'doctor'), reportsController.turnaroundReport);

module.exports = router;
