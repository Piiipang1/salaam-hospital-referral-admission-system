const express = require('express');
const router = express.Router();
const endorsementsController = require('../controllers/endorsements.controller');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/roleGuard');

// Nursing shift handoffs — nurse-only, both sides. The controller additionally
// restricts each endorsement to the two nurses named on it.

// POST /api/endorsements — submit a handoff to the next nurse on duty
router.post('/', auth, requireRole('nurse'), endorsementsController.createEndorsement);

// Literal paths BEFORE '/:id' so they are never parsed as an endorsement id.
// GET /api/endorsements/incoming — handoffs waiting for me
router.get('/incoming', auth, requireRole('nurse'), endorsementsController.getIncomingEndorsements);

// GET /api/endorsements/outgoing — handoffs I submitted
router.get('/outgoing', auth, requireRole('nurse'), endorsementsController.getOutgoingEndorsements);

// GET /api/endorsements/:id — full handoff with per-patient notes
router.get('/:id', auth, requireRole('nurse'), endorsementsController.getEndorsementById);

// POST /api/endorsements/:id/acknowledge — take over; moves the assignments
router.post('/:id/acknowledge', auth, requireRole('nurse'), endorsementsController.acknowledgeEndorsement);

// DELETE /api/endorsements/:id — withdraw a handoff not yet acknowledged
router.delete('/:id', auth, requireRole('nurse'), endorsementsController.cancelEndorsement);

module.exports = router;
