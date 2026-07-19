const { spawn } = require('child_process');
const path = require('path');
const fs   = require('fs');
const db   = require('../config/db');

// ─── Backup directory: backend/backups/ ───────────────────────────────────────
const BACKUP_DIR = path.join(__dirname, '../backups');

// Ensure the backups folder exists when this module loads
if (!fs.existsSync(BACKUP_DIR)) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

// Resolve a configured tool path to something spawn() can launch WITHOUT a
// shell. On Windows a bare path like "C:\xampp\mysql\bin\mysqldump" (no .exe)
// only resolves through cmd.exe; since we no longer use a shell, append .exe
// when that file exists. On Linux/deploy the tools are on PATH, so we fall back
// to the bare command name.
const resolveExe = (configuredPath, fallback) => {
  if (!configuredPath) return fallback;
  if (process.platform === 'win32' && !path.extname(configuredPath) && fs.existsSync(`${configuredPath}.exe`)) {
    return `${configuredPath}.exe`;
  }
  return configuredPath;
};

// The DB password is passed to the mysql tools via the MYSQL_PWD environment
// variable — never as a --password CLI arg (which leaks in process listings)
// and never interpolated into a shell string.
const childEnv = (dbPassword) => ({ ...process.env, MYSQL_PWD: dbPassword ?? '' });

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

  const dumpExe = resolveExe(MYSQLDUMP_PATH, 'mysqldump');

  // No shell, no interpolation: every value is a discrete argv entry, so a DB
  // name or credential can never break out into a command. The dump is written
  // by piping the child's stdout into the file — no shell "> redirect".
  const args = [
    `--host=${DB_HOST}`,
    `--port=${DB_PORT}`,
    `--user=${DB_USER}`,
    '--single-transaction',
    '--routines',
    '--triggers',
    '--add-drop-table',
    DB_NAME,
  ];

  console.log(`[backup] Starting backup → ${filename}`);

  const outStream = fs.createWriteStream(outputPath);
  const child = spawn(dumpExe, args, { env: childEnv(DB_PASSWORD), windowsHide: true });
  child.stdout.pipe(outStream);

  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

  let responded = false;
  const cleanupFile = () => {
    try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch { /* ignore */ }
  };
  const failOnce = (logMsg) => {
    if (responded) return;
    responded = true;
    console.error(`[backup] ${logMsg}`); // stderr / error stays server-side only
    outStream.destroy();
    cleanupFile();
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        message: 'Backup failed. Check that mysqldump is on PATH or set MYSQLDUMP_PATH in .env.',
      });
    }
  };

  // Success requires BOTH the process to exit 0 AND the file to finish writing.
  let exitCode = null;
  let streamFinished = false;
  const succeedIfReady = () => {
    if (responded || exitCode !== 0 || !streamFinished) return;
    responded = true;
    const stats = fs.statSync(outputPath);
    console.log(`[backup] Completed: ${filename} (${formatSize(stats.size)})`);
    res.status(201).json({
      success:    true,
      message:    'Backup created successfully.',
      filename,
      size:       formatSize(stats.size),
      created_at: new Date().toISOString(),
    });
  };

  child.on('error', (err) => failOnce(`spawn failed: ${err.message}`));
  outStream.on('error', (err) => failOnce(`write stream error: ${err.message}`));
  child.on('close', (code) => {
    exitCode = code;
    if (code !== 0) return failOnce(`mysqldump exited ${code}: ${stderr}`);
    succeedIfReady();
  });
  outStream.on('finish', () => { streamFinished = true; succeedIfReady(); });
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
          // mtime, not birthtime: creation time is unreliable on some Linux
          // filesystems (returns 0 / the epoch), which would break sort order.
          // A backup file is written once and never modified, so mtime is
          // effectively its creation time here.
          created_at: stats.mtime.toISOString(),
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

  // ── 2. Build mysql restore command (no shell, args array) ──────────────────
  const mysqlExe = resolveExe(MYSQL_PATH, 'mysql');
  const args = [
    `--host=${DB_HOST}`,
    `--port=${DB_PORT}`,
    `--user=${DB_USER}`,
    DB_NAME,
  ];

  console.log(`[restore] Starting restore from ${safeName} …`);

  // ── 3. Execute restore — stream the .sql file into the child's stdin ───────
  const child     = spawn(mysqlExe, args, { env: childEnv(DB_PASSWORD), windowsHide: true });
  const inStream  = fs.createReadStream(filePath);
  inStream.pipe(child.stdin);

  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

  let responded = false;
  const failOnce = (logMsg) => {
    if (responded) return;
    responded = true;
    console.error(`[restore] ${logMsg}`); // stderr / error stays server-side only
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        message: 'Restore failed. Check that mysql is on PATH or set MYSQL_PATH in .env.',
      });
    }
  };

  child.on('error', (err) => failOnce(`spawn failed: ${err.message}`));
  inStream.on('error', (err) => failOnce(`read stream error: ${err.message}`));

  child.on('close', async (code) => {
    if (responded) return;
    if (code !== 0) return failOnce(`mysql exited ${code}: ${stderr}`);
    responded = true;

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
    return res.status(500).json({ success: false, message: 'Could not delete backup file.' });
  }
};

module.exports = { createBackup, listBackups, downloadBackup, restoreBackup, deleteBackup };
