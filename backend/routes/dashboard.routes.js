const express    = require('express');
const router     = express.Router();
const dashboardController = require('../controllers/dashboard.controller');
const auth       = require('../middleware/auth');

// GET /api/dashboard/stats
router.get('/stats',           auth, dashboardController.getStats);

// GET /api/dashboard/recent-activity
router.get('/recent-activity', auth, dashboardController.getRecentActivity);

// GET /api/dashboard/my-stats  — role-specific stats + action list
router.get('/my-stats',        auth, dashboardController.getMyStats);

module.exports = router;
