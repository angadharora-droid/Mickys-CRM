import { cn, formatDate } from '@/lib/utils';
import { scoreTone } from '@/lib/constants';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CheckCircle2, Circle, Trophy } from 'lucide-react';

/**
 * The lead's score card: the total, how it compares to the most a lead can
 * earn (before repeat orders), and every milestone with the points it earned
 * — ticked with the date it happened, or greyed with what is still to do.
 * `scoreCard` is the server's computed card (lead.scoreCard).
 */
export default function LeadScoreCard({ scoreCard, className }) {
  if (!scoreCard) return null;
  const { total, scale, items, orders = [], repeatOrderPoints } = scoreCard;
  const pct = scale ? Math.min(100, Math.round((total / scale) * 100)) : 0;
  const earned = items.filter((i) => i.earned).length;

  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <Trophy className="h-4 w-4 text-gold" /> Lead Score Card
          </span>
          <span className="text-xs font-normal text-muted-foreground">
            {earned} of {items.length} milestones
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-end gap-4">
          <div className={cn('rounded-2xl px-4 py-3 ring-1 ring-inset', scoreTone(total, scale))}>
            <p className="text-[11px] font-semibold uppercase tracking-wider opacity-80">Score</p>
            <p className="font-display text-4xl font-bold leading-none tabular-nums">{total}</p>
          </div>
          <div className="min-w-0 flex-1 space-y-1.5 pb-1">
            <div className="flex items-baseline justify-between text-xs text-muted-foreground">
              <span>
                out of <span className="font-semibold text-foreground">{scale}</span> before repeat orders
              </span>
              <span className="tabular-nums">{pct}%</span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-gradient-to-r from-primary to-gold transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
            <p className="text-[11px] text-muted-foreground">
              +{repeatOrderPoints} for every repeat order
              {orders.length > 0 && ` · ${orders.length} order${orders.length === 1 ? '' : 's'} on record`}
            </p>
          </div>
        </div>

        <ol className="grid gap-1.5 sm:grid-cols-2">
          {items.map((item, idx) => (
            <li
              key={item.key}
              className={cn(
                'flex items-start gap-2.5 rounded-lg border px-3 py-2',
                item.earned ? 'border-emerald-200 bg-emerald-50/50 dark:border-emerald-900 dark:bg-emerald-950/30' : 'bg-muted/20'
              )}
            >
              {item.earned ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
              ) : (
                <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/50" />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <p className={cn('text-sm font-medium leading-tight', !item.earned && 'text-muted-foreground')}>
                    <span className="mr-1.5 text-[11px] tabular-nums text-muted-foreground">{idx + 1}.</span>
                    {item.label}
                  </p>
                  <p className={cn('shrink-0 text-sm font-semibold tabular-nums', item.earned ? 'text-emerald-700 dark:text-emerald-400' : 'text-muted-foreground')}>
                    {item.earned ? `+${item.earnedPoints}` : item.perEvent ? `${item.points}/order` : `${item.points} pts`}
                  </p>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {item.earned
                    ? [
                        item.at ? formatDate(item.at) : null,
                        item.perEvent && item.count ? `${item.count} × ${item.points}` : null,
                        item.key === 'callsDone' && item.count ? `${item.count} call${item.count === 1 ? '' : 's'}` : null,
                        item.key === 'visitDone' && item.count > 1 ? `${item.count} visits` : null,
                        item.key === 'sampleGiven' && item.count > 1 ? `${item.count} times` : null,
                        item.detail || null,
                      ].filter(Boolean).join(' · ')
                    : item.key === 'callsDone' && item.required
                      ? `${item.count || 0} of ${item.required} calls logged`
                      : item.key === 'repeatOrder'
                        ? 'After the first order'
                        : 'Not yet'}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
