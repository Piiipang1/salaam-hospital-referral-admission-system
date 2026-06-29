import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { getMyNotifications } from '../api/notifications.api';
import { useAuth } from './AuthContext';
import { NOTIFICATION_POLL_MS } from '../utils/constants';

const NotifContext = createContext(null);

export const NotifProvider = ({ children }) => {
  const { user } = useAuth();
  const [unreadCount, setUnreadCount] = useState(0);

  const refresh = useCallback(async () => {
    if (!user) return;
    try {
      const res = await getMyNotifications();
      if (res.success) setUnreadCount(res.unread_count ?? 0);
    } catch (_) { /* silent — don't break app if notifications fail */ }
  }, [user]);

  // Initial fetch + polling
  useEffect(() => {
    if (!user) { setUnreadCount(0); return; }
    refresh();
    const interval = setInterval(refresh, NOTIFICATION_POLL_MS);
    return () => clearInterval(interval);
  }, [user, refresh]);

  return (
    <NotifContext.Provider value={{ unreadCount, refreshNotifications: refresh }}>
      {children}
    </NotifContext.Provider>
  );
};

export const useNotif = () => {
  const ctx = useContext(NotifContext);
  if (!ctx) throw new Error('useNotif must be inside NotifProvider');
  return ctx;
};

export default NotifContext;
