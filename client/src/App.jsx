import { Routes, Route, Navigate } from 'react-router-dom';
import { ROLES } from '@/lib/constants';
import AppLayout from '@/components/layout/AppLayout';
import ProtectedRoute from '@/components/layout/ProtectedRoute';

import Login from '@/pages/Login';
import Dashboard from '@/pages/dashboard/Dashboard';
import LeadList from '@/pages/leads/LeadList';
import LeadCreate from '@/pages/leads/LeadCreate';
import LeadDetail from '@/pages/leads/LeadDetail';
import LeadTracker from '@/pages/leads/LeadTracker';
import MyRecords from '@/pages/leads/MyRecords';
import FollowUps from '@/pages/FollowUps';
import RateMaster from '@/pages/rate-master/RateMaster';
import ExportKit from '@/pages/export/ExportKit';
import UsersPage from '@/pages/users/Users';
import ActivityLogs from '@/pages/ActivityLogs';
import ChangePassword from '@/pages/ChangePassword';
import NotFound from '@/pages/NotFound';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />

      <Route
        element={
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        }
      >
        <Route path="/" element={<Dashboard />} />

        <Route path="/leads" element={<LeadList />} />
        <Route
          path="/leads/new"
          element={
            <ProtectedRoute roles={[ROLES.SALES_EXEC, ROLES.ADMIN, ROLES.PR_MANAGER]}>
              <LeadCreate />
            </ProtectedRoute>
          }
        />
        <Route path="/leads/:id" element={<LeadDetail />} />
        <Route path="/follow-ups" element={<FollowUps />} />
        <Route
          path="/my-records"
          element={
            <ProtectedRoute roles={[ROLES.SALES_EXEC, ROLES.PR_MANAGER]}>
              <MyRecords />
            </ProtectedRoute>
          }
        />
        <Route
          path="/lead-tracker"
          element={
            <ProtectedRoute roles={[ROLES.ADMIN]}>
              <LeadTracker />
            </ProtectedRoute>
          }
        />

        <Route
          path="/export"
          element={
            <ProtectedRoute roles={[ROLES.ADMIN]}>
              <ExportKit />
            </ProtectedRoute>
          }
        />
        <Route
          path="/rate-master"
          element={
            <ProtectedRoute roles={[ROLES.ADMIN]}>
              <RateMaster />
            </ProtectedRoute>
          }
        />
        <Route
          path="/users"
          element={
            <ProtectedRoute roles={[ROLES.ADMIN]}>
              <UsersPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/activity-logs"
          element={
            <ProtectedRoute roles={[ROLES.ADMIN]}>
              <ActivityLogs />
            </ProtectedRoute>
          }
        />
        <Route path="/change-password" element={<ChangePassword />} />
      </Route>

      <Route path="/404" element={<NotFound />} />
      <Route path="*" element={<Navigate to="/404" replace />} />
    </Routes>
  );
}
