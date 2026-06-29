import api from './axios';

/**
 * Fetch paginated, filtered activity logs.
 * @param {object} params — { user_id, action, target_table, from_date, to_date, page, limit }
 */
export const getActivityLogs     = (params = {}) =>
  api.get('/api/admin/activity-logs', { params }).then(r => r.data);

/**
 * Fetch distinct actions, target_tables, and all users for filter dropdowns.
 */
export const getActivityLogsMeta = () =>
  api.get('/api/admin/activity-logs/meta').then(r => r.data);
