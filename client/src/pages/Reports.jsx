import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import api, { apiError } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { cn, formatDate, formatDateTime } from '@/lib/utils';
import PageHeader from '@/components/shared/PageHeader';
import EmptyState from '@/components/shared/EmptyState';
import TableSkeleton from '@/components/shared/TableSkeleton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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

/** Date presets — "Daily" views are just Today / Yesterday. */
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

function cellValue(col, value) {
  if (value === null || value === undefined || value === '') return '—';
  if (col.type === 'date') return formatDate(value);
  if (col.type === 'datetime') return formatDateTime(value);
  if (col.type === 'day') return formatDate(`${value}T00:00:00`);
  return String(value);
}

const STATUS_TONES = {
  Overdue: 'bg-destructive/10 text-destructive',
  'Due today': 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  Open: 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300',
  Closed: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  Done: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  Cleared: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  Failed: 'bg-destructive/10 text-destructive',
};

const CHIP_TONES = {
  default: 'bg-card',
  sky: 'bg-sky-50 dark:bg-sky-950/40',
  amber: 'bg-amber-50 dark:bg-amber-950/40',
  red: 'bg-red-50 dark:bg-red-950/40',
  green: 'bg-emerald-50 dark:bg-emerald-950/40',
};

/** Headline numbers per report, computed from the full (uncapped) row set. */
function summarize(type, report) {
  if (!report) return [];
  const rows = report.rows || [];
  const t = report.totals || {};
  const count = (fn) => rows.filter(fn).length;
  const uniq = (key) => new Set(rows.map((r) => r[key]).filter(Boolean)).size;
  switch (type) {
    case 'visits':
      return [
        { label: 'Visits', value: rows.length, tone: 'sky' },
        { label: 'Businesses', value: uniq('refNumber') },
        { label: 'Cities', value: uniq('city') },
        { label: 'Days in field', value: new Set(rows.map((r) => String(r.visitDate).slice(0, 10))).size },
      ];
    case 'leads':
      return [
        { label: 'Leads', value: rows.length, tone: 'sky' },
        { label: 'Visited', value: count((r) => r.visits > 0) },
        { label: 'Kit generated', value: count((r) => Boolean(r.generatedAt)) },
        { label: 'Delivered', value: count((r) => r.delivered === 'Yes'), tone: 'green' },
      ];
    case 'follow-ups':
      return [
        { label: 'Open', value: count((r) => r.status === 'Open'), tone: 'sky' },
        { label: 'Due today', value: count((r) => r.status === 'Due today'), tone: 'amber' },
        { label: 'Overdue', value: count((r) => r.status === 'Overdue'), tone: 'red' },
        { label: 'Closed', value: count((r) => r.status === 'Closed'), tone: 'green' },
      ];
    case 'action-points':
      return [
        { label: 'Open', value: count((r) => r.status === 'Open'), tone: 'sky' },
        { label: 'Cleared', value: count((r) => r.status === 'Cleared'), tone: 'green' },
      ];
    case 'kits':
      return [
        { label: 'Kits', value: rows.length, tone: 'sky' },
        { label: 'Delivered', value: count((r) => r.delivered === 'Yes'), tone: 'green' },
        { label: 'Emails sent', value: rows.reduce((s, r) => s + (r.emailsSent || 0), 0) },
      ];
    case 'emails':
      return [
        { label: 'Sent', value: count((r) => r.status === 'Sent'), tone: 'green' },
        { label: 'Failed', value: count((r) => r.status === 'Failed'), tone: 'red' },
        { label: 'Businesses', value: uniq('refNumber') },
      ];
    case 'instructions':
      return [
        { label: 'Given', value: rows.length, tone: 'sky' },
        { label: 'Open', value: count((r) => r.status === 'Open'), tone: 'amber' },
        { label: 'Done', value: count((r) => r.status === 'Done'), tone: 'green' },
      ];
    case 'exec-performance':
      return [
        { label: 'Leads added', value: t.leadsAdded ?? 0, tone: 'sky' },
        { label: 'Visits', value: t.visits ?? 0 },
        { label: 'Kits generated', value: t.kitsGenerated ?? 0 },
        { label: 'Kits delivered', value: t.kitsDelivered ?? 0, tone: 'green' },
        { label: 'Follow-ups closed', value: t.followUpsClosed ?? 0 },
        { label: 'Overdue', value: t.overdueFollowUps ?? 0, tone: 'red' },
      ];
    case 'daily-summary':
      return [
        { label: 'New leads', value: t.newLeads ?? 0, tone: 'sky' },
        { label: 'Visits', value: t.visits ?? 0 },
        { label: 'Kits generated', value: t.kitsGenerated ?? 0 },
        { label: 'Kits delivered', value: t.kitsDelivered ?? 0, tone: 'green' },
        { label: 'Follow-ups closed', value: t.followUpsClosed ?? 0 },
        { label: 'Emails', value: t.emailsSent ?? 0 },
      ];
    default:
      return [];
  }
}

