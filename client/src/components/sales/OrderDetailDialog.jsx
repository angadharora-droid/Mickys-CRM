import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import api, { apiError } from '@/lib/api';
import { orderStageSince, daysSince, PIPELINE_STAGES } from '@/lib/constants';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import OrderStatusBadge from './OrderStatusBadge';
import OrderItems from './OrderItems';
import OrderTimeline from './OrderTimeline';

/**
 * One order, in full, for any desk: the voucher on the left and its journey
 * on the right. The list rows every page holds carry the order without its
 * people (history.by, dispatch.filledBy…), so the dialog reloads the order
 * when it opens. `renderActions(order, setOrder)` supplies the footer — each
 * desk brings the buttons for its own step.
 */
export default function OrderDetailDialog({ open, order: initial, onClose, renderActions, onOrderChange }) {
  const [order, setOrder] = useState(initial);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !initial?._id) return;
    setOrder(initial);
    setLoading(true);
    api
      .get(`/sales-orders/${initial._id}`)
      .then((r) => setOrder(r.data.data))
      .catch((err) => toast.error(apiError(err)))
      .finally(() => setLoading(false));
  }, [open, initial]);

  const update = (next) => {
    setOrder(next);
    onOrderChange?.(next);
  };

  const o = order;
  const stage = o ? PIPELINE_STAGES.find((s) => s.key === o.status) : null;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-4xl max-h-[92dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap pr-8">
            {o?.number}
            {o && <OrderStatusBadge status={o.status} />}
            {o && o.status !== 'closed' && o.status !== 'cancelled' && (
              <span className="text-xs font-normal text-muted-foreground">
                at this stage {daysSince(orderStageSince(o))} day{daysSince(orderStageSince(o)) === 1 ? '' : 's'}
                {stage?.next ? ` · ${stage.next}` : ''}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        {!o ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <div className="grid gap-6 lg:grid-cols-5">
            <div className="lg:col-span-3">
              <OrderItems order={o} />
            </div>
            <div className="lg:col-span-2 lg:border-l lg:pl-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
                Journey{loading ? ' · refreshing…' : ''}
              </p>
              <OrderTimeline order={o} />
            </div>
          </div>
        )}

        {o && renderActions && <DialogFooter className="mt-2 flex-wrap gap-2">{renderActions(o, update)}</DialogFooter>}
      </DialogContent>
    </Dialog>
  );
}
