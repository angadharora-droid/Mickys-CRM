import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import api, { apiError } from '@/lib/api';
import { formatDateTime } from '@/lib/utils';
import PageHeader from '@/components/shared/PageHeader';
import StatCard from '@/components/shared/StatCard';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { CalendarDays, CalendarRange, Clock, Package, Send, Plus, ScrollText } from 'lucide-react';

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

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <ScrollText className="h-4 w-4" /> Recent Activity
          </CardTitle>
        </CardHeader>
        <CardContent>
          {(data?.recentActivities || []).length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">No recent activity</p>
          ) : (
            <ul className="space-y-3">
              {data.recentActivities.map((a) => (
                <li key={a._id} className="flex items-start gap-3 text-sm">
                  <span className="mt-1.5 h-2 w-2 rounded-full bg-primary shrink-0" />
                  <div>
                    <p>{a.details || a.action}</p>
                    <p className="text-xs text-muted-foreground">{formatDateTime(a.timestamp)}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
