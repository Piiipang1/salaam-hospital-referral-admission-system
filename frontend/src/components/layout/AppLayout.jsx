import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import PageWrapper from './PageWrapper';
import BottomNav from './BottomNav';

// Page titles are rendered by each page's own .page-header, not the TopBar.
const AppLayout = () => (
  <>
    <Sidebar collapsed={false} />
    <TopBar />
    <PageWrapper>
      <Outlet />
    </PageWrapper>
    <BottomNav />
  </>
);

export default AppLayout;
