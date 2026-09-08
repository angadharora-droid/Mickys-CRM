import { useState } from 'react';
import { cn, formatDateTime } from '@/lib/utils';
import { LEAD_STAGES, STAGE_LABELS, STAGE_HINTS } from '@/lib/constants';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import TurnDownDialog from './TurnDownDialog';
import { Filter, Loader2, Sparkles, UserCheck, ThumbsDown, CircleDashed, ChevronRight } from 'lucide-react';

const ICONS = { new: CircleDashed, live: Sparkles, client: UserCheck, turned_down: ThumbsDown };

const ACTIVE = {
  new: 'bg-stone-600 text-white ring-stone-600',
  live: 'bg-sky-600 text-white ring-sky-600',
  client: 'bg-emerald-600 text-white ring-emerald-600',
  turned_down: 'bg-red-600 text-white ring-red-600',
};

/**
 * The lead status funnel control on the lead page: one button per stage,
 * the current one filled. Moving to Turned down asks for the reason first.
 * `onChange(stage, reason)` returns a promise; `busy` disables the buttons.
 */
export default function StageControl({ lead, onChange, busy }) {
  const [turnDownOpen, setTurnDownOpen] = useState(false);
  const current = lead.stage || 'new';
  const lastMove = [...(lead.stageHistory || [])].reverse()[0];

  const pick = (stage) => {
    if (stage === current || busy) return;
    if (stage === 'turned_down') {
      setTurnDownOpen(true);
      return;
    }
    onChange(stage, '').catch(() => {});
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" /> Lead Status Funnel
          </span>
          <span className="text-xs font-normal text-muted-foreground">{STAGE_HINTS[current]}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {LEAD_STAGES.map((stage, i) => {
            const Icon = ICONS[stage];
            const active = stage === current;
            return (
              <div key={stage} className="flex items-center gap-1.5">
                {i === 3 && <span className="mx-1 hidden h-6 w-px bg-border sm:block" />}
                {i > 0 && i < 3 && <ChevronRight className="hidden h-4 w-4 text-muted-foreground/60 sm:block" />}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => pick(stage)}
                  title={STAGE_HINTS[stage]}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium ring-1 ring-inset transition-colors disabled:opacity-60',
                    active ? ACTIVE[stage] : 'bg-card text-muted-foreground ring-border hover:bg-accent hover:text-foreground'
                  )}
                >
                  {busy && active ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Icon className="h-3.5 w-3.5" />}
                  {STAGE_LABELS[stage]}
                </button>
              </div>
            );
          })}
        </div>

        {current === 'turned_down' && lead.turnDownReason && (
          <div className="rounded-lg border border-red-200 bg-red-50/60 p-3 text-sm dark:border-red-900 dark:bg-red-950/30">
            <p className="text-xs font-semibold uppercase tracking-wider text-red-700 dark:text-red-300">Turned down — reason</p>
            <p className="mt-1 whitespace-pre-wrap break-words">{lead.turnDownReason}</p>
          </div>
        )}

        {lastMove && (
          <p className="text-xs text-muted-foreground">
            {STAGE_LABELS[lastMove.to] || lastMove.to}
            {lastMove.reason ? ` — ${lastMove.reason}` : ''} ·{' '}
            {lastMove.source === 'system' ? 'automatic' : lastMove.changedBy?.name || 'by hand'} · {formatDateTime(lastMove.at)}
          </p>
        )}
        <p className="text-[11px] text-muted-foreground">
          A new lead goes Live on its first kit, visit, call, sample or feedback; it becomes Client made when
          appointed as a customer. Both can also be set here by hand, or by dragging the lead on the Pipeline board.
        </p>
      </CardContent>

      <TurnDownDialog
        lead={lead}
        open={turnDownOpen}
        busy={busy}
        onOpenChange={setTurnDownOpen}
        onConfirm={(reason) => onChange('turned_down', reason)}
      />
    </Card>
  );
}
