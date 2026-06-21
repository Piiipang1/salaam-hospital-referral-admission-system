import api from './axios';

export const createBackup    = () => api.post('/api/admin/backup').then(r => r.data);
export const listBackups     = () => api.get('/api/admin/backups').then(r => r.data);

// Returns the full URL for a direct authenticated download via anchor tag
export const getBackupDownloadUrl = (filename) => `/api/admin/backups/${encodeURIComponent(filename)}`;
