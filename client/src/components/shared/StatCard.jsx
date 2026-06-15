import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/**
 * Brand-aligned accent tones for the icon tile. These mirror the app's
 * semantic colour language (see STATUS_STYLES) so dashboards stay on-theme:
 * maroon for neutral counts, saffron gold for highlights, and the
 * amber/emerald/red semantics for pending / done / failed.
 */
const TONES = {
  primary: 'bg-primary/10 text-primary',
  gold: 'bg-gold/15 text-gold',
  success: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  warning: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  danger: 'bg-red-500/10 text-red-600 dark:text-red-400',
};

export default function StatCard({ title, value, icon: Icon, hint, tone = 'primary', iconClass }) {
  return (
    <Card className="group relative overflow-hidden transition-all duration-200 hover:shadow-lifted hover:-translate-y-0.5 active:translate-y-0">
      <span className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-primary via-gold to-primary opacity-60 group-hover:opacity-100 transition-opacity" />
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs sm:text-[13px] font-medium text-muted-foreground truncate">{title}</p>
          {Icon && (
            <div className={cn('shrink-0 rounded-lg sm:rounded-xl p-2 sm:p-2.5', TONES[tone] || TONES.primary, iconClass)}>
              <Icon className="h-4 w-4 sm:h-[18px] sm:w-[18px]" />
            </div>
          )}
        </div>
        <p className="mt-1.5 sm:mt-2 text-2xl sm:text-3xl font-bold tracking-tight tabular-nums">{value ?? '—'}</p>
        {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}
