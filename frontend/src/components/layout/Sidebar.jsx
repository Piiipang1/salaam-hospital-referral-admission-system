import { useState, useEffect } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Users, Siren, Repeat, BedDouble,
  DoorOpen, Bell, BarChart3, UserCog, ScrollText, LogOut, ChevronDown, Hospital,
  ClipboardList, ArrowLeftRight,
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
  { to: '/patients',      icon: Users,           label: 'Patients',        roles: ['doctor', 'nurse'] },
  { to: '/triage',        icon: Siren,           label: 'Triage',          roles: ['doctor', 'nurse'] },
  { to: '/referrals',     icon: Repeat,          label: 'Referrals',       roles: ['doctor'] },
  // For doctors, Admissions is their merged "My Patients" page (Current + History tabs)
  { to: '/admissions',    icon: BedDouble,       label: 'Admissions',      doctorLabel: 'My Patients', roles: ['doctor', 'nurse'] },
  // Room grid is for admin/nurse only — doctors use "My Patients" instead
  { to: '/rooms',         icon: DoorOpen,        label: 'Rooms',           roles: ['admin', 'nurse'] },
  // Nursing: ward roster and shift handoffs. Nurse-only — they are the only
  // role attached to a department.
  { to: '/ward',          icon: ClipboardList,   label: 'My Ward',         roles: ['nurse'] },
  { to: '/endorsements',  icon: ArrowLeftRight,  label: 'Endorsements',    roles: ['nurse'] },
  { to: '/notifications', icon: Bell,            label: 'Notifications'    },
  { to: '/reports',       icon: BarChart3,       label: 'Reports',         roles: ['admin'] },
  // Directory of facilities patients are diverted to when this hospital is full
  { to: '/external-hospitals', icon: Hospital,   label: 'External Hospitals', roles: ['admin'] },
  { to: '/users',         icon: UserCog,         label: 'User Management', roles: ['admin'] },
  { to: '/audit',         icon: ScrollText,      label: 'Audit Trail',     roles: ['admin'] },
];

const ITEM_BY_PATH = Object.fromEntries(NAV_ITEMS.map((i) => [i.to, i]));

// Sub-items shown under the expandable "User Management" entry. Each links to
// /users with a ?role= filter so the page shows only that role's table.
const USER_SUBITEMS = [
  { to: '/users?role=doctor', label: 'Doctors' },
  { to: '/users?role=nurse',  label: 'Nurses'  },
];

// Admins get a grouped oversight nav. Dashboard stays ungrouped on top;
// Oversight = read-only visibility (rooms grid, reports, audit trail),
// Administration = account/system management.
const ADMIN_SECTIONS = [
  { header: null,             paths: ['/dashboard'] },
  { header: 'Oversight',      paths: ['/rooms', '/reports', '/audit'] },
  { header: 'Administration', paths: ['/external-hospitals', '/users', '/notifications'] },
];

const Sidebar = ({ collapsed, onClose, mobileOpen }) => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // Expandable "User Management" submenu. Auto-open when already on /users so
  // the active sub-item is visible.
  const [usersOpen, setUsersOpen] = useState(false);
  useEffect(() => {
    if (location.pathname === '/users') setUsersOpen(true);
  }, [location.pathname]);

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

    // User Management is an expandable dropdown: the row toggles the submenu
    // (never navigates) and reveals the per-role sub-links below it.
    if (item.to === '/users') {
      const currentRole = new URLSearchParams(location.search).get('role');
      return (
        <div key={item.to} className="sidebar__submenu">
          <button
            type="button"
            className="sidebar__link"
            onClick={() => setUsersOpen((open) => !open)}
            aria-expanded={usersOpen}
            title={collapsed ? label : undefined}
            style={{ background: 'none', border: 'none', width: '100%', cursor: 'pointer', font: 'inherit', textAlign: 'left' }}
          >
            <span className="sidebar__link-icon"><Icon size={18} /></span>
            {!collapsed && <span className="sidebar__link-label">{label}</span>}
            {!collapsed && (
              <span
                className="sidebar__link-chevron"
                style={{ marginLeft: 'auto', display: 'inline-flex', transition: 'transform var(--transition-fast)', transform: usersOpen ? 'rotate(180deg)' : 'none' }}
              >
                <ChevronDown size={16} />
              </span>
            )}
          </button>
          {usersOpen && !collapsed && USER_SUBITEMS.map((sub) => {
            // NavLink's default isActive ignores the query string, so match on
            // ?role= manually — otherwise all three sub-links highlight at once.
            const subRole = new URLSearchParams(sub.to.split('?')[1]).get('role');
            const active = location.pathname === '/users' && currentRole === subRole;
            return (
              <NavLink
                key={sub.to}
                to={sub.to}
                onClick={onClose}
                className={`sidebar__link sidebar__sublink${active ? ' sidebar__link--active' : ''}`}
                style={{ paddingLeft: 'var(--space-8)', fontSize: 'var(--font-size-xs)' }}
              >
                <span className="sidebar__link-label">{sub.label}</span>
              </NavLink>
            );
          })}
        </div>
      );
    }

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
