const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const auth = require('../middleware/auth');

// POST /api/auth/login
router.post('/login', authController.login);

// POST /api/auth/logout (client-side token clear, server logs it)
router.post('/logout', auth, authController.logout);

// GET /api/auth/me
router.get('/me', auth, authController.getMe);

// PUT /api/auth/change-password
router.put('/change-password', auth, authController.changePassword);

module.exports = router;
