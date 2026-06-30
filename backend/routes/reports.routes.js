const express = require('express');
const router = express.Router();
const reportsController = require('../controllers/reports.controller');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/roleGuard');

// GET /api/reports/admissions
router.get('/admissions', auth, requireRole('admin'), reportsController.admissionsReport);

// GET /api/reports/referrals
router.get('/referrals', auth, requireRole('admin'), reportsController.referralsReport);

// GET /api/reports/turnaround
router.get('/turnaround', auth, requireRole('admin'), reportsController.turnaroundReport);

module.exports = router;
