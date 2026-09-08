import { cn } from '@/lib/utils';
import { STAGE_LABELS, STAGE_STYLES } from '@/lib/constants';

/** The lead's funnel stage (New / Live / Client made / Turned down). */
export default function StageBadge({ stage, className, size = 'sm' }) {
  const key = stage || 'new';
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full font-semibold whitespace-nowrap leading-none ring-1 ring-inset',
        size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-sm',
        STAGE_STYLES[key] || STAGE_STYLES.new,
        className
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      {STAGE_LABELS[key] || key}
    </span>
  );
}
