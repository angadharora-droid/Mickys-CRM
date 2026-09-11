import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import api, { apiError } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { ROLES, ACTION_POINTS, BUSINESS_TYPES, LEAD_STAGES, STAGE_LABELS } from '@/lib/constants';
import { cn, formatDate } from '@/lib/utils';
import PageHeader from '@/components/shared/PageHeader';
import EmptyState from '@/components/shared/EmptyState';
import TableSkeleton from '@/components/shared/TableSkeleton';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  CalendarClock, CalendarCheck, Loader2, Target, CheckCircle2, ClipboardList, Search, FilterX, SearchX,
} from 'lucide-react';

const ALL = 'all';
const VIEWS = ['instructions', 'actions', 'followups'];

/** Calendar day (UTC) for a date value, or '' when unset. */
const isoDay = (date) => (date ? new Date(date).toISOString().slice(0, 10) : '');
const todayStr = () => isoDay(new Date());
const plusDays = (n) => isoDay(new Date(Date.now() + n * 86400000));

/** Due-window filter choices, keyed by the value stored in the URL. */
const DUE_OPTIONS = [
  [ALL, 'Any due date'],
  ['overdue', 'Overdue'],
  ['today', 'Due today'],
  ['week', 'Next 7 days'],
  ['nodate', 'No follow-up set'],
];

/** Label + styling for a due date relative to today. */
const dueMeta = (date) => {
  const d = isoDay(date);
  const t = todayStr();
  if (d && d < t) return { label: 'Overdue', cls: 'text-destructive font-medium' };
  if (d === t) return { label: 'Due today', cls: 'text-amber-600 font-medium' };
  return { label: formatDate(date), cls: 'text-foreground' };
};

/** Id of the populated (or raw) assignedExecId reference. */
const execIdOf = (lead) => {
  const e = lead.assignedExecId;
  return e && typeof e === 'object' ? String(e._id || '') : String(e || '');
};

