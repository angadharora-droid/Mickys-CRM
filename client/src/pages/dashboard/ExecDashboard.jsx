import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import api, { apiError } from '@/lib/api';
import PageHeader from '@/components/shared/PageHeader';
import StatCard from '@/components/shared/StatCard';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { CalendarDays, CalendarRange, Clock, Package, Send, Plus } from 'lucide-react';

export default function ExecDashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get('/dashboard/exec')
      .then((res) => setData(res.data.data))
      .catch((err) => toast.error(apiError(err)))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64" />
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-28" />)}
        </div>
        <Skeleton className="h-80" />
      </div>
    );
  }

  const cards = data?.cards || {};

  return (
    <div className="space-y-6">
      <PageHeader title="My Dashboard" description="Your leads and kit activity at a glance">
        <Button asChild>
          <Link to="/leads/new"><Plus className="h-4 w-4" /> New Lead</Link>
        </Button>
      </PageHeader>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5">
        <StatCard title="New Today" value={cards.todayCount} icon={CalendarDays} tone="primary" />
        <StatCard title="This Month" value={cards.monthCount} icon={CalendarRange} tone="gold" />
        <StatCard title="In Progress" value={cards.openCount} icon={Clock} tone="warning" />
        <StatCard title="Kits Generated" value={cards.generatedCount} icon={Package} tone="primary" />
        <StatCard title="Delivered" value={cards.deliveredCount} icon={Send} tone="success" />
      </div>
    </div>
  );
}
