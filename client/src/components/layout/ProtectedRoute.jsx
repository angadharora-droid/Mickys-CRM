import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { MODULES, hasModule, canUseSalesPages } from '@/lib/constants';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Where to send a user who can't view the requested area: the first module
 * they can actually use, in the order the app presents them. '/' is the last
 * resort — LeadsHome shows a "nothing assigned" notice there rather than
 * bouncing the user around.
 */
export const homeFor = (user) => {
  if (hasModule(user, MODULES.LEADS)) return '/';
  if (canUseSalesPages(user)) return '/sales';
  if (hasModule(user, MODULES.INVOICING)) return '/sales/invoicing';
  if (hasModule(user, MODULES.DISPATCH)) return '/sales/dispatch';
  return '/';
};

/**
 * `roles` restricts by role; `module` requires one module assignment and
 * `modules` any one of several (the sales shell is shared by the sales,
 * accounts and dispatch desks). Admins pass every module check.
 */
export default function ProtectedRoute({ children, roles, module, modules }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="w-full max-w-md space-y-4 p-8">
          <Skeleton className="h-10 w-3/4" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-10 w-1/2" />
        </div>
      </div>
    );
  }

  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;

  if (roles && !roles.includes(user.role)) return <Navigate to={homeFor(user)} replace />;

  if (module && !hasModule(user, module)) return <Navigate to={homeFor(user)} replace />;

  if (modules && !modules.some((m) => hasModule(user, m))) return <Navigate to={homeFor(user)} replace />;

  return children;
}
