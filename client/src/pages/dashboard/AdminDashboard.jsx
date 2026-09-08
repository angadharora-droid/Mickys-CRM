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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Contact, Sparkles, Package, Send, Users, Filter, UserCheck, Trophy, Medal, SquareKanban } from 'lucide-react';

export default function AdminDashboard() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get('/dashboard/admin')
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
  const league = data?.charts?.execPerformance || [];

  return (
    <div className="space-y-6">
      <PageHeader title="Admin Dashboard" description="Leads, kits, the status funnel and score card across the team" />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-7">
        <StatCard title="Total Leads" value={cards.totalLeads} icon={Contact} tone="primary" />
        <StatCard title="New Leads" value={cards.newLeads} icon={Sparkles} tone="gold" />
        <StatCard title="Kits Generated" value={cards.generatedKits} icon={Package} tone="primary" />
        <StatCard title="Delivered" value={cards.deliveredKits} icon={Send} tone="success" />
        <StatCard title="Clients Made" value={cards.clients} icon={UserCheck} tone="success" />
        <StatCard title="Score Points" value={cards.points?.toLocaleString('en-IN')} icon={Trophy} tone="gold" />
        <StatCard title="Active Execs" value={cards.activeExecs} icon={Users} tone="gold" />
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Filter className="h-4 w-4 text-muted-foreground" /> Lead Status Funnel
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
        <LeadScoreSummary scores={data?.scores} showExecutive className="lg:col-span-2" />
      </div>

      {/* Per-executive league: where their leads sit on the funnel and the
          points they have earned on the score card. */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Medal className="h-4 w-4 text-gold" /> Score League
            <span className="text-xs font-normal text-muted-foreground">· by owner, ranked on points</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {league.length === 0 ? (
            <p className="text-sm text-muted-foreground">No leads assigned yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8">#</TableHead>
                    <TableHead>Owner</TableHead>
                    <TableHead className="text-right">Leads</TableHead>
                    <TableHead className="text-right">Kits</TableHead>
                    <TableHead className="text-right">Live</TableHead>
                    <TableHead className="text-right whitespace-nowrap">Clients made</TableHead>
                    <TableHead className="text-right whitespace-nowrap">Turned down</TableHead>
                    <TableHead className="text-right">Points</TableHead>
                    <TableHead className="text-right whitespace-nowrap">Avg / lead</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {league.map((e, i) => (
                    <TableRow key={e.name}>
                      <TableCell className="text-xs font-semibold text-muted-foreground tabular-nums">{i + 1}</TableCell>
                      <TableCell className="font-medium">{e.name}</TableCell>
                      <TableCell className="text-right tabular-nums">{e.leads}</TableCell>
                      <TableCell className="text-right tabular-nums">{e.kits}</TableCell>
                      <TableCell className="text-right tabular-nums">{e.live}</TableCell>
                      <TableCell className="text-right tabular-nums text-emerald-700 dark:text-emerald-400">{e.clients}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{e.turnedDown}</TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">{e.points.toLocaleString('en-IN')}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{e.avgPoints}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
