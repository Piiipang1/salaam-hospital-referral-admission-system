const express = require('express');
const router = express.Router();
const nursingController = require('../controllers/nursing.controller');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/roleGuard');

// Every route here is ward-scoped to the calling nurse's own department, which
// only makes sense for a nurse: the controller resolves req.user.linked_id to
// an `employees` row. Doctors and admins have no ward roster of their own.

// GET /api/nursing/me — my ward + workload counts. Never 409s on a missing
// department; it is how the UI discovers that one is missing.
router.get('/me', auth, requireRole('nurse'), nursingController.getMyNursingContext);

// GET /api/nursing/ward?mine=true — patients in my ward
router.get('/ward', auth, requireRole('nurse'), nursingController.getWardPatients);

// GET /api/nursing/colleagues — other active nurses in my ward
router.get('/colleagues', auth, requireRole('nurse'), nursingController.getWardNurses);

// POST /api/nursing/assignments — take a patient, or hand one to a ward colleague
router.post('/assignments', auth, requireRole('nurse'), nursingController.assignPatient);

// DELETE /api/nursing/assignments/:patientId — give up a patient I hold
router.delete('/assignments/:patientId', auth, requireRole('nurse'), nursingController.releasePatient);

module.exports = router;
