import { useState } from 'react';
import { cn, formatCurrency, formatDate, formatDateTime } from '@/lib/utils';
import {
  PIPELINE_STAGES, ORDER_STAGE_STAMP, ORDER_STATUS_LABELS, PAYMENT_MODE_LABELS, DISPATCH_MODE_LABELS, daysSince,
} from '@/lib/constants';
import { Check, XCircle, Star, History, ChevronDown, ChevronUp } from 'lucide-react';

/** ★★★★☆ */
export function Stars({ value, className }) {
  if (value == null) return <span className="text-muted-foreground">—</span>;
  return (
    <span className={cn('inline-flex items-center gap-0.5', className)} title={`${value} of 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} className={cn('h-3.5 w-3.5', n <= value ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground/40')} />
      ))}
    </span>
  );
}

const Row = ({ label, children }) =>
  children == null || children === '' ? null : (
    <div className="flex gap-2 text-xs">
      <span className="w-24 shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 break-words">{children}</span>
    </div>
  );

/** Who moved the order into this stage, from the stamp owners or the history. */
function actorFor(order, key) {
  const direct = {
    open: order.createdBy?.name,
    confirmed: order.payment?.recordedBy?.name,
    invoiced:
      order.invoices?.length
        ? order.invoices[order.invoices.length - 1].source === 'tally'
          ? 'Tally push'
          : order.invoices[order.invoices.length - 1].linkedBy?.name
        : null,
    dispatched: order.dispatch?.filledBy?.name,
    delivered: order.delivery?.markedBy?.name,
    closed: order.feedback?.submittedBy?.name,
  }[key];
  if (direct) return direct;
  const h = [...(order.history || [])].reverse().find((e) => e.to === key);
  return h?.by?.name || (h?.source === 'tally' ? 'Tally push' : '');
}

/** The facts each stage recorded. */
function StageDetails({ order: o, stage }) {
  switch (stage) {
    case 'open':
      return (
        <>
          <Row label="Items">{`${o.items?.length || 0} · ${formatCurrency(o.total)}`}</Row>
        </>
      );
    case 'confirmed': {
      const p = o.payment;
      return (
        <>
          {p?.mode && (
            <Row label="Payment">
              {PAYMENT_MODE_LABELS[p.mode] || p.mode}
              {p.amount != null ? ` · ${formatCurrency(p.amount)}` : ''}
              {p.reference ? ` · ${p.reference}` : ''}
            </Row>
          )}
          {p?.receivedOn && <Row label="Received on">{formatDate(p.receivedOn)}</Row>}
          {p?.notes && <Row label="Notes">{p.notes}</Row>}
          {o.accountsEmailedAt && <Row label="Emailed">accounts, {formatDateTime(o.accountsEmailedAt)}</Row>}
        </>
      );
    }
    case 'invoiced':
      return (o.invoices || []).map((inv, i) => (
        <Row key={i} label={i === 0 ? 'Tally invoice' : ''}>
          <span className="font-medium">{inv.voucherNumber || '(no number)'}</span>
          {inv.date ? ` · ${formatDate(inv.date)}` : ''}
          {inv.amount ? ` · ${formatCurrency(inv.amount)}` : ''}
          {inv.party ? ` · ${inv.party}` : ''}
          <span className="text-muted-foreground">
            {inv.source === 'tally'
              ? ` · matched from ${inv.matchedVia === 'orderNo' ? 'Order No(s)' : inv.matchedVia}`
              : ` · linked by ${inv.linkedBy?.name || 'accounts'}`}
          </span>
          {inv.note ? ` — ${inv.note}` : ''}
        </Row>
      ));
    case 'dispatched': {
      const d = o.dispatch;
      if (!d?.mode) return null;
      return (
        <>
          <Row label="Mode">
            {DISPATCH_MODE_LABELS[d.mode] || d.mode}
            {d.carrier ? ` · ${d.carrier}` : ''}
          </Row>
          <Row label="Docket / LR">{d.docketNumber}</Row>
          <Row label="Vehicle">{[d.vehicleNumber, d.driverName, d.driverPhone].filter(Boolean).join(' · ')}</Row>
          <Row label="Consignment">
            {[d.packages != null && `${d.packages} pkg`, d.weightKg != null && `${d.weightKg} kg`, d.ewayBill && `e-way ${d.ewayBill}`]
              .filter(Boolean)
              .join(' · ')}
          </Row>
          <Row label="Sent on">
            {d.dispatchedOn ? formatDate(d.dispatchedOn) : ''}
            {d.expectedDeliveryOn ? ` · expected ${formatDate(d.expectedDeliveryOn)}` : ''}
          </Row>
          <Row label="Remarks">{d.remarks}</Row>
        </>
      );
    }
    case 'delivered': {
      const d = o.delivery;
      if (!d?.markedAt) return null;
      return (
        <>
          <Row label="Delivered on">{d.deliveredOn ? formatDate(d.deliveredOn) : ''}</Row>
          <Row label="Received by">{d.receivedBy}</Row>
          <Row label="Remarks">{d.remarks}</Row>
        </>
      );
    }
    case 'closed': {
      const f = o.feedback;
      if (!f?.submittedAt) return null;
      return (
        <>
          <Row label="Overall"><Stars value={f.rating} /></Row>
          {(f.quality != null || f.delivery != null || f.packaging != null) && (
            <Row label="Detail">
              <span className="inline-flex flex-wrap gap-x-3 gap-y-1">
                {f.quality != null && <span>Quality <Stars value={f.quality} /></span>}
                {f.delivery != null && <span>Delivery <Stars value={f.delivery} /></span>}
                {f.packaging != null && <span>Packaging <Stars value={f.packaging} /></span>}
              </span>
            </Row>
          )}
          {f.wouldReorder != null && <Row label="Reorder?">{f.wouldReorder ? 'Yes' : 'No'}</Row>}
          <Row label="Comments">{f.comments}</Row>
        </>
      );
    }
    default:
      return null;
  }
}

/**
 * The order's journey, stage by stage: done, current or still to come, with
 * what each stage recorded and who did it. Cancelled orders show where they
 * got to and then the cancellation. The full move-by-move history sits
 * underneath, folded.
 */
export default function OrderTimeline({ order: o, className }) {
  const [showHistory, setShowHistory] = useState(false);
  if (!o) return null;

  const cancelled = o.status === 'cancelled';
  const currentIdx = PIPELINE_STAGES.findIndex((s) => s.key === o.status);

  return (
    <div className={cn('space-y-1', className)}>
      <ol className="relative">
        {PIPELINE_STAGES.map((stage, idx) => {
          const at = o[ORDER_STAGE_STAMP[stage.key]];
          const reached = stage.key === 'open' ? true : Boolean(at);
          const isCurrent = !cancelled && idx === currentIdx;
          const state = isCurrent ? 'current' : reached ? 'done' : 'pending';
          const actor = reached ? actorFor(o, stage.key) : '';
          const last = idx === PIPELINE_STAGES.length - 1 && !cancelled;
          return (
            <li key={stage.key} className="relative flex gap-3 pb-4">
              {!last && (
                <span
                  className={cn(
                    'absolute left-[11px] top-6 bottom-0 w-px',
                    state === 'pending' ? 'bg-border border-l border-dashed' : 'bg-primary/40'
                  )}
                />
              )}
              <span
                className={cn(
                  'relative z-10 mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full ring-2 ring-background',
                  state === 'done' && 'bg-primary text-primary-foreground',
                  state === 'current' && 'bg-gold text-gold-foreground shadow-soft',
                  state === 'pending' && 'bg-muted text-muted-foreground'
                )}
              >
                {state === 'done' ? <Check className="h-3.5 w-3.5" /> : <span className="text-[10px] font-bold">{idx + 1}</span>}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                  <p className={cn('text-sm font-medium', state === 'pending' && 'text-muted-foreground')}>
                    {stage.label}
                    {isCurrent && (
                      <span className="ml-2 rounded-full bg-gold/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800">
                        now · {daysSince(at || o.createdAt)}d
                      </span>
                    )}
                  </p>
                  {reached && (
                    <p className="text-[11px] text-muted-foreground whitespace-nowrap">
                      {formatDateTime(stage.key === 'open' ? o.createdAt : at)}
                      {actor ? ` · ${actor}` : ''}
                    </p>
                  )}
                </div>
                {state === 'pending' ? (
                  <p className="text-xs text-muted-foreground/80">{stage.hint}</p>
                ) : (
                  <div className="mt-1 space-y-0.5">
                    {isCurrent && stage.next && (
                      <p className="text-xs text-amber-800">Next: {stage.next}</p>
                    )}
                    <StageDetails order={o} stage={stage.key} />
                  </div>
                )}
              </div>
            </li>
          );
        })}
        {cancelled && (
          <li className="relative flex gap-3">
            <span className="relative z-10 mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-red-100 text-red-700 ring-2 ring-background">
              <XCircle className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                <p className="text-sm font-medium text-red-700">Cancelled</p>
                {o.cancelledAt && (
                  <p className="text-[11px] text-muted-foreground">
                    {formatDateTime(o.cancelledAt)}
                    {actorFor(o, 'cancelled') ? ` · ${actorFor(o, 'cancelled')}` : ''}
                  </p>
                )}
              </div>
              {[...(o.history || [])].reverse().find((h) => h.to === 'cancelled')?.note && (
                <p className="text-xs text-muted-foreground">
                  {[...(o.history || [])].reverse().find((h) => h.to === 'cancelled').note}
                </p>
              )}
            </div>
          </li>
        )}
      </ol>

      {o.history?.length > 0 && (
        <div>
          <button
            type="button"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => setShowHistory((s) => !s)}
          >
            <History className="h-3.5 w-3.5" /> Full history ({o.history.length})
            {showHistory ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
          {showHistory && (
            <ul className="mt-1 divide-y rounded-lg border text-xs">
              {[...o.history].reverse().map((h, i) => (
                <li key={i} className="px-3 py-1.5">
                  <div className="flex flex-wrap justify-between gap-x-2">
                    <span className="font-medium">
                      {h.from && h.from !== h.to ? `${ORDER_STATUS_LABELS[h.from] || h.from} → ` : ''}
                      {ORDER_STATUS_LABELS[h.to] || h.to}
                    </span>
                    <span className="text-muted-foreground">
                      {formatDateTime(h.at)} · {h.by?.name || (h.source === 'tally' ? 'Tally push' : 'system')}
                    </span>
                  </div>
                  {h.note && <p className="text-muted-foreground">{h.note}</p>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
