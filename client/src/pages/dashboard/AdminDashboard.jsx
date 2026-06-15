import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import api, { apiError } from '@/lib/api';
import PageHeader from '@/components/shared/PageHeader';
import StatCard from '@/components/shared/StatCard';
import { Skeleton } from '@/components/ui/skeleton';
import { Contact, Sparkles, Package, Send, Users } from 'lucide-react';

export default function AdminDashboard() {
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
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-28" />)}
        </div>
      </div>
    );
  }

  const cards = data?.cards || {};

  return (
    <div className="space-y-6">
      <PageHeader title="Admin Dashboard" description="Leads, kits and sales-exec activity across the team" />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5">
        <StatCard title="Total Leads" value={cards.totalLeads} icon={Contact} tone="primary" />
        <StatCard title="New Leads" value={cards.newLeads} icon={Sparkles} tone="gold" />
        <StatCard title="Kits Generated" value={cards.generatedKits} icon={Package} tone="primary" />
        <StatCard title="Delivered" value={cards.deliveredKits} icon={Send} tone="success" />
        <StatCard title="Active Execs" value={cards.activeExecs} icon={Users} tone="gold" />
      </div>
    </div>
  );
}
