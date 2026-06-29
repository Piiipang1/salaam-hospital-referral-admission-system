import api from './axios';

export const createBackup  = () => api.post('/api/admin/backup').then(r => r.data);
export const listBackups   = () => api.get('/api/admin/backups').then(r => r.data);

// Returns the full URL for a direct authenticated download via anchor tag
export const getBackupDownloadUrl = (filename) =>
  `/api/admin/backups/${encodeURIComponent(filename)}`;

/**
 * Restore the database from a saved backup file.
 * @param {string} filename — exact filename from the backup list
 */
export const restoreBackup = (filename) =>
  api.post(`/api/admin/restore/${encodeURIComponent(filename)}`).then(r => r.data);

/**
 * Permanently delete a backup file from the server.
 * @param {string} filename — exact filename from the backup list
 */
export const deleteBackup = (filename) =>
  api.delete(`/api/admin/backups/${encodeURIComponent(filename)}`).then(r => r.data);

