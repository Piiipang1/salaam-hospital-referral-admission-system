import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { canViewReports, canManageUsers } from '../../utils/roleGuard';
import { ROLE_LABELS } from '../../utils/constants';
import './Sidebar.css';

const NAV_ITEMS = [
  { to: '/dashboard',     icon: '📊', label: 'Dashboard'       },
  { to: '/patients',      icon: '🧑‍⚕️', label: 'Patients'        },
  { to: '/triage',        icon: '🚨', label: 'Triage'           },
  { to: '/referrals',     icon: '🔄', label: 'Referrals'        },
  { to: '/admissions',    icon: '🏥', label: 'Admissions'       },
  { to: '/rooms',         icon: '🛏️', label: 'Rooms'            },
  { to: '/notifications', icon: '🔔', label: 'Notifications'    },
  { to: '/reports',       icon: '📈', label: 'Reports',         roles: ['admin'] },
  { to: '/users',         icon: '👤', label: 'User Management', roles: ['admin'] },
  { to: '/audit',         icon: '🔍', label: 'Audit Trail',     roles: ['admin'] },
];

const Sidebar = ({ collapsed, onClose, mobileOpen }) => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const displayName = (user?.first_name && user?.last_name)
    ? `${user.first_name} ${user.last_name}`
    : user?.username;

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const visibleItems = NAV_ITEMS.filter(
    (item) => !item.roles || item.roles.includes(user?.role)
  );

  return (
    <>
      {/* Mobile overlay backdrop */}
      <div className={`sidebar-backdrop${mobileOpen ? ' active' : ''}`} onClick={onClose} aria-hidden="true" />

      <aside className={`sidebar${collapsed ? ' sidebar--collapsed' : ''}${mobileOpen ? ' sidebar--mobile-open' : ''}`}>
        {/* Brand */}
        <div className="sidebar__brand">
          <span className="sidebar__brand-icon">🏥</span>
          {!collapsed && (
            <div className="sidebar__brand-text">
              <span className="sidebar__brand-name">Salaam</span>
              <span className="sidebar__brand-sub">Hospital</span>
            </div>
          )}
        </div>

        {/* Navigation */}
        <nav className="sidebar__nav" aria-label="Main navigation">
          {visibleItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `sidebar__link${isActive ? ' sidebar__link--active' : ''}`
              }
              onClick={onClose}
              title={collapsed ? item.label : undefined}
            >
              <span className="sidebar__link-icon">{item.icon}</span>
              {!collapsed && <span className="sidebar__link-label">{item.label}</span>}
            </NavLink>
          ))}
        </nav>

        {/* User + Logout */}
        <div className="sidebar__footer">
          {!collapsed && (
            <div className="sidebar__user">
              <div className="sidebar__user-avatar">
                {displayName?.[0]?.toUpperCase() ?? '?'}
              </div>
              <div className="sidebar__user-info">
                <span className="sidebar__user-name">{displayName}</span>
                <span className="sidebar__user-role">{ROLE_LABELS[user?.role] ?? user?.role}</span>
              </div>
            </div>
          )}
          <button
            className="sidebar__logout"
            onClick={handleLogout}
            title="Logout"
            aria-label="Logout"
          >
            <span>🚪</span>
            {!collapsed && <span>Logout</span>}
          </button>
        </div>
      </aside>
    </>
  );
};

export default Sidebar;
