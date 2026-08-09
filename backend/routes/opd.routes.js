const express = require('express');
const router = express.Router();
const opdController = require('../controllers/opd.controller');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/roleGuard');

// Outpatient follow-ups are clinical records — admins are oversight-only.
// Follow-ups are CREATED by confirmDischarge, never here; these routes read the
// OPD book and keep it current.

// GET /api/opd/clinics — routing targets, needed by the discharge dialog
router.get('/clinics', auth, requireRole('doctor', 'nurse'), opdController.getClinics);

// GET /api/opd/followups — the OPD book, scoped per role by the controller.
// Declared before '/followups/:id' so "followups" is matched exactly.
router.get('/followups', auth, requireRole('doctor', 'nurse'), opdController.getFollowups);

// GET /api/opd/followups/:id
router.get('/followups/:id', auth, requireRole('doctor', 'nurse'), opdController.getFollowupById);

// PUT /api/opd/followups/:id — reschedule / re-route / amend notes
router.put('/followups/:id', auth, requireRole('doctor', 'nurse'), opdController.updateFollowup);

// PUT /api/opd/followups/:id/status — Completed | Missed | Cancelled
router.put('/followups/:id/status', auth, requireRole('doctor', 'nurse'), opdController.updateFollowupStatus);

module.exports = router;
