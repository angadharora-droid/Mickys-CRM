import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import api, { apiError } from '@/lib/api';
import { LEAD_STATUSES, STATUS_LABELS, ROLE_LABELS, CHART_COLORS, CHART_TOOLTIP_STYLE } from '@/lib/constants';
import { formatDate, cn } from '@/lib/utils';
import PageHeader from '@/components/shared/PageHeader';
import StatusBadge from '@/components/shared/StatusBadge';
import Pagination from '@/components/shared/Pagination';
import EmptyState from '@/components/shared/EmptyState';
import TableSkeleton from '@/components/shared/TableSkeleton';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { Download, Eye, Loader2, Users, FilterX, Contact, CalendarDays } from 'lucide-react';

const ALL = '__all__';

// Short headers for the per-status count columns (full labels are too wide).
const STATUS_COLS = [
  ['new', 'New'],
  ['kit_selected', 'Kit'],
  ['rates_confirmed', 'Rates'],
  ['generated', 'Generated'],
  ['delivered', 'Delivered'],
];

const DATE_PRESETS = [
  ['today', 'Today'],
  ['7d', '7 days'],
  ['30d', '30 days'],
  ['month', 'This month'],
  ['all', 'All time'],
];

// Local YYYY-MM-DD (avoids the UTC shift of toISOString for date inputs).
const isoDay = (d) => {
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d - off).toISOString().slice(0, 10);
};

