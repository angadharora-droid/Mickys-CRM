import { formatCurrency, formatDateTime, formatQty } from '@/lib/utils';

/**
 * The order itself — customer, lines, total, notes — as every desk sees it.
 * The appointed customer's details (GSTIN, mobile, address) ride along when
 * the order was booked against a frozen price list; a plain Tally-ledger
 * order has only its name.
 */
export default function OrderItems({ order: o }) {
  if (!o) return null;
  const c = o.customer && typeof o.customer === 'object' ? o.customer : null;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="sm:col-span-2 min-w-0">
          <p className="text-xs text-muted-foreground">Customer</p>
          <p className="text-sm font-medium">{o.customerName}</p>
          {c && (
            <p className="text-xs text-muted-foreground mt-0.5 whitespace-pre-line">
              {[c.gstin && `GSTIN ${c.gstin}`, c.mobile, c.email].filter(Boolean).join(' · ')}
              {c.address ? `\n${c.address}` : ''}
            </p>
          )}
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Booked</p>
          <p className="text-sm">{formatDateTime(o.createdAt)}</p>
          {o.createdBy?.name && (
            <p className="text-xs text-muted-foreground">
              by {o.createdBy.name}
              {o.createdBy.phone ? ` · ${o.createdBy.phone}` : ''}
            </p>
          )}
        </div>
      </div>

      <div className="rounded-lg border divide-y">
        {(o.items || []).map((i) => (
          <div key={i.name} className="flex items-center justify-between gap-3 px-3 py-2">
            <div className="min-w-0">
              <p className="text-sm font-medium leading-tight truncate">{i.name}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {formatQty(i.qty, i.baseUnits)} × {formatCurrency(i.rate)}
                {i.packSize ? ` · ${i.packSize}` : ''}
              </p>
            </div>
            <p className="text-sm font-semibold tabular-nums shrink-0">
              {formatCurrency(i.amount != null ? i.amount : (Number(i.qty) || 0) * (Number(i.rate) || 0))}
            </p>
          </div>
        ))}
        <div className="flex items-center justify-between px-3 py-2 bg-muted/50">
          <p className="text-sm font-medium">Total</p>
          <p className="text-base font-bold tabular-nums">{formatCurrency(o.total)}</p>
        </div>
      </div>

      {o.notes && (
        <div>
          <p className="text-xs text-muted-foreground mb-1">Notes</p>
          <p className="text-sm whitespace-pre-wrap rounded-lg border p-3">{o.notes}</p>
        </div>
      )}
    </div>
  );
}
