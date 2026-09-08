import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import StageBadge from '@/components/shared/StageBadge';
import ScoreBadge from '@/components/shared/ScoreBadge';
import { Trophy } from 'lucide-react';

/**
 * Dashboard card for the score card: total points, the average per lead, and
 * the highest-scoring leads. `scores` is the server's scores object
 * ({ total, average, max, top[] }); `showExecutive` adds who owns each.
 */
export default function LeadScoreSummary({ scores, title = 'Lead Score Card', showExecutive = false, className }) {
  if (!scores) return null;
  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Trophy className="h-4 w-4 text-gold" /> {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-xl bg-primary/5 px-3 py-2.5">
            <p className="text-[11px] font-medium text-muted-foreground">Total points</p>
            <p className="text-xl font-bold tabular-nums">{scores.total.toLocaleString('en-IN')}</p>
          </div>
          <div className="rounded-xl bg-gold/10 px-3 py-2.5">
            <p className="text-[11px] font-medium text-muted-foreground">Avg per lead</p>
            <p className="text-xl font-bold tabular-nums">{scores.average}</p>
          </div>
          <div className="rounded-xl bg-emerald-500/10 px-3 py-2.5">
            <p className="text-[11px] font-medium text-muted-foreground">Best lead</p>
            <p className="text-xl font-bold tabular-nums">{scores.max}</p>
          </div>
        </div>

        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Top leads</p>
          {scores.top.length === 0 ? (
            <p className="text-sm text-muted-foreground">No points scored yet — generate a kit, log a visit or give samples.</p>
          ) : (
            <ol className="divide-y rounded-lg border">
              {scores.top.map((l, i) => (
                <li key={l._id}>
                  <Link to={`/leads/${l._id}`} className="flex items-center gap-3 px-3 py-2 hover:bg-accent/60">
                    <span className="w-5 shrink-0 text-xs font-semibold tabular-nums text-muted-foreground">{i + 1}.</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{l.businessName}</p>
                      <p className="truncate text-[11px] text-muted-foreground">
                        {l.city}{showExecutive ? ` · ${l.executive}` : ''}
                      </p>
                    </div>
                    <StageBadge stage={l.stage} className="hidden sm:inline-flex" />
                    <ScoreBadge score={l.score} />
                  </Link>
                </li>
              ))}
            </ol>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
