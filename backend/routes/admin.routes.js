const express    = require('express');
const router     = express.Router();
const auth       = require('../middleware/auth');
const requireRole = require('../middleware/roleGuard');
const backupCtrl  = require('../controllers/backup.controller');
const adminCtrl   = require('../controllers/admin.controller');

// All admin routes require authentication + admin role
const adminOnly = [auth, requireRole('admin')];

// ── Backup routes ──────────────────────────────────────────────
// POST /api/admin/backup          — trigger a new mysqldump backup
router.post('/backup',           ...adminOnly, backupCtrl.createBackup);

// GET  /api/admin/backups         — list all .sql backup files
router.get('/backups',           ...adminOnly, backupCtrl.listBackups);

// GET  /api/admin/backups/:filename — download a specific backup file
// IMPORTANT: must be last — static "backups" is registered before :filename
router.get('/backups/:filename',    ...adminOnly, backupCtrl.downloadBackup);

// DELETE /api/admin/backups/:filename — permanently delete a backup file
router.delete('/backups/:filename', ...adminOnly, backupCtrl.deleteBackup);

// POST /api/admin/restore/:filename — restore DB from a saved .sql backup
router.post('/restore/:filename',   ...adminOnly, backupCtrl.restoreBackup);

// ── Audit Trail routes ─────────────────────────────────────────
// GET /api/admin/activity-logs/meta — distinct actions, tables, users (for filters)
// NOTE: /meta must be registered BEFORE /:id-style routes to avoid conflict
router.get('/activity-logs/meta', ...adminOnly, adminCtrl.getActivityLogsMeta);

// GET /api/admin/activity-logs — paginated + filtered log entries
router.get('/activity-logs',      ...adminOnly, adminCtrl.getActivityLogs);

module.exports = router;