export default function Reports() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [catalog, setCatalog] = useState([]);
  const [type, setType] = useState('visits');
  const [preset, setPreset] = useState('last7');
  const [[from, to], setRange] = useState(() => presetRange('last7'));
  const [execId, setExecId] = useState(ALL_EXECS);
  const [execs, setExecs] = useState([]);
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState('');

  // Report catalog (types + labels) — the single source of truth is the server.
  useEffect(() => {
    api.get('/reports')
      .then(({ data }) => setCatalog(data.data))
      .catch((err) => toast.error(apiError(err)));
  }, []);

  // Admin-only: team list for the executive filter.
  useEffect(() => {
    if (!isAdmin) return;
    Promise.all([
      api.get('/users', { params: { role: 'admin', isActive: 'true', limit: 100 } }),
      api.get('/users', { params: { role: 'sales_exec', isActive: 'true', limit: 100 } }),
      api.get('/users', { params: { role: 'pr_manager', isActive: 'true', limit: 100 } }),
    ])
      .then((results) => setExecs(results.flatMap((r) => r.data.data)))
      .catch((err) => toast.error(apiError(err)));
  }, [isAdmin]);

  const query = useMemo(
    () => ({ from, to, ...(isAdmin && execId !== ALL_EXECS ? { execId } : {}) }),
    [from, to, execId, isAdmin]
  );

  const load = useCallback(async () => {
    if (!from || !to) return;
    setLoading(true);
    try {
      const { data } = await api.get(`/reports/${type}`, { params: query });
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

  const downloadReport = () =>
    downloadXlsx('one', `/reports/${type}`, { ...query, format: 'xlsx' }, `mickys-${type}-report_${from}_to_${to}.xlsx`);

  const downloadAll = () =>
    downloadXlsx('all', '/reports/export/all', query, `mickys-all-reports_${from}_to_${to}.xlsx`);

  const active = catalog.find((c) => c.type === type);
  // Only trust a payload that matches the selected type — on a type switch there
  // is one pre-effect frame where `report` still holds the previous type's data.
  const current = report?.type === type ? report : null;
  const columns = current?.columns || [];
  const rows = current?.rows || [];
  const previewRows = rows.slice(0, PREVIEW_CAP);
  const chips = loading ? [] : summarize(type, current);

  // The visit report reads best day-by-day, so its preview is grouped by date.
  const groupKey = type === 'visits' ? 'visitDate' : null;
  const formatDayHeading = (d) =>
    new Date(d).toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });

  let lastGroup = null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reports"
        description="Build, preview and export CRM reports to Excel"
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
                  {(catalog.length ? catalog : [{ type: 'visits', label: 'Visit Report' }]).map((c) => (
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
          {active?.description && (
            <p className="mt-3 text-xs text-muted-foreground">{active.description}</p>
          )}
        </CardContent>
      </Card>

      {/* Headline numbers for the selected report & period */}
      {chips.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {chips.map((chip) => (
            <div
              key={chip.label}
              className={cn('rounded-xl border px-3 py-2.5', CHIP_TONES[chip.tone] || CHIP_TONES.default)}
            >
              <p className="text-xl font-bold leading-tight tabular-nums">{chip.value}</p>
              <p className="mt-0.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {chip.label}
              </p>
            </div>
          ))}
        </div>
      )}

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
              title="No records in this period"
              description="Try a wider date range or a different report."
            />
          ) : (
            <>
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
                  {previewRows.map((row, i) => {
                    const groupLabel = groupKey ? formatDayHeading(row[groupKey]) : null;
                    const showGroup = groupLabel && groupLabel !== lastGroup;
                    if (groupLabel) lastGroup = groupLabel;
                    return (
                      <Fragment key={i}>
                        {showGroup && (
                          <TableRow className="bg-muted/40 hover:bg-muted/40">
                            <TableCell colSpan={columns.length} className="py-2 text-xs font-semibold text-muted-foreground">
                              {groupLabel}
                            </TableCell>
                          </TableRow>
                        )}
                        <TableRow>
                          {columns.map((c) => {
                            const display = cellValue(c, row[c.key]);
                            const tone = c.key === 'status' ? STATUS_TONES[display] : null;
                            return (
                              <TableCell
                                key={c.key}
                                className={cn(
                                  'py-2.5 align-top text-sm',
                                  c.type === 'number' && 'text-right tabular-nums',
                                  ['note', 'closingNote', 'text', 'subject', 'attachments', 'address', 'internalNotes'].includes(c.key)
                                    ? 'min-w-[16rem] max-w-md whitespace-pre-wrap break-words'
                                    : 'whitespace-nowrap'
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
                      </Fragment>
                    );
                  })}
                </TableBody>
                {current?.totals && (
                  <TableFooter>
                    <TableRow>
                      {columns.map((c, i) => (
                        <TableCell key={c.key} className={cn('py-2.5 text-sm font-semibold', c.type === 'number' && 'text-right tabular-nums')}>
                          {i === 0 ? 'Total' : c.type === 'number' ? current.totals[c.key] ?? '' : ''}
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
