import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Loader2, ThumbsDown } from 'lucide-react';

/**
 * Asks for the reason before a lead is marked Turned down — shared by the
 * lead page's stage control and the pipeline board. `onConfirm(reason)`
 * returns a promise; the dialog closes itself when it resolves.
 */
export default function TurnDownDialog({ lead, open, busy, onOpenChange, onConfirm }) {
  const [reason, setReason] = useState('');
  useEffect(() => { if (open) setReason(''); }, [open]);

  const confirm = () =>
    onConfirm(reason.trim())
      .then(() => onOpenChange(false))
      .catch(() => {});

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !busy) onOpenChange(false); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Turn down {lead?.businessName || 'this lead'}?</DialogTitle>
          <DialogDescription>
            The lead leaves the active funnel. Its score stays on record and it can be revived to Live later.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="turn-down-reason">Reason *</Label>
          <Textarea
            id="turn-down-reason"
            rows={3}
            placeholder="e.g. Already tied up with another supplier, price too high, closed down…"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button variant="destructive" onClick={confirm} disabled={!reason.trim() || busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ThumbsDown className="h-4 w-4" />}
            Mark turned down
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
