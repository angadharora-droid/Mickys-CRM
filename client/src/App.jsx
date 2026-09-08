import { Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { ROLES, MODULES, PIPELINE_MODULES, hasModule, canUseSalesPages } from '@/lib/constants';
import { useAuth } from '@/context/AuthContext';
import AppLayout from '@/components/layout/AppLayout';
import SalesLayout from '@/components/layout/SalesLayout';
import ProtectedRoute, { homeFor } from '@/components/layout/ProtectedRoute';
import EmptyState from '@/components/shared/EmptyState';
import { Card } from '@/components/ui/card';
import { ShieldOff } from 'lucide-react';

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
import Settings from '@/pages/Settings';
import SalesOverview from '@/pages/sales/SalesOverview';
import StockList from '@/pages/sales/StockList';
import SalesOrders from '@/pages/sales/SalesOrders';
import SalesCustomers, { SalesCustomerForm } from '@/pages/sales/SalesCustomers';
import SalesReports from '@/pages/sales/SalesReports';
import SalesSettings from '@/pages/sales/SalesSettings';
import Pipeline from '@/pages/sales/Pipeline';
import Invoicing from '@/pages/sales/Invoicing';
import SalesRegister from '@/pages/sales/SalesRegister';
import Dispatch from '@/pages/sales/Dispatch';
import NotFound from '@/pages/NotFound';

/** An account with no usable module assignment lands here instead of looping. */
function NoAccess() {
  return (
    <Card>
      <EmptyState
        icon={ShieldOff}
        title="No module assigned to your account"
        description="Ask an admin to assign you a module (Leads CRM, Sales Orders, Invoicing or Dispatch) under Users."
      />
    </Card>
  );
}

/** "/" is the Leads dashboard — users without the Leads module land on their
 *  own module's home instead. */
function LeadsHome() {
  const { user } = useAuth();
  if (user && !hasModule(user, MODULES.LEADS)) {
    const home = homeFor(user);
    return home === '/' ? <NoAccess /> : <Navigate to={home} replace />;
  }
  return <Dashboard />;
}

/** "/sales" is the stock overview for sales; the accounts and dispatch desks
 *  are sent to their own queue. */
function SalesHome() {
  const { user } = useAuth();
  if (canUseSalesPages(user)) return <SalesOverview />;
  const home = homeFor(user);
  return <Navigate to={home === '/sales' ? '/' : home} replace />;
}

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
        <Route path="/" element={<LeadsHome />} />

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
        <Route
          path="/settings"
          element={
            <ProtectedRoute roles={[ROLES.ADMIN]}>
              <Settings />
            </ProtectedRoute>
          }
        />
      </Route>

      {/* Sales Order module — its own shell with a separate sidebar/nav,
          shared by three desks: sales (sales_orders), accounts (invoicing)
          and dispatch. The shell opens to any of them; each page then
          requires its own module. */}
      <Route
        element={
          <ProtectedRoute modules={PIPELINE_MODULES}>
            <SalesLayout />
          </ProtectedRoute>
        }
      >
        <Route path="/sales" element={<SalesHome />} />

        {/* Order booking pages: the sales module plus a role that may book. */}
        <Route
          element={
            <ProtectedRoute roles={[ROLES.ADMIN, ROLES.SALES_EXEC]} module={MODULES.SALES_ORDERS}>
              <Outlet />
            </ProtectedRoute>
          }
        >
          <Route path="/sales/stock" element={<StockList />} />
          <Route path="/sales/orders" element={<SalesOrders />} />
          <Route path="/sales/customers" element={<SalesCustomers />} />
          <Route path="/sales/customers/new" element={<SalesCustomerForm />} />
          <Route path="/sales/customers/:id" element={<SalesCustomerForm />} />
          {/* Sales execs run these too — the server scopes every report to the
              orders they booked, so no admin-only wrapper here. */}
          <Route path="/sales/reports" element={<SalesReports />} />
        </Route>

        {/* The funnel is every desk's view of the same orders. */}
        <Route path="/sales/pipeline" element={<Pipeline />} />
        <Route
          path="/sales/invoicing"
          element={
            <ProtectedRoute module={MODULES.INVOICING}>
              <Invoicing />
            </ProtectedRoute>
          }
        />
        {/* The Tally sales register: read by sales and accounts alike. */}
        <Route
          path="/sales/register"
          element={
            <ProtectedRoute modules={[MODULES.SALES_ORDERS, MODULES.INVOICING]}>
              <SalesRegister />
            </ProtectedRoute>
          }
        />
        <Route
          path="/sales/dispatch"
          element={
            <ProtectedRoute module={MODULES.DISPATCH}>
              <Dispatch />
            </ProtectedRoute>
          }
        />
        <Route
          path="/sales/settings"
          element={
            <ProtectedRoute roles={[ROLES.ADMIN]}>
              <SalesSettings />
            </ProtectedRoute>
          }
        />
      </Route>

      <Route path="/404" element={<NotFound />} />
      <Route path="*" element={<Navigate to="/404" replace />} />
    </Routes>
  );
}
