import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import api, { apiError } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import {
  ROLES, LEAD_STAGES, STAGE_LABELS, STAGE_HINTS, BUSINESS_TYPES, KIT_TYPE_LABELS, daysSince,
} from '@/lib/constants';
import { cn, formatDate } from '@/lib/utils';
import PageHeader from '@/components/shared/PageHeader';
import StatusBadge from '@/components/shared/StatusBadge';
import ScoreBadge from '@/components/shared/ScoreBadge';
import TurnDownDialog from '@/components/leads/TurnDownDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Search, FilterX, Plus, RefreshCw, Loader2, GripVertical, MoreHorizontal, ArrowRightLeft,
  CalendarClock, Sparkles, UserCheck, ThumbsDown, CircleDashed, ExternalLink,
} from 'lucide-react';

const ALL = '__all__';

const STAGE_ICONS = { new: CircleDashed, live: Sparkles, client: UserCheck, turned_down: ThumbsDown };
const STAGE_DOT = {
  new: 'bg-stone-400',
  live: 'bg-sky-500',
  client: 'bg-emerald-500',
  turned_down: 'bg-red-500',
};
const STAGE_HEAD = {
  new: 'border-stone-300 dark:border-stone-700',
  live: 'border-sky-300 dark:border-sky-800',
  client: 'border-emerald-300 dark:border-emerald-800',
  turned_down: 'border-red-300 dark:border-red-900',
};

