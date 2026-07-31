import { Fragment, useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import api, { apiError } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import {
  ROLES, ROLE_LABELS, LEAD_STATUSES, STATUS_LABELS, BUSINESS_TYPES, KIT_TYPES, KIT_TYPE_LABELS,
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
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  ChevronDown, ChevronRight, Plus, Search, FilterX, Contact, AlertTriangle, Lock, UserCog, X, Loader2,
} from 'lucide-react';

const ALL = '__all__';

export default function LeadList() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const canSeeAll = user.role === ROLES.ADMIN;

  // Filters & page live in the URL so they survive opening a lead and coming back.
  const [searchParams, setSearchParams] = useSearchParams();
  const search = searchParams.get('q') || '';
  const status = searchParams.get('status') || ALL;
  const kitType = searchParams.get('kit') || ALL;
  const businessType = searchParams.get('biz') || ALL;
  const execId = searchParams.get('exec') || ALL;
  const creatorId = searchParams.get('creator') || ALL;
  const city = searchParams.get('city') || ALL;
  const page = Number(searchParams.get('page')) || 1;

  const [leads, setLeads] = useState([]);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(true);
  const [expandedRows, setExpandedRows] = useState({});
  const [execs, setExecs] = useState([]);
  const [creators, setCreators] = useState([]);
  const [cities, setCities] = useState([]);

  // Bulk reassign (admin): selection survives paging so leads can be gathered
  // across pages; the header checkbox selects/clears the current page only.
  const [selected, setSelected] = useState(() => new Set());
  const [reassignOpen, setReassignOpen] = useState(false);
  const [reassignTo, setReassignTo] = useState('');
  const [reassigning, setReassigning] = useState(false);
  const [assignees, setAssignees] = useState([]);

  // Write a single filter to the URL; changing any filter returns to page 1.
  const setFilter = useCallback((key, value) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value && value !== ALL) next.set(key, value);
      else next.delete(key);
      next.delete('page');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const setPage = useCallback((p) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (p > 1) next.set('page', String(p));
      else next.delete('page');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  useEffect(() => {
    if (canSeeAll) {
      // A lead's owner can be an admin, a sales exec or a PR manager, so the
      // owner filter lists all three.
      Promise.all([
        api.get('/users', { params: { role: 'admin', limit: 100 } }),
        api.get('/users', { params: { role: 'sales_exec', limit: 100 } }),
        api.get('/users', { params: { role: 'pr_manager', limit: 100 } }),
      ])
        .then(([adminRes, execRes, prRes]) =>
          setExecs([...adminRes.data.data, ...execRes.data.data, ...prRes.data.data]))
        .catch(() => {});
    }
    // Only cities that actually have a visible lead — the filter's option set.
    api.get('/cities', { params: { inUse: true } })
      .then((res) => setCities(res.data.data))
      .catch(() => {});
    // Only creators that appear on leads the caller can see — so the dropdown
    // never lists someone who created none of their visible leads.
    api.get('/leads/creators')
      .then((res) => setCreators(res.data.data))
      .catch(() => {});
  }, [canSeeAll]);

  const fetchLeads = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, limit: 100 };
      if (search) params.search = search;
      if (status !== ALL) params.status = status;
      if (kitType !== ALL) params.kitType = kitType;
      if (businessType !== ALL) params.businessType = businessType;
      if (execId !== ALL) params.execId = execId;
      if (creatorId !== ALL) params.createdBy = creatorId;
      if (city !== ALL) params.city = city;
      const { data } = await api.get('/leads', { params });
      setLeads(data.data);
      setMeta(data.meta);
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setLoading(false);
    }
  }, [page, search, status, kitType, businessType, execId, creatorId, city]);

  useEffect(() => {
    const t = setTimeout(fetchLeads, search ? 350 : 0);
    return () => clearTimeout(t);
  }, [fetchLeads, search]);

  const clearFilters = () => {
    setSearchParams({}, { replace: true });
    setExpandedRows({});
    setSelected(new Set());
  };

  const toggleRow = (id) => setExpandedRows((c) => ({ ...c, [id]: !c[id] }));
  const hasFilters =
    search || status !== ALL || kitType !== ALL || businessType !== ALL ||
    execId !== ALL || creatorId !== ALL || city !== ALL;

  const toggleSelect = (id) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });

  const pageIds = leads.map((l) => l._id);
  const allOnPageSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const someOnPageSelected = pageIds.some((id) => selected.has(id));

  const toggleSelectPage = () => setSelected((prev) => {
    const next = new Set(prev);
    if (allOnPageSelected) pageIds.forEach((id) => next.delete(id));
    else pageIds.forEach((id) => next.add(id));
    return next;
  });

  // Admin: hand the selected leads to any active user. The user list is fetched
  // lazily the first time the dialog opens.
  const openReassign = async () => {
    setReassignTo('');
    setReassignOpen(true);
    if (assignees.length) return;
    try {
      const { data } = await api.get('/users', { params: { isActive: 'true', limit: 100 } });
      setAssignees(data.data);
    } catch (err) {
      toast.error(apiError(err));
    }
  };

  const bulkReassign = async () => {
    setReassigning(true);
    try {
      const { data } = await api.post('/leads/bulk-reassign', {
        leadIds: [...selected],
        assignedExecId: reassignTo,
      });
      toast.success(data.message);
      setReassignOpen(false);
      setSelected(new Set());
      fetchLeads();
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setReassigning(false);
    }
  };

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
              onChange={(e) => setFilter('q', e.target.value)}
            />
          </div>

          <Select value={status} onValueChange={(v) => setFilter('status', v)}>
            <SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All statuses</SelectItem>
              {LEAD_STATUSES.map((s) => <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>)}
            </SelectContent>
          </Select>

          <Select value={kitType} onValueChange={(v) => setFilter('kit', v)}>
            <SelectTrigger><SelectValue placeholder="Kit type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All kits</SelectItem>
              {KIT_TYPES.map((k) => <SelectItem key={k.value} value={k.value}>{k.label}</SelectItem>)}
            </SelectContent>
          </Select>

          <Select value={businessType} onValueChange={(v) => setFilter('biz', v)}>
            <SelectTrigger><SelectValue placeholder="Business type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All types</SelectItem>
              {BUSINESS_TYPES.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
            </SelectContent>
          </Select>

          <Select value={city} onValueChange={(v) => setFilter('city', v)}>
            <SelectTrigger><SelectValue placeholder="City" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All cities</SelectItem>
              {cities.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>

          <Select value={creatorId} onValueChange={(v) => setFilter('creator', v)}>
            <SelectTrigger><SelectValue placeholder="Created by" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All creators</SelectItem>
              {creators.map((c) => (
                <SelectItem key={c._id} value={c._id}>
                  {c.name}
                  {c.role === 'admin' ? ' — Admin' : c.role === 'pr_manager' ? ' — PR Manager' : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {canSeeAll && (
            <Select value={execId} onValueChange={(v) => setFilter('exec', v)}>
              <SelectTrigger><SelectValue placeholder="Assigned to" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All owners</SelectItem>
                {execs.map((e) => (
                  <SelectItem key={e._id} value={e._id}>
                    {e.name}
                    {e.role === 'admin' ? ' — Admin' : e.role === 'pr_manager' ? ' — PR Manager' : ''}
                  </SelectItem>
                ))}
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

      {canSeeAll && selected.size > 0 && (
        <Card className="mb-4 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">
              {selected.size} lead{selected.size === 1 ? '' : 's'} selected
            </span>
            <div className="ml-auto flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
                <X className="h-4 w-4" /> Clear
              </Button>
              <Button size="sm" onClick={openReassign}>
                <UserCog className="h-4 w-4" /> Reassign
              </Button>
            </div>
          </div>
        </Card>
      )}

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
                  {canSeeAll && (
                    <TableHead className="w-10 px-2">
                      <Checkbox
                        checked={allOnPageSelected ? true : someOnPageSelected ? 'indeterminate' : false}
                        onCheckedChange={toggleSelectPage}
                        aria-label="Select all leads on this page"
                      />
                    </TableHead>
                  )}
                  <TableHead className="w-10 px-2 lg:hidden" />
                  <TableHead className="hidden sm:table-cell">Reference</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead className="hidden sm:table-cell">City</TableHead>
                  <TableHead className="hidden md:table-cell">Kit</TableHead>
                  <TableHead className="hidden lg:table-cell">Owner</TableHead>
                  <TableHead className="hidden lg:table-cell">Created by</TableHead>
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
                        {canSeeAll && (
                          <TableCell className="px-2" onClick={(e) => e.stopPropagation()}>
                            <Checkbox
                              checked={selected.has(lead._id)}
                              onCheckedChange={() => toggleSelect(lead._id)}
                              aria-label={`Select ${lead.businessName}`}
                            />
                          </TableCell>
                        )}
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
                        <TableCell className="hidden lg:table-cell text-muted-foreground">{lead.createdBy?.name || '—'}</TableCell>
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
                          <TableCell colSpan={canSeeAll ? 9 : 8} className="px-4 py-3">
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
                              <div>
                                <dt className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Owner</dt>
                                <dd className="mt-1 font-medium">{lead.assignedExecId?.name || '—'}</dd>
                              </div>
                              <div>
                                <dt className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Created by</dt>
                                <dd className="mt-1 font-medium">{lead.createdBy?.name || '—'}</dd>
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

      {/* Admin: hand the selected leads to any active user */}
      <Dialog open={reassignOpen} onOpenChange={setReassignOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Reassign {selected.size} lead{selected.size === 1 ? '' : 's'}</DialogTitle>
            <DialogDescription>
              Pass the selected leads on to any user. They will move to that person's list.
            </DialogDescription>
          </DialogHeader>
          <Select value={reassignTo} onValueChange={setReassignTo}>
            <SelectTrigger><SelectValue placeholder="Select user" /></SelectTrigger>
            <SelectContent>
              {assignees.map((u) => (
                <SelectItem key={u._id} value={u._id}>
                  {u.name}{u.employeeCode ? ` (${u.employeeCode})` : ''} · {ROLE_LABELS[u.role] || u.role}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReassignOpen(false)} disabled={reassigning}>
              Cancel
            </Button>
            <Button onClick={bulkReassign} disabled={!reassignTo || reassigning}>
              {reassigning && <Loader2 className="h-4 w-4 animate-spin" />} Assign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
