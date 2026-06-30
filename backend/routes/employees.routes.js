const express = require('express');
const router = express.Router();
const employeesController = require('../controllers/employees.controller');
const auth = require('../middleware/auth');

// GET /api/employees — active employees only (for form dropdowns)
router.get('/', auth, employeesController.getActiveEmployees);

module.exports = router;
