import { useNavigate } from 'react-router-dom';
import { Bell, Sun, Moon } from 'lucide-react';
import { useNotif } from '../../context/NotifContext';
import { useTheme } from '../../context/ThemeContext';
import logo from '../../assets/logo.png';
import './TopBar.css';

const TopBar = () => {
  const { unreadCount } = useNotif();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();

  return (
    <header className="topbar">
      {/* Brand — shown only on mobile, where the sidebar (which carries the
          logo on desktop) is hidden. */}
      <div className="topbar__brand">
        <img src={logo} alt="Salaam Hospital" className="topbar__brand-logo" />
        <span className="topbar__brand-name">Salaam</span>
      </div>

      {/* Page titles live in each page's own .page-header — no duplicate here */}
      <div className="topbar__actions">
        {/* Theme Toggle */}
        <button
          className="topbar__theme-btn"
          onClick={toggleTheme}
          aria-label="Toggle dark mode"
        >
          {theme === 'dark' ? <Sun size={19} /> : <Moon size={19} />}
        </button>

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
