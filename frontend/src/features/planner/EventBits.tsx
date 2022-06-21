import { Repeat, Users } from 'lucide-react';
import { parseDate } from '../../lib/dates';
import { cx } from '../../lib/cx';
import { formatTime } from '../../lib/format';
import { useLoader } from '../../hooks/useLoader';
import { plannerApi } from './api';
import { KIND_LABELS } from './calendar';
import type { CourseOption, EventKind, Occurrence } from './types';

export function KindDot({ kind }: { kind: EventKind }) {
  return <span className={cx('kind-dot', `kind-${kind}`)} aria-hidden />;
}

export function KindBadge({ kind }: { kind: EventKind }) {
  return (
    <span className={cx('kind-badge', `kind-${kind}`)}>
      <KindDot kind={kind} />
      {KIND_LABELS[kind]}
    </span>
  );
}

/** Accessible name for an occurrence button, e.g. "SQL workshop, Live session, 15:00". */
export function occurrenceLabel(item: Occurrence): string {
  const when = item.event.all_day ? 'all day' : formatTime(parseDate(item.starts_at));
  return `${item.event.title}, ${KIND_LABELS[item.event.kind]}, ${when}`;
}

/** Compact coloured chip used by the month grid and the week view's all-day row. */
export function EventChip({ item, onSelect }: { item: Occurrence; onSelect: (item: Occurrence) => void }) {
  const { event } = item;
  return (
    <button
      type="button"
      className={cx('event-chip', `kind-${event.kind}`, event.all_day && 'all-day')}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(item);
      }}
      aria-label={occurrenceLabel(item)}
      title={event.title}
    >
      {!event.all_day && <time>{formatTime(parseDate(item.starts_at))}</time>}
      <span className="event-chip-title">{event.title}</span>
      {event.recurrence !== 'none' && <Repeat className="chip-icon" aria-hidden />}
      {event.shared && <Users className="chip-icon" aria-hidden />}
    </button>
  );
}

/** Active courses of a workspace, for course pickers and filters. */
export function useCourses(workspaceId: number): CourseOption[] {
  const { data } = useLoader(() => plannerApi.courses(workspaceId).then((page) => page.items), `planner-courses:${workspaceId}`);
  return data ?? [];
}
