import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import AppLayout from '../components/layout/AppLayout';
import Spinner from '../components/ui/Spinner';

// Pages
import LoginPage           from '../pages/Login/LoginPage';
import DashboardPage       from '../pages/Dashboard/DashboardPage';
import PatientsPage        from '../pages/Patients/PatientsPage';
import PatientDetailPage   from '../pages/Patients/PatientDetailPage';
import TriagePage          from '../pages/Triage/TriagePage';
import TriageDetailPage    from '../pages/Triage/TriageDetailPage';
import ReferralsPage       from '../pages/Referrals/ReferralsPage';
import AdmissionsPage      from '../pages/Admissions/AdmissionsPage';
import RoomsPage           from '../pages/Rooms/RoomsPage';
import NotificationsPage   from '../pages/Notifications/NotificationsPage';
import ReportsPage         from '../pages/Reports/ReportsPage';
import UserManagementPage  from '../pages/UserManagement/UserManagementPage';

/** Redirect to /login if not authenticated */
const ProtectedRoute = ({ children }) => {
  const { user, isLoading } = useAuth();
  if (isLoading) return <Spinner fullscreen />;
  return user ? children : <Navigate to="/login" replace />;
};

/** Redirect to /dashboard if role not allowed */
const RoleRoute = ({ children, roles }) => {
  const { user } = useAuth();
  if (!roles.includes(user?.role)) return <Navigate to="/dashboard" replace />;
  return children;
};

const AppRouter = () => {
  const { user, isLoading } = useAuth();
  if (isLoading) return <Spinner fullscreen />;

  return (
    <BrowserRouter>
      <Routes>
        {/* Public */}
        <Route
          path="/login"
          element={user ? <Navigate to="/dashboard" replace /> : <LoginPage />}
        />

        {/* Protected — wrapped in shared layout */}
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <AppLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<Navigate to="/dashboard" replace />} />

          {/* All roles */}
          <Route path="dashboard"     element={<DashboardPage />} />
          <Route path="patients"      element={<PatientsPage />} />
          <Route path="patients/:id"  element={<PatientDetailPage />} />
          <Route path="triage"        element={<TriagePage />} />
          <Route path="triage/:id"    element={<TriageDetailPage />} />
          <Route path="referrals"     element={<ReferralsPage />} />
          <Route path="admissions"    element={<AdmissionsPage />} />
          <Route path="rooms"         element={<RoomsPage />} />
          <Route path="notifications" element={<NotificationsPage />} />

          {/* admin + doctor only */}
          <Route
            path="reports"
            element={
              <RoleRoute roles={['admin', 'doctor']}>
                <ReportsPage />
              </RoleRoute>
            }
          />

          {/* admin only */}
          <Route
            path="users"
            element={
              <RoleRoute roles={['admin']}>
                <UserManagementPage />
              </RoleRoute>
            }
          />

          {/* 404 fallback */}
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
};

export default AppRouter;
