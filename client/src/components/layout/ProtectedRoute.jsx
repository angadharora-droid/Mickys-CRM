import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { MODULES, hasModule } from '@/lib/constants';
import { Skeleton } from '@/components/ui/skeleton';

/** Where to send a user who can't view the requested area. */
export const homeFor = (user) =>
  hasModule(user, MODULES.LEADS) ? '/' : hasModule(user, MODULES.SALES_ORDERS) ? '/sales' : '/';

export default function ProtectedRoute({ children, roles, module }) {
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

  return children;
}
