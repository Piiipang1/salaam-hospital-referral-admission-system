const express = require('express');
const { rateLimit } = require('express-rate-limit');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const auth = require('../middleware/auth');

// Brute-force guard for the login route only — 10 attempts / 15 min / IP.
// Deliberately NOT applied to the whole API (the dashboard polls notifications).
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) =>
    res.status(429).json({
      success: false,
      message: 'Too many login attempts. Try again in a few minutes.',
    }),
});

// POST /api/auth/login
router.post('/login', loginLimiter, authController.login);

// POST /api/auth/logout (client-side token clear, server logs it)
router.post('/logout', auth, authController.logout);

// GET /api/auth/me
router.get('/me', auth, authController.getMe);

// PUT /api/auth/change-password
router.put('/change-password', auth, authController.changePassword);

module.exports = router;
