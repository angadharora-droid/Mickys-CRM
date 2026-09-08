import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import api, { apiError } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import {
  ROLES, MODULES, PIPELINE_STAGES, ORDER_STATUS_LABELS, hasModule, canUseSalesPages, orderStageSince, daysSince,
} from '@/lib/constants';
import { cn, formatCurrency, formatDate, formatDateTime } from '@/lib/utils';
import PageHeader from '@/components/shared/PageHeader';
import EmptyState from '@/components/shared/EmptyState';
import TableSkeleton from '@/components/shared/TableSkeleton';
import Pagination from '@/components/shared/Pagination';
import OrderFunnel from '@/components/sales/OrderFunnel';
import OrderStatusBadge from '@/components/sales/OrderStatusBadge';
import OrderDetailDialog from '@/components/sales/OrderDetailDialog';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ReceiptText, Banknote, Truck, RefreshCw, Workflow, AlertTriangle } from 'lucide-react';

const ALL = '__all__';

const dayStr = (d) => d.toLocaleDateString('en-CA');

/** Booking-date windows the funnel can be drawn over. No dates = whole book. */
const PRESETS = [
  { value: 'all', label: 'All orders' },
  { value: 'last30', label: 'Booked in last 30 days' },
  { value: 'thisMonth', label: 'Booked this month' },
  { value: 'last90', label: 'Booked in last 90 days' },
  { value: 'custom', label: 'Custom booking dates' },
];

function presetRange(preset) {
  const now = new Date();
  switch (preset) {
    case 'last30': return [dayStr(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29)), dayStr(now)];
    case 'thisMonth': return [dayStr(new Date(now.getFullYear(), now.getMonth(), 1)), dayStr(now)];
    case 'last90': return [dayStr(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 89)), dayStr(now)];
    default: return ['', ''];
  }
}

const STAGE_META = Object.fromEntries(PIPELINE_STAGES.map((s) => [s.key, s]));

/**
 * The whole pipeline on one screen: the funnel over a booking window, and
 * under it the orders sitting at whichever stage was clicked, oldest first,
 * with how long each has waited and whose move it is.
 */
