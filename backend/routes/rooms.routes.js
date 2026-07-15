const express = require('express');
const router = express.Router();
const roomsController = require('../controllers/rooms.controller');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/roleGuard');

// GET /api/rooms — room grid with occupancy. Admin/nurse/staff only (matches
// the sidebar and the /rooms RoleRoute); doctors use My Patients instead.
// The controller additionally strips clinical fields for admins.
router.get('/', auth, requireRole('admin', 'nurse', 'staff'), roomsController.getAllRooms);

// GET /api/rooms/available
router.get('/available', auth, roomsController.getAvailableRooms);

// GET /api/rooms/:id
router.get('/:id', auth, roomsController.getRoomById);

// POST /api/rooms  — admin only
router.post('/', auth, requireRole('admin'), roomsController.createRoom);

// PUT /api/rooms/:id  — admin only
router.put('/:id', auth, requireRole('admin'), roomsController.updateRoom);

// DELETE /api/rooms/:id  — admin only
router.delete('/:id', auth, requireRole('admin'), roomsController.deleteRoom);

module.exports = router;
