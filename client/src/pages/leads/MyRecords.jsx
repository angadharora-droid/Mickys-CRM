import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import api, { apiError } from '@/lib/api';
import { LEAD_STATUSES, STATUS_LABELS } from '@/lib/constants';
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
import { ClipboardList, FilterX, Plus, Search } from 'lucide-react';

const ALL = '__all__';

export default function MyRecords() {
  const navigate = useNavigate();
  const [records, setRecords] = useState([]);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState(ALL);

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

  return (
    <div>
      <PageHeader title="My Records" description="View and manage all leads assigned to you">
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
