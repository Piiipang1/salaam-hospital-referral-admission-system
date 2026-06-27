import { useNavigate } from 'react-router-dom';
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
        ☰
      </button>

      <h1 className="topbar__title">{title}</h1>

      <div className="topbar__actions">
        {/* Notification Bell */}
        <button
          className="topbar__notif-btn"
          onClick={() => navigate('/notifications')}
          aria-label={`Notifications${unreadCount > 0 ? ` — ${unreadCount} unread` : ''}`}
        >
          🔔
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
