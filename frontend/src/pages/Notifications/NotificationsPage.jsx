import { useEffect, useState, useCallback } from 'react';
import {
  Building2, BedDouble, Repeat, CheckCircle2, Award, XCircle,
  Siren, AlertTriangle, Activity, Bell,
} from 'lucide-react';
import { getMyNotifications, markAsRead, markAllAsRead } from '../../api/notifications.api';
import { useNotif } from '../../context/NotifContext';
import { timeAgo } from '../../utils/formatDate';
import Button  from '../../components/ui/Button';
import Spinner from '../../components/ui/Spinner';
import Alert   from '../../components/ui/Alert';
import './NotificationsPage.css';

// ── Derive a display icon from the notification message text ─────────────────
// Keyword matching picks the lucide icon component to render in the avatar.
const getNotifIcon = (message = '') => {
  const m = message.toLowerCase();
  if (m.includes('discharg'))            return Building2;
  if (m.includes('admitted') || m.includes('admission')) return BedDouble;
  if (m.includes('referral') && m.includes('new'))       return Repeat;
  if (m.includes('accepted'))            return CheckCircle2;
  if (m.includes('completed'))           return Award;
  if (m.includes('cancelled'))           return XCircle;
  if (m.includes('triage') && m.includes('critical'))    return Siren;
  if (m.includes('triage') && m.includes('urgent'))      return AlertTriangle;
  if (m.includes('triage'))              return Activity;
  return Bell;
};

// ── Colour accent based on message type ──────────────────────────────────────
const getAccentClass = (message = '') => {
  const m = message.toLowerCase();
  if (m.includes('critical'))  return 'notif-item--critical';
  if (m.includes('urgent'))    return 'notif-item--urgent';
  if (m.includes('cancelled')) return 'notif-item--cancelled';
  if (m.includes('discharg'))  return 'notif-item--discharge';
  return '';
};

// ── Main component ────────────────────────────────────────────────────────────
const NotificationsPage = () => {
  const { refreshNotifications } = useNotif();
  const [notifs,     setNotifs]     = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState('');
  const [markingAll, setMarkingAll] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    getMyNotifications()
      .then((r) => { if (r.success) setNotifs(r.data); })
      .catch(() => setError('Failed to load notifications.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleMarkOne = async (id) => {
    try { await markAsRead(id); refreshNotifications(); load(); } catch (_) {}
  };

  const handleMarkAll = async () => {
    setMarkingAll(true);
    try { await markAllAsRead(); refreshNotifications(); load(); } catch (_) {}
    finally { setMarkingAll(false); }
  };

  const unread = notifs.filter((n) => !n.is_read).length;

  if (loading) return <Spinner />;

  return (
    <div className="notif-page">

      {/* Header */}
      <div className="page-header">
        <div>
          <h2 className="page-title">Notifications</h2>
          <p className="page-subtitle">
            {unread > 0 ? `${unread} unread` : 'All caught up'} · {notifs.length} total
          </p>
        </div>
        {unread > 0 && (
          <Button
            id="mark-all-read-btn"
            variant="secondary"
            onClick={handleMarkAll}
            loading={markingAll}
          >
            ✓ Mark All as Read
          </Button>
        )}
      </div>

      {error && <Alert type="error" message={error} onDismiss={() => setError('')} />}

      {/* Notification list */}
      <div className="notif-list">
        {notifs.length === 0 && (
          <div className="notif-empty">
            <span className="notif-empty__icon"><Bell size={48} /></span>
            <p className="text-muted">You have no notifications.</p>
          </div>
        )}

        {notifs.map((n) => {
          const Icon   = getNotifIcon(n.message);
          const accent = getAccentClass(n.message);
          return (
            <div
              key={n.notification_id}
              className={`notif-item ${n.is_read ? '' : 'notif-item--unread'} ${accent}`}
            >
              {/* Icon avatar */}
              <div className="notif-item__avatar" aria-hidden="true">
                <Icon size={18} />
              </div>

              {/* Body */}
              <div className="notif-item__body">
                <p className="notif-item__message">{n.message}</p>
                <span className="notif-item__time">{timeAgo(n.created_at)}</span>
              </div>

              {/* Mark read button — only on unread */}
              {!n.is_read && (
                <button
                  className="notif-item__mark-btn"
                  onClick={() => handleMarkOne(n.notification_id)}
                  title="Mark as read"
                  aria-label="Mark as read"
                >
                  ✓
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default NotificationsPage;
