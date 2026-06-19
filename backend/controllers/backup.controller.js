const { exec } = require('child_process');
const path = require('path');
const fs   = require('fs');

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
    .toISOString()           // "2026-06-16T14:35:00.000Z"
    .replace('T', '_')
    .replace(/:/g, '-')
    .slice(0, 19);           // "2026-06-16_14-35-00"

/** Format file size from bytes to a human-readable string */
const formatSize = (bytes) => {
  if (bytes < 1024)        return `${bytes} B`;
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

  // Use custom path from .env if set (e.g. MYSQLDUMP_PATH=C:\xampp\mysql\bin\mysqldump)
  // otherwise fall back to mysqldump which must be on PATH
  const dumpExe = MYSQLDUMP_PATH
    ? `"${MYSQLDUMP_PATH}"`
    : 'mysqldump';

  // Build mysqldump command — password handled safely:
  //   - If password is empty, omit --password entirely to avoid "using password on CLI" warning
  //   - Never log the actual password
  const passwordArg = DB_PASSWORD ? `--password="${DB_PASSWORD}"` : '';
  const command = [
    dumpExe,
    `--host=${DB_HOST}`,
    `--port=${DB_PORT}`,
    `--user=${DB_USER}`,
    passwordArg,
    '--single-transaction',   // consistent snapshot without locking
    '--routines',             // include stored procedures/functions
    '--triggers',             // include triggers
    '--add-drop-table',       // safe to re-import over existing schema
    `"${DB_NAME}"`,
    `> "${outputPath}"`,
  ].filter(Boolean).join(' ');

  console.log(`[backup] Starting backup → ${filename}`);

  exec(command, { shell: true }, (err, stdout, stderr) => {
    if (err) {
      console.error('[backup] mysqldump failed:', stderr || err.message);
      // Clean up any partial file
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
      success:  true,
      message:  'Backup created successfully.',
      filename,
      size:     formatSize(stats.size),
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
      // Newest first
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    return res.status(200).json({ success: true, data: files, total: files.length });
  } catch (err) {
    console.error('[backup] listBackups error:', err);
    return res.status(500).json({ success: false, message: 'Could not read backup directory.' });
  }
};

// ─── GET /api/admin/backups/:filename  (download) ────────────────────────────
const downloadBackup = (req, res) => {
  // Strip any path traversal attempts — only allow the basename
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

module.exports = { createBackup, listBackups, downloadBackup };
