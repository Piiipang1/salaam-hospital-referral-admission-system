const express = require('express');
const router = express.Router();
const roomsController = require('../controllers/rooms.controller');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/roleGuard');

// GET /api/rooms
router.get('/', auth, roomsController.getAllRooms);

// GET /api/rooms/available
router.get('/available', auth, roomsController.getAvailableRooms);

// GET /api/rooms/:id
router.get('/:id', auth, roomsController.getRoomById);

// POST /api/rooms  — admin only
router.post('/', auth, requireRole('admin'), roomsController.createRoom);

// PUT /api/rooms/:id  — admin only
router.put('/:id', auth, requireRole('admin'), roomsController.updateRoom);

module.exports = router;
