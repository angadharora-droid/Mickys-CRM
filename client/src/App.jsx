import { Routes, Route, Navigate } from 'react-router-dom';
import { ROLES } from '@/lib/constants';
import AppLayout from '@/components/layout/AppLayout';
import SalesLayout from '@/components/layout/SalesLayout';
import ProtectedRoute from '@/components/layout/ProtectedRoute';

import Login from '@/pages/Login';
import Dashboard from '@/pages/dashboard/Dashboard';
import LeadList from '@/pages/leads/LeadList';
import LeadCreate from '@/pages/leads/LeadCreate';
import LeadDetail from '@/pages/leads/LeadDetail';
import LeadTracker from '@/pages/leads/LeadTracker';
import MyRecords from '@/pages/leads/MyRecords';
import FollowUps from '@/pages/FollowUps';
import Reports from '@/pages/Reports';
import RateMaster from '@/pages/rate-master/RateMaster';
import ExportKit from '@/pages/export/ExportKit';
import UsersPage from '@/pages/users/Users';
import ActivityLogs from '@/pages/ActivityLogs';
import ChangePassword from '@/pages/ChangePassword';
import EmailSettings from '@/pages/EmailSettings';
import SalesOverview from '@/pages/sales/SalesOverview';
import StockList from '@/pages/sales/StockList';
import SalesOrders from '@/pages/sales/SalesOrders';
import SalesCustomers, { SalesCustomerForm } from '@/pages/sales/SalesCustomers';
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
        <Route path="/reports" element={<Reports />} />
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
        <Route path="/email-settings" element={<EmailSettings />} />
      </Route>

      {/* Sales Order module — its own shell with a separate sidebar/nav */}
      <Route
        element={
          <ProtectedRoute roles={[ROLES.ADMIN, ROLES.SALES_EXEC]}>
            <SalesLayout />
          </ProtectedRoute>
        }
      >
        <Route path="/sales" element={<SalesOverview />} />
        <Route path="/sales/stock" element={<StockList />} />
        <Route path="/sales/orders" element={<SalesOrders />} />
        <Route path="/sales/customers" element={<SalesCustomers />} />
        <Route path="/sales/customers/new" element={<SalesCustomerForm />} />
        <Route path="/sales/customers/:id" element={<SalesCustomerForm />} />
      </Route>

      <Route path="/404" element={<NotFound />} />
      <Route path="*" element={<Navigate to="/404" replace />} />
    </Routes>
  );
}
