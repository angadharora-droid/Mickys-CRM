import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import api, { apiError } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { ROLES } from '@/lib/constants';
import { cn, formatCurrency, formatDate, formatDateTime } from '@/lib/utils';
import PageHeader from '@/components/shared/PageHeader';
import EmptyState from '@/components/shared/EmptyState';
import TableSkeleton from '@/components/shared/TableSkeleton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Download, FileSpreadsheet, Loader2, CalendarRange } from 'lucide-react';

const ALL_EXECS = '__all__';
const PREVIEW_CAP = 300;

const dayStr = (d) => d.toLocaleDateString('en-CA'); // YYYY-MM-DD in local time

/** Date presets, matching the CRM reports page. */
const PRESETS = [
  { value: 'today', label: 'Today (daily)' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'last7', label: 'Last 7 days' },
  { value: 'last30', label: 'Last 30 days' },
  { value: 'thisMonth', label: 'This month' },
  { value: 'lastMonth', label: 'Last month' },
  { value: 'custom', label: 'Custom range' },
];

function presetRange(preset) {
  const now = new Date();
  switch (preset) {
    case 'today': return [dayStr(now), dayStr(now)];
    case 'yesterday': {
      const y = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
      return [dayStr(y), dayStr(y)];
    }
    case 'last7': return [dayStr(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6)), dayStr(now)];
    case 'last30': return [dayStr(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29)), dayStr(now)];
    case 'thisMonth': return [dayStr(new Date(now.getFullYear(), now.getMonth(), 1)), dayStr(now)];
    case 'lastMonth': {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const end = new Date(now.getFullYear(), now.getMonth(), 0);
      return [dayStr(start), dayStr(end)];
    }
    default: return null;
  }
}

/** Numeric columns that carry rupees rather than counts or quantities. */
const MONEY_KEYS = new Set(['total', 'value', 'avgRate', 'avgOrderValue', 'openValue', 'reservedValue']);

/** Stock Commitment and Rate Freeze Validity describe today, not a window. */
const CURRENT_STATE = new Set(['commitment', 'rateValidity']);

function cellValue(col, value) {
  if (value === null || value === undefined || value === '') return '—';
  if (col.type === 'date') return formatDate(value);
  if (col.type === 'datetime') return formatDateTime(value);
  if (col.type === 'day') return formatDate(`${value}T00:00:00`);
  if (col.type === 'number') {
    return MONEY_KEYS.has(col.key)
      ? formatCurrency(value)
      : Number(value).toLocaleString('en-IN', { maximumFractionDigits: 3 });
  }
  return String(value);
}

/** Order statuses, rate-freeze states and stock alerts all read as a chip. */
const TONES = {
  Open: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  Confirmed: 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300',
  Closed: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  Cancelled: 'bg-destructive/10 text-destructive',
  Expired: 'bg-destructive/10 text-destructive',
  'Expiring soon': 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  'No validity set': 'bg-muted text-muted-foreground',
  Valid: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  Oversold: 'bg-destructive/10 text-destructive',
  'Not in Tally': 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
};

const CHIP_COLUMNS = ['status', 'validity', 'alert'];

