import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import api, { apiError } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { MODULES, hasModule } from '@/lib/constants';
import { cn, formatCurrency, formatDate, formatDateTime } from '@/lib/utils';
import PageHeader from '@/components/shared/PageHeader';
import StatCard from '@/components/shared/StatCard';
import EmptyState from '@/components/shared/EmptyState';
import TableSkeleton from '@/components/shared/TableSkeleton';
import Pagination from '@/components/shared/Pagination';
import OrderDetailDialog from '@/components/sales/OrderDetailDialog';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Search, FileSpreadsheet, Download, Loader2, RefreshCw, Banknote, IndianRupee, ReceiptText, Link2 } from 'lucide-react';

const CUSTOM = '__custom__';
const pad2 = (n) => String(n).padStart(2, '0');

/** The last twelve months, newest first, as "Sep 2026" → "2026-09". */
const monthOptions = () => {
  const now = new Date();
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    return {
      value: `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`,
      label: d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }),
    };
  });
};
const monthRange = (v) => {
  const [y, m] = v.split('-').map(Number);
  return [`${v}-01`, `${v}-${pad2(new Date(y, m, 0).getDate())}`];
};

/**
 * The Tally sales register inside the CRM: every sales invoice the Tally
 * push has sent, one row each, as the register itself lays them out — with
 * the CRM order it settled (or the fact that it names none) beside it.
 */
