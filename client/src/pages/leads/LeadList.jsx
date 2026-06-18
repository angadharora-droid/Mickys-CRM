import { Fragment, useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import api, { apiError } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import {
  ROLES, LEAD_STATUSES, STATUS_LABELS, BUSINESS_TYPES, KIT_TYPES, KIT_TYPE_LABELS,
} from '@/lib/constants';
import { formatDate } from '@/lib/utils';
import PageHeader from '@/components/shared/PageHeader';
import StatusBadge from '@/components/shared/StatusBadge';
import Pagination from '@/components/shared/Pagination';
import EmptyState from '@/components/shared/EmptyState';
import TableSkeleton from '@/components/shared/TableSkeleton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ChevronDown, ChevronRight, Plus, Search, FilterX, Contact, AlertTriangle, Lock } from 'lucide-react';

const ALL = '__all__';

export default function LeadList() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const canSeeAll = user.role === ROLES.ADMIN;

  const [leads, setLeads] = useState([]);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState(ALL);
  const [kitType, setKitType] = useState(ALL);
  const [businessType, setBusinessType] = useState(ALL);
  const [execId, setExecId] = useState(ALL);
  const [expandedRows, setExpandedRows] = useState({});
  const [execs, setExecs] = useState([]);

  useEffect(() => {
    if (canSeeAll) {
      api.get('/users', { params: { role: 'sales_exec', limit: 100 } })
        .then((res) => setExecs(res.data.data))
        .catch(() => {});
    }
  }, [canSeeAll]);

  const fetchLeads = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, limit: 10 };
      if (search) params.search = search;
      if (status !== ALL) params.status = status;
      if (kitType !== ALL) params.kitType = kitType;
      if (businessType !== ALL) params.businessType = businessType;
      if (execId !== ALL) params.execId = execId;
      const { data } = await api.get('/leads', { params });
      setLeads(data.data);
      setMeta(data.meta);
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setLoading(false);
    }
  }, [page, search, status, kitType, businessType, execId]);

  useEffect(() => {
    const t = setTimeout(fetchLeads, search ? 350 : 0);
    return () => clearTimeout(t);
  }, [fetchLeads, search]);

  const clearFilters = () => {
    setSearch(''); setStatus(ALL); setKitType(ALL); setBusinessType(ALL); setExecId(ALL);
    setPage(1); setExpandedRows({});
  };

  const toggleRow = (id) => setExpandedRows((c) => ({ ...c, [id]: !c[id] }));
  const hasFilters = search || status !== ALL || kitType !== ALL || businessType !== ALL || execId !== ALL;

  return (
    <div>
      <PageHeader title="Leads & Kits" description="Capture clients and generate their sales kits">
        <Button asChild>
          <a href="/leads/new" onClick={(e) => { e.preventDefault(); navigate('/leads/new'); }}>
            <Plus className="h-4 w-4" /> New Lead
          </a>
        </Button>
      </PageHeader>

      <Card className="p-4 mb-4">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-6">
          <div className="relative col-span-2 xl:col-span-2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search ref no, client, email…"
              className="pl-9"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            />
          </div>

          <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1); }}>
            <SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All statuses</SelectItem>
              {LEAD_STATUSES.map((s) => <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>)}
            </SelectContent>
          </Select>

          <Select value={kitType} onValueChange={(v) => { setKitType(v); setPage(1); }}>
            <SelectTrigger><SelectValue placeholder="Kit type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All kits</SelectItem>
              {KIT_TYPES.map((k) => <SelectItem key={k.value} value={k.value}>{k.label}</SelectItem>)}
            </SelectContent>
          </Select>

          <Select value={businessType} onValueChange={(v) => { setBusinessType(v); setPage(1); }}>
            <SelectTrigger><SelectValue placeholder="Business type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All types</SelectItem>
              {BUSINESS_TYPES.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
            </SelectContent>
          </Select>

          {canSeeAll && (
            <Select value={execId} onValueChange={(v) => { setExecId(v); setPage(1); }}>
              <SelectTrigger><SelectValue placeholder="Exec" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All execs</SelectItem>
                {execs.map((e) => <SelectItem key={e._id} value={e._id}>{e.name}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
        </div>
        {hasFilters && (
          <Button variant="ghost" size="sm" className="mt-3" onClick={clearFilters}>
            <FilterX className="h-4 w-4" /> Clear filters
          </Button>
        )}
      </Card>

      <Card>
        {loading ? (
          <TableSkeleton />
        ) : leads.length === 0 ? (
          <EmptyState
            icon={Contact}
            title="No leads yet"
            description={hasFilters ? 'Try adjusting your filters.' : 'Create your first lead to generate a sales kit.'}
          />
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10 px-2 lg:hidden" />
                  <TableHead className="hidden sm:table-cell">Reference</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead className="hidden sm:table-cell">City</TableHead>
                  <TableHead className="hidden md:table-cell">Kit</TableHead>
                  <TableHead className="hidden lg:table-cell">Exec</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {leads.map((lead) => {
                  const isExpanded = !!expandedRows[lead._id];
                  const ExpandIcon = isExpanded ? ChevronDown : ChevronRight;
                  return (
                    <Fragment key={lead._id}>
                      <TableRow className="cursor-pointer" onClick={() => navigate(`/leads/${lead._id}`)}>
                        <TableCell className="px-2 lg:hidden">
                          <Button
                            type="button" variant="ghost" size="icon" className="h-8 w-8"
                            aria-label={isExpanded ? 'Hide details' : 'Show details'} aria-expanded={isExpanded}
                            onClick={(e) => { e.stopPropagation(); toggleRow(lead._id); }}
                          >
                            <ExpandIcon className="h-4 w-4" />
                          </Button>
                        </TableCell>
                        <TableCell className="hidden sm:table-cell font-semibold text-primary whitespace-nowrap font-mono text-xs">{lead.refNumber}</TableCell>
                        <TableCell>
                          <p className="font-medium leading-tight">{lead.businessName}</p>
                          <p className="sm:hidden mt-0.5 font-mono text-[11px] font-semibold text-primary">{lead.refNumber}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">{lead.contactPerson} · {lead.businessType}</p>
                        </TableCell>
                        <TableCell className="hidden sm:table-cell">{lead.city}</TableCell>
                        <TableCell className="hidden md:table-cell">
                          {lead.kitType ? <Badge variant="outline">{KIT_TYPE_LABELS[lead.kitType]}</Badge> : <span className="text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell className="hidden lg:table-cell">{lead.assignedExecId?.name || '—'}</TableCell>
                        <TableCell>
                          <div className="flex flex-col items-start gap-1">
                            <div className="flex items-center gap-1.5">
                              <StatusBadge status={lead.status} />
                              {lead.locked && <Lock className="h-3 w-3 text-muted-foreground" aria-label="Locked" />}
                            </div>
                            {lead.editedAfterGeneration && (
                              <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100 text-[10px]">
                                <AlertTriangle className="h-2.5 w-2.5" /> Edited
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                      {isExpanded && (
                        <TableRow className="bg-muted/25 hover:bg-muted/25 lg:hidden">
                          <TableCell colSpan={7} className="px-4 py-3">
                            <dl className="grid gap-3 text-sm sm:grid-cols-3">
                              <div>
                                <dt className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">City</dt>
                                <dd className="mt-1 font-medium">{[lead.city, lead.state].filter(Boolean).join(', ')}</dd>
                              </div>
                              <div>
                                <dt className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Kit</dt>
                                <dd className="mt-1 font-medium">{lead.kitType ? KIT_TYPE_LABELS[lead.kitType] : '—'}</dd>
                              </div>
                              <div>
                                <dt className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Lead date</dt>
                                <dd className="mt-1 font-medium">{formatDate(lead.leadDate)}</dd>
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
