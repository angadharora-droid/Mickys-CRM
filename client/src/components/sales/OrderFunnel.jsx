import { cn, formatCurrency } from '@/lib/utils';
import { PIPELINE_STAGES } from '@/lib/constants';
import { Stars } from './OrderTimeline';
import { AlertTriangle, Ban } from 'lucide-react';

/**
 * The order funnel: one bar per stage, its length the share of booked orders
 * that reached the stage. Each row also names the orders sitting at that
 * stage right now — the number someone has to act on — and how many of them
 * have sat there longer than they should. `onStageClick` makes the rows act
 * as a filter; `compact` drops the lead-time captions for the overview card.
 */
export default function OrderFunnel({ data, compact = false, activeStage, onStageClick, className }) {
  if (!data) return null;
  const { totals, stages, feedback } = data;
  const base = Math.max(totals.booked, 1);

  return (
    <div className={cn('space-y-3', className)}>
      <ol className="space-y-2">
        {stages.map((s, i) => {
          const pct = Math.round((s.reached / base) * 100);
          const meta = PIPELINE_STAGES[i];
          const clickable = Boolean(onStageClick);
          const active = activeStage === s.key;
          return (
            <li key={s.key}>
              <button
                type="button"
                disabled={!clickable}
                onClick={() => onStageClick?.(s.key)}
                className={cn(
                  'w-full rounded-lg px-2 py-1.5 text-left transition-colors',
                  clickable && 'hover:bg-accent/60',
                  active && 'bg-accent ring-1 ring-primary/30'
                )}
              >
                <div className="flex items-center gap-3">
                  <div className="w-24 shrink-0 sm:w-28">
                    <p className="text-sm font-medium leading-tight">{s.label}</p>
                    {!compact && meta?.owner && (
                      <p className="text-[11px] text-muted-foreground leading-tight">{meta.owner}</p>
                    )}
                  </div>
                  <div className="h-7 flex-1 overflow-hidden rounded-md bg-primary/10">
                    <div
                      className="h-full rounded-md bg-gradient-to-r from-primary to-primary/70 transition-all"
                      style={{ width: `${Math.max(pct, s.reached ? 2 : 0)}%` }}
                    />
                  </div>
                  <div className="w-16 shrink-0 text-right sm:w-20">
                    <p className="text-sm font-semibold tabular-nums leading-tight">{s.reached.toLocaleString('en-IN')}</p>
                    <p className="text-[11px] text-muted-foreground tabular-nums leading-tight">{pct}%</p>
                  </div>
                  <div className="w-[6.5rem] shrink-0 text-right sm:w-36">
                    <p className="text-xs tabular-nums">
                      <span className={cn('font-semibold', s.current > 0 ? 'text-foreground' : 'text-muted-foreground')}>
                        {s.current}
                      </span>{' '}
                      <span className="text-muted-foreground">here now</span>
                    </p>
                    {s.stuck > 0 ? (
                      <p className="text-[11px] text-red-600 inline-flex items-center gap-1 justify-end">
                        <AlertTriangle className="h-3 w-3" /> {s.stuck} over {s.stuckAfterDays}d
                      </p>
                    ) : (
                      !compact && <p className="text-[11px] text-muted-foreground">{formatCurrency(s.currentValue)}</p>
                    )}
                  </div>
                </div>
                {!compact && i > 0 && (
                  <p className="mt-1 pl-[6.75rem] sm:pl-[7.75rem] text-[11px] text-muted-foreground">
                    {s.conversion != null ? `${s.conversion}% of ${stages[i - 1].label.toLowerCase()}` : '—'}
                    {s.avgDaysFromPrevious != null ? ` · avg ${s.avgDaysFromPrevious} day${s.avgDaysFromPrevious === 1 ? '' : 's'} from ${stages[i - 1].label.toLowerCase()}` : ''}
                  </p>
                )}
              </button>
            </li>
          );
        })}
      </ol>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t pt-2 text-xs text-muted-foreground">
        <span>
          <span className="font-semibold text-foreground">{totals.booked.toLocaleString('en-IN')}</span> orders booked ·{' '}
          {formatCurrency(totals.value)}
        </span>
        {totals.cancelled > 0 && (
          <button
            type="button"
            disabled={!onStageClick}
            onClick={() => onStageClick?.('cancelled')}
            className={cn(
              'inline-flex items-center gap-1 rounded px-1 text-red-600',
              onStageClick && 'hover:bg-red-50',
              activeStage === 'cancelled' && 'bg-red-50 ring-1 ring-red-200'
            )}
          >
            <Ban className="h-3 w-3" /> {totals.cancelled} cancelled · {formatCurrency(totals.cancelledValue)}
          </button>
        )}
        {feedback?.count > 0 && (
          <span className="inline-flex items-center gap-1.5">
            Feedback from {feedback.count}: <Stars value={Math.round(feedback.avgRating || 0)} />
            <span className="font-medium text-foreground">{feedback.avgRating}</span>
            {feedback.wouldReorder + feedback.wouldNotReorder > 0 &&
              ` · ${feedback.wouldReorder} would reorder${feedback.wouldNotReorder ? `, ${feedback.wouldNotReorder} would not` : ''}`}
          </span>
        )}
      </div>
    </div>
  );
}