export default function SalesReports() {
  const { user } = useAuth();
  const isAdmin = user?.role === ROLES.ADMIN;

  const [catalog, setCatalog] = useState([]);
  const [type, setType] = useState('register');
  const [preset, setPreset] = useState('last30');
  const [[from, to], setRange] = useState(() => presetRange('last30'));
  const [execId, setExecId] = useState(ALL_EXECS);
  const [execs, setExecs] = useState([]);
  const [limitPending, setLimitPending] = useState(false);
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState('');

  // Report catalog (types + labels) — the server decides what this user may run,
  // so an exec's picker simply has no Executive Performance in it.
  useEffect(() => {
    api.get('/sales-reports')
      .then(({ data }) => setCatalog(data.data))
      .catch((err) => toast.error(apiError(err)));
  }, []);

  // Admin-only: everyone who can book an order, for the executive filter.
  useEffect(() => {
    if (!isAdmin) return;
    Promise.all([
      api.get('/users', { params: { role: ROLES.ADMIN, isActive: 'true', limit: 100 } }),
      api.get('/users', { params: { role: ROLES.SALES_EXEC, isActive: 'true', limit: 100 } }),
    ])
      .then((results) => setExecs(results.flatMap((r) => r.data.data)))
      .catch((err) => toast.error(apiError(err)));
  }, [isAdmin]);

  const scopeParams = useMemo(
    () => (isAdmin && execId !== ALL_EXECS ? { execId } : {}),
    [execId, isAdmin]
  );

  /**
   * The Order Book is the outstanding book, not a period extract: sent no dates,
   * the server returns every order still holding stock whenever it was booked.
   * Always sending the range would hide the ageing orders the report exists to
   * surface, so there the period is opt-in.
   */
  const wholeBook = type === 'orderBook' && !limitPending;

  const query = useMemo(
    () => (wholeBook ? scopeParams : { from, to, ...scopeParams }),
    [wholeBook, from, to, scopeParams]
  );

  const load = useCallback(async () => {
    if (!from || !to) return;
    setLoading(true);
    try {
      const { data } = await api.get(`/sales-reports/${type}`, { params: query });
      setReport(data.data);
    } catch (err) {
      // Never leave the previous report's rows on screen under the new title.
      setReport(null);
      toast.error(apiError(err));
    } finally {
      setLoading(false);
    }
  }, [type, query, from, to]);

  useEffect(() => { load(); }, [load]);

  const applyPreset = (value) => {
    setPreset(value);
    const range = presetRange(value);
    if (range) setRange(range);
  };

  const setFrom = (v) => { setPreset('custom'); setRange(([, t]) => [v, t]); };
  const setTo = (v) => { setPreset('custom'); setRange(([f]) => [f, v]); };

  const downloadXlsx = async (key, url, params, filename) => {
    setDownloading(key);
    try {
      const res = await api.get(url, { params, responseType: 'blob' });
      const blobUrl = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(blobUrl);
      toast.success('Excel downloaded');
    } catch (err) {
      // Error bodies arrive as blobs on download requests — surface the real message.
      let message = apiError(err);
      if (err?.response?.data instanceof Blob) {
        try {
          const parsed = JSON.parse(await err.response.data.text());
          message = parsed.details?.[0] ? `${parsed.message}: ${parsed.details[0]}` : parsed.message || message;
        } catch { /* keep the generic message */ }
      }
      toast.error(message);
    } finally {
      setDownloading('');
    }
  };

  // A report that ignores the period is not filed under one: a current-position
  // extract, or the whole outstanding book, named for a window it never obeyed
  // reads as a period extract to whoever the file is forwarded to.
  const downloadReport = () =>
    downloadXlsx(
      'one',
      `/sales-reports/${type}`,
      { ...query, format: 'xlsx' },
      CURRENT_STATE.has(type) || wholeBook
        ? `mickys-sales-${type}-report.xlsx`
        : `mickys-sales-${type}-report_${from}_to_${to}.xlsx`
    );

  // Every sheet shares one period, so the workbook's Order Book sheet is always
  // the period's outstanding orders rather than the whole book.
  const downloadAll = () =>
    downloadXlsx(
      'all',
      '/sales-reports/export/all',
      { from, to, ...scopeParams },
      `mickys-sales-all-reports_${from}_to_${to}.xlsx`
    );

  const active = catalog.find((c) => c.type === type);
  // Only trust a payload that matches the selected type — on a type switch there
  // is one pre-effect frame where `report` still holds the previous type's data.
  const current = report?.type === type ? report : null;
  const columns = current?.columns || [];
  const rows = current?.rows || [];
  const previewRows = rows.slice(0, PREVIEW_CAP);

  const periodNote = CURRENT_STATE.has(type)
    ? 'This report is the position as it stands today — the period above does not narrow it.'
    : wholeBook
      ? 'Showing every order still holding stock, whenever it was booked.'
      : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sales Reports"
        description="Build, preview and export sales order reports to Excel"
      >
        <Button variant="outline" onClick={downloadAll} disabled={Boolean(downloading) || !from || !to}>
          {downloading === 'all' ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
          Download all (Excel)
        </Button>
      </PageHeader>

      {/* Filters */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <CalendarRange className="h-4 w-4 text-muted-foreground" /> Report &amp; Period
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className={cn('grid gap-3 sm:grid-cols-2', isAdmin ? 'lg:grid-cols-5' : 'lg:grid-cols-4')}>
            <div className="space-y-1.5">
              <Label>Report</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger><SelectValue placeholder="Select a report" /></SelectTrigger>
                <SelectContent>
                  {(catalog.length ? catalog : [{ type: 'register', label: 'Order Register' }]).map((c) => (
                    <SelectItem key={c.type} value={c.type}>{c.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Period</Label>
              <Select value={preset} onValueChange={applyPreset}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PRESETS.map((p) => (
                    <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>From</Label>
              <Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>To</Label>
              <Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
            </div>
            {isAdmin && (
              <div className="space-y-1.5">
                <Label>Executive</Label>
                <Select value={execId} onValueChange={setExecId}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL_EXECS}>All executives</SelectItem>
                    {execs.map((e) => (
                      <SelectItem key={e._id} value={e._id}>{e.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {type === 'orderBook' && (
            <label className="mt-3 flex items-center gap-2 text-xs font-medium">
              <Checkbox checked={limitPending} onCheckedChange={(v) => setLimitPending(v === true)} />
              Only orders booked in this period
            </label>
          )}

          {active?.description && (
            <p className="mt-3 text-xs text-muted-foreground">{active.description}</p>
          )}
          {periodNote && <p className="mt-1 text-xs text-muted-foreground">{periodNote}</p>}
        </CardContent>
      </Card>

      {/* Preview + export */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex flex-wrap items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              {active?.label || 'Report'}
              {current && (
                <Badge variant="secondary">
                  {current.meta.count} record{current.meta.count === 1 ? '' : 's'}
                </Badge>
              )}
            </span>
            <Button size="sm" onClick={downloadReport} disabled={Boolean(downloading) || loading || !from || !to}>
              {downloading === 'one' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              Download Excel
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <TableSkeleton rows={6} />
          ) : !rows.length ? (
            <EmptyState
              icon={FileSpreadsheet}
              title="Nothing to show"
              description="Try a wider date range or a different report."
            />
          ) : (
            <>
              {/* The table scrolls inside its own box, so a wide report never
                  drags the whole phone screen sideways. */}
              <Table>
                <TableHeader>
                  <TableRow>
                    {columns.map((c) => (
                      <TableHead key={c.key} className={cn('whitespace-nowrap', c.type === 'number' && 'text-right')}>
                        {c.header}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {previewRows.map((row, i) => (
                    <TableRow key={i}>
                      {columns.map((c) => {
                        const display = cellValue(c, row[c.key]);
                        const tone = CHIP_COLUMNS.includes(c.key) ? TONES[display] : null;
                        return (
                          <TableCell
                            key={c.key}
                            className={cn(
                              'py-2.5 align-top text-sm whitespace-nowrap',
                              c.type === 'number' && 'text-right tabular-nums',
                              // Oversold stock is the one number on this screen
                              // that has to be impossible to skim past.
                              c.key === 'availableQty' && row[c.key] < 0 && 'text-red-600 font-semibold'
                            )}
                          >
                            {tone ? (
                              <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', tone)}>{display}</span>
                            ) : (
                              display
                            )}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  ))}
                </TableBody>
                {current?.totals && (
                  <TableFooter>
                    <TableRow>
                      {columns.map((c, i) => (
                        <TableCell
                          key={c.key}
                          className={cn('py-2.5 text-sm font-semibold', c.type === 'number' && 'text-right tabular-nums')}
                        >
                          {i === 0
                            ? 'Total'
                            : c.type === 'number' && current.totals[c.key] !== undefined
                              ? cellValue(c, current.totals[c.key])
                              : ''}
                        </TableCell>
                      ))}
                    </TableRow>
                  </TableFooter>
                )}
              </Table>
              {rows.length > PREVIEW_CAP && (
                <p className="border-t px-4 py-3 text-xs text-muted-foreground">
                  Showing the first {PREVIEW_CAP} of {rows.length} records — download the Excel file for the full data.
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
