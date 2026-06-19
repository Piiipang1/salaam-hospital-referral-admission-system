const db = require('../config/db');

// GET /api/notifications
const getMyNotifications = async (req, res) => {
  try {
    // Fetch full list + unread count in parallel
    const [
      [rows],
      [[{ unread_count }]],
    ] = await Promise.all([
      db.query(
        'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC',
        [req.user.user_id]
      ),
      db.query(
        'SELECT COUNT(*) AS unread_count FROM notifications WHERE user_id = ? AND is_read = 0',
        [req.user.user_id]
      ),
    ]);

    return res.status(200).json({ success: true, data: rows, unread_count });
  } catch (err) {
    console.error('getMyNotifications error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// PUT /api/notifications/:id/read
const markAsRead = async (req, res) => {
  try {
    // Verify the notification exists before updating
    const [rows] = await db.query(
      'SELECT notification_id, user_id FROM notifications WHERE notification_id = ?',
      [req.params.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Notification not found.' });
    }

    // Verify ownership — a user may not mark another user's notification
    if (rows[0].user_id !== req.user.user_id) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    await db.query(
      'UPDATE notifications SET is_read = 1 WHERE notification_id = ? AND user_id = ?',
      [req.params.id, req.user.user_id]
    );

    return res.status(200).json({ success: true, message: 'Notification marked as read.' });
  } catch (err) {
    console.error('markAsRead error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// PUT /api/notifications/read-all
const markAllAsRead = async (req, res) => {
  try {
    await db.query(
      'UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0',
      [req.user.user_id]
    );

    return res.status(200).json({ success: true, message: 'All notifications marked as read.' });
  } catch (err) {
    console.error('markAllAsRead error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

module.exports = { getMyNotifications, markAsRead, markAllAsRead };
