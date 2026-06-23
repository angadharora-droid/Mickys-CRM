import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import api, { apiError } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { ROLES } from '@/lib/constants';
import { cn, formatDate } from '@/lib/utils';
import PageHeader from '@/components/shared/PageHeader';
import EmptyState from '@/components/shared/EmptyState';
import TableSkeleton from '@/components/shared/TableSkeleton';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { CalendarClock, CalendarCheck, Loader2, Target, CheckCircle2, ClipboardList } from 'lucide-react';

const todayStr = () => new Date().toISOString().slice(0, 10);

/** Label + styling for a due date relative to today. */
const dueMeta = (date) => {
  const d = date ? new Date(date).toISOString().slice(0, 10) : '';
  const t = todayStr();
  if (d && d < t) return { label: 'Overdue', cls: 'text-destructive font-medium' };
  if (d === t) return { label: 'Due today', cls: 'text-amber-600 font-medium' };
  return { label: formatDate(date), cls: 'text-foreground' };
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

  const [view, setView] = useState('instructions'); // 'instructions' | 'actions' | 'followups'

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

  return (
    <div>
      <PageHeader title="Follow-ups" description="Instructions, action points and scheduled follow-ups that need attention" />

      {/* Pill switcher between the two worklists */}
      <div className="mb-4 flex flex-wrap gap-2">
        {[
          { key: 'instructions', label: 'Instructions', icon: ClipboardList, count: openInstructions.length, isLoading: instrLoading },
          { key: 'actions', label: 'Action points', icon: Target, count: actionItems.length, isLoading: apLoading },
          { key: 'followups', label: 'Follow-ups', icon: CalendarClock, count: items.length, isLoading: loading },
        ].map(({ key, label, icon: Icon, count, isLoading }) => {
          const active = view === key;
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
                <span className={cn(
                  'rounded-full px-1.5 py-0.5 text-xs font-semibold',
                  active ? 'bg-primary-foreground/20' : 'bg-foreground/10 text-foreground'
                )}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Instructions — admin directives, one row per open instruction */}
      {view === 'instructions' && (
      <Card>
        <CardContent className="p-0">
          {instrLoading ? (
            <TableSkeleton />
          ) : openInstructions.length === 0 ? (
            <EmptyState
              icon={ClipboardList}
              title="No open instructions"
              description="Instructions from your admin appear here until you mark them done."
            />
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
                {openInstructions.map(({ lead, instr }) => (
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
          ) : actionItems.length === 0 ? (
            <EmptyState
              icon={Target}
              title="No open action points"
              description="Set an action point on a lead and it will appear here to action and close."
            />
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
                {actionItems.map((lead) => {
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
          ) : items.length === 0 ? (
            <EmptyState
              icon={CalendarClock}
              title="No open follow-ups"
              description="Set a follow-up date on a lead and it will appear here when action is due."
            />
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
                {items.map((lead) => {
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
