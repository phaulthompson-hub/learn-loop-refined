import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Plus, X } from 'lucide-react';
import { addDays, dayKey, isSameDay, parseDate } from '../../lib/dates';
import { cx } from '../../lib/cx';
import { formatLongDate } from '../../lib/format';
import { weekdayLabels } from './calendar';
import { EventChip } from './EventBits';
import type { Occurrence } from './types';

const VISIBLE_CHIPS = 3;

type MonthViewProps = {
  matrix: Date[][];
  anchor: Date;
  now: Date;
  weekStartsOn: number;
  byDay: Map<string, Occurrence[]>;
  onSelect: (item: Occurrence) => void;
  onCreate: (day: Date) => void;
};

/** Phones show coloured dots instead of chips, so tapping a busy day lists its events instead. */
const isCompact = () => typeof window !== 'undefined' && Boolean(window.matchMedia?.('(max-width: 640px)').matches);

const KEY_STEPS: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };

/** Popover listing every item of a crowded day ("+N more"). Closes on Escape or an outside click. */
function DayPopover({ day, items, onSelect, onClose }: { day: Date; items: Occurrence[]; onSelect: (item: Occurrence) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('.day-popover-list button')?.focus();
    const onDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) closeRef.current();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);
  return (
    <div
      ref={ref}
      className="day-popover"
      role="dialog"
      aria-label={`All events on ${formatLongDate(day)}`}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <header>
        <b>{formatLongDate(day)}</b>
        <button type="button" className="icon-only" aria-label="Close" onClick={onClose}>
          <X />
        </button>
      </header>
      <div className="day-popover-list">
        {items.map((item) => (
          <EventChip key={item.key} item={item} onSelect={onSelect} />
        ))}
      </div>
    </div>
  );
}

/**
 * Six-week month grid. Each day's number is a button (arrow keys move between days, Enter adds an
 * event); event chips open the detail drawer; crowded days collapse into a "+N more" popover.
 */
export function MonthView({ matrix, anchor, now, weekStartsOn, byDay, onSelect, onCreate }: MonthViewProps) {
  const grid = useRef<HTMLDivElement>(null);
  const days = matrix.flat();
  const month = anchor.getUTCMonth();
  const todayInView = days.some((day) => isSameDay(day, now));
  const [focusKey, setFocusKey] = useState(() => dayKey(todayInView ? now : days.find((d) => d.getUTCMonth() === month)!));
  const [expanded, setExpanded] = useState<string | null>(null);
  const activeKey = days.some((day) => dayKey(day) === focusKey) ? focusKey : dayKey(days[7]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (!target.dataset.day) return;
    const current = parseDate(target.dataset.day);
    const index = days.findIndex((day) => isSameDay(day, current));
    let next: Date | undefined;
    if (event.key in KEY_STEPS) next = addDays(current, KEY_STEPS[event.key]);
    else if (event.key === 'Home') next = days[index - (index % 7)];
    else if (event.key === 'End') next = days[index - (index % 7) + 6];
    // Copy into a const: TypeScript 4.9 does not keep the narrowing of a `let` inside the callback below.
    const destination = next;
    if (!destination || !days.some((day) => isSameDay(day, destination))) return;
    event.preventDefault();
    const key = dayKey(destination);
    setFocusKey(key);
    grid.current?.querySelector<HTMLElement>(`[data-day="${key}"]`)?.focus();
  };

  return (
    <div className="month-view">
      <div className="month-head" aria-hidden>
        {weekdayLabels(weekStartsOn).map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>
      <div className="month-grid" ref={grid} role="grid" aria-label="Month" onKeyDown={onKeyDown}>
        {matrix.map((week) => (
          <div className="month-row" role="row" key={dayKey(week[0])}>
            {week.map((day) => {
              const key = dayKey(day);
              const items = byDay.get(key) ?? [];
              const hidden = items.length > VISIBLE_CHIPS ? items.length - (VISIBLE_CHIPS - 1) : 0;
              const shown = hidden ? items.slice(0, VISIBLE_CHIPS - 1) : items;
              const today = isSameDay(day, now);
              return (
                <div
                  key={key}
                  role="gridcell"
                  className={cx('month-cell', day.getUTCMonth() !== month && 'outside', today && 'today', items.length > 0 && 'busy')}
                  aria-selected={key === activeKey}
                  onClick={() => (items.length && isCompact() ? setExpanded(key) : onCreate(day))}
                >
                  <button
                    type="button"
                    className="day-number"
                    data-day={key}
                    tabIndex={key === activeKey ? 0 : -1}
                    aria-label={`${formatLongDate(day)}${today ? ', today' : ''}, ${items.length} events. Add an event`}
                    aria-current={today ? 'date' : undefined}
                    onFocus={() => setFocusKey(key)}
                    onClick={(event) => {
                      event.stopPropagation();
                      onCreate(day);
                    }}
                  >
                    <span>{day.getUTCDate()}</span>
                    <Plus className="add-hint" aria-hidden />
                  </button>
                  <div className="month-chips">
                    {shown.map((item) => (
                      <EventChip key={item.key} item={item} onSelect={onSelect} />
                    ))}
                    {hidden > 0 && (
                      <button
                        type="button"
                        className="more-chip"
                        aria-haspopup="dialog"
                        aria-expanded={expanded === key}
                        onClick={(event) => {
                          event.stopPropagation();
                          setExpanded(expanded === key ? null : key);
                        }}
                      >
                        +{hidden} more
                      </button>
                    )}
                  </div>
                  {items.length > 0 && (
                    <span className="mobile-dots" aria-hidden>
                      {items.slice(0, 4).map((item) => (
                        <i key={item.key} className={`kind-${item.event.kind}`} />
                      ))}
                    </span>
                  )}
                  {expanded === key && (
                    <DayPopover
                      day={day}
                      items={items}
                      onSelect={(item) => {
                        setExpanded(null);
                        onSelect(item);
                      }}
                      onClose={() => setExpanded(null)}
                    />
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
