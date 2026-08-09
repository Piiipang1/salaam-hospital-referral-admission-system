const express = require('express');
const router = express.Router();
const admissionsController = require('../controllers/admissions.controller');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/roleGuard');

// Admissions are clinical — admins are oversight-only and have no access.

// GET /api/admissions
router.get('/', auth, requireRole('doctor', 'nurse'), admissionsController.getAllAdmissions);

// GET /api/admissions/:id/clearance — pre-discharge checklist state.
// Declared before '/:id' so "clearance" is never parsed as part of that route.
router.get('/:id/clearance', auth, requireRole('doctor', 'nurse'), admissionsController.getDischargeClearance);

// GET /api/admissions/:id/followup-suggestion — which OPD clinic the discharge
// would route to, and the default follow-up date. Before '/:id' as above.
router.get('/:id/followup-suggestion', auth, requireRole('doctor', 'nurse'), admissionsController.getFollowupSuggestion);

// GET /api/admissions/:id
router.get('/:id', auth, requireRole('doctor', 'nurse'), admissionsController.getAdmissionById);

// POST /api/admissions
router.post('/', auth, requireRole('doctor'), admissionsController.createAdmission);

// PUT /api/admissions/:id/assign-room
router.put('/:id/assign-room', auth, requireRole('nurse'), admissionsController.assignRoom);

// PUT /api/admissions/:id/discharge — step 1: assigned doctor initiates
router.put('/:id/discharge', auth, requireRole('doctor'), admissionsController.dischargePatient);

// Clearance ticks. Doctors are included because DoctorOrder is doctor-only;
// the controller enforces which role may touch which item.
// PUT    /api/admissions/:id/clearance/:item — mark cleared
// DELETE /api/admissions/:id/clearance/:item — undo a tick made in error
router.put('/:id/clearance/:item',    auth, requireRole('doctor', 'nurse'), admissionsController.verifyClearanceItem);
router.delete('/:id/clearance/:item', auth, requireRole('doctor', 'nurse'), admissionsController.unverifyClearanceItem);

// PUT /api/admissions/:id/confirm-discharge — step 2: nurse confirms.
// Refuses with 409 unless every clearance item is verified.
router.put('/:id/confirm-discharge', auth, requireRole('nurse'), admissionsController.confirmDischarge);

// PUT /api/admissions/:id/cancel-discharge — mistaken initiation → back to Active
router.put('/:id/cancel-discharge', auth, requireRole('doctor'), admissionsController.cancelDischarge);

module.exports = router;
