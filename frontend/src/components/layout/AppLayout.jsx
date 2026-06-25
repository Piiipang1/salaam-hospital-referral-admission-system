import { useState, useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import PageWrapper from './PageWrapper';

const PAGE_TITLES = {
  '/dashboard':     'Dashboard',
  '/patients':      'Patients',
  '/triage':        'Triage',
  '/referrals':     'Referrals',
  '/admissions':    'Admissions',
  '/rooms':         'Rooms',
  '/notifications': 'Notifications',
  '/reports':       'Reports',
  '/users':         'User Management',
};

const getTitle = (pathname) => {
  // Match exact then prefix
  if (PAGE_TITLES[pathname]) return PAGE_TITLES[pathname];
  const match = Object.keys(PAGE_TITLES).find((k) => pathname.startsWith(k + '/'));
  return match ? PAGE_TITLES[match] : 'Salaam Hospital';
};

const AppLayout = () => {
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  // Close mobile sidebar on route change
  useEffect(() => { setMobileOpen(false); }, [location.pathname]);

  return (
    <>
      <Sidebar
        collapsed={false}
        onClose={() => setMobileOpen(false)}
        mobileOpen={mobileOpen}
      />
      <TopBar
        title={getTitle(location.pathname)}
        onMenuToggle={() => setMobileOpen((v) => !v)}
      />
      <PageWrapper>
        <Outlet />
      </PageWrapper>
    </>
  );
};

export default AppLayout;
