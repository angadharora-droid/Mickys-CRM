import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export default function Pagination({ meta, onPageChange }) {
  if (!meta || meta.totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-border/70">
      <p className="text-sm text-muted-foreground">
        Page <span className="font-semibold text-foreground">{meta.page}</span> of {meta.totalPages} ·{' '}
        {meta.total} records
      </p>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" disabled={!meta.hasPrev} onClick={() => onPageChange(meta.page - 1)}>
          <ChevronLeft className="h-4 w-4" /> Prev
        </Button>
        <Button variant="outline" size="sm" disabled={!meta.hasNext} onClick={() => onPageChange(meta.page + 1)}>
          Next <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
