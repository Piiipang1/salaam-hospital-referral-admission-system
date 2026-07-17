const express = require('express');
const router = express.Router();
const assignmentsController = require('../controllers/assignments.controller');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/roleGuard');

// Attending-doctor assignment lifecycle — all doctor-only. Finer authorization
// is enforced in the controller against fresh DB reads: accept/decline require
// the caller to be the doctor the Pending row proposes; cancel requires a
// live-checked Doctor-in-Charge.

// GET /api/assignments/pending — proposals awaiting the logged-in doctor
router.get('/pending', auth, requireRole('doctor'), assignmentsController.getMyPendingAssignments);

// POST /api/assignments/:patientId/accept
router.post('/:patientId/accept', auth, requireRole('doctor'), assignmentsController.acceptAssignment);

// POST /api/assignments/:patientId/decline — body: { reason }
router.post('/:patientId/decline', auth, requireRole('doctor'), assignmentsController.declineAssignment);

// POST /api/assignments/:patientId/cancel — Doctor-in-Charge only (checked in controller)
router.post('/:patientId/cancel', auth, requireRole('doctor'), assignmentsController.cancelAssignment);

module.exports = router;
