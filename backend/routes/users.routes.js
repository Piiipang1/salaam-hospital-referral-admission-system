const express = require('express');
const router = express.Router();
const usersController = require('../controllers/users.controller');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/roleGuard');

// All routes below require authentication + admin role
// POST /api/users
router.post('/', auth, requireRole('admin'), usersController.createUser);

// GET /api/users
router.get('/', auth, requireRole('admin'), usersController.getAllUsers);

// GET /api/users/:id
router.get('/:id', auth, requireRole('admin'), usersController.getUserById);

// PUT /api/users/:id
router.put('/:id', auth, requireRole('admin'), usersController.updateUser);

// DELETE /api/users/:id  (deactivate)
router.delete('/:id', auth, requireRole('admin'), usersController.deactivateUser);

module.exports = router;
