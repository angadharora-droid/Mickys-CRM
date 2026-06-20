import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import api, { apiError } from '@/lib/api';
import { LEAD_STATUSES, STATUS_LABELS, KIT_TYPE_LABELS } from '@/lib/constants';
import { formatDate } from '@/lib/utils';
import PageHeader from '@/components/shared/PageHeader';
import StatusBadge from '@/components/shared/StatusBadge';
import Pagination from '@/components/shared/Pagination';
import EmptyState from '@/components/shared/EmptyState';
import TableSkeleton from '@/components/shared/TableSkeleton';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ClipboardList, Download, FilterX, Loader2, Plus, Search } from 'lucide-react';

const ALL = '__all__';

const escapeExcel = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const excelCell = (value) => `<Cell><Data ss:Type="String">${escapeExcel(value)}</Data></Cell>`;
const excelRow = (values, styleId = '') =>
  `<Row${styleId ? ` ss:StyleID="${styleId}"` : ''}>${values.map(excelCell).join('')}</Row>`;

const FOLLOWUP_STATUS_LABELS = { open: 'Open', closed: 'Closed' };

/** The lead's single internal note — newest legacy note, else the shared field. */
const internalNoteText = (lead) => {
  const latest = [...(lead.notes || [])]
    .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt))[0];
  return latest?.text || lead.internalNotes || '';
};

const REPORT_COLUMNS = [
  ['Reference', (l) => l.refNumber],
  ['Client', (l) => l.businessName],
  ['Contact person', (l) => l.contactPerson],
  ['Designation', (l) => l.designation],
  ['Mobile', (l) => l.mobileNumber],
  ['WhatsApp', (l) => l.whatsappNumber],
  ['Email', (l) => l.email],
  ['Business type', (l) => l.businessType],
  ['City', (l) => l.city],
  ['State', (l) => l.state],
  ['Address', (l) => l.address],
  ['GSTIN', (l) => l.gstin],
  ['Assigned to', (l) => l.assignedExecId?.name || ''],
  ['Created by', (l) => l.createdBy?.name || ''],
  ['Lead source', (l) => l.leadSource],
  ['Kit type', (l) => (l.kitType ? KIT_TYPE_LABELS[l.kitType] || l.kitType : '')],
  ['Status', (l) => STATUS_LABELS[l.status] || l.status],
  ['Action point', (l) => l.actionPoint],
  ['Internal notes', (l) => internalNoteText(l)],
  ['Follow-up note', (l) => l.followUp?.note],
  ['Follow-up date', (l) => (l.followUp?.date ? formatDate(l.followUp.date) : '')],
  ['Follow-up status', (l) => (l.followUp?.status ? FOLLOWUP_STATUS_LABELS[l.followUp.status] || l.followUp.status : '')],
  ['Follow-up closing note', (l) => l.followUp?.closingNote],
  ['Delivery method', (l) => l.delivery?.method],
  ['Delivered on', (l) => (l.delivery?.sentAt ? formatDate(l.delivery.sentAt) : '')],
  ['Lead date', (l) => formatDate(l.leadDate)],
  ['Generated on', (l) => (l.generatedAt ? formatDate(l.generatedAt) : '')],
  ['Created date', (l) => formatDate(l.createdAt)],
];

