import { formatCurrency, formatDateTime, formatQty } from '@/lib/utils';
import { GST_BASIS_LABELS, orderTotals } from '@/lib/gst';

/**
 * The order itself — customer, lines, GST, totals, notes — as every desk
 * sees it. The appointed customer's details (GSTIN, mobile, address) ride
 * along when the order was booked against a frozen price list; a plain
 * Tally-ledger order has only its name. An order booked before GST was
 * recorded carries no GST rows and shows its plain total.
 */
export default function OrderItems({ order: o }) {
  if (!o) return null;
  const c = o.customer && typeof o.customer === 'object' ? o.customer : null;
  const t = orderTotals(o);
  const withGst = t.gstTotal > 0;
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
                {Number(i.gst) > 0 ? ` · GST ${Number(i.gst)}%` : ''}
              </p>
            </div>
            <p className="text-sm font-semibold tabular-nums shrink-0">
              {formatCurrency(i.amount != null ? i.amount : (Number(i.qty) || 0) * (Number(i.rate) || 0))}
            </p>
          </div>
        ))}
        {withGst && (
          <div className="px-3 py-2 bg-muted/30 space-y-0.5 text-sm">
            <p className="text-[11px] text-muted-foreground">
              Rates {GST_BASIS_LABELS[t.basis]?.toLowerCase() || 'exclusive of GST'}
            </p>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Taxable value</span>
              <span className="tabular-nums">{formatCurrency(t.taxableTotal)}</span>
            </div>
            {t.supplyType === 'inter' ? (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">IGST</span>
                <span className="tabular-nums">{formatCurrency(t.igst)}</span>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">CGST</span>
                  <span className="tabular-nums">{formatCurrency(t.cgst)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">SGST</span>
                  <span className="tabular-nums">{formatCurrency(t.sgst)}</span>
                </div>
              </>
            )}
          </div>
        )}
        <div className="flex items-center justify-between px-3 py-2 bg-muted/50">
          <p className="text-sm font-medium">Total{withGst ? ' (incl. GST)' : ''}</p>
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