export default function SalesRegister() {
  const { user } = useAuth();
  const months = useMemo(monthOptions, []);
  const [month, setMonth] = useState(months[0].value);
  const [[from, to], setRange] = useState(() => monthRange(months[0].value));
  const [search, setSearch] = useState('');
  const [unmatched, setUnmatched] = useState(false);
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [detail, setDetail] = useState(null);

  const params = useCallback(() => {
    const p = {};
    if (from) p.from = from;
    if (to) p.to = to;
    if (search) p.search = search;
    if (unmatched) p.unmatched = 'true';
    return p;
  }, [from, to, search, unmatched]);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/invoicing/register', { params: { ...params(), page, limit: 50 } });
      setRows(data.data);
      setMeta(data.meta);
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setLoading(false);
    }
  }, [params, page]);

  useEffect(() => {
    const t = setTimeout(fetchRows, search ? 350 : 0);
    return () => clearTimeout(t);
  }, [fetchRows, search]);

  const chooseMonth = (v) => {
    setMonth(v);
    if (v !== CUSTOM) setRange(monthRange(v));
    setPage(1);
  };

  const exportXlsx = async () => {
    setExporting(true);
    try {
      const res = await api.get('/invoicing/register/export', { params: params(), responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `mickys-sales-register_${from}_to_${to}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setExporting(false);
    }
  };

  const totals = meta?.totals;
  const anyBasic = rows.some((r) => r.basicValueKnown);

  return (
    <div>
      <PageHeader
        title="Sales Register"
        description="Every sales invoice Tally has sent to the CRM, as the register reads it — basic value is the Sales A/c amount before GST"
      >
        <Button variant="outline" onClick={fetchRows}>
          <RefreshCw className="h-4 w-4" /> Refresh
        </Button>
        {hasModule(user, MODULES.INVOICING) && (
          <Button asChild variant="outline">
            <Link to="/sales/invoicing"><Banknote className="h-4 w-4" /> Invoicing</Link>
          </Button>
        )}
        <Button onClick={exportXlsx} disabled={exporting || !totals?.count}>
          {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Export Excel
        </Button>
      </PageHeader>

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4 mb-4">
        <StatCard title="Invoices" value={totals ? totals.count.toLocaleString('en-IN') : '—'} hint={meta?.range?.label || ''} icon={ReceiptText} />
        <StatCard title="Basic Value" value={totals ? formatCurrency(totals.basicValue) : '—'} hint="Sales A/c, before GST" icon={IndianRupee} tone="success" />
        <StatCard title="Gross Total" value={totals ? formatCurrency(totals.amount) : '—'} hint={totals?.other ? `GST + round off ${formatCurrency(totals.other)}` : 'As billed'} icon={IndianRupee} tone="gold" />
        <StatCard
          title="Without CRM order"
          value={totals ? (totals.count - totals.matched).toLocaleString('en-IN') : '—'}
          hint={totals ? `${totals.matched} matched to orders` : ''}
          icon={Link2}
          tone={totals && totals.count - totals.matched > 0 ? 'warning' : 'success'}
        />
      </div>

      <Card className="p-4 mb-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Select value={month} onValueChange={chooseMonth}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {months.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
              <SelectItem value={CUSTOM}>Custom dates</SelectItem>
            </SelectContent>
          </Select>
          {month === CUSTOM && (
            <>
              <Input type="date" value={from} max={to || undefined} onChange={(e) => { setRange([e.target.value, to]); setPage(1); }} />
              <Input type="date" value={to} min={from || undefined} onChange={(e) => { setRange([from, e.target.value]); setPage(1); }} />
            </>
          )}
          <div className={cn('relative', month === CUSTOM ? 'lg:col-span-1' : 'lg:col-span-3')}>
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Party, voucher no., ref or order no.…" className="pl-9" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
          </div>
          <label className="flex h-10 items-center gap-2 rounded-lg border px-3 text-sm cursor-pointer">
            <input type="checkbox" className="h-4 w-4 accent-primary" checked={unmatched} onChange={(e) => { setUnmatched(e.target.checked); setPage(1); }} />
            Without CRM order only
          </label>
        </div>
      </Card>

      <Card>
        {loading ? (
          <TableSkeleton rows={8} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={FileSpreadsheet}
            title="No invoices in this window"
            description={
              meta?.totals && !search && !unmatched
                ? 'Tally has sent no sales invoices dated in this range. Invoices arrive with every Tally push once the updated TDL is loaded.'
                : 'Try another month, search or filter.'
            }
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Particulars</TableHead>
                    <TableHead className="hidden md:table-cell">Vch Type</TableHead>
                    <TableHead>Voucher No.</TableHead>
                    <TableHead className="hidden lg:table-cell">Ref No.</TableHead>
                    <TableHead className="text-right">Basic Value</TableHead>
                    <TableHead className="text-right hidden sm:table-cell">GST + R/O</TableHead>
                    <TableHead className="text-right">Gross Total</TableHead>
                    <TableHead className="hidden md:table-cell">CRM Order</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => {
                    const order = r.orders[0];
                    return (
                      <TableRow
                        key={r._id}
                        className={order ? 'cursor-pointer' : undefined}
                        onClick={() => order && setDetail({ _id: order._id, number: order.number })}
                      >
                        <TableCell className="whitespace-nowrap">{r.date ? formatDate(r.date) : '—'}</TableCell>
                        <TableCell className="max-w-[260px]">
                          <p className="truncate font-medium">{r.party || '—'}</p>
                          <p className="text-xs text-muted-foreground md:hidden">
                            {r.voucherType}{r.orders.length ? ` · ${r.orders.map((o) => o.number).join(', ')}` : ''}
                          </p>
                        </TableCell>
                        <TableCell className="hidden md:table-cell text-sm">{r.voucherType || '—'}</TableCell>
                        <TableCell className="whitespace-nowrap text-sm">{r.voucherNumber || '—'}</TableCell>
                        <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">{r.reference || '—'}</TableCell>
                        <TableCell
                          className="text-right tabular-nums font-semibold"
                          title={
                            `Tally sent — sales ledgers: ${formatCurrency(r.salesLedgerValue)} · item lines: ${formatCurrency(r.itemValue)} · GST: ${formatCurrency(r.tax)}` +
                            (r.basicValueKnown ? '' : ' — none usable, so the billed total is shown')
                          }
                        >
                          {formatCurrency(r.basicValue)}{!r.basicValueKnown && <span className="text-muted-foreground">*</span>}
                        </TableCell>
                        <TableCell className="text-right tabular-nums hidden sm:table-cell text-muted-foreground">
                          {r.gstAndRoundOff == null ? '—' : formatCurrency(r.gstAndRoundOff)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{formatCurrency(r.amount)}</TableCell>
                        <TableCell className="hidden md:table-cell">
                          {r.orders.length ? (
                            <>
                              <p className="text-sm">{r.orders.map((o) => o.number).join(', ')}</p>
                              <p className="text-xs text-muted-foreground">{r.orders.map((o) => o.bookedBy).filter(Boolean).join(', ')}</p>
                            </>
                          ) : r.orderNumbers.length ? (
                            <Badge variant="outline" className="border bg-red-100 text-red-700 border-red-200 text-[10px]" title="The order number written on the invoice does not exist in the CRM">
                              {r.orderNumbers.join(', ')} · no such order
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
                {totals && (
                  <TableFooter>
                    <TableRow>
                      <TableCell colSpan={5} className="font-semibold">
                        Grand Total · {totals.count} invoice{totals.count === 1 ? '' : 's'}
                        <span className="hidden lg:inline text-xs font-normal text-muted-foreground"> · {meta.range.label}</span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-bold">{formatCurrency(totals.basicValue)}</TableCell>
                      <TableCell className="text-right tabular-nums hidden sm:table-cell">{formatCurrency(totals.other)}</TableCell>
                      <TableCell className="text-right tabular-nums font-bold">{formatCurrency(totals.amount)}</TableCell>
                      <TableCell className="hidden md:table-cell" />
                    </TableRow>
                  </TableFooter>
                )}
              </Table>
            </div>
            {totals?.basis && totals.basis.withBasic < totals.count && (
              <div className="mx-4 my-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
                <p className="font-medium">
                  * {totals.count - totals.basis.withBasic} of {totals.count} invoices arrived without a usable basic value, so their billed total is shown.
                </p>
                <p className="mt-1">
                  Of the three figures the TDL sends, Tally delivered the sales-ledger figure on {totals.basis.withLedger}, the item-line figure on{' '}
                  {totals.basis.withItem} and the GST figure on {totals.basis.withTax} of them
                  {totals.basis.lastSeenAt ? ` (last push ${formatDateTime(totals.basis.lastSeenAt)})` : ''}.
                  {totals.basis.withLedger + totals.basis.withItem + totals.basis.withTax === 0
                    ? ' None arriving means the Tally machine is still running a TDL without these fields — re-download it from the TDL URL, replace the file and restart Tally.'
                    : ''}
                </p>
              </div>
            )}
            <Pagination meta={meta} onPageChange={setPage} />
          </>
        )}
      </Card>

      {meta?.range && rows.length > 0 && (
        <p className="mt-3 text-xs text-muted-foreground">
          Totals cover every invoice in the window, not just this page.
          {anyBasic ? ' Basic value is the Sales A/c amount as Tally sent it.' : ''}
          {totals?.basis?.lastSeenAt ? ` Last push ${formatDateTime(totals.basis.lastSeenAt)}.` : ''}
          {' '}Hover a basic value to see the figures Tally sent for that invoice.
        </p>
      )}

      <OrderDetailDialog
        open={Boolean(detail)}
        order={detail}
        onClose={() => setDetail(null)}
        renderActions={() => <Button variant="outline" onClick={() => setDetail(null)}>Close</Button>}
      />
    </div>
  );
}
