import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import PageWrapper from './PageWrapper';
import BottomNav from './BottomNav';
import { useAuth } from '../../context/AuthContext';

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
  const { user } = useAuth();

  // Doctors' Admissions page is their merged "My Patients" view.
  const title = (user?.role === 'doctor' && location.pathname.startsWith('/admissions'))
    ? 'My Patients'
    : getTitle(location.pathname);

  return (
    <>
      <Sidebar collapsed={false} />
      <TopBar title={title} />
      <PageWrapper>
        <Outlet />
      </PageWrapper>
      <BottomNav />
    </>
  );
};

export default AppLayout;
