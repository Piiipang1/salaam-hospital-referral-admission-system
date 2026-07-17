import { NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Users, Siren, Repeat, BedDouble,
  DoorOpen, Bell, BarChart3, UserCog, ScrollText, LogOut,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { canViewReports, canManageUsers } from '../../utils/roleGuard';
import { ROLE_LABELS } from '../../utils/constants';
import logo from '../../assets/logo.png';
import './Sidebar.css';

// Admins are oversight-only: no clinical pages (Patients, Triage, Referrals,
// Admissions) — those routes are also blocked in AppRouter and on the backend.
const NAV_ITEMS = [
  { to: '/dashboard',     icon: LayoutDashboard, label: 'Dashboard'       },
  { to: '/patients',      icon: Users,           label: 'Patients',        roles: ['doctor', 'nurse', 'staff'] },
  { to: '/triage',        icon: Siren,           label: 'Triage',          roles: ['doctor', 'nurse', 'staff'] },
  { to: '/referrals',     icon: Repeat,          label: 'Referrals',       roles: ['doctor'] },
  // For doctors, Admissions is their merged "My Patients" page (Current + History tabs)
  { to: '/admissions',    icon: BedDouble,       label: 'Admissions',      doctorLabel: 'My Patients', roles: ['doctor', 'nurse', 'staff'] },
  // Room grid is for admin/nurse/staff only — doctors use "My Patients" instead
  { to: '/rooms',         icon: DoorOpen,        label: 'Rooms',           roles: ['admin', 'nurse', 'staff'] },
  { to: '/notifications', icon: Bell,            label: 'Notifications'    },
  { to: '/reports',       icon: BarChart3,       label: 'Reports',         roles: ['admin'] },
  { to: '/users',         icon: UserCog,         label: 'User Management', roles: ['admin'] },
  { to: '/audit',         icon: ScrollText,      label: 'Audit Trail',     roles: ['admin'] },
];

const ITEM_BY_PATH = Object.fromEntries(NAV_ITEMS.map((i) => [i.to, i]));

// Admins get a grouped oversight nav. Dashboard stays ungrouped on top;
// Oversight = read-only visibility (rooms grid, reports, audit trail),
// Administration = account/system management.
const ADMIN_SECTIONS = [
  { header: null,             paths: ['/dashboard'] },
  { header: 'Oversight',      paths: ['/rooms', '/reports', '/audit'] },
  { header: 'Administration', paths: ['/users', '/notifications'] },
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

  const renderNavLink = (item) => {
    if (!item) return null;
    const Icon = item.icon;
    const label = (user?.role === 'doctor' && item.doctorLabel) ? item.doctorLabel : item.label;
    return (
      <NavLink
        key={item.to}
        to={item.to}
        className={({ isActive }) => `sidebar__link${isActive ? ' sidebar__link--active' : ''}`}
        onClick={onClose}
        title={collapsed ? label : undefined}
      >
        <span className="sidebar__link-icon"><Icon size={18} /></span>
        {!collapsed && <span className="sidebar__link-label">{label}</span>}
      </NavLink>
    );
  };

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

        {/* Navigation — admins get labeled sections; others a flat list */}
        <nav className="sidebar__nav" aria-label="Main navigation">
          {user?.role === 'admin'
            ? ADMIN_SECTIONS.map((section, i) => (
                <div key={section.header ?? `section-${i}`} className="sidebar__section">
                  {!collapsed && section.header && (
                    <span className="sidebar__section-header">{section.header}</span>
                  )}
                  {section.paths.map((p) => renderNavLink(ITEM_BY_PATH[p]))}
                </div>
              ))
            : visibleItems.map(renderNavLink)}
        </nav>

        {/* User + Logout */}
        <div className="sidebar__footer">
        {/* User account card — clickable, navigates to /profile */}
        {!collapsed && (
          <NavLink
            to="/profile"
            className={({ isActive }) =>
              `sidebar__user${isActive ? ' sidebar__user--active' : ''}`
            }
            onClick={onClose}
            title="My Profile"
          >
            <div className="sidebar__user-avatar">
              {displayName?.[0]?.toUpperCase() ?? '?'}
            </div>
            <div className="sidebar__user-info">
              <span className="sidebar__user-name">{displayName}</span>
              <span className="sidebar__user-role">{ROLE_LABELS[user?.role] ?? user?.role}</span>
            </div>
          </NavLink>
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
