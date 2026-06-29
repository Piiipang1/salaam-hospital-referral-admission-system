const { exec } = require('child_process');
const path = require('path');
const fs   = require('fs');
const db   = require('../config/db');

// ─── Backup directory: backend/backups/ ───────────────────────────────────────
const BACKUP_DIR = path.join(__dirname, '../backups');

// Ensure the backups folder exists when this module loads
if (!fs.existsSync(BACKUP_DIR)) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build a safe timestamp string suitable for filenames: 2026-06-16_14-35-00 */
const timestamp = () =>
  new Date()
    .toISOString()
    .replace('T', '_')
    .replace(/:/g, '-')
    .slice(0, 19);

/** Format file size from bytes to a human-readable string */
const formatSize = (bytes) => {
  if (bytes < 1024)         return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
};

// ─── POST /api/admin/backup ───────────────────────────────────────────────────
const createBackup = (req, res) => {
  const {
    DB_HOST     = 'localhost',
    DB_PORT     = '3306',
    DB_USER     = 'root',
    DB_PASSWORD = '',
    DB_NAME     = 'salaam_hospital',
    MYSQLDUMP_PATH,
  } = process.env;

  const filename   = `${DB_NAME}_backup_${timestamp()}.sql`;
  const outputPath = path.join(BACKUP_DIR, filename);

  const dumpExe     = MYSQLDUMP_PATH ? `"${MYSQLDUMP_PATH}"` : 'mysqldump';
  const passwordArg = DB_PASSWORD ? `--password="${DB_PASSWORD}"` : '';

  const command = [
    dumpExe,
    `--host=${DB_HOST}`,
    `--port=${DB_PORT}`,
    `--user=${DB_USER}`,
    passwordArg,
    '--single-transaction',
    '--routines',
    '--triggers',
    '--add-drop-table',
    `"${DB_NAME}"`,
    `> "${outputPath}"`,
  ].filter(Boolean).join(' ');

  console.log(`[backup] Starting backup → ${filename}`);

  exec(command, { shell: true }, (err, stdout, stderr) => {
    if (err) {
      console.error('[backup] mysqldump failed:', stderr || err.message);
      if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
      return res.status(500).json({
        success: false,
        message: 'Backup failed. Check that mysqldump is on PATH or set MYSQLDUMP_PATH in .env.',
        detail:  stderr || err.message,
      });
    }

    const stats = fs.statSync(outputPath);
    console.log(`[backup] Completed: ${filename} (${formatSize(stats.size)})`);

    return res.status(201).json({
      success:    true,
      message:    'Backup created successfully.',
      filename,
      size:       formatSize(stats.size),
      created_at: new Date().toISOString(),
    });
  });
};

// ─── GET /api/admin/backups ───────────────────────────────────────────────────
const listBackups = (req, res) => {
  try {
    const files = fs.readdirSync(BACKUP_DIR)
      .filter((f) => f.endsWith('.sql'))
      .map((filename) => {
        const stats = fs.statSync(path.join(BACKUP_DIR, filename));
        return {
          filename,
          size:       formatSize(stats.size),
          size_bytes: stats.size,
          created_at: stats.birthtime.toISOString(),
        };
      })
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    return res.status(200).json({ success: true, data: files, total: files.length });
  } catch (err) {
    console.error('[backup] listBackups error:', err);
    return res.status(500).json({ success: false, message: 'Could not read backup directory.' });
  }
};

// ─── GET /api/admin/backups/:filename  (download) ────────────────────────────
const downloadBackup = (req, res) => {
  const safeName = path.basename(req.params.filename);
  const filePath = path.join(BACKUP_DIR, safeName);

  if (!safeName.endsWith('.sql') || !fs.existsSync(filePath)) {
    return res.status(404).json({ success: false, message: 'Backup file not found.' });
  }

  res.download(filePath, safeName, (err) => {
    if (err) {
      console.error('[backup] download error:', err);
      if (!res.headersSent) {
        res.status(500).json({ success: false, message: 'Download failed.' });
      }
    }
  });
};

