import { useAuth } from '@/context/AuthContext';
import { ROLES } from '@/lib/constants';
import AdminDashboard from './AdminDashboard';
import ExecDashboard from './ExecDashboard';

export default function Dashboard() {
  const { user } = useAuth();
  if (user?.role === ROLES.ADMIN) return <AdminDashboard />;
  return <ExecDashboard />;
}
