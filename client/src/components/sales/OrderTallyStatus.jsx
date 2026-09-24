import { useState } from 'react';
import { toast } from 'sonner';
import api, { apiError } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { formatDateTime } from '@/lib/utils';
import { ROLES } from '@/lib/constants';
import { Button } from '@/components/ui/button';
import { AlertTriangle, CheckCircle2, Clock, Loader2, RotateCcw, Send } from 'lucide-react';

/**
 * Where an order stands with Tally, as the server worked it out
 * (order.tallyStatus — services/tallyOrder.service.js statusOf): confirmed
 * orders go to Tally as Sales Order vouchers through the Tally add-on, and
 * Tally's own number comes back. An admin can offer an order to the add-on
 * again when it never arrived or was deleted in Tally.
 */
const TONES = {
  good: 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200',
  wait: 'border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-200',
  warn: 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200',
  quiet: 'border-border bg-muted/40 text-muted-foreground',
};

function describe(s) {
  const test = s.mode === 'test' ? ' (test ledger)' : '';
  switch (s.state) {
    case 'in_tally':
      return { tone: 'good', icon: CheckCircle2, title: `In Tally as ${s.voucherNumber || 'a sales order'}${test}`, body: `Order no. ${s.orderNo} · last seen ${formatDateTime(s.seenAt)}` };
    case 'missing':
      return { tone: 'warn', icon: AlertTriangle, title: `No longer in Tally${test}`, body: `It was ${s.voucherNumber || 'there'} (Order no. ${s.orderNo}) but Tally's latest report no longer has it — deleted there?` };
    case 'sent':
      return { tone: 'wait', icon: Send, title: `Sent to Tally${test}`, body: `Collected by the Tally add-on ${formatDateTime(s.sentAt)} as Order no. ${s.orderNo}. Tally's number shows here after its next report (every 10 minutes).` };
    case 'queued':
      return { tone: 'wait', icon: Clock, title: `Going to Tally${s.currentMode === 'test' ? ' (test ledger)' : ''}`, body: 'The Tally add-on creates it as a Sales Order at its next run (every 10 minutes).' };
    case 'held':
      return { tone: 'warn', icon: AlertTriangle, title: 'Cannot go to Tally yet', body: s.holdReason };
    case 'waiting':
      return { tone: 'quiet', icon: Clock, title: 'Goes to Tally once confirmed', body: '' };
    case 'before':
      return { tone: 'quiet', icon: Clock, title: 'Not sent to Tally', body: 'Confirmed before orders started going to Tally automatically.' };
    default:
      return null;
  }
}

export default function OrderTallyStatus({ order, onChange }) {
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const s = order?.tallyStatus;
  if (!s || (!s.enabled && !['in_tally', 'missing', 'sent'].includes(s.state))) return null;
  const d = describe(s);
  if (!d) return null;
  const Icon = d.icon;
  const canResend = user?.role === ROLES.ADMIN && order.status === 'confirmed' && ['sent', 'missing'].includes(s.state);

  const resend = async () => {
    const ok = window.confirm(
      `Send ${order.number} to Tally again?\n\nOnly do this after checking Tally does not already have it — otherwise it will be there twice.`
    );
    if (!ok) return;
    setBusy(true);
    try {
      const { data } = await api.post(`/sales-orders/${order._id}/tally-resend`);
      toast.success(data.message);
      const fresh = await api.get(`/sales-orders/${order._id}`);
      onChange?.(fresh.data.data);
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`mt-4 flex items-start gap-3 rounded-lg border p-3 text-sm ${TONES[d.tone]}`}>
      <Icon className="h-4 w-4 mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="font-medium">{d.title}</p>
        {d.body && <p className="text-xs mt-0.5 opacity-90">{d.body}</p>}
      </div>
      {canResend && (
        <Button size="sm" variant="outline" className="shrink-0 bg-background" onClick={resend} disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
          Send again
        </Button>
      )}
    </div>
  );
}