const buildRecordsReport = (records, search, status) => {
  const rows = [
    excelRow(['My Records Report'], 'Title'),
    excelRow(['Downloaded on', new Date().toLocaleString('en-IN')]),
    excelRow(['Search filter', search || 'None']),
    excelRow(['Status filter', status === ALL ? 'All statuses' : STATUS_LABELS[status] || status]),
    excelRow(['Total records', records.length]),
    excelRow([]),
    excelRow(REPORT_COLUMNS.map(([label]) => label), 'Header'),
    ...records.map((record) => excelRow(REPORT_COLUMNS.map(([, get]) => get(record)))),
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
  <Worksheet ss:Name="My Records">
    <Table>${rows.join('')}</Table>
  </Worksheet>
</Workbook>`;
};

const downloadExcel = (filename, content) => {
  const blob = new Blob([content], { type: 'application/vnd.ms-excel;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
};

export default function MyRecords() {
  const navigate = useNavigate();
  const [records, setRecords] = useState([]);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState(ALL);
  const [reportLoading, setReportLoading] = useState(false);

  const fetchRecords = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, limit: 10 };
      if (search) params.search = search;
      if (status !== ALL) params.status = status;
      const { data } = await api.get('/leads', { params });
      setRecords(data.data);
      setMeta(data.meta);
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setLoading(false);
    }
  }, [page, search, status]);

  useEffect(() => {
    const timer = setTimeout(fetchRecords, search ? 350 : 0);
    return () => clearTimeout(timer);
  }, [fetchRecords, search]);

  const clearFilters = () => {
    setSearch('');
    setStatus(ALL);
    setPage(1);
  };

  const hasFilters = search || status !== ALL;

  const downloadReport = async () => {
    setReportLoading(true);
    try {
      const params = { page: 1, limit: 100 };
      if (search) params.search = search;
      if (status !== ALL) params.status = status;

      const firstResponse = await api.get('/leads', { params });
      const allRecords = [...firstResponse.data.data];
      const totalPages = firstResponse.data.meta?.totalPages || 1;

      if (totalPages > 1) {
        const remainingResponses = await Promise.all(
          Array.from({ length: totalPages - 1 }, (_, index) =>
            api.get('/leads', { params: { ...params, page: index + 2 } })
          )
        );
        remainingResponses.forEach((response) => allRecords.push(...response.data.data));
      }

      const stamp = new Date().toISOString().slice(0, 10);
      downloadExcel(`my-records-report-${stamp}.xls`, buildRecordsReport(allRecords, search, status));
      toast.success('Report downloaded');
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setReportLoading(false);
    }
  };

  return (
    <div>
      <PageHeader title="My Records" description="View and manage all leads assigned to you">
        <Button variant="outline" onClick={downloadReport} disabled={reportLoading}>
          {reportLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          Download Report
        </Button>
        <Button onClick={() => navigate('/leads/new')}>
          <Plus className="h-4 w-4" /> New Lead
        </Button>
      </PageHeader>

      <Card className="mb-4 p-4">
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Search reference, client, contact or email"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
            />
          </div>
          <Select
            value={status}
            onValueChange={(value) => {
              setStatus(value);
              setPage(1);
            }}
          >
            <SelectTrigger className="sm:w-52">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All statuses</SelectItem>
              {LEAD_STATUSES.map((item) => (
                <SelectItem key={item} value={item}>{STATUS_LABELS[item]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {hasFilters && (
            <Button variant="ghost" onClick={clearFilters}>
              <FilterX className="h-4 w-4" /> Clear
            </Button>
          )}
        </div>
      </Card>

      <Card>
        {loading ? (
          <TableSkeleton />
        ) : records.length === 0 ? (
          <EmptyState
            icon={ClipboardList}
            title="No records found"
            description={hasFilters ? 'Try adjusting your search or status filter.' : 'Create your first lead to start building your records.'}
          >
            {!hasFilters && (
              <Button onClick={() => navigate('/leads/new')}>
                <Plus className="h-4 w-4" /> New Lead
              </Button>
            )}
          </EmptyState>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="hidden sm:table-cell">Reference</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead className="hidden md:table-cell">City</TableHead>
                  <TableHead className="hidden lg:table-cell">Lead Date</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {records.map((record) => (
                  <TableRow
                    key={record._id}
                    className="cursor-pointer"
                    onClick={() => navigate(`/leads/${record._id}`)}
                  >
                    <TableCell className="hidden whitespace-nowrap font-mono text-xs font-semibold text-primary sm:table-cell">
                      {record.refNumber}
                    </TableCell>
                    <TableCell>
                      <p className="font-medium leading-tight">{record.businessName}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        <span className="font-mono font-semibold text-primary sm:hidden">{record.refNumber} · </span>
                        {record.contactPerson}
                      </p>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">{record.city}</TableCell>
                    <TableCell className="hidden whitespace-nowrap text-muted-foreground lg:table-cell">
                      {formatDate(record.leadDate)}
                    </TableCell>
                    <TableCell><StatusBadge status={record.status} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Pagination meta={meta} onPageChange={setPage} />
          </>
        )}
      </Card>
    </div>
  );
}