// "2026-06-15" -> "15 Jun" for chart axis labels.
const formatDay = (s) => {
  const [y, m, d] = s.split('-');
  return new Date(y, m - 1, d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
};

const excelCell = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const excelXmlCell = (value) => {
  const isNumber = typeof value === 'number' && Number.isFinite(value);
  return `<Cell><Data ss:Type="${isNumber ? 'Number' : 'String'}">${excelCell(value)}</Data></Cell>`;
};

const excelXmlRow = (row, styleId = '') =>
  `<Row${styleId ? ` ss:StyleID="${styleId}"` : ''}>${row.map(excelXmlCell).join('')}</Row>`;

const excelWorksheet = (name, rows) => `
  <Worksheet ss:Name="${excelCell(name)}">
    <Table>${rows.join('')}</Table>
  </Worksheet>`;

const downloadTextFile = (filename, text, type = 'application/vnd.ms-excel;charset=utf-8;') => {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};

export default function LeadTracker() {
  const navigate = useNavigate();

  const [creators, setCreators] = useState([]);
  const [daily, setDaily] = useState([]);
  const [summaryLoading, setSummaryLoading] = useState(true);

  const [leads, setLeads] = useState([]);
  const [meta, setMeta] = useState(null);
  const [leadsLoading, setLeadsLoading] = useState(true);
  const [reportLoading, setReportLoading] = useState('');
  const [previewOpen, setPreviewOpen] = useState(false);
  const [reportLeads, setReportLeads] = useState([]);
  const [page, setPage] = useState(1);
  const [createdBy, setCreatedBy] = useState(ALL);
  const [status, setStatus] = useState(ALL);

  // Creation-date range (YYYY-MM-DD); empty = all time.
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const fetchSummary = useCallback(async () => {
    setSummaryLoading(true);
    try {
      const params = {};
      if (from) params.from = from;
      if (to) params.to = to;
      const { data } = await api.get('/dashboard/lead-tracker', { params });
      setCreators(data.data.creators || []);
      setDaily(data.data.daily || []);
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setSummaryLoading(false);
    }
  }, [from, to]);

  useEffect(() => { fetchSummary(); }, [fetchSummary]);

  const fetchLeads = useCallback(async () => {
    setLeadsLoading(true);
    try {
      const params = { page, limit: 10 };
      if (createdBy !== ALL) params.createdBy = createdBy;
      if (status !== ALL) params.status = status;
      if (from) params.createdFrom = from;
      if (to) params.createdTo = to;
      const { data } = await api.get('/leads', { params });
      setLeads(data.data);
      setMeta(data.meta);
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setLeadsLoading(false);
    }
  }, [page, createdBy, status, from, to]);

  useEffect(() => { fetchLeads(); }, [fetchLeads]);

  const totalLeads = useMemo(() => creators.reduce((a, c) => a + c.total, 0), [creators]);
  const hasFilter = createdBy !== ALL || status !== ALL;
  const rangeLabel = from || to ? `${from || 'Start'} to ${to || 'Today'}` : 'All time';

  const selectCreator = (id) => {
    setCreatedBy((cur) => (cur === id ? ALL : id));
    setPage(1);
  };

  const applyPreset = (preset) => {
    const today = new Date();
    if (preset === 'all') { setFrom(''); setTo(''); }
    else if (preset === 'today') { setFrom(isoDay(today)); setTo(isoDay(today)); }
    else if (preset === '7d') { const d = new Date(today); d.setDate(d.getDate() - 6); setFrom(isoDay(d)); setTo(isoDay(today)); }
    else if (preset === '30d') { const d = new Date(today); d.setDate(d.getDate() - 29); setFrom(isoDay(d)); setTo(isoDay(today)); }
    else if (preset === 'month') { setFrom(isoDay(new Date(today.getFullYear(), today.getMonth(), 1))); setTo(isoDay(today)); }
    setPage(1);
  };

  const fetchReportLeads = async () => {
    const all = [];
    let nextPage = 1;
    let hasNext = true;

    while (hasNext) {
      const params = { page: nextPage, limit: 100 };
      if (createdBy !== ALL) params.createdBy = createdBy;
      if (status !== ALL) params.status = status;
      if (from) params.createdFrom = from;
      if (to) params.createdTo = to;
      const { data } = await api.get('/leads', { params });
      all.push(...(data.data || []));
      hasNext = Boolean(data.meta?.hasNext);
      nextPage += 1;
    }

    return all;
  };

  const buildExcelReport = (details) => {
    const metaRows = [
      excelXmlRow(['Lead Tracker Report'], 'Title'),
      excelXmlRow(['Date range', rangeLabel]),
      excelXmlRow(['Creator filter', createdBy === ALL ? 'All creators' : creators.find((c) => c.creatorId === createdBy)?.name || createdBy]),
      excelXmlRow(['Status filter', status === ALL ? 'All statuses' : STATUS_LABELS[status] || status]),
      excelXmlRow([]),
    ];

    const creatorRows = [
      ...metaRows,
      excelXmlRow(['Created by', 'Role', 'Total', 'New', 'Kit', 'Rates', 'Generated', 'Delivered', 'First created', 'Last created'], 'Header'),
      ...creators.map((c) => excelXmlRow([
        c.name,
        ROLE_LABELS[c.role] || c.role || '',
        c.total,
        c.new,
        c.kit_selected,
        c.rates_confirmed,
        c.generated,
        c.delivered,
        formatDate(c.firstAt),
        formatDate(c.lastAt),
      ])),
    ];
    const dailyRows = [
      ...metaRows,
      excelXmlRow(['Date', 'Leads', 'Kits'], 'Header'),
      ...daily.map((d) => excelXmlRow([d.date, d.leads, d.kits])),
    ];
    const detailRows = [
      ...metaRows,
      excelXmlRow(['Reference', 'Client', 'Contact person', 'City', 'Created by', 'Status', 'Lead date', 'Created date'], 'Header'),
      ...details.map((lead) => excelXmlRow([
        lead.refNumber,
        lead.businessName,
        lead.contactPerson,
        lead.city,
        lead.createdBy?.name || '',
        STATUS_LABELS[lead.status] || lead.status,
        formatDate(lead.leadDate),
        formatDate(lead.createdAt),
      ])),
    ];

    return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook
  xmlns="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:o="urn:schemas-microsoft-com:office:office"
  xmlns:x="urn:schemas-microsoft-com:office:excel"
  xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
  <Styles>
    <Style ss:ID="Title"><Font ss:Bold="1" ss:Size="16" ss:Color="#7f0f16" /></Style>
    <Style ss:ID="Header">
      <Font ss:Bold="1" ss:Color="#ffffff" />
      <Interior ss:Color="#7f0f16" ss:Pattern="Solid" />
    </Style>
  </Styles>
  ${excelWorksheet('Leads by creator', creatorRows)}
  ${excelWorksheet('Leads created per day', dailyRows)}
  ${excelWorksheet('Lead details', detailRows)}
</Workbook>`;
  };

  const previewReport = async () => {
    setReportLoading('preview');
    try {
      const details = await fetchReportLeads();
      setReportLeads(details);
      setPreviewOpen(true);
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setReportLoading('');
    }
  };

  const downloadReport = async () => {
    setReportLoading('download');
    try {
      const details = await fetchReportLeads();
      const stamp = new Date().toISOString().slice(0, 10);
      downloadTextFile(`lead-tracker-report-${stamp}.xls`, buildExcelReport(details));
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setReportLoading('');
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Lead Tracker" description="Who created how many leads, their status and dates">
        <Button type="button" variant="outline" onClick={previewReport} disabled={Boolean(reportLoading)}>
          {reportLoading === 'preview' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
          Preview
        </Button>
        <Button type="button" onClick={downloadReport} disabled={Boolean(reportLoading)}>
          {reportLoading === 'download' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          Download report
        </Button>
      </PageHeader>

      {/* Date range filter */}
      <Card>
        <CardContent className="py-4">
          <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">From</label>
              <Input type="date" value={from} max={to || undefined} className="w-[150px]"
                onChange={(e) => { setFrom(e.target.value); setPage(1); }} />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">To</label>
              <Input type="date" value={to} min={from || undefined} className="w-[150px]"
                onChange={(e) => { setTo(e.target.value); setPage(1); }} />
            </div>
            <div className="flex flex-wrap gap-2">
              {DATE_PRESETS.map(([k, label]) => (
                <Button key={k} type="button" variant="outline" size="sm" onClick={() => applyPreset(k)}>{label}</Button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Leads created per day */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <CalendarDays className="h-4 w-4" /> Leads created per day
          </CardTitle>
        </CardHeader>
        <CardContent className="h-64">
          {summaryLoading ? (
            <div className="h-full w-full animate-pulse rounded-md bg-muted" />
          ) : daily.length === 0 ? (
            <EmptyState icon={CalendarDays} title="No leads in this range" description="Adjust the date range to see daily activity." />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={daily.map((d) => ({ ...d, label: formatDay(d.date) }))}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-muted" />
                <XAxis dataKey="label" fontSize={11} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                <YAxis fontSize={11} allowDecimals={false} tickLine={false} axisLine={false} width={28} />
                <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
                <Bar dataKey="leads" fill={CHART_COLORS[0]} name="Leads" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Per-creator summary */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="h-4 w-4" /> Leads by creator
            {!summaryLoading && (
              <span className="text-sm font-normal text-muted-foreground">· {totalLeads} leads total</span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {summaryLoading ? (
            <TableSkeleton />
          ) : creators.length === 0 ? (
            <EmptyState icon={Contact} title="No leads yet" description="Created leads will be tracked here by their creator." />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Created by</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    {STATUS_COLS.map(([k, label]) => (
                      <TableHead key={k} className="text-right whitespace-nowrap">{label}</TableHead>
                    ))}
                    <TableHead className="whitespace-nowrap">Last created</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {creators.map((c) => {
                    const selected = createdBy === c.creatorId;
                    return (
                      <TableRow
                        key={c.creatorId || 'unknown'}
                        className={cn('cursor-pointer', selected && 'bg-primary/5')}
                        onClick={() => c.creatorId && selectCreator(c.creatorId)}
                      >
                        <TableCell>
                          <span className="font-medium">{c.name}</span>
                          {c.role && <Badge variant="outline" className="ml-2 text-[10px]">{ROLE_LABELS[c.role] || c.role}</Badge>}
                        </TableCell>
                        <TableCell className="text-right font-semibold">{c.total}</TableCell>
                        {STATUS_COLS.map(([k]) => (
                          <TableCell key={k} className={cn('text-right tabular-nums', !c[k] && 'text-muted-foreground/50')}>
                            {c[k]}
                          </TableCell>
                        ))}
                        <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(c.lastAt)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
          {!summaryLoading && creators.length > 0 && (
            <p className="mt-3 text-xs text-muted-foreground">Tip: click a creator to filter the detailed leads below.</p>
          )}
        </CardContent>
      </Card>

      {/* Detailed leads with status + dates */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Lead details</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 mb-4">
            <Select value={createdBy} onValueChange={(v) => { setCreatedBy(v); setPage(1); }}>
              <SelectTrigger><SelectValue placeholder="Creator" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All creators</SelectItem>
                {creators.filter((c) => c.creatorId).map((c) => (
                  <SelectItem key={c.creatorId} value={c.creatorId}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1); }}>
              <SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All statuses</SelectItem>
                {LEAD_STATUSES.map((s) => <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>)}
              </SelectContent>
            </Select>
            {hasFilter && (
              <Button variant="ghost" size="sm" className="justify-self-start" onClick={() => { setCreatedBy(ALL); setStatus(ALL); setPage(1); }}>
                <FilterX className="h-4 w-4" /> Clear
              </Button>
            )}
          </div>

          {leadsLoading ? (
            <TableSkeleton />
          ) : leads.length === 0 ? (
            <EmptyState icon={Contact} title="No leads found" description={hasFilter ? 'Try adjusting the filters.' : 'No leads have been created yet.'} />
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="hidden sm:table-cell">Reference</TableHead>
                      <TableHead>Client</TableHead>
                      <TableHead className="hidden md:table-cell">Created by</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="hidden sm:table-cell whitespace-nowrap">Lead date</TableHead>
                      <TableHead className="hidden lg:table-cell whitespace-nowrap">Created</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {leads.map((lead) => (
                      <TableRow key={lead._id} className="cursor-pointer" onClick={() => navigate(`/leads/${lead._id}`)}>
                        <TableCell className="hidden sm:table-cell font-mono text-xs font-semibold text-primary whitespace-nowrap">{lead.refNumber}</TableCell>
                        <TableCell>
                          <p className="font-medium leading-tight">{lead.businessName}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">{lead.contactPerson} · {lead.city}</p>
                        </TableCell>
                        <TableCell className="hidden md:table-cell">{lead.createdBy?.name || '—'}</TableCell>
                        <TableCell><StatusBadge status={lead.status} /></TableCell>
                        <TableCell className="hidden sm:table-cell whitespace-nowrap text-muted-foreground">{formatDate(lead.leadDate)}</TableCell>
                        <TableCell className="hidden lg:table-cell whitespace-nowrap text-muted-foreground">{formatDate(lead.createdAt)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <Pagination meta={meta} onPageChange={setPage} />
            </>
          )}
        </CardContent>
      </Card>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>Lead Tracker Report</DialogTitle>
            <DialogDescription>
              {rangeLabel} · {reportLeads.length} detailed lead{reportLeads.length === 1 ? '' : 's'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-3">
              <Card>
                <CardContent className="p-4">
                  <p className="text-xs text-muted-foreground">Total leads</p>
                  <p className="mt-1 text-2xl font-semibold">{totalLeads}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <p className="text-xs text-muted-foreground">Creators</p>
                  <p className="mt-1 text-2xl font-semibold">{creators.length}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <p className="text-xs text-muted-foreground">Filtered details</p>
                  <p className="mt-1 text-2xl font-semibold">{reportLeads.length}</p>
                </CardContent>
              </Card>
            </div>

            <div>
              <h3 className="mb-2 text-sm font-semibold">Leads by creator</h3>
              <div className="max-h-64 overflow-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Created by</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      {STATUS_COLS.map(([k, label]) => <TableHead key={k} className="text-right">{label}</TableHead>)}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {creators.map((c) => (
                      <TableRow key={c.creatorId || c.name}>
                        <TableCell>{c.name}</TableCell>
                        <TableCell className="text-right font-semibold">{c.total}</TableCell>
                        {STATUS_COLS.map(([k]) => <TableCell key={k} className="text-right tabular-nums">{c[k]}</TableCell>)}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>

            <div>
              <h3 className="mb-2 text-sm font-semibold">Lead details</h3>
              <div className="max-h-80 overflow-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Reference</TableHead>
                      <TableHead>Client</TableHead>
                      <TableHead>Created by</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Created</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {reportLeads.map((lead) => (
                      <TableRow key={lead._id}>
                        <TableCell className="font-mono text-xs">{lead.refNumber}</TableCell>
                        <TableCell>
                          <p className="font-medium">{lead.businessName}</p>
                          <p className="text-xs text-muted-foreground">{lead.contactPerson} · {lead.city}</p>
                        </TableCell>
                        <TableCell>{lead.createdBy?.name || '-'}</TableCell>
                        <TableCell>{STATUS_LABELS[lead.status] || lead.status}</TableCell>
                        <TableCell>{formatDate(lead.createdAt)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>

            <div className="flex justify-end">
              <Button type="button" onClick={downloadReport} disabled={Boolean(reportLoading)}>
                {reportLoading === 'download' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                Download report
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
