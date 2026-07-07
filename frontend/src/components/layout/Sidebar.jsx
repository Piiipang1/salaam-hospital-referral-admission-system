import { NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Users, Siren, Repeat, BedDouble,
  DoorOpen, Bell, BarChart3, UserCog, ScrollText, LogOut, CircleUserRound,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { canViewReports, canManageUsers } from '../../utils/roleGuard';
import { ROLE_LABELS } from '../../utils/constants';
import logo from '../../assets/logo.png';
import './Sidebar.css';

const NAV_ITEMS = [
  { to: '/dashboard',     icon: LayoutDashboard, label: 'Dashboard'       },
  { to: '/patients',      icon: Users,           label: 'Patients'        },
  { to: '/triage',        icon: Siren,           label: 'Triage'           },
  { to: '/referrals',     icon: Repeat,          label: 'Referrals'        },
  { to: '/admissions',    icon: BedDouble,       label: 'Admissions'       },
  // Doctors see their own admitted patients on /rooms, not the room grid
  { to: '/rooms',         icon: DoorOpen,        label: 'Rooms',           doctorLabel: "My Patients' Rooms" },
  { to: '/notifications', icon: Bell,            label: 'Notifications'    },
  { to: '/profile',       icon: CircleUserRound, label: 'My Profile'       },
  { to: '/reports',       icon: BarChart3,       label: 'Reports',         roles: ['admin'] },
  { to: '/users',         icon: UserCog,         label: 'User Management', roles: ['admin'] },
  { to: '/audit',         icon: ScrollText,      label: 'Audit Trail',     roles: ['admin'] },
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
          <img src={logo} alt="Salaam Hospital" className="sidebar__brand-logo" />
          {!collapsed && (
            <div className="sidebar__brand-text">
              <span className="sidebar__brand-name">Salaam</span>
              <span className="sidebar__brand-sub">Hospital</span>
            </div>
          )}
        </div>

        {/* Navigation */}
        <nav className="sidebar__nav" aria-label="Main navigation">
          {visibleItems.map((item) => {
            const Icon = item.icon;
            const label = (user?.role === 'doctor' && item.doctorLabel) ? item.doctorLabel : item.label;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `sidebar__link${isActive ? ' sidebar__link--active' : ''}`
                }
                onClick={onClose}
                title={collapsed ? label : undefined}
              >
                <span className="sidebar__link-icon"><Icon size={18} /></span>
                {!collapsed && <span className="sidebar__link-label">{label}</span>}
              </NavLink>
            );
          })}
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
            <span><LogOut size={16} /></span>
            {!collapsed && <span>Logout</span>}
          </button>
        </div>
      </aside>
    </>
  );
};

export default Sidebar;
