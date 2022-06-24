import { CalendarPlus, MapPin, Repeat, Users } from 'lucide-react';
import { EmptyState } from '../../components/ui';
import { dayKey, isSameDay } from '../../lib/dates';
import { cx } from '../../lib/cx';
import { relativeDay, formatLongDate } from '../../lib/format';
import { KIND_LABELS, timeLabel } from './calendar';
import { KindDot, occurrenceLabel } from './EventBits';
import type { Occurrence } from './types';

type AgendaViewProps = {
  days: Date[];
  now: Date;
  byDay: Map<string, Occurrence[]>;
  onSelect: (item: Occurrence) => void;
  onCreate: (day: Date) => void;
};

/** Day-by-day list of the next two weeks from the anchor; days without events are skipped. */
export function AgendaView({ days, now, byDay, onSelect, onCreate }: AgendaViewProps) {
  const busy = days.filter((day) => (byDay.get(dayKey(day)) ?? []).length > 0);
  if (!busy.length) {
    return (
      <EmptyState icon={<CalendarPlus />} title="Nothing planned for these two weeks">
        <p>Block time for a study session or a review, or move to another fortnight.</p>
        <button type="button" className="primary" onClick={() => onCreate(days[0])}>
          <CalendarPlus aria-hidden /> Plan a session
        </button>
      </EmptyState>
    );
  }
  return (
    <ol className="agenda">
      {busy.map((day) => (
        <li key={dayKey(day)} className={cx('agenda-day', isSameDay(day, now) && 'today')}>
          <h3>
            <span>{relativeDay(day, now)}</span>
            <small>{formatLongDate(day)}</small>
          </h3>
          <ul>
            {byDay.get(dayKey(day))!.map((item) => (
              <li key={item.key}>
                <button type="button" className="agenda-item" onClick={() => onSelect(item)} aria-label={occurrenceLabel(item)}>
                  <span className="agenda-time">{timeLabel(item)}</span>
                  <KindDot kind={item.event.kind} />
                  <span className="agenda-main">
                    <b>{item.event.title}</b>
                    <small>
                      {KIND_LABELS[item.event.kind]}
                      {item.event.course && ` · ${item.event.course.title}`}
                      {item.event.location && (
                        <>
                          {' · '}
                          <MapPin aria-hidden /> {item.event.location}
                        </>
                      )}
                    </small>
                  </span>
                  <span className="agenda-flags" aria-hidden>
                    {item.event.recurrence !== 'none' && <Repeat />}
                    {item.event.shared && <Users />}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ol>
  );
}
