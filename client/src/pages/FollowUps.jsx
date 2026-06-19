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
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { CalendarClock, CalendarCheck, Loader2 } from 'lucide-react';

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
  const [closeTarget, setCloseTarget] = useState(null); // lead being closed
  const [closeNote, setCloseNote] = useState('');
  const [closing, setClosing] = useState(false);

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

  useEffect(() => { fetchItems(); }, [fetchItems]);

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

  return (
    <div>
      <PageHeader title="Follow-ups" description="Leads with an open follow-up, soonest due first" />

      <Card>
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
      </Card>

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
