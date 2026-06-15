import { cn } from '@/lib/utils';
import { STATUS_LABELS, STATUS_STYLES } from '@/lib/constants';

export default function StatusBadge({ status, className }) {
  if (!status) return null;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap leading-none ring-1 ring-inset',
        STATUS_STYLES[status] || 'bg-muted text-muted-foreground',
        className
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      {STATUS_LABELS[status] || status}
    </span>
  );
}
