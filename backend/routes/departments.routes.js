const express = require('express');
const router = express.Router();
const departmentsController = require('../controllers/departments.controller');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/roleGuard');

// GET /api/departments — ward list. Open to any authenticated role: names and
// counts only, no clinical or row-level data.
router.get('/', auth, departmentsController.getAllDepartments);

// PUT /api/departments/nurses/:employeeId — admin assigns a nurse to a ward.
// Declared before '/:id' so "nurses" is never parsed as a department id.
router.put('/nurses/:employeeId', auth, requireRole('admin'), departmentsController.setEmployeeDepartment);

// POST /api/departments — admin only
router.post('/', auth, requireRole('admin'), departmentsController.createDepartment);

// PUT /api/departments/:id — admin only (also the retire/revive switch)
router.put('/:id', auth, requireRole('admin'), departmentsController.updateDepartment);

// DELETE /api/departments/:id — admin only; refuses once anything references it
router.delete('/:id', auth, requireRole('admin'), departmentsController.deleteDepartment);

module.exports = router;
