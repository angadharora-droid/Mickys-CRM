import { cn } from '@/lib/utils';
import { STAGE_BAR_STYLES, STAGE_HINTS } from '@/lib/constants';

/**
 * The lead status funnel: New → Live → Client made as stacked bars sized by
 * share of all leads, with Turned down set apart beneath. `data` is the
 * server's funnel object ({ total, stages, everClient, conversionPct }).
 * `onStageClick` makes each row a filter; `compact` drops the hints.
 */
export default function LeadFunnel({ data, compact = false, activeStage, onStageClick, className }) {
  if (!data) return null;
  const { total, stages, everClient, conversionPct } = data;
  const flow = stages.filter((s) => s.key !== 'turned_down');
  const lost = stages.find((s) => s.key === 'turned_down');
  const base = Math.max(total, 1);

  const Row = ({ s }) => {
    const pct = Math.round((s.count / base) * 100);
    const clickable = Boolean(onStageClick);
    const active = activeStage === s.key;
    return (
      <li>
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
              {!compact && <p className="text-[11px] leading-tight text-muted-foreground">{STAGE_HINTS[s.key]}</p>}
            </div>
            <div className="h-7 flex-1 overflow-hidden rounded-md bg-muted">
              <div
                className={cn('h-full rounded-md bg-gradient-to-r transition-all', STAGE_BAR_STYLES[s.key])}
                style={{ width: `${Math.max(pct, s.count ? 2 : 0)}%` }}
              />
            </div>
            <div className="w-16 shrink-0 text-right sm:w-20">
              <p className="text-sm font-semibold leading-tight tabular-nums">{s.count.toLocaleString('en-IN')}</p>
              <p className="text-[11px] leading-tight text-muted-foreground tabular-nums">{pct}%</p>
            </div>
            {!compact && (
              <div className="hidden w-20 shrink-0 text-right sm:block">
                <p className="text-xs tabular-nums text-muted-foreground">
                  <span className="font-semibold text-foreground">{s.points.toLocaleString('en-IN')}</span> pts
                </p>
              </div>
            )}
          </div>
        </button>
      </li>
    );
  };

  return (
    <div className={cn('space-y-3', className)}>
      <ol className="space-y-2">
        {flow.map((s) => <Row key={s.key} s={s} />)}
      </ol>
      {lost && (
        <ol className="border-t pt-2">
          <Row s={lost} />
        </ol>
      )}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t pt-2 text-xs text-muted-foreground">
        <span>
          <span className="font-semibold text-foreground">{total.toLocaleString('en-IN')}</span> lead{total === 1 ? '' : 's'}
        </span>
        <span>
          <span className="font-semibold text-foreground">{everClient.toLocaleString('en-IN')}</span> ever made client ·{' '}
          <span className="font-semibold text-foreground">{conversionPct}%</span> conversion
        </span>
      </div>
    </div>
  );
}
