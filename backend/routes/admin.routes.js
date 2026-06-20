const express    = require('express');
const router     = express.Router();
const auth       = require('../middleware/auth');
const requireRole = require('../middleware/roleGuard');
const backupCtrl = require('../controllers/backup.controller');

// All admin routes require authentication + admin role
const adminOnly = [auth, requireRole('admin')];

// POST /api/admin/backup          — trigger a new mysqldump backup
router.post('/backup',  ...adminOnly, backupCtrl.createBackup);

// GET  /api/admin/backups         — list all .sql backup files
router.get('/backups',  ...adminOnly, backupCtrl.listBackups);

// GET  /api/admin/backups/:filename — download a specific backup file
// IMPORTANT: must be last — static "backups" is registered before :filename
router.get('/backups/:filename', ...adminOnly, backupCtrl.downloadBackup);

module.exports = router;
