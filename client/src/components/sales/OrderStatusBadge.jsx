import { Lock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ORDER_STATUS_LABELS, ORDER_STATUS_STYLES } from '@/lib/constants';
import { Badge } from '@/components/ui/badge';

/** One order status as a chip — the same colours everywhere in the module. */
export default function OrderStatusBadge({ status, className, title }) {
  if (!status) return null;
  return (
    <Badge variant="outline" className={cn('border whitespace-nowrap', ORDER_STATUS_STYLES[status] || '', className)} title={title}>
      {status === 'confirmed' && <Lock className="h-3 w-3 mr-1" />}
      {ORDER_STATUS_LABELS[status] || status}
    </Badge>
  );
}
