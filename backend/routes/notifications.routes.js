const express = require('express');
const router = express.Router();
const notificationsController = require('../controllers/notifications.controller');
const auth = require('../middleware/auth');

// GET /api/notifications  — get notifications for logged-in user
router.get('/', auth, notificationsController.getMyNotifications);

// PUT /api/notifications/read-all  — mark all as read (MUST be before /:id/read)
router.put('/read-all', auth, notificationsController.markAllAsRead);

// PUT /api/notifications/:id/read  — mark one as read
router.put('/:id/read', auth, notificationsController.markAsRead);

module.exports = router;
