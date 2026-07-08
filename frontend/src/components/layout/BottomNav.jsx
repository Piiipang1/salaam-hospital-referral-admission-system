import { useState, useEffect } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Users, Siren, BedDouble, Menu,
  Bell, Repeat, DoorOpen, BarChart3, UserCog, ScrollText, LogOut, X,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import './BottomNav.css';

// 4 nav links + "More" button = 5 slots in the bar
const BAR_ITEMS = [
  { to: '/dashboard',  icon: LayoutDashboard, label: 'Dashboard'  },
  { to: '/patients',   icon: Users,           label: 'Patients'   },
  { to: '/triage',     icon: Siren,           label: 'Triage'     },
  { to: '/admissions', icon: BedDouble,       label: 'Admissions' },
];

// Nav links that appear in the More sheet (role-restricted where noted)
const SHEET_ITEMS = [
  { to: '/notifications', icon: Bell,       label: 'Notifications'    },
  { to: '/referrals',     icon: Repeat,     label: 'Referrals',       roles: ['doctor', 'admin'] },
  { to: '/rooms',         icon: DoorOpen,   label: 'Rooms'            },
  { to: '/reports',       icon: BarChart3,  label: 'Reports',         roles: ['admin'] },
  { to: '/users',         icon: UserCog,    label: 'User Management', roles: ['admin'] },
  { to: '/audit',         icon: ScrollText, label: 'Audit Trail',     roles: ['admin'] },
];

const BottomNav = () => {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [sheetOpen, setSheetOpen] = useState(false);

  // Close the sheet whenever the route changes
  useEffect(() => { setSheetOpen(false); }, [location.pathname]);

  const visibleSheetItems = SHEET_ITEMS.filter(
    (item) => !item.roles || item.roles.includes(user?.role)
  );

  const handleLogout = () => {
    setSheetOpen(false);
    logout();
  };

  return (
    <>
      {/* ── Fixed bottom bar ── */}
      <nav className="bottom-nav" aria-label="Mobile navigation">
        {BAR_ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `bottom-nav__item${isActive ? ' bottom-nav__item--active' : ''}`
              }
            >
              <span className="bottom-nav__icon"><Icon size={22} /></span>
              <span className="bottom-nav__label">{item.label}</span>
            </NavLink>
          );
        })}

        <button
          className="bottom-nav__item bottom-nav__item--more"
          onClick={() => setSheetOpen(true)}
          aria-label="More navigation options"
        >
          <span className="bottom-nav__icon"><Menu size={22} /></span>
          <span className="bottom-nav__label">More</span>
        </button>
      </nav>

      {/* ── Tap-outside backdrop ── */}
      <div
        className={`bottom-nav__backdrop${sheetOpen ? ' bottom-nav__backdrop--open' : ''}`}
        onClick={() => setSheetOpen(false)}
        aria-hidden="true"
      />

      {/* ── More sheet (slides up from bottom) ── */}
      <div
        className={`bottom-nav__sheet${sheetOpen ? ' bottom-nav__sheet--open' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="More options"
      >
        <div className="bottom-nav__sheet-header">
          <span className="bottom-nav__sheet-title">More</span>
          <button
            className="bottom-nav__sheet-close"
            onClick={() => setSheetOpen(false)}
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {visibleSheetItems.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `bottom-nav__sheet-item${isActive ? ' bottom-nav__sheet-item--active' : ''}`
              }
            >
              <span className="bottom-nav__sheet-item-icon"><Icon size={20} /></span>
              {item.label}
            </NavLink>
          );
        })}

        {/* ── Divider + Logout ── */}
        <div className="bottom-nav__sheet-divider" />
        <button
          className="bottom-nav__sheet-logout"
          onClick={handleLogout}
        >
          <span className="bottom-nav__sheet-item-icon"><LogOut size={20} /></span>
          Logout
        </button>
      </div>
    </>
  );
};

export default BottomNav;
