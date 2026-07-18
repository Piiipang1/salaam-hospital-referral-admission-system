const db = require('../config/db');

// GET /api/admin/activity-logs
// Returns paginated, filtered activity logs joined with the users table.
const getActivityLogs = async (req, res) => {
  const {
    user_id,
    role,
    action,
    target_table,
    from_date,
    to_date,
    page  = 1,
    limit = 25,
  } = req.query;

  const offset = (parseInt(page) - 1) * parseInt(limit);

  try {
    const conditions = [];
    const params     = [];

    if (user_id)      { conditions.push('al.user_id = ?');                    params.push(user_id); }
    if (role)         { conditions.push('u.role = ?');                        params.push(role); }
    if (action)       { conditions.push('al.action = ?');                     params.push(action); }
    if (target_table) { conditions.push('al.target_table = ?');               params.push(target_table); }
    if (from_date)    { conditions.push('DATE(al.created_at) >= ?');          params.push(from_date); }
    if (to_date)      { conditions.push('DATE(al.created_at) <= ?');          params.push(to_date); }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

    const [[rows], [[{ total }]]] = await Promise.all([
      db.query(
        `SELECT
           al.log_id,
           al.user_id,
           u.username,
           u.role,
           al.action,
           al.target_table,
           al.target_id,
           al.created_at
         FROM activity_logs al
         LEFT JOIN users u ON al.user_id = u.user_id
         ${where}
         ORDER BY al.created_at DESC
         LIMIT ? OFFSET ?`,
        [...params, parseInt(limit), offset]
      ),
      db.query(
        `SELECT COUNT(*) AS total FROM activity_logs al LEFT JOIN users u ON al.user_id = u.user_id ${where}`,
        params
      ),
    ]);

    return res.status(200).json({
      success: true,
      data: rows,
      total,
      page:  parseInt(page),
      limit: parseInt(limit),
    });
  } catch (err) {
    console.error('getActivityLogs error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

module.exports = { getActivityLogs };
