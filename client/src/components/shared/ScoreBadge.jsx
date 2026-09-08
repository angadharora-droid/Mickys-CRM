import { cn } from '@/lib/utils';
import { DEFAULT_SCORE_SCALE, scoreTone } from '@/lib/constants';
import { Trophy } from 'lucide-react';

/** A lead's score-card total as a compact pill, coloured by how far along it is. */
export default function ScoreBadge({ score = 0, scale = DEFAULT_SCORE_SCALE, className, title }) {
  return (
    <span
      title={title || `Lead score: ${score} points`}
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold tabular-nums ring-1 ring-inset',
        scoreTone(score, scale),
        className
      )}
    >
      <Trophy className="h-3 w-3" />
      {score}
    </span>
  );
}
