import type { CSSProperties, MouseEvent } from 'react';
import { Repeat, Users } from 'lucide-react';
import { dayKey, isSameDay, parseDate } from '../../lib/dates';
import { cx } from '../../lib/cx';
import { formatLongDate, formatTime } from '../../lib/format';
import { GRID_END_HOUR, GRID_START_HOUR, layoutDay, minutesAtOffset, shortWeekday } from './calendar';
import { EventChip, occurrenceLabel } from './EventBits';
import type { Occurrence } from './types';

type WeekViewProps = {
  days: Date[];
  now: Date;
  byDay: Map<string, Occurrence[]>;
  onSelect: (item: Occurrence) => void;
  /** `minutes` after midnight for a timed slot, or null for the all-day row. */
  onCreate: (day: Date, minutes: number | null) => void;
};

const HOURS = Array.from({ length: GRID_END_HOUR - GRID_START_HOUR }, (_, i) => GRID_START_HOUR + i);
const GRID_MINUTES = (GRID_END_HOUR - GRID_START_HOUR) * 60;

function nowOffset(now: Date): number | null {
  const minutes = now.getUTCHours() * 60 + now.getUTCMinutes() - GRID_START_HOUR * 60;
  return minutes >= 0 && minutes <= GRID_MINUTES ? (minutes / GRID_MINUTES) * 100 : null;
}

function DayColumn({ day, items, now, onSelect, onCreate }: { day: Date; items: Occurrence[]; now: Date; onSelect: WeekViewProps['onSelect']; onCreate: WeekViewProps['onCreate'] }) {
  const timed = items.filter((item) => !item.event.all_day);
  const byKey = new Map(timed.map((item) => [item.key, item]));
  const placed = layoutDay(
    timed.map((item) => ({ key: item.key, start: parseDate(item.starts_at), end: parseDate(item.ends_at) })),
    day,
  );
  const today = isSameDay(day, now);
  const line = today ? nowOffset(now) : null;

  const createAt = (event: MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    onCreate(day, minutesAtOffset(event.clientY - rect.top, rect.height));
  };

  return (
    <div className={cx('week-column', today && 'today')} onClick={createAt}>
      {placed.map((block) => {
        const item = byKey.get(block.key)!;
        const style = {
          top: `${block.top}%`,
          height: `${block.height}%`,
          left: `${(block.column / block.columns) * 100}%`,
          width: `${100 / block.columns}%`,
        } as CSSProperties;
        const compact = block.height < 5;
        return (
          <button
            key={block.key}
            type="button"
            className={cx('week-block', `kind-${item.event.kind}`, compact && 'compact', block.clippedStart && 'clipped-start', block.clippedEnd && 'clipped-end')}
            style={style}
            aria-label={occurrenceLabel(item)}
            onClick={(event) => {
              event.stopPropagation();
              onSelect(item);
            }}
          >
            <b>{item.event.title}</b>
            {!compact && (
              <small>
                {formatTime(parseDate(item.starts_at))}–{formatTime(parseDate(item.ends_at))}
                {item.event.location ? ` · ${item.event.location}` : ''}
              </small>
            )}
            <span className="block-icons" aria-hidden>
              {item.event.recurrence !== 'none' && <Repeat />}
              {item.event.shared && <Users />}
            </span>
          </button>
        );
      })}
      {line !== null && <div className="now-line" style={{ top: `${line}%` }} aria-hidden />}
    </div>
  );
}

/**
 * Seven-day time grid from 07:00 to 22:00. Overlapping blocks sit side by side (see `layoutDay`);
 * clicking an empty slot creates an event there, snapped to the half hour.
 */
export function WeekView({ days, now, byDay, onSelect, onCreate }: WeekViewProps) {
  return (
    <div className="week-scroll">
      <div className="week-view">
        <div className="week-corner" />
        {days.map((day) => (
          <button
            key={dayKey(day)}
            type="button"
            className={cx('week-day-head', isSameDay(day, now) && 'today')}
            aria-label={`Add an all-day event on ${formatLongDate(day)}`}
            onClick={() => onCreate(day, null)}
          >
            <small>{shortWeekday(day)}</small>
            <b>{day.getUTCDate()}</b>
          </button>
        ))}

        <div className="week-gutter-label">All day</div>
        {days.map((day) => (
          <div key={dayKey(day)} className="week-all-day">
            {(byDay.get(dayKey(day)) ?? [])
              .filter((item) => item.event.all_day)
              .map((item) => (
                <EventChip key={item.key} item={item} onSelect={onSelect} />
              ))}
          </div>
        ))}

        <div className="week-hours" aria-hidden>
          {HOURS.map((hour) => (
            <span key={hour}>{String(hour).padStart(2, '0')}:00</span>
          ))}
        </div>
        {days.map((day) => (
          <DayColumn key={dayKey(day)} day={day} items={byDay.get(dayKey(day)) ?? []} now={now} onSelect={onSelect} onCreate={onCreate} />
        ))}
      </div>
    </div>
  );
}
