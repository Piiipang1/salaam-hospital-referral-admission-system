import { useNavigate } from 'react-router-dom';
import { Menu, Bell } from 'lucide-react';
import { useNotif } from '../../context/NotifContext';
import './TopBar.css';

const TopBar = ({ title, onMenuToggle }) => {
  const { unreadCount } = useNotif();
  const navigate = useNavigate();

  return (
    <header className="topbar">
      {/* Hamburger — mobile only */}
      <button
        className="topbar__menu-btn show-mobile-only"
        onClick={onMenuToggle}
        aria-label="Toggle navigation menu"
      >
        <Menu size={21} />
      </button>

      <h1 className="topbar__title">{title}</h1>

      <div className="topbar__actions">
        {/* Notification Bell */}
        <button
          className="topbar__notif-btn"
          onClick={() => navigate('/notifications')}
          aria-label={`Notifications${unreadCount > 0 ? ` — ${unreadCount} unread` : ''}`}
        >
          <Bell size={19} />
          {unreadCount > 0 && (
            <span className="topbar__notif-badge">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </button>
      </div>
    </header>
  );
};

export default TopBar;
