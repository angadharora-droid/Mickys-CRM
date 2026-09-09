import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import api, { apiError } from '@/lib/api';
import { PAYMENT_MODE_LABELS, daysSince } from '@/lib/constants';
import { cn, formatCurrency, formatDate, formatDateTime } from '@/lib/utils';
import PageHeader from '@/components/shared/PageHeader';
import StatCard from '@/components/shared/StatCard';
import EmptyState from '@/components/shared/EmptyState';
import TableSkeleton from '@/components/shared/TableSkeleton';
import Pagination from '@/components/shared/Pagination';
import OrderStatusBadge from '@/components/sales/OrderStatusBadge';
import OrderDetailDialog from '@/components/sales/OrderDetailDialog';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Search, Banknote, FileCheck2, FileQuestion, RefreshCw, AlertTriangle, Clock, Eye, FileSpreadsheet } from 'lucide-react';

const paymentText = (p) => {
  if (!p?.mode) return 'Not recorded';
  return [PAYMENT_MODE_LABELS[p.mode] || p.mode, p.amount != null ? formatCurrency(p.amount) : '', p.reference].filter(Boolean).join(' · ');
};

/**
 * The accounts desk — a monitor, not a form. Accounts key the invoice in
 * Tally with the order number on it; the Tally push brings it back and the
 * CRM moves the order to Invoiced and into the Dispatch queue on its own.
 * This screen shows which confirmed orders are waiting for that, which have
 * come back matched, and how many recent Tally invoices name no order at all
 * (keyed without the number — fixed in Tally, and matched by the next push).
 */