export default function Pipeline() {
  const { user } = useAuth();
  const isAdmin = user?.role === ROLES.ADMIN;
  const [searchParams] = useSearchParams();

  const [preset, setPreset] = useState('all');
  const [[from, to], setRange] = useState(['', '']);
  const [execId, setExecId] = useState(ALL);
  const [execs, setExecs] = useState([]);
  const [mine, setMine] = useState(false);

  const [funnel, setFunnel] = useState(null);
  const [funnelLoading, setFunnelLoading] = useState(true);
  const [stage, setStage] = useState(searchParams.get('stage') || 'open');
  const [orders, setOrders] = useState([]);
  const [meta, setMeta] = useState(null);
  const [page, setPage] = useState(1);
  const [listLoading, setListLoading] = useState(true);
  const [detail, setDetail] = useState(null);

  // Admin-only: everyone who can book an order, for the executive filter.
  useEffect(() => {
    if (!isAdmin) return;
    Promise.all([
      api.get('/users', { params: { role: ROLES.ADMIN, isActive: 'true', limit: 100 } }),
      api.get('/users', { params: { role: ROLES.SALES_EXEC, isActive: 'true', limit: 100 } }),
    ])
      .then((results) => setExecs(results.flatMap((r) => r.data.data)))
      .catch(() => {});
  }, [isAdmin]);

  const scopeParams = useCallback(() => {
    const params = {};
    if (from) params.from = from;
    if (to) params.to = to;
    if (isAdmin && execId !== ALL) params.execId = execId;
    if (!isAdmin && mine) params.mine = 'true';
    return params;
  }, [from, to, isAdmin, execId, mine]);

  const fetchFunnel = useCallback(async () => {
    setFunnelLoading(true);
    try {
      const { data } = await api.get('/sales-orders/funnel', { params: scopeParams() });
      setFunnel(data.data);
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setFunnelLoading(false);
    }
  }, [scopeParams]);

  const fetchList = useCallback(async () => {
    setListLoading(true);
    try {
      const { data } = await api.get('/sales-orders', {
        params: { ...scopeParams(), status: stage, page, limit: 20, sort: 'oldest' },
      });
      setOrders(data.data);
      setMeta(data.meta);
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setListLoading(false);
    }
  }, [scopeParams, stage, page]);

  useEffect(() => { fetchFunnel(); }, [fetchFunnel]);
  useEffect(() => { fetchList(); }, [fetchList]);

  const choosePreset = (p) => {
    setPreset(p);
    if (p !== 'custom') setRange(presetRange(p));
    setPage(1);
  };
  const chooseStage = (s) => {
    setStage(s);
    setPage(1);
  };

  const refresh = () => {
    fetchFunnel();
    fetchList();
  };

  const stageMeta = STAGE_META[stage];
  const stageRow = funnel?.stages.find((s) => s.key === stage);
  const stuckAfter = stageRow?.stuckAfterDays;

  return (
    <div>
      <PageHeader
        title="Order Pipeline"
        description="Every order from booking to customer feedback — where each one stands, how long it has waited, and whose move it is"
      >
        <Button variant="outline" onClick={refresh}>
          <RefreshCw className="h-4 w-4" /> Refresh
        </Button>
        {canUseSalesPages(user) && (
          <Button asChild variant="outline">
            <Link to="/sales/orders"><ReceiptText className="h-4 w-4" /> Sales Orders</Link>
          </Button>
        )}
        {hasModule(user, MODULES.INVOICING) && (
          <Button asChild variant="outline">
            <Link to="/sales/invoicing"><Banknote className="h-4 w-4" /> Invoicing</Link>
          </Button>
        )}
        {hasModule(user, MODULES.DISPATCH) && (
          <Button asChild variant="outline">
            <Link to="/sales/dispatch"><Truck className="h-4 w-4" /> Dispatch</Link>
          </Button>
        )}
      </PageHeader>

      <Card className="p-4 mb-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Select value={preset} onValueChange={choosePreset}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {PRESETS.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
            </SelectContent>
          </Select>
          {preset === 'custom' && (
            <>
              <Input type="date" value={from} max={to || undefined} onChange={(e) => { setRange([e.target.value, to]); setPage(1); }} />
              <Input type="date" value={to} min={from || undefined} onChange={(e) => { setRange([from, e.target.value]); setPage(1); }} />
            </>
          )}
          {isAdmin ? (
            <Select value={execId} onValueChange={(v) => { setExecId(v); setPage(1); }}>
              <SelectTrigger><SelectValue placeholder="All executives" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All executives</SelectItem>
                {execs.map((u) => <SelectItem key={u._id} value={u._id}>{u.name}</SelectItem>)}
              </SelectContent>
            </Select>
          ) : (
            <label className="flex items-center gap-2 rounded-lg border px-3 text-sm cursor-pointer h-10">
              <input type="checkbox" className="h-4 w-4 accent-primary" checked={mine} onChange={(e) => { setMine(e.target.checked); setPage(1); }} />
              Only my orders
            </label>
          )}
        </div>
      </Card>

      <Card className="mb-4">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Workflow className="h-4 w-4 text-primary" /> Funnel
            {funnel?.range && <span className="text-xs font-normal text-muted-foreground">· booked {funnel.range.label}</span>}
          </CardTitle>
          <CardDescription>
            Each bar is the share of booked orders that reached the stage. Click a stage to list the orders sitting there now.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {funnelLoading && !funnel ? (
            <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-8" />)}</div>
          ) : funnel?.totals.booked === 0 && funnel?.totals.cancelled === 0 ? (
            <EmptyState icon={Workflow} title="No orders in this window" description="Widen the booking dates, or book the first order." />
          ) : (
            <OrderFunnel data={funnel} activeStage={stage} onStageClick={chooseStage} />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex flex-wrap items-center gap-2">
            {stage === 'cancelled' ? 'Cancelled' : `${stageMeta?.label || ORDER_STATUS_LABELS[stage]} — here now`}
            {meta && <span className="text-xs font-normal text-muted-foreground">· {meta.total} order{meta.total === 1 ? '' : 's'}</span>}
          </CardTitle>
          {stageMeta?.next && <CardDescription>Next step: {stageMeta.next}. Oldest first.</CardDescription>}
        </CardHeader>
        <CardContent className="p-0">
          {listLoading ? (
            <TableSkeleton rows={5} />
          ) : orders.length === 0 ? (
            <EmptyState icon={ReceiptText} title="Nothing here" description="No orders are sitting at this stage in the chosen window." />
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Order</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead className="text-right">Value</TableHead>
                    <TableHead className="hidden md:table-cell">Booked by</TableHead>
                    <TableHead>At this stage</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orders.map((o) => {
                    const since = orderStageSince(o);
                    const days = daysSince(since);
                    const stuck = stuckAfter && days > stuckAfter;
                    return (
                      <TableRow key={o._id} className="cursor-pointer" onClick={() => setDetail(o)}>
                        <TableCell>
                          <p className="font-medium whitespace-nowrap">{o.number}</p>
                          <p className="text-xs text-muted-foreground">booked {formatDate(o.createdAt)}</p>
                        </TableCell>
                        <TableCell className="max-w-[200px]">
                          <p className="truncate">{o.customerName}</p>
                          <div className="md:hidden"><OrderStatusBadge status={o.status} className="mt-1 text-[10px]" /></div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums font-semibold">{formatCurrency(o.total)}</TableCell>
                        <TableCell className="hidden md:table-cell text-sm text-muted-foreground">{o.createdBy?.name || '—'}</TableCell>
                        <TableCell>
                          <p className={cn('text-sm tabular-nums whitespace-nowrap', stuck ? 'text-red-600 font-semibold' : '')}>
                            {stuck && <AlertTriangle className="inline h-3.5 w-3.5 mr-1 -mt-0.5" />}
                            {days} day{days === 1 ? '' : 's'}
                          </p>
                          <p className="text-xs text-muted-foreground whitespace-nowrap">since {formatDateTime(since)}</p>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              <Pagination meta={meta} onPageChange={setPage} />
            </>
          )}
        </CardContent>
      </Card>

      <OrderDetailDialog
        open={Boolean(detail)}
        order={detail}
        onClose={() => setDetail(null)}
        renderActions={(o) => (
          <>
            {canUseSalesPages(user) && (
              <Button asChild variant="outline">
                <Link to={`/sales/orders?order=${o._id}`}><ReceiptText className="h-4 w-4" /> Open in Sales Orders</Link>
              </Button>
            )}
            {hasModule(user, MODULES.INVOICING) && (o.status === 'confirmed' || o.status === 'open') && (
              <Button asChild variant="outline">
                <Link to={`/sales/invoicing?order=${o._id}`}><Banknote className="h-4 w-4" /> Open in Invoicing</Link>
              </Button>
            )}
            {hasModule(user, MODULES.DISPATCH) && (o.status === 'invoiced' || o.status === 'dispatched') && (
              <Button asChild variant="outline">
                <Link to={`/sales/dispatch?order=${o._id}`}><Truck className="h-4 w-4" /> Open in Dispatch</Link>
              </Button>
            )}
            <Button variant="outline" onClick={() => setDetail(null)}>Close</Button>
          </>
        )}
      />
    </div>
  );
}
