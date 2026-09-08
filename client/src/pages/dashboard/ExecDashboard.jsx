import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import api, { apiError } from '@/lib/api';
import PageHeader from '@/components/shared/PageHeader';
import StatCard from '@/components/shared/StatCard';
import LeadFunnel from '@/components/leads/LeadFunnel';
import LeadScoreSummary from '@/components/leads/LeadScoreSummary';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { CalendarDays, CalendarRange, Clock, Package, Send, Plus, Filter, UserCheck, Trophy, SquareKanban } from 'lucide-react';

export default function ExecDashboard() {
  const navigate = useNavigate();
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
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-7">
          {Array.from({ length: 7 }).map((_, i) => <Skeleton key={i} className="h-28" />)}
        </div>
        <div className="grid gap-4 lg:grid-cols-5">
          <Skeleton className="h-72 lg:col-span-3" />
          <Skeleton className="h-72 lg:col-span-2" />
        </div>
      </div>
    );
  }

  const cards = data?.cards || {};

  return (
    <div className="space-y-6">
      <PageHeader title="My Dashboard" description="Your leads, their funnel stage and score at a glance">
        <Button asChild>
          <Link to="/leads/new"><Plus className="h-4 w-4" /> New Lead</Link>
        </Button>
      </PageHeader>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-7">
        <StatCard title="New Today" value={cards.todayCount} icon={CalendarDays} tone="primary" />
        <StatCard title="This Month" value={cards.monthCount} icon={CalendarRange} tone="gold" />
        <StatCard title="In Progress" value={cards.openCount} icon={Clock} tone="warning" />
        <StatCard title="Kits Generated" value={cards.generatedCount} icon={Package} tone="primary" />
        <StatCard title="Delivered" value={cards.deliveredCount} icon={Send} tone="success" />
        <StatCard title="Clients Made" value={cards.clients} icon={UserCheck} tone="success" />
        <StatCard title="My Points" value={cards.points?.toLocaleString('en-IN')} icon={Trophy} tone="gold" />
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Filter className="h-4 w-4 text-muted-foreground" /> My Lead Funnel
              <span className="text-xs font-normal text-muted-foreground">· click a stage to open those leads</span>
              <Button asChild variant="outline" size="sm" className="ml-auto h-7">
                <Link to="/pipeline"><SquareKanban className="h-3.5 w-3.5" /> Open board</Link>
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <LeadFunnel data={data?.funnel} onStageClick={(stage) => navigate(`/leads?stage=${stage}`)} />
          </CardContent>
        </Card>
        <LeadScoreSummary scores={data?.scores} title="My Score Card" className="lg:col-span-2" />
      </div>
    </div>
  );
}