export default function FollowUps() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isAdmin = user?.role === ROLES.ADMIN;

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [closeTarget, setCloseTarget] = useState(null); // lead whose follow-up is being closed
  const [closeNote, setCloseNote] = useState('');
  const [closing, setClosing] = useState(false);

  const [actionItems, setActionItems] = useState([]);
  const [apLoading, setApLoading] = useState(true);
  const [apTarget, setApTarget] = useState(null); // lead whose action point is being closed
  const [apClosing, setApClosing] = useState(false);

  const [instrLeads, setInstrLeads] = useState([]);
  const [instrLoading, setInstrLoading] = useState(true);
  const [instrTarget, setInstrTarget] = useState(null); // { leadId, instrId, text, businessName }
  const [instrClosing, setInstrClosing] = useState(false);

  // View + filters live in the query string so they survive opening a lead
  // and coming back (and can be shared as a link).
  const [searchParams, setSearchParams] = useSearchParams();
  const param = (key) => searchParams.get(key) || ALL;
  const rawView = searchParams.get('view');
  const view = VIEWS.includes(rawView) ? rawView : 'instructions'; // 'instructions' | 'actions' | 'followups'
  const q = searchParams.get('q') || '';
  const due = param('due');
  const action = param('action');
  const type = param('type');
  const stage = param('stage');
  const city = param('city');
  const execId = isAdmin ? param('exec') : ALL; // execs only ever see their own leads

  const setParam = (key, value) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (!value || value === ALL) next.delete(key);
      else next.set(key, value);
      return next;
    }, { replace: true });
  };
  const setView = (v) => setParam('view', v === 'instructions' ? '' : v);
  const clearFilters = () => {
    setSearchParams((prev) => {
      const next = new URLSearchParams();
      if (prev.get('view')) next.set('view', prev.get('view'));
      return next;
    }, { replace: true });
  };
  const hasFilter = Boolean(q.trim()) || [due, action, type, stage, city, execId].some((v) => v !== ALL);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/follow-ups');
      setItems(data.data);
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchActionPoints = useCallback(async () => {
    setApLoading(true);
    try {
      const { data } = await api.get('/action-points');
      setActionItems(data.data);
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setApLoading(false);
    }
  }, []);

  const fetchInstructions = useCallback(async () => {
    setInstrLoading(true);
    try {
      const { data } = await api.get('/instructions');
      setInstrLeads(data.data);
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setInstrLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchItems();
    fetchActionPoints();
    fetchInstructions();
  }, [fetchItems, fetchActionPoints, fetchInstructions]);

  const submitClose = async () => {
    if (!closeTarget || !closeNote.trim()) return;
    setClosing(true);
    try {
      await api.post(`/leads/${closeTarget._id}/follow-up/close`, { closingNote: closeNote.trim() });
      toast.success('Follow-up closed');
      setCloseTarget(null);
      setCloseNote('');
      fetchItems();
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setClosing(false);
    }
  };

  // Closing an action point simply clears it; the lead's follow-up is untouched.
  const closeActionPoint = async () => {
    if (!apTarget) return;
    setApClosing(true);
    try {
      await api.put(`/leads/${apTarget._id}/action-point`, { actionPoint: '' });
      toast.success('Action point closed');
      setApTarget(null);
      fetchActionPoints();
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setApClosing(false);
    }
  };

  // Mark an admin instruction done (the exec is finished with it).
  const closeInstruction = async () => {
    if (!instrTarget) return;
    setInstrClosing(true);
    try {
      await api.post(`/leads/${instrTarget.leadId}/instructions/${instrTarget.instrId}/done`);
      toast.success('Instruction marked done');
      setInstrTarget(null);
      fetchInstructions();
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setInstrClosing(false);
    }
  };

  // Flatten to one row per open instruction (a lead may carry several).
  const openInstructions = instrLeads.flatMap((lead) =>
    (lead.instructions || [])
      .filter((i) => i.status === 'open')
      .map((instr) => ({ lead, instr }))
  );

  // Filter choices derived from whatever is loaded, so the pickers only offer
  // executives / cities that actually have something in these worklists.
  const { execs, cities } = useMemo(() => {
    const execMap = new Map();
    const citySet = new Set();
    [...instrLeads, ...actionItems, ...items].forEach((lead) => {
      const e = lead.assignedExecId;
      if (e && typeof e === 'object' && e._id && !execMap.has(String(e._id))) {
        execMap.set(String(e._id), e.name || e.email || String(e._id));
      }
      if (lead.city) citySet.add(lead.city);
    });
    return {
      execs: [...execMap.entries()]
        .map(([id, name]) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      cities: [...citySet].sort((a, b) => a.localeCompare(b)),
    };
  }, [instrLeads, actionItems, items]);

  /** Does this lead pass every active filter? `extra` is tab-specific text (e.g. the instruction). */
  const matches = (lead, extra = '') => {
    if (execId !== ALL && execIdOf(lead) !== execId) return false;
    if (city !== ALL && lead.city !== city) return false;
    if (type !== ALL && lead.businessType !== type) return false;
    if (stage !== ALL && (lead.stage || 'new') !== stage) return false;
    if (action !== ALL && lead.actionPoint !== action) return false;
    if (due !== ALL) {
      const d = lead.followUp?.status === 'open' ? isoDay(lead.followUp?.date) : '';
      const t = todayStr();
      const ok = due === 'nodate' ? !d
        : due === 'overdue' ? Boolean(d) && d < t
        : due === 'today' ? d === t
        : due === 'week' ? Boolean(d) && d >= t && d <= plusDays(7)
        : true;
      if (!ok) return false;
    }
    const needle = q.trim().toLowerCase();
    if (needle) {
      const hay = [
        lead.businessName, lead.refNumber, lead.contactPerson, lead.city, lead.mobileNumber,
        lead.actionPoint, lead.followUp?.note, extra,
      ].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  };

  const shownInstructions = openInstructions.filter(({ lead, instr }) => matches(lead, instr.text));
  const shownActions = actionItems.filter((lead) => matches(lead));
  const shownFollowUps = items.filter((lead) => matches(lead));

  const shownCount = view === 'instructions' ? shownInstructions.length : view === 'actions' ? shownActions.length : shownFollowUps.length;
  const totalCount = view === 'instructions' ? openInstructions.length : view === 'actions' ? actionItems.length : items.length;

  /** Empty state for a tab: distinguishes "nothing at all" from "nothing matches the filters". */
  const emptyFor = (total, icon, title, description) => (
    total > 0 && hasFilter ? (
      <EmptyState icon={SearchX} title="No matches" description="Nothing in this list matches the current filters.">
        <Button variant="outline" size="sm" onClick={clearFilters}>
          <FilterX className="h-4 w-4" /> Clear filters
        </Button>
      </EmptyState>
    ) : (
      <EmptyState icon={icon} title={title} description={description} />
    )
  );

  return (
    <div>
      <PageHeader title="Follow-ups" description="Instructions, action points and scheduled follow-ups that need attention" />

      {/* Pill switcher between the three worklists (counts reflect the active filters) */}
      <div className="mb-4 flex flex-wrap gap-2">
        {[
          { key: 'instructions', label: 'Instructions', icon: ClipboardList, count: shownInstructions.length, total: openInstructions.length, isLoading: instrLoading },
          { key: 'actions', label: 'Action points', icon: Target, count: shownActions.length, total: actionItems.length, isLoading: apLoading },
          { key: 'followups', label: 'Follow-ups', icon: CalendarClock, count: shownFollowUps.length, total: items.length, isLoading: loading },
        ].map(({ key, label, icon: Icon, count, total, isLoading }) => {
          const active = view === key;
          const filtered = hasFilter && count !== total;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setView(key)}
              aria-pressed={active}
              className={cn(
                'inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-medium transition-colors',
                active ? 'bg-primary text-primary-foreground shadow-sm' : 'bg-muted text-muted-foreground hover:bg-muted/70'
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
              {!isLoading && (
                <span
                  title={filtered ? `${count} of ${total} match the filters` : undefined}
                  className={cn(
                    'rounded-full px-1.5 py-0.5 text-xs font-semibold',
                    active ? 'bg-primary-foreground/20' : 'bg-foreground/10 text-foreground'
                  )}
                >
                  {filtered ? `${count}/${total}` : count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Filters — shared across all three worklists */}
      <Card className="mb-4">
        <CardContent className="space-y-3 p-3 sm:p-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              aria-label="Search"
              placeholder="Search client, ref no., contact, city, instruction or note…"
              className="pl-9"
              value={q}
              onChange={(e) => setParam('q', e.target.value)}
            />
          </div>
          <div className={cn('grid grid-cols-2 gap-2 sm:grid-cols-3', isAdmin ? 'lg:grid-cols-6' : 'lg:grid-cols-5')}>
            <Select value={due} onValueChange={(v) => setParam('due', v)}>
              <SelectTrigger aria-label="Due date"><SelectValue placeholder="Due" /></SelectTrigger>
              <SelectContent>
                {DUE_OPTIONS.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={action} onValueChange={(v) => setParam('action', v)}>
              <SelectTrigger aria-label="Action point"><SelectValue placeholder="Action point" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All action points</SelectItem>
                {ACTION_POINTS.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={type} onValueChange={(v) => setParam('type', v)}>
              <SelectTrigger aria-label="Business type"><SelectValue placeholder="Business type" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All business types</SelectItem>
                {BUSINESS_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={stage} onValueChange={(v) => setParam('stage', v)}>
              <SelectTrigger aria-label="Stage"><SelectValue placeholder="Stage" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All stages</SelectItem>
                {LEAD_STAGES.map((s) => <SelectItem key={s} value={s}>{STAGE_LABELS[s]}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={city} onValueChange={(v) => setParam('city', v)}>
              <SelectTrigger aria-label="City"><SelectValue placeholder="City" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All cities</SelectItem>
                {cities.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                {/* Keep a URL-supplied city selectable even if nothing loaded carries it */}
                {city !== ALL && !cities.includes(city) && <SelectItem value={city}>{city}</SelectItem>}
              </SelectContent>
            </Select>
            {isAdmin && (
              <Select value={execId} onValueChange={(v) => setParam('exec', v)}>
                <SelectTrigger aria-label="Assigned to"><SelectValue placeholder="Assigned to" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All executives</SelectItem>
                  {execs.map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
                  {execId !== ALL && !execs.some((e) => e.id === execId) && <SelectItem value={execId}>Selected executive</SelectItem>}
                </SelectContent>
              </Select>
            )}
          </div>
          {hasFilter && (
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>Showing {shownCount} of {totalCount}</span>
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                <FilterX className="h-4 w-4" /> Clear filters
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Instructions — admin directives, one row per open instruction */}
      {view === 'instructions' && (
      <Card>
        <CardContent className="p-0">
          {instrLoading ? (
            <TableSkeleton />
          ) : shownInstructions.length === 0 ? (
            emptyFor(
              openInstructions.length,
              ClipboardList,
              'No open instructions',
              'Instructions from your admin appear here until you mark them done.'
            )
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Client</TableHead>
                  <TableHead>Instruction</TableHead>
                  <TableHead className="hidden sm:table-cell">From</TableHead>
                  {isAdmin && <TableHead className="hidden lg:table-cell">Assigned to</TableHead>}
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shownInstructions.map(({ lead, instr }) => (
                  <TableRow
                    key={instr._id}
                    className="cursor-pointer"
                    onClick={() => navigate(`/leads/${lead._id}`)}
                  >
                    <TableCell>
                      <p className="font-medium leading-tight">{lead.businessName}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        <span className="font-mono font-semibold text-primary">{lead.refNumber}</span> · {lead.contactPerson}
                      </p>
                    </TableCell>
                    <TableCell>
                      <p className="max-w-md whitespace-pre-wrap break-words text-sm">{instr.text}</p>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell whitespace-nowrap text-muted-foreground">
                      {instr.createdBy?.name || 'Admin'}
                    </TableCell>
                    {isAdmin && (
                      <TableCell className="hidden lg:table-cell text-muted-foreground">
                        {lead.assignedExecId?.name || '—'}
                      </TableCell>
                    )}
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={(e) => {
                          e.stopPropagation();
                          setInstrTarget({ leadId: lead._id, instrId: instr._id, text: instr.text, businessName: lead.businessName });
                        }}
                      >
                        <CheckCircle2 className="h-4 w-4" /> Mark done
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      )}

      {/* Action points — leads with a pending next-action, close when handled */}
      {view === 'actions' && (
      <Card>
        <CardContent className="p-0">
          {apLoading ? (
            <TableSkeleton />
          ) : shownActions.length === 0 ? (
            emptyFor(
              actionItems.length,
              Target,
              'No open action points',
              'Set an action point on a lead and it will appear here to action and close.'
            )
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Client</TableHead>
                  <TableHead>Action point</TableHead>
                  <TableHead className="hidden sm:table-cell">Follow-up</TableHead>
                  {isAdmin && <TableHead className="hidden lg:table-cell">Assigned to</TableHead>}
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shownActions.map((lead) => {
                  const hasFollowUp = lead.followUp?.status === 'open';
                  const meta = hasFollowUp ? dueMeta(lead.followUp?.date) : null;
                  return (
                    <TableRow
                      key={lead._id}
                      className="cursor-pointer"
                      onClick={() => navigate(`/leads/${lead._id}`)}
                    >
                      <TableCell>
                        <p className="font-medium leading-tight">{lead.businessName}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          <span className="font-mono font-semibold text-primary">{lead.refNumber}</span> · {lead.contactPerson}
                        </p>
                      </TableCell>
                      <TableCell className="font-medium">{lead.actionPoint}</TableCell>
                      <TableCell className="hidden sm:table-cell whitespace-nowrap">
                        {meta ? <span className={meta.cls}>{meta.label}</span> : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      {isAdmin && (
                        <TableCell className="hidden lg:table-cell text-muted-foreground">
                          {lead.assignedExecId?.name || '—'}
                        </TableCell>
                      )}
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={(e) => { e.stopPropagation(); setApTarget(lead); }}
                        >
                          <CheckCircle2 className="h-4 w-4" /> Close
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      )}

      {/* Follow-ups — scheduled reminders, soonest due first */}
      {view === 'followups' && (
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <TableSkeleton />
          ) : shownFollowUps.length === 0 ? (
            emptyFor(
              items.length,
              CalendarClock,
              'No open follow-ups',
              'Set a follow-up date on a lead and it will appear here when action is due.'
            )
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Client</TableHead>
                  <TableHead className="hidden md:table-cell">Action point</TableHead>
                  <TableHead>Due</TableHead>
                  {isAdmin && <TableHead className="hidden lg:table-cell">Assigned to</TableHead>}
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shownFollowUps.map((lead) => {
                  const meta = dueMeta(lead.followUp?.date);
                  return (
                    <TableRow
                      key={lead._id}
                      className="cursor-pointer"
                      onClick={() => navigate(`/leads/${lead._id}`)}
                    >
                      <TableCell>
                        <p className="font-medium leading-tight">{lead.businessName}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          <span className="font-mono font-semibold text-primary">{lead.refNumber}</span> · {lead.contactPerson}
                        </p>
                        {lead.actionPoint && (
                          <p className="mt-0.5 text-xs md:hidden">{lead.actionPoint}</p>
                        )}
                        {lead.followUp?.note && (
                          <p className="mt-0.5 text-xs text-muted-foreground italic">{lead.followUp.note}</p>
                        )}
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        {lead.actionPoint || <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className={cn('whitespace-nowrap', meta.cls)}>{meta.label}</TableCell>
                      {isAdmin && (
                        <TableCell className="hidden lg:table-cell text-muted-foreground">
                          {lead.assignedExecId?.name || '—'}
                        </TableCell>
                      )}
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={(e) => { e.stopPropagation(); setCloseNote(''); setCloseTarget(lead); }}
                        >
                          <CalendarCheck className="h-4 w-4" /> Close
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      )}

      <ConfirmDialog
        open={Boolean(apTarget)}
        onOpenChange={(o) => { if (!o) setApTarget(null); }}
        title="Close this action point?"
        description={apTarget
          ? `This clears the “${apTarget.actionPoint}” action point on ${apTarget.businessName}. Any scheduled follow-up is left unchanged.`
          : ''}
        confirmLabel="Close action point"
        variant="default"
        loading={apClosing}
        onConfirm={closeActionPoint}
      />

      <ConfirmDialog
        open={Boolean(instrTarget)}
        onOpenChange={(o) => { if (!o) setInstrTarget(null); }}
        title="Mark this instruction as done?"
        description={instrTarget
          ? `“${instrTarget.text}” on ${instrTarget.businessName} will be marked done and removed from this list.`
          : ''}
        confirmLabel="Mark done"
        variant="default"
        loading={instrClosing}
        onConfirm={closeInstruction}
      />

      <Dialog open={Boolean(closeTarget)} onOpenChange={(o) => { if (!o) setCloseTarget(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="truncate pr-8">
              Close follow-up{closeTarget ? ` — ${closeTarget.businessName}` : ''}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="fu-close-note">Closing note</Label>
            <Textarea
              id="fu-close-note"
              rows={3}
              placeholder="What was the outcome of this follow-up?"
              value={closeNote}
              onChange={(e) => setCloseNote(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCloseTarget(null)} disabled={closing}>Cancel</Button>
            <Button onClick={submitClose} disabled={!closeNote.trim() || closing}>
              {closing ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarCheck className="h-4 w-4" />}
              Close follow-up
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
