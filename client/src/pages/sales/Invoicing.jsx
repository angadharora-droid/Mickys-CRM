import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import api, { apiError } from '@/lib/api';
import { PAYMENT_MODE_LABELS, daysSince } from '@/lib/constants';
import { cn, formatCurrency, formatDate, formatDateTime, todayInput } from '@/lib/utils';
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
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  Search, Banknote, FileCheck2, Link2, Loader2, RefreshCw, AlertTriangle, Landmark, Clock, Eye, CheckCircle2,
} from 'lucide-react';

const paymentText = (p) => {
  if (!p?.mode) return 'Not recorded';
  return [PAYMENT_MODE_LABELS[p.mode] || p.mode, p.amount != null ? formatCurrency(p.amount) : '', p.reference].filter(Boolean).join(' · ');
};

/** Accounts link a Tally voucher that was keyed without the order number. */
function LinkInvoiceDialog({ open, order, onClose, onLinked }) {
  const [form, setForm] = useState({ voucherNumber: '', date: todayInput(), amount: '', note: '' });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || !order) return;
    setForm({ voucherNumber: '', date: todayInput(), amount: order.total ?? '', note: '' });
  }, [open, order]);

  const submit = async () => {
    if (!form.voucherNumber.trim()) return toast.error('Type the Tally invoice number');
    setBusy(true);
    try {
      const { data } = await api.post(`/invoicing/${order._id}/link-invoice`, {
        voucherNumber: form.voucherNumber.trim(),
        date: form.date || '',
        amount: form.amount === '' ? null : Number(form.amount),
        note: form.note.trim(),
      });
      toast.success(data.message);
      onLinked(data.data);
      onClose();
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Link Tally invoice to {order?.number}</DialogTitle>
          <DialogDescription>
            For a voucher keyed without the order number on it. Normally the Tally push matches invoices on its own —
            write <span className="font-medium">{order?.number}</span> in the invoice's Order No(s), Ref or Narration.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="space-y-1.5">
            <Label>Tally invoice number *</Label>
            <Input autoFocus value={form.voucherNumber} onChange={(e) => setForm((f) => ({ ...f, voucherNumber: e.target.value }))} placeholder="e.g. CPF/26-27/0142" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Invoice date</Label>
              <Input type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Invoice amount</Label>
              <Input type="number" min="0" inputMode="decimal" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Note</Label>
            <Textarea rows={2} value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} placeholder="Why it was linked by hand (optional)" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />} Link invoice
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Accounts note that the payment checked out against the bank. */
function VerifyDialog({ open, order, onClose, onVerified }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setNote(''); }, [open]);

  const submit = async () => {
    setBusy(true);
    try {
      const { data } = await api.post(`/invoicing/${order._id}/verify`, { note: note.trim() });
      toast.success(data.message);
      onVerified(data.data);
      onClose();
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Verify payment on {order?.number}</DialogTitle>
          <DialogDescription>
            Sales confirmed this order against: <span className="font-medium">{paymentText(order?.payment)}</span>
            {order?.payment?.receivedOn ? `, received ${formatDate(order.payment.receivedOn)}` : ''}. Mark it verified once
            the bank / cash book agrees. The order does not move — the Tally invoice does that.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label>Note</Label>
          <Textarea rows={2} autoFocus value={note} onChange={(e) => setNote(e.target.value)} placeholder="Bank reference, partial payment, anything accounts should remember (optional)" />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Landmark className="h-4 w-4" />} Mark verified
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The accounts desk. Accounts key the invoice in Tally; this screen tells
 * them which confirmed orders are waiting for one (with the payment sales
 * confirmed against) and shows the invoices Tally has sent back.
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
  const [linkFor, setLinkFor] = useState(null);
  const [verifyFor, setVerifyFor] = useState(null);

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

  const afterChange = (updated) => {
    fetchQueue();
    setDetail((d) => (d && String(d._id) === String(updated._id) ? updated : d));
  };

  const counts = meta?.counts || {};
  const lastSync = meta?.lastSync;
  const tdlStale = lastSync && lastSync.invoiceCount === 0;

  return (
    <div>
      <PageHeader
        title="Invoicing"
        description="Confirmed orders waiting for their Tally invoice, and the ones Tally has matched back"
      >
        <Button variant="outline" onClick={fetchQueue}>
          <RefreshCw className="h-4 w-4" /> Refresh
        </Button>
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-3 mb-4">
        <StatCard
          title="Awaiting invoice"
          value={counts.awaiting ?? '—'}
          hint="Confirmed by sales — key the invoice in Tally"
          icon={Clock}
          tone={counts.awaiting > 0 ? 'warning' : 'success'}
        />
        <StatCard title="Invoiced" value={counts.invoiced ?? '—'} hint="Matched from Tally or linked by hand" icon={FileCheck2} tone="success" />
        <StatCard
          title="Last Tally push"
          value={lastSync ? formatDateTime(lastSync.at).replace(/,? \d{4}/, '') : '—'}
          hint={
            !lastSync
              ? 'No sync yet'
              : tdlStale
                ? 'Carried no invoices — the Tally machine is on the old TDL'
                : `${lastSync.invoiceCount} invoice${lastSync.invoiceCount === 1 ? '' : 's'} carried · ${lastSync.invoicesMatched} matched to orders`
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
                  <TableHead className="text-right">Actions</TableHead>
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
                        <p className="text-xs text-muted-foreground">
                          {o.payment?.receivedOn ? `received ${formatDate(o.payment.receivedOn)}` : ''}
                          {o.accounts?.verifiedAt && (
                            <Badge variant="outline" className="ml-1 border bg-emerald-100 text-emerald-800 border-emerald-200 text-[10px]">
                              <CheckCircle2 className="h-3 w-3 mr-0.5" /> verified
                            </Badge>
                          )}
                        </p>
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
                              waiting {waiting} day{waiting === 1 ? '' : 's'}
                            </p>
                          </>
                        )}
                      </TableCell>
                      <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1">
                          <Button variant="ghost" size="icon" className="h-8 w-8" title="View order" onClick={() => setDetail(o)}>
                            <Eye className="h-4 w-4" />
                          </Button>
                          {o.status === 'confirmed' && !o.accounts?.verifiedAt && (
                            <Button variant="ghost" size="icon" className="h-8 w-8" title="Mark payment verified" onClick={() => setVerifyFor(o)}>
                              <Landmark className="h-4 w-4" />
                            </Button>
                          )}
                          {(o.status === 'confirmed' || o.status === 'open') && (
                            <Button variant="ghost" size="icon" className="h-8 w-8" title="Link Tally invoice by hand" onClick={() => setLinkFor(o)}>
                              <Link2 className="h-4 w-4" />
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

      <Card className="mt-4">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">How an order gets invoiced</CardTitle>
          <CardDescription>The invoice is keyed in Tally, not here. The CRM only needs to recognise it.</CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="grid gap-2 text-sm sm:grid-cols-3">
            <li className="rounded-lg border p-3">
              <p className="font-medium">1. Check the payment</p>
              <p className="text-xs text-muted-foreground mt-1">Sales confirm each order against a payment (or approved credit) — it is shown in the Payment column. Verify it if you keep that record.</p>
            </li>
            <li className="rounded-lg border p-3">
              <p className="font-medium">2. Key the sales invoice in Tally</p>
              <p className="text-xs text-muted-foreground mt-1">Write the order number (e.g. <span className="font-mono">SO-2026-0042</span>) in the invoice's <span className="font-medium">Order No(s)</span>, <span className="font-medium">Ref</span> or <span className="font-medium">Narration</span>. Case and spacing do not matter.</p>
            </li>
            <li className="rounded-lg border p-3">
              <p className="font-medium">3. Wait for the push</p>
              <p className="text-xs text-muted-foreground mt-1">Tally pushes to the CRM every 10 minutes (Ctrl+F10 on the Mickys Stock Export for at once). The order moves to Invoiced and dispatch is told. Forgot the number? Use Link invoice.</p>
            </li>
          </ol>
        </CardContent>
      </Card>

      <OrderDetailDialog
        open={Boolean(detail)}
        order={detail}
        onClose={() => setDetail(null)}
        renderActions={(o) => (
          <>
            {o.status === 'confirmed' && !o.accounts?.verifiedAt && (
              <Button variant="outline" onClick={() => setVerifyFor(o)}>
                <Landmark className="h-4 w-4" /> Mark payment verified
              </Button>
            )}
            {(o.status === 'confirmed' || o.status === 'open') && (
              <Button onClick={() => setLinkFor(o)}>
                <Link2 className="h-4 w-4" /> Link Tally invoice
              </Button>
            )}
            <Button variant="outline" onClick={() => setDetail(null)}>Close</Button>
          </>
        )}
      />
      <LinkInvoiceDialog open={Boolean(linkFor)} order={linkFor} onClose={() => setLinkFor(null)} onLinked={afterChange} />
      <VerifyDialog open={Boolean(verifyFor)} order={verifyFor} onClose={() => setVerifyFor(null)} onVerified={afterChange} />
    </div>
  );
}
