import { Eye } from 'lucide-react';
import { capitalize } from '../../../lib/format';
import type { Grade, IntervalPreview } from '../types';

type GradeBarProps = {
  flipped: boolean;
  previews: IntervalPreview[];
  busy: boolean;
  onFlip: () => void;
  onGrade: (grade: Grade) => void;
};

const TONES: Record<Grade, string> = { 0: 'again', 1: 'hard', 2: 'good', 3: 'easy' };

/** "Show answer" until the card is turned over, then the four grades with the interval each one schedules. */
export function GradeBar({ flipped, previews, busy, onFlip, onGrade }: GradeBarProps) {
  if (!flipped) {
    return (
      <div className="fc-gradebar">
        <button type="button" className="primary fc-show-answer" onClick={onFlip}>
          <Eye /> Show answer <kbd>Space</kbd>
        </button>
      </div>
    );
  }
  return (
    <div className="fc-gradebar fc-grades" role="group" aria-label="How well did you remember?">
      {previews.map((preview) => (
        <button
          key={preview.grade}
          type="button"
          className={`fc-grade fc-grade-${TONES[preview.grade]}`}
          disabled={busy}
          onClick={() => onGrade(preview.grade)}
          aria-label={`${capitalize(preview.label)}: next review in ${preview.display}`}
        >
          <span className="fc-grade-label">{capitalize(preview.label)}</span>
          <span className="fc-grade-interval">{preview.display}</span>
          <kbd>{preview.grade + 1}</kbd>
        </button>
      ))}
    </div>
  );
}
