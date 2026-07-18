import api from './axios';

/**
 * Fetch paginated, filtered activity logs.
 * @param {object} params — { user_id, action, target_table, from_date, to_date, page, limit }
 */
export const getActivityLogs     = (params = {}) =>
  api.get('/api/admin/activity-logs', { params }).then(r => r.data);