export default function Invoicing() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [stage, setStage] = useState('awaiting');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [orders, setOrders] = useState([]);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState(null);

  const fetchQueue = useCallback(async () => {
    setLoading(true);
    try {
      const params = { stage, page, limit: 20 };
      if (search) params.search = search;
      const { data } = await api.get('/invoicing/queue', { params });
      setOrders(data.data);
      setMeta(data.meta);
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setLoading(false);
    }
  }, [stage, page, search]);

  useEffect(() => {
    const t = setTimeout(fetchQueue, search ? 350 : 0);
    return () => clearTimeout(t);
  }, [fetchQueue, search]);

  // A notification ("SO-x confirmed — invoice it") lands here with ?order=.
  useEffect(() => {
    const id = searchParams.get('order');
    if (!id) return;
    api.get(`/sales-orders/${id}`)
      .then((r) => setDetail(r.data.data))
      .catch((err) => toast.error(apiError(err)))
      .finally(() => setSearchParams({}, { replace: true }));
  }, [searchParams, setSearchParams]);

  const counts = meta?.counts || {};
  const lastSync = meta?.lastSync;
  const unmatched = meta?.unmatchedInvoices ?? 0;
  const windowDays = meta?.unmatchedWindowDays || 60;
  // A push that carried no invoices, or one from a TDL copy older than the
  // current template, both mean the Tally machine needs the new file.
  const tdlStale = lastSync && (lastSync.invoiceCount === 0 || lastSync.tdlCurrent === false);

  return (
    <div>
      <PageHeader
        title="Invoicing"
        description="Confirmed orders waiting for their Tally invoice. The Tally push moves them to Invoiced and on to dispatch — nothing to do here."
      >
        <Button variant="outline" onClick={fetchQueue}>
          <RefreshCw className="h-4 w-4" /> Refresh
        </Button>
        <Button asChild variant="outline">
          <Link to="/sales/register"><FileSpreadsheet className="h-4 w-4" /> Sales register</Link>
        </Button>
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4 mb-4">
        <StatCard
          title="Awaiting invoice"
          value={counts.awaiting ?? '—'}
          hint="Confirmed by sales — key the invoice in Tally with the order number on it"
          icon={Clock}
          tone={counts.awaiting > 0 ? 'warning' : 'success'}
        />
        <StatCard title="Invoiced" value={counts.invoiced ?? '—'} hint="Matched from Tally and passed to dispatch" icon={FileCheck2} tone="success" />
        <Link
          to="/sales/register?unmatched=true"
          className="block rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          title="Open these invoices in the sales register"
        >
          <StatCard
            title="Without order number"
            value={meta ? unmatched : '—'}
            hint={
              unmatched > 0
                ? `Tally invoices from the last ${windowDays} days naming no CRM order. For a CRM order, add the SO number to the voucher in Tally — the next push matches it.`
                : `Every Tally invoice in the last ${windowDays} days names a CRM order`
            }
            icon={FileQuestion}
            tone={unmatched > 0 ? 'warning' : 'success'}
          />
        </Link>
        <StatCard
          title="Last Tally push"
          value={lastSync ? formatDateTime(lastSync.at).replace(/,? \d{4}/, '') : '—'}
          hint={
            !lastSync
              ? 'No sync yet'
              : lastSync.tdlCurrent === false
                ? `Tally is running TDL ${lastSync.tdlVersion ? `v${lastSync.tdlVersion}` : 'older than v4'} — current is v${lastSync.tdlLatest}. Re-download, replace, restart Tally.`
                : lastSync.invoiceCount === 0
                  ? 'Carried no invoices — the Tally machine is on the old TDL'
                  : `TDL v${lastSync.tdlVersion} · ${lastSync.invoiceCount} invoice${lastSync.invoiceCount === 1 ? '' : 's'} carried · ${lastSync.invoicesMatched} matched · basic value on ${lastSync.invoicesWithBasic}`
          }
          icon={tdlStale ? AlertTriangle : Banknote}
          tone={tdlStale ? 'danger' : 'primary'}
        />
      </div>

      <Card className="p-4 mb-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <Tabs value={stage} onValueChange={(v) => { setStage(v); setPage(1); }}>
            <TabsList className="flex-wrap h-auto">
              <TabsTrigger value="awaiting">Awaiting invoice{counts.awaiting != null ? ` (${counts.awaiting})` : ''}</TabsTrigger>
              <TabsTrigger value="invoiced">Invoiced{counts.invoiced != null ? ` (${counts.invoiced})` : ''}</TabsTrigger>
              <TabsTrigger value="open">Not yet confirmed{counts.open != null ? ` (${counts.open})` : ''}</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="relative md:w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Order, customer, invoice or UTR…" className="pl-9" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
          </div>
        </div>
      </Card>

      <Card>
        {loading ? (
          <TableSkeleton rows={6} />
        ) : orders.length === 0 ? (
          <EmptyState
            icon={Banknote}
            title={stage === 'awaiting' ? 'Nothing waiting for an invoice' : 'No orders here'}
            description={
              stage === 'awaiting'
                ? 'Every confirmed order has been invoiced. New confirmations appear here the moment sales confirm them.'
                : 'Try another tab or search.'
            }
          />
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                  <TableHead>Payment</TableHead>
                  <TableHead className="hidden lg:table-cell">{stage === 'invoiced' ? 'Tally invoice' : stage === 'open' ? 'Booked' : 'Confirmed'}</TableHead>
                  <TableHead className="text-right">View</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.map((o) => {
                  const inv = o.invoices?.[o.invoices.length - 1];
                  const waiting = daysSince(o.confirmedAt);
                  return (
                    <TableRow key={o._id} className="cursor-pointer" onClick={() => setDetail(o)}>
                      <TableCell>
                        <p className="font-medium whitespace-nowrap">{o.number}</p>
                        <p className="text-xs text-muted-foreground whitespace-nowrap">{formatDate(o.createdAt)} · {o.createdBy?.name || '—'}</p>
                      </TableCell>
                      <TableCell className="max-w-[220px]">
                        <p className="truncate">{o.customerName}</p>
                        {o.customer?.gstin && <p className="text-xs text-muted-foreground">GSTIN {o.customer.gstin}</p>}
                        <div className="lg:hidden mt-1"><OrderStatusBadge status={o.status} className="text-[10px]" /></div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-semibold">{formatCurrency(o.total)}</TableCell>
                      <TableCell>
                        <p className="text-sm">{paymentText(o.payment)}</p>
                        {o.payment?.receivedOn && (
                          <p className="text-xs text-muted-foreground">received {formatDate(o.payment.receivedOn)}</p>
                        )}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell">
                        {stage === 'invoiced' ? (
                          <>
                            <p className="text-sm font-medium">{inv?.voucherNumber || '—'}</p>
                            <p className="text-xs text-muted-foreground">
                              {inv?.date ? formatDate(inv.date) : ''}{inv ? ` · ${inv.source === 'tally' ? 'from Tally' : 'linked by hand'}` : ''}
                            </p>
                          </>
                        ) : stage === 'open' ? (
                          <p className="text-sm text-muted-foreground">{formatDateTime(o.createdAt)}</p>
                        ) : (
                          <>
                            <p className="text-sm">{formatDateTime(o.confirmedAt)}</p>
                            <p className={cn('text-xs', waiting > 2 ? 'text-red-600 font-medium' : 'text-muted-foreground')}>
                              waiting {waiting} day{waiting === 1 ? '' : 's'} for the Tally invoice
                            </p>
                          </>
                        )}
                      </TableCell>
                      <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                        <Button variant="ghost" size="icon" className="h-8 w-8" title="View order" onClick={() => setDetail(o)}>
                          <Eye className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            <Pagination meta={meta} onPageChange={setPage} />
          </>
        )}
      </Card>

      <Card className="mt-4">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">How an order gets invoiced</CardTitle>
          <CardDescription>Everything happens in Tally. The CRM only recognises the invoice and moves the order along.</CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="grid gap-2 text-sm sm:grid-cols-3">
            <li className="rounded-lg border p-3">
              <p className="font-medium">1. Sales confirm the order</p>
              <p className="text-xs text-muted-foreground mt-1">It lands in <span className="font-medium">Awaiting invoice</span> with the payment sales confirmed against. Nothing to click here.</p>
            </li>
            <li className="rounded-lg border p-3">
              <p className="font-medium">2. Key the sales invoice in Tally</p>
              <p className="text-xs text-muted-foreground mt-1">Write the order number (e.g. <span className="font-mono">SO-2026-0042</span>) in the invoice's <span className="font-medium">Order No(s)</span>, <span className="font-medium">Ref</span> or <span className="font-medium">Narration</span>. Case and spacing do not matter.</p>
            </li>
            <li className="rounded-lg border p-3">
              <p className="font-medium">3. The push does the rest</p>
              <p className="text-xs text-muted-foreground mt-1">Tally pushes to the CRM every 10 minutes (Ctrl+F10 on the Mickys Stock Export for at once). The order moves to <span className="font-medium">Invoiced</span> and into the Dispatch queue on its own. Forgot the number? Add it to the voucher in Tally — the next push picks it up.</p>
            </li>
          </ol>
        </CardContent>
      </Card>

      <OrderDetailDialog
        open={Boolean(detail)}
        order={detail}
        onClose={() => setDetail(null)}
        renderActions={() => <Button variant="outline" onClick={() => setDetail(null)}>Close</Button>}
      />
    </div>
  );
}