// ─── POST /api/admin/restore/:filename ───────────────────────────────────────
// Restores the database from an existing .sql backup file (admin-only).
//
// Required .env variables:
//   DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME  — same as backup
//   MYSQL_PATH  — full path to the mysql binary, e.g.:
//                   MYSQL_PATH=C:\xampp\mysql\bin\mysql
//                 If not set, "mysql" must be on the system PATH.
//
// Security:
//   - Only the basename of the filename is used (path traversal is impossible).
//   - File must already exist in the BACKUP_DIR and end with .sql.
//   - Route is protected by auth + requireRole('admin').
const restoreBackup = async (req, res) => {
  const {
    DB_HOST     = 'localhost',
    DB_PORT     = '3306',
    DB_USER     = 'root',
    DB_PASSWORD = '',
    DB_NAME     = 'salaam_hospital',
    MYSQL_PATH,
  } = process.env;

  // ── 1. Validate filename ────────────────────────────────────────────────────
  const safeName = path.basename(req.params.filename);
  if (!safeName.endsWith('.sql')) {
    return res.status(400).json({
      success: false,
      message: 'Invalid filename — must be a .sql file.',
    });
  }

  const filePath = path.join(BACKUP_DIR, safeName);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({
      success: false,
      message: `Backup file not found: ${safeName}`,
    });
  }

  // ── 2. Build mysql restore command ─────────────────────────────────────────
  const mysqlExe    = MYSQL_PATH ? `"${MYSQL_PATH}"` : 'mysql';
  const passwordArg = DB_PASSWORD ? `--password="${DB_PASSWORD}"` : '';

  const command = [
    mysqlExe,
    `--host=${DB_HOST}`,
    `--port=${DB_PORT}`,
    `--user=${DB_USER}`,
    passwordArg,
    `"${DB_NAME}"`,
    `< "${filePath}"`,
  ].filter(Boolean).join(' ');

  console.log(`[restore] Starting restore from ${safeName} …`);

  // ── 3. Execute restore ──────────────────────────────────────────────────────
  exec(command, { shell: true }, async (err, stdout, stderr) => {
    if (err) {
      console.error('[restore] mysql restore failed:', stderr || err.message);
      return res.status(500).json({
        success: false,
        message: 'Restore failed. Check that mysql is on PATH or set MYSQL_PATH in .env.',
        detail:  stderr || err.message,
      });
    }

    console.log(`[restore] Restore complete from ${safeName}`);

    // ── 4. Audit log (best-effort — DB may have just been replaced) ────────────
    try {
      await db.query(
        "INSERT INTO activity_logs (user_id, action, target_table, target_id) VALUES (?, 'RESTORE', 'database', 0)",
        [req.user.user_id]
      );
    } catch (logErr) {
      console.warn('[restore] activity_log insert failed (non-fatal):', logErr.message);
    }

    return res.status(200).json({
      success:     true,
      message:     `Database restored successfully from ${safeName}.`,
      filename:    safeName,
      restored_at: new Date().toISOString(),
    });
  });
};

// ─── DELETE /api/admin/backups/:filename ──────────────────────────────────────
// Permanently deletes a backup file from the backups directory.
// Security: only the basename is used — path traversal is impossible.
const deleteBackup = (req, res) => {
  const safeName = path.basename(req.params.filename);

  if (!safeName.endsWith('.sql')) {
    return res.status(400).json({ success: false, message: 'Invalid filename — must be a .sql file.' });
  }

  const filePath = path.join(BACKUP_DIR, safeName);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ success: false, message: `Backup file not found: ${safeName}` });
  }

  try {
    fs.unlinkSync(filePath);
    console.log(`[backup] Deleted: ${safeName}`);
    return res.status(200).json({ success: true, message: `Backup deleted: ${safeName}`, filename: safeName });
  } catch (err) {
    console.error('[backup] deleteBackup error:', err);
    return res.status(500).json({ success: false, message: 'Could not delete backup file.', detail: err.message });
  }
};

module.exports = { createBackup, listBackups, downloadBackup, restoreBackup, deleteBackup };