/** Which follow-up chip a card shows, if any. */
const followUpChip = (lead) => {
  if (lead.followUp?.status !== 'open' || !lead.followUp?.date) return null;
  const today = new Date().toISOString().slice(0, 10);
  const due = new Date(lead.followUp.date).toISOString().slice(0, 10);
  if (due < today) return { label: 'Overdue', cls: 'bg-destructive/10 text-destructive' };
  if (due === today) return { label: 'Due today', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300' };
  return { label: `Due ${formatDate(lead.followUp.date)}`, cls: 'bg-sky-50 text-sky-700 dark:bg-sky-950 dark:text-sky-300' };
};

/** Moves a lead between columns in the board data (optimistic update). */
function moveInBoard(board, lead, toStage, { score } = {}) {
  if (!board) return board;
  const newScore = score ?? lead.score ?? 0;
  return {
    ...board,
    stages: board.stages.map((col) => {
      if (col.key === lead.stage && col.key !== toStage) {
        return {
          ...col,
          count: Math.max(0, col.count - 1),
          points: col.points - (lead.score || 0),
          leads: col.leads.filter((l) => l._id !== lead._id),
        };
      }
      if (col.key === toStage) {
        const rest = col.leads.filter((l) => l._id !== lead._id);
        const already = rest.length !== col.leads.length;
        return {
          ...col,
          count: already ? col.count : col.count + 1,
          points: col.points - (already ? lead.score || 0 : 0) + newScore,
          leads: [{ ...lead, stage: toStage, score: newScore, stageSince: new Date().toISOString() }, ...rest],
        };
      }
      return col;
    }),
  };
}

function LeadCard({ lead, isAdmin, dragging, moving, onDragStart, onDragEnd, onMove, onOpen }) {
  const chip = followUpChip(lead);
  const days = daysSince(lead.stageSince);
  return (
    <div
      draggable={!moving}
      onDragStart={(e) => onDragStart(e, lead)}
      onDragEnd={onDragEnd}
      onClick={() => onOpen(lead)}
      className={cn(
        'group relative cursor-grab rounded-xl border bg-card p-3 shadow-soft transition-all hover:-translate-y-0.5 hover:shadow-lifted active:cursor-grabbing',
        dragging && 'opacity-40',
        moving && 'animate-pulse'
      )}
    >
      <div className="flex items-start gap-2">
        <GripVertical className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/40 group-hover:text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="truncate text-sm font-semibold leading-tight">{lead.businessName}</p>
            <ScoreBadge score={lead.score || 0} className="shrink-0" />
          </div>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {lead.contactPerson} · {lead.city}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <Badge variant="outline" className="text-[10px] font-medium">{lead.businessType}</Badge>
            <StatusBadge status={lead.status} className="px-2 py-0.5 text-[10px]" />
            {lead.kitType && <span className="text-[10px] text-muted-foreground">{KIT_TYPE_LABELS[lead.kitType]}</span>}
          </div>
          {lead.stage === 'turned_down' && lead.turnDownReason && (
            <p className="mt-2 line-clamp-2 text-xs text-red-700 dark:text-red-300">{lead.turnDownReason}</p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
            {isAdmin && <span className="truncate">{lead.assignedExecId?.name || 'Unassigned'}</span>}
            <span className="inline-flex items-center gap-1">
              <CalendarClock className="h-3 w-3" />
              {days === 0 ? 'today' : `${days} day${days === 1 ? '' : 's'} here`}
            </span>
            {chip && <span className={cn('rounded-full px-1.5 py-0.5 font-medium', chip.cls)}>{chip.label}</span>}
          </div>
        </div>
        {/* Touch / keyboard fallback for drag-and-drop */}
        <DropdownMenu>
          <DropdownMenuTrigger
            onClick={(e) => e.stopPropagation()}
            className="absolute right-1.5 top-1.5 rounded-md p-1 text-muted-foreground opacity-0 transition hover:bg-accent group-hover:opacity-100 focus:opacity-100 data-[state=open]:opacity-100 sm:opacity-60"
            aria-label="Move lead"
          >
            {moving ? <Loader2 className="h-4 w-4 animate-spin" /> : <MoreHorizontal className="h-4 w-4" />}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48" onClick={(e) => e.stopPropagation()}>
            <DropdownMenuLabel className="text-xs text-muted-foreground">Move to</DropdownMenuLabel>
            {LEAD_STAGES.filter((s) => s !== lead.stage).map((s) => {
              const Icon = STAGE_ICONS[s];
              return (
                <DropdownMenuItem key={s} className="gap-2" onSelect={() => onMove(lead, s)}>
                  <Icon className="h-4 w-4" /> {STAGE_LABELS[s]}
                </DropdownMenuItem>
              );
            })}
            <DropdownMenuSeparator />
            <DropdownMenuItem className="gap-2" onSelect={() => onOpen(lead)}>
              <ExternalLink className="h-4 w-4" /> Open lead
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

export default function LeadPipeline() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const isAdmin = user?.role === ROLES.ADMIN;

  const [searchParams, setSearchParams] = useSearchParams();
  const search = searchParams.get('q') || '';
  const execId = searchParams.get('exec') || ALL;
  const businessType = searchParams.get('biz') || ALL;

  const [board, setBoard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [execs, setExecs] = useState([]);
  const [dragId, setDragId] = useState(null);
  const [overStage, setOverStage] = useState(null);
  const [movingId, setMovingId] = useState(null);
  const [turnDown, setTurnDown] = useState(null); // the lead awaiting a reason

  const setFilter = useCallback((key, value) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value && value !== ALL) next.set(key, value);
      else next.delete(key);
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  useEffect(() => {
    if (!isAdmin) return;
    Promise.all([
      api.get('/users', { params: { role: 'admin', limit: 100 } }),
      api.get('/users', { params: { role: 'sales_exec', limit: 100 } }),
      api.get('/users', { params: { role: 'pr_manager', limit: 100 } }),
    ])
      .then((results) => setExecs(results.flatMap((r) => r.data.data)))
      .catch(() => {});
  }, [isAdmin]);

  const load = useCallback(async ({ silent = false } = {}) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    try {
      const params = {};
      if (search) params.search = search;
      if (execId !== ALL) params.execId = execId;
      if (businessType !== ALL) params.businessType = businessType;
      const { data } = await api.get('/leads/pipeline', { params });
      setBoard(data.data);
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [search, execId, businessType]);

  useEffect(() => {
    const t = setTimeout(load, search ? 350 : 0);
    return () => clearTimeout(t);
  }, [load, search]);

  const hasFilters = search || execId !== ALL || businessType !== ALL;
  const clearFilters = () => setSearchParams({}, { replace: true });

  // ---- Moving leads between stages ----
  const moveLead = async (lead, stage, reason = '') => {
    if (lead.stage === stage || movingId) return Promise.resolve();
    const from = lead.stage;
    setMovingId(lead._id);
    setBoard((b) => moveInBoard(b, lead, stage));
    try {
      const { data } = await api.put(`/leads/${lead._id}/stage`, { stage, reason });
      const updated = data.data;
      // Settle the optimistic card with what the server says (score may have
      // grown — Client made earns points — and the stage stamp is now real).
      setBoard((b) =>
        moveInBoard(
          b,
          { ...lead, stage, score: lead.score },
          stage,
          { score: updated.score ?? updated.scoreCard?.total ?? lead.score }
        )
      );
      setBoard((b) => ({
        ...b,
        stages: b.stages.map((col) => ({
          ...col,
          leads: col.leads.map((l) =>
            l._id === lead._id
              ? {
                  ...l,
                  turnDownReason: updated.turnDownReason || '',
                  clientMadeAt: updated.clientMadeAt || null,
                  stageSince: updated.stageHistory?.slice(-1)[0]?.at || l.stageSince,
                }
              : l
          ),
        })),
      }));
      toast.success(`${lead.businessName} → ${STAGE_LABELS[stage]}`);
    } catch (err) {
      toast.error(apiError(err));
      setBoard((b) => moveInBoard(b, { ...lead, stage }, from, { score: lead.score }));
      throw err;
    } finally {
      setMovingId(null);
    }
  };

  const requestMove = (lead, stage) => {
    if (stage === lead.stage) return;
    if (stage === 'turned_down') {
      setTurnDown(lead);
      return;
    }
    moveLead(lead, stage).catch(() => {});
  };

  const onDragStart = (e, lead) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', lead._id);
    setDragId(lead._id);
  };
  const onDragEnd = () => { setDragId(null); setOverStage(null); };
  const onDrop = (e, stage) => {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/plain') || dragId;
    setOverStage(null);
    setDragId(null);
    const lead = board?.stages.flatMap((c) => c.leads).find((l) => l._id === id);
    if (lead) requestMove(lead, stage);
  };

  const openLead = (lead) => navigate(`/leads/${lead._id}`);

  const total = board?.total || 0;
  const countOf = (key) => board?.stages.find((s) => s.key === key)?.count || 0;
  const everClient = countOf('client');

  return (
    <div className="space-y-4">
      <PageHeader title="Lead Pipeline" description="Drag leads between stages — New, Live, Client made, or Turned down">
        <Button variant="outline" onClick={() => load({ silent: true })} disabled={refreshing || loading}>
          <RefreshCw className={cn('h-4 w-4', refreshing && 'animate-spin')} /> Refresh
        </Button>
        <Button onClick={() => navigate('/leads/new')}><Plus className="h-4 w-4" /> New Lead</Button>
      </PageHeader>

      {/* Filters + the funnel summary */}
      <Card>
        <CardContent className="space-y-3 p-4">
          <div className={cn('grid gap-3 sm:grid-cols-2', isAdmin ? 'lg:grid-cols-4' : 'lg:grid-cols-3')}>
            <div className="relative sm:col-span-2 lg:col-span-2">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search client, contact, city, ref…"
                className="pl-9"
                value={search}
                onChange={(e) => setFilter('q', e.target.value)}
              />
            </div>
            <Select value={businessType} onValueChange={(v) => setFilter('biz', v)}>
              <SelectTrigger><SelectValue placeholder="Business type" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All types</SelectItem>
                {BUSINESS_TYPES.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
              </SelectContent>
            </Select>
            {isAdmin && (
              <Select value={execId} onValueChange={(v) => setFilter('exec', v)}>
                <SelectTrigger><SelectValue placeholder="Owner" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All owners</SelectItem>
                  {execs.map((e) => (
                    <SelectItem key={e._id} value={e._id}>
                      {e.name}{e.role === 'admin' ? ' — Admin' : e.role === 'pr_manager' ? ' — PR Manager' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span><span className="font-semibold text-foreground">{total.toLocaleString('en-IN')}</span> leads</span>
            {LEAD_STAGES.map((s) => (
              <span key={s} className="inline-flex items-center gap-1.5">
                <span className={cn('h-2 w-2 rounded-full', STAGE_DOT[s])} />
                {STAGE_LABELS[s]} <span className="font-semibold text-foreground">{countOf(s).toLocaleString('en-IN')}</span>
              </span>
            ))}
            <span>
              Conversion <span className="font-semibold text-foreground">{total ? Math.round((everClient / total) * 100) : 0}%</span>
            </span>
            {hasFilters && (
              <Button variant="ghost" size="sm" className="h-7 px-2" onClick={clearFilters}>
                <FilterX className="h-3.5 w-3.5" /> Clear filters
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* The board */}
      {loading ? (
        <div className="flex gap-4 overflow-x-auto pb-2">
          {LEAD_STAGES.map((s) => <Skeleton key={s} className="h-[60vh] w-[290px] shrink-0 rounded-2xl" />)}
        </div>
      ) : (
        <div className="-mx-1 flex gap-4 overflow-x-auto px-1 pb-3">
          {board?.stages.map((col) => {
            const Icon = STAGE_ICONS[col.key];
            const over = overStage === col.key;
            const truncated = col.leads.length < col.count;
            return (
              <section
                key={col.key}
                onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (!over) setOverStage(col.key); }}
                onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOverStage(null); }}
                onDrop={(e) => onDrop(e, col.key)}
                className={cn(
                  'flex w-[290px] shrink-0 flex-col rounded-2xl border bg-muted/30 transition-colors',
                  col.key === 'turned_down' && 'ml-2',
                  over && 'bg-primary/5 ring-2 ring-primary/40'
                )}
              >
                <header className={cn('flex items-center gap-2 border-b-2 px-3 py-2.5', STAGE_HEAD[col.key])}>
                  <span className={cn('h-2.5 w-2.5 rounded-full', STAGE_DOT[col.key])} />
                  <Icon className="h-4 w-4 text-muted-foreground" />
                  <p className="text-sm font-semibold">{STAGE_LABELS[col.key]}</p>
                  <span className="rounded-full bg-card px-2 py-0.5 text-xs font-semibold tabular-nums ring-1 ring-border">
                    {col.count.toLocaleString('en-IN')}
                  </span>
                  <span className="ml-auto text-[11px] tabular-nums text-muted-foreground" title="Score points held at this stage">
                    {col.points.toLocaleString('en-IN')} pts
                  </span>
                </header>
                <p className="px-3 pt-2 text-[11px] text-muted-foreground">{STAGE_HINTS[col.key]}</p>
                <div className="max-h-[calc(100vh-22rem)] min-h-[10rem] space-y-2 overflow-y-auto p-2">
                  {col.leads.length === 0 ? (
                    <div className={cn(
                      'flex h-28 items-center justify-center rounded-xl border border-dashed text-xs text-muted-foreground',
                      over && 'border-primary/50 text-primary'
                    )}>
                      {over ? 'Drop here' : dragId ? 'Drop a lead here' : 'No leads'}
                    </div>
                  ) : (
                    col.leads.map((lead) => (
                      <LeadCard
                        key={lead._id}
                        lead={lead}
                        isAdmin={isAdmin}
                        dragging={dragId === lead._id}
                        moving={movingId === lead._id}
                        onDragStart={onDragStart}
                        onDragEnd={onDragEnd}
                        onMove={requestMove}
                        onOpen={openLead}
                      />
                    ))
                  )}
                  {truncated && (
                    <p className="px-1 pb-1 pt-2 text-center text-[11px] text-muted-foreground">
                      Showing the top {col.leads.length} of {col.count.toLocaleString('en-IN')} by score — search or filter to find the rest.
                    </p>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}

      <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <ArrowRightLeft className="h-3 w-3" />
        Drag a card to another column to change its stage, or use the ⋯ menu on the card (works on touch screens). Turning a lead down asks for the reason.
      </p>

      <TurnDownDialog
        lead={turnDown}
        open={Boolean(turnDown)}
        busy={Boolean(movingId)}
        onOpenChange={(o) => { if (!o) setTurnDown(null); }}
        onConfirm={(reason) => moveLead(turnDown, 'turned_down', reason)}
      />
    </div>
  );
}
