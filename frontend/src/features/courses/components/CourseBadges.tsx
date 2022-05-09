import { Archive, FileEdit, Gauge } from 'lucide-react';
import { DIFFICULTY_LABELS } from '../catalog';
import type { CourseStatus, Difficulty } from '../types';

export function DifficultyBadge({ difficulty }: { difficulty: Difficulty }) {
  return (
    <span className={`badge difficulty-${difficulty}`}>
      <Gauge aria-hidden="true" />
      {DIFFICULTY_LABELS[difficulty]}
    </span>
  );
}

/** Nothing for active courses; a visible marker for drafts and archived ones. */
export function StatusBadge({ status }: { status: CourseStatus }) {
  if (status === 'active') return null;
  return status === 'draft' ? (
    <span className="badge violet">
      <FileEdit aria-hidden="true" />
      Draft
    </span>
  ) : (
    <span className="badge warn">
      <Archive aria-hidden="true" />
      Archived
    </span>
  );
}
