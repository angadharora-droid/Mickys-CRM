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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { CalendarClock, CalendarCheck, Loader2, Target, CheckCircle2 } from 'lucide-react';

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

  useEffect(() => { fetchItems(); fetchActionPoints(); }, [fetchItems, fetchActionPoints]);

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

  return (
    <div>
      <PageHeader title="Follow-ups" description="Open action points and scheduled follow-ups that need attention" />

      {/* Action points — leads with a pending next-action, close when handled */}
      <Card className="mb-6">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Target className="h-4 w-4 text-muted-foreground" /> Action points
            {!apLoading && actionItems.length > 0 && (
              <span className="text-sm font-normal text-muted-foreground">· {actionItems.length} open</span>
            )}
          </CardTitle>
        </CardHeader>
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

      {/* Follow-ups — scheduled reminders, soonest due first */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <CalendarClock className="h-4 w-4 text-muted-foreground" /> Follow-ups
            {!loading && items.length > 0 && (
              <span className="text-sm font-normal text-muted-foreground">· {items.length} open</span>
            )}
          </CardTitle>
        </CardHeader>
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
