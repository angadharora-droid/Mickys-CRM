import { Fragment, useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import api, { apiError } from '@/lib/api';
import { ROLE_LABELS } from '@/lib/constants';
import { formatDateTime } from '@/lib/utils';
import PageHeader from '@/components/shared/PageHeader';
import Pagination from '@/components/shared/Pagination';
import EmptyState from '@/components/shared/EmptyState';
import TableSkeleton from '@/components/shared/TableSkeleton';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { ChevronDown, ChevronRight, Search, ScrollText } from 'lucide-react';

const ALL = '__all__';
const ENTITIES = ['User', 'Customer', 'Product', 'PurchaseOrder', 'Setting'];

export default function ActivityLogs() {
  const [logs, setLogs] = useState([]);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [entity, setEntity] = useState(ALL);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [expandedRows, setExpandedRows] = useState({});

  const toggleRow = (id) => {
    setExpandedRows((current) => ({ ...current, [id]: !current[id] }));
  };

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, limit: 20 };
      if (search) params.search = search;
      if (entity !== ALL) params.entity = entity;
      if (dateFrom) params.dateFrom = dateFrom;
      if (dateTo) params.dateTo = dateTo;
      const { data } = await api.get('/activity-logs', { params });
      setLogs(data.data);
      setMeta(data.meta);
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setLoading(false);
    }
  }, [page, search, entity, dateFrom, dateTo]);

  useEffect(() => {
    const t = setTimeout(fetchLogs, search ? 350 : 0);
    return () => clearTimeout(t);
  }, [fetchLogs, search]);

  return (
    <div>
      <PageHeader title="Activity Logs" description="Complete audit trail of every action in the system" />

      <Card className="p-4 mb-4">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <div className="relative col-span-2 lg:col-span-2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search details…"
              className="pl-9"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            />
          </div>
          <Select value={entity} onValueChange={(v) => { setEntity(v); setPage(1); }}>
            <SelectTrigger><SelectValue placeholder="Entity" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All entities</SelectItem>
              {ENTITIES.map((e) => <SelectItem key={e} value={e}>{e}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} />
          <Input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }} />
        </div>
      </Card>

      <Card>
        {loading ? (
          <TableSkeleton rows={10} />
        ) : logs.length === 0 ? (
          <EmptyState icon={ScrollText} title="No activity logs" />
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10 px-2 md:hidden" />
                  <TableHead>When</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead className="hidden sm:table-cell">Entity</TableHead>
                  <TableHead className="hidden md:table-cell">Details</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((log) => {
                  const isExpanded = !!expandedRows[log._id];
                  const ExpandIcon = isExpanded ? ChevronDown : ChevronRight;

                  return (
                    <Fragment key={log._id}>
                      <TableRow>
                        <TableCell className="px-2 md:hidden">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            aria-label={isExpanded ? 'Hide log details' : 'Show log details'}
                            aria-expanded={isExpanded}
                            onClick={() => toggleRow(log._id)}
                          >
                            <ExpandIcon className="h-4 w-4" />
                          </Button>
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-xs">{formatDateTime(log.timestamp)}</TableCell>
                        <TableCell>
                          <p className="font-medium text-sm">{log.userId?.name || 'System'}</p>
                          <p className="text-xs text-muted-foreground">{ROLE_LABELS[log.userId?.role] || ''}</p>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="font-mono text-[10px]">{log.action}</Badge>
                        </TableCell>
                        <TableCell className="hidden sm:table-cell text-sm">{log.entity}</TableCell>
                        <TableCell className="hidden md:table-cell text-sm text-muted-foreground">{log.details}</TableCell>
                      </TableRow>
                      {isExpanded && (
                        <TableRow className="bg-muted/25 hover:bg-muted/25 md:hidden">
                          <TableCell colSpan={6} className="px-4 py-3">
                            <dl className="grid gap-3 text-sm sm:grid-cols-2">
                              <div>
                                <dt className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Entity</dt>
                                <dd className="mt-1 font-medium">{log.entity}</dd>
                              </div>
                              <div>
                                <dt className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Details</dt>
                                <dd className="mt-1 text-muted-foreground">{log.details || '—'}</dd>
                              </div>
                            </dl>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
            <Pagination meta={meta} onPageChange={setPage} />
          </>
        )}
      </Card>
    </div>
  );
}
