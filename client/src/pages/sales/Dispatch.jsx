import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import api, { apiError } from '@/lib/api';
import { DISPATCH_MODE_OPTIONS, DISPATCH_MODE_LABELS, daysSince } from '@/lib/constants';
import { cn, formatCurrency, formatDate, formatDateTime, todayInput } from '@/lib/utils';
import PageHeader from '@/components/shared/PageHeader';
import StatCard from '@/components/shared/StatCard';
import EmptyState from '@/components/shared/EmptyState';
import TableSkeleton from '@/components/shared/TableSkeleton';
import Pagination from '@/components/shared/Pagination';
import OrderStatusBadge from '@/components/sales/OrderStatusBadge';
import OrderDetailDialog from '@/components/sales/OrderDetailDialog';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Search, Truck, PackageCheck, Loader2, RefreshCw, Clock, Eye, Pencil, Send } from 'lucide-react';

const dateInput = (d) => (d ? new Date(d).toLocaleDateString('en-CA') : '');

const EMPTY_FORM = {
  mode: 'transport', carrier: '', docketNumber: '', vehicleNumber: '', driverName: '', driverPhone: '',
  packages: '', weightKg: '', ewayBill: '', dispatchedOn: '', expectedDeliveryOn: '', remarks: '',
};

/** How the goods went — the form dispatch fills when the consignment leaves. */
function DispatchFormDialog({ open, order, onClose, onSaved }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const editing = order?.status === 'dispatched';

  useEffect(() => {
    if (!open || !order) return;
    const d = order.dispatch || {};
    setForm({
      mode: d.mode || 'transport',
      carrier: d.carrier || '',
      docketNumber: d.docketNumber || '',
      vehicleNumber: d.vehicleNumber || '',
      driverName: d.driverName || '',
      driverPhone: d.driverPhone || '',
      packages: d.packages ?? '',
      weightKg: d.weightKg ?? '',
      ewayBill: d.ewayBill || '',
      dispatchedOn: d.dispatchedOn ? dateInput(d.dispatchedOn) : todayInput(),
      expectedDeliveryOn: d.expectedDeliveryOn ? dateInput(d.expectedDeliveryOn) : '',
      remarks: d.remarks || '',
    });
  }, [open, order]);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async () => {
    setBusy(true);
    try {
      const { data } = await api.post(`/dispatch/${order._id}`, {
        ...form,
        packages: form.packages === '' ? null : Number(form.packages),
        weightKg: form.weightKg === '' ? null : Number(form.weightKg),
      });
      toast.success(data.message);
      onSaved(data.data);
      onClose();
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setBusy(false);
    }
  };

  const inv = order?.invoices?.[order.invoices.length - 1];

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[92dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? `Dispatch details — ${order?.number}` : `Dispatch ${order?.number}`}</DialogTitle>
          <DialogDescription>
            {order?.customerName}
            {inv?.voucherNumber ? ` · Tally invoice ${inv.voucherNumber}${inv.date ? ` dated ${formatDate(inv.date)}` : ''}` : ''}
            {' · '}{formatCurrency(order?.total)}
            {editing ? '' : '. Saving marks the order dispatched and tells the sales executive to confirm delivery.'}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>How is it going? *</Label>
            <Select value={form.mode} onValueChange={(v) => setForm((f) => ({ ...f, mode: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {DISPATCH_MODE_OPTIONS.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Transporter / courier</Label>
            <Input value={form.carrier} onChange={set('carrier')} placeholder="e.g. VRL Logistics, Delhivery" />
          </div>
          <div className="space-y-1.5">
            <Label>LR / AWB / docket no.</Label>
            <Input value={form.docketNumber} onChange={set('docketNumber')} />
          </div>
          <div className="space-y-1.5">
            <Label>Vehicle number</Label>
            <Input value={form.vehicleNumber} onChange={set('vehicleNumber')} placeholder="MH 31 AB 1234" />
          </div>
          <div className="space-y-1.5">
            <Label>Driver name</Label>
            <Input value={form.driverName} onChange={set('driverName')} />
          </div>
          <div className="space-y-1.5">
            <Label>Driver phone</Label>
            <Input type="tel" inputMode="tel" value={form.driverPhone} onChange={set('driverPhone')} />
          </div>
          <div className="space-y-1.5">
            <Label>Packages</Label>
            <Input type="number" min="0" inputMode="numeric" value={form.packages} onChange={set('packages')} placeholder="Boxes / crates" />
          </div>
          <div className="space-y-1.5">
            <Label>Weight (kg)</Label>
            <Input type="number" min="0" inputMode="decimal" value={form.weightKg} onChange={set('weightKg')} />
          </div>
          <div className="space-y-1.5">
            <Label>E-way bill no.</Label>
            <Input value={form.ewayBill} onChange={set('ewayBill')} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Dispatched on</Label>
              <Input type="date" value={form.dispatchedOn} onChange={set('dispatchedOn')} />
            </div>
            <div className="space-y-1.5">
              <Label>Expected delivery</Label>
              <Input type="date" value={form.expectedDeliveryOn} min={form.dispatchedOn || undefined} onChange={set('expectedDeliveryOn')} />
            </div>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Remarks</Label>
            <Textarea rows={2} value={form.remarks} onChange={set('remarks')} placeholder="Cold chain, part shipment, anything the sales exec or customer should know" />
          </div>
        </div>

        <DialogFooter className="mt-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : editing ? <Pencil className="h-4 w-4" /> : <Send className="h-4 w-4" />}
            {editing ? 'Save details' : 'Mark dispatched'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const dispatchSummary = (d) =>
  d?.mode
    ? [DISPATCH_MODE_LABELS[d.mode] || d.mode, d.carrier, d.docketNumber && `#${d.docketNumber}`, d.vehicleNumber].filter(Boolean).join(' · ')
    : '—';

/**
 * The dispatch desk: invoiced orders waiting to go, the form that sends
 * them, and the consignments still out with the customer.
 */
export default function Dispatch() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [stage, setStage] = useState('pending');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [orders, setOrders] = useState([]);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState(null);
  const [formFor, setFormFor] = useState(null);

  const fetchQueue = useCallback(async () => {
    setLoading(true);
    try {
      const params = { stage, page, limit: 20 };
      if (search) params.search = search;
      const { data } = await api.get('/dispatch/queue', { params });
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

  // A notification ("SO-x invoiced — ready to dispatch") lands here with ?order=.
  useEffect(() => {
    const id = searchParams.get('order');
    if (!id) return;
    api.get(`/sales-orders/${id}`)
      .then((r) => setDetail(r.data.data))
      .catch((err) => toast.error(apiError(err)))
      .finally(() => setSearchParams({}, { replace: true }));
  }, [searchParams, setSearchParams]);

  const afterChange = (updated) => {
    fetchQueue();
    setDetail((d) => (d && String(d._id) === String(updated._id) ? updated : d));
  };

  const counts = meta?.counts || {};

  return (
    <div>
      <PageHeader title="Dispatch" description="Invoiced orders waiting to go out, and the consignments still on their way">
        <Button variant="outline" onClick={fetchQueue}>
          <RefreshCw className="h-4 w-4" /> Refresh
        </Button>
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-3 mb-4">
        <StatCard title="To dispatch" value={counts.pending ?? '—'} hint="Invoiced in Tally — send the goods" icon={Clock} tone={counts.pending > 0 ? 'warning' : 'success'} />
        <StatCard title="On the way" value={counts.dispatched ?? '—'} hint="Sent, delivery not yet confirmed by sales" icon={Truck} tone="primary" />
        <StatCard title="Delivered" value={counts.delivered ?? '—'} hint="Confirmed received by the customer" icon={PackageCheck} tone="success" />
      </div>

      <Card className="p-4 mb-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <Tabs value={stage} onValueChange={(v) => { setStage(v); setPage(1); }}>
            <TabsList className="flex-wrap h-auto">
              <TabsTrigger value="pending">To dispatch{counts.pending != null ? ` (${counts.pending})` : ''}</TabsTrigger>
              <TabsTrigger value="dispatched">On the way{counts.dispatched != null ? ` (${counts.dispatched})` : ''}</TabsTrigger>
              <TabsTrigger value="delivered">Delivered{counts.delivered != null ? ` (${counts.delivered})` : ''}</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="relative md:w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Order, customer, invoice, docket, vehicle…" className="pl-9" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
          </div>
        </div>
      </Card>

      <Card>
        {loading ? (
          <TableSkeleton rows={6} />
        ) : orders.length === 0 ? (
          <EmptyState
            icon={Truck}
            title={stage === 'pending' ? 'Nothing to dispatch' : 'No orders here'}
            description={
              stage === 'pending'
                ? 'Orders appear here the moment their Tally invoice is matched. Nothing is waiting right now.'
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
                  <TableHead className="hidden md:table-cell">Tally invoice</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                  <TableHead className="hidden lg:table-cell">{stage === 'pending' ? 'Waiting' : stage === 'dispatched' ? 'Sent' : 'Delivered'}</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.map((o) => {
                  const inv = o.invoices?.[o.invoices.length - 1];
                  const waiting = daysSince(o.invoicedAt);
                  const c = o.customer;
                  return (
                    <TableRow key={o._id} className="cursor-pointer" onClick={() => setDetail(o)}>
                      <TableCell>
                        <p className="font-medium whitespace-nowrap">{o.number}</p>
                        <p className="text-xs text-muted-foreground whitespace-nowrap">{o.createdBy?.name || '—'}{o.createdBy?.phone ? ` · ${o.createdBy.phone}` : ''}</p>
                      </TableCell>
                      <TableCell className="max-w-[240px]">
                        <p className="truncate">{o.customerName}</p>
                        <p className="text-xs text-muted-foreground truncate">{[c?.mobile, c?.address].filter(Boolean).join(' · ') || ''}</p>
                        <div className="md:hidden mt-1"><OrderStatusBadge status={o.status} className="text-[10px]" /></div>
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        <p className="text-sm">{inv?.voucherNumber || <span className="text-muted-foreground">not matched</span>}</p>
                        {inv?.date && <p className="text-xs text-muted-foreground">{formatDate(inv.date)}</p>}
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-semibold">{formatCurrency(o.total)}</TableCell>
                      <TableCell className="hidden lg:table-cell">
                        {stage === 'pending' ? (
                          <>
                            <p className={cn('text-sm', waiting > 2 ? 'text-red-600 font-medium' : '')}>{waiting} day{waiting === 1 ? '' : 's'}</p>
                            <p className="text-xs text-muted-foreground">invoiced {formatDateTime(o.invoicedAt)}</p>
                          </>
                        ) : stage === 'dispatched' ? (
                          <>
                            <p className="text-sm">{dispatchSummary(o.dispatch)}</p>
                            <p className="text-xs text-muted-foreground">
                              {o.dispatch?.dispatchedOn ? formatDate(o.dispatch.dispatchedOn) : formatDate(o.dispatchedAt)}
                              {o.dispatch?.expectedDeliveryOn ? ` · expected ${formatDate(o.dispatch.expectedDeliveryOn)}` : ''}
                            </p>
                          </>
                        ) : (
                          <>
                            <p className="text-sm">{o.delivery?.deliveredOn ? formatDate(o.delivery.deliveredOn) : formatDate(o.deliveredAt)}</p>
                            <p className="text-xs text-muted-foreground">{o.delivery?.receivedBy ? `received by ${o.delivery.receivedBy}` : dispatchSummary(o.dispatch)}</p>
                          </>
                        )}
                      </TableCell>
                      <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1">
                          <Button variant="ghost" size="icon" className="h-8 w-8" title="View order" onClick={() => setDetail(o)}>
                            <Eye className="h-4 w-4" />
                          </Button>
                          {o.status === 'invoiced' && (
                            <Button size="sm" onClick={() => setFormFor(o)}>
                              <Truck className="h-4 w-4" /> Dispatch
                            </Button>
                          )}
                          {o.status === 'dispatched' && (
                            <Button variant="ghost" size="icon" className="h-8 w-8" title="Edit dispatch details" onClick={() => setFormFor(o)}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
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

      <OrderDetailDialog
        open={Boolean(detail)}
        order={detail}
        onClose={() => setDetail(null)}
        renderActions={(o) => (
          <>
            {o.status === 'invoiced' && (
              <Button onClick={() => setFormFor(o)}>
                <Truck className="h-4 w-4" /> Dispatch this order
              </Button>
            )}
            {o.status === 'dispatched' && (
              <Button variant="outline" onClick={() => setFormFor(o)}>
                <Pencil className="h-4 w-4" /> Edit dispatch details
              </Button>
            )}
            <Button variant="outline" onClick={() => setDetail(null)}>Close</Button>
          </>
        )}
      />
      <DispatchFormDialog open={Boolean(formFor)} order={formFor} onClose={() => setFormFor(null)} onSaved={afterChange} />
    </div>
  );
}
