import { Fragment } from 'react';
import { Link } from 'react-router-dom';
import { CalendarClock, CalendarPlus, MapPin, Repeat, Users } from 'lucide-react';
import { cx } from '../../../lib/cx';
import { formatTime, humanize } from '../../../lib/format';
import { agendaTime, nowMarkerIndex } from '../homeLogic';
import type { AgendaItem } from '../types';

/** Today's events as a vertical timeline with a "now" marker between past and upcoming sessions. */
export function AgendaPanel({ items, now }: { items: AgendaItem[]; now: Date }) {
  const marker = nowMarkerIndex(items);
  return (
    <section className="panel home-panel agenda-panel" aria-labelledby="agenda-title">
      <header className="panel-head">
        <h2 id="agenda-title">
          <CalendarClock /> Today
        </h2>
        <Link className="ghost small" to="/planner">
          Planner
        </Link>
      </header>
      {items.length === 0 ? (
        <div className="section-empty">
          <p>
            <b>Nothing scheduled today.</b> A 25-minute block on the calendar makes practice far more likely to happen.
          </p>
          <Link className="secondary small" to="/planner">
            <CalendarPlus /> Plan a session
          </Link>
        </div>
      ) : (
        <ol className="timeline">
          {items.map((item, index) => (
            <Fragment key={`${item.event_id}-${item.starts_at}`}>
              {index === marker && <NowMarker now={now} />}
              <li className={cx('timeline-item', `agenda-${item.kind}`, `status-${item.status}`)}>
                <time className="timeline-time" dateTime={item.starts_at}>
                  {agendaTime(item)}
                </time>
                <span className="timeline-dot" aria-hidden="true" />
                <div className="timeline-card">
                  <div className="timeline-title">
                    <b>{item.title}</b>
                    {item.status === 'now' && <span className="badge ok live-pill">Now</span>}
                  </div>
                  <div className="timeline-meta">
                    <span className={`badge agenda-badge agenda-${item.kind}`}>{humanize(item.kind)}</span>
                    {item.course && (
                      <span className="course-chip">
                        <span className="color-dot" style={{ background: item.course.color }} />
                        {item.course.title}
                      </span>
                    )}
                    {item.location && (
                      <span>
                        <MapPin /> {item.location}
                      </span>
                    )}
                    {item.recurring && (
                      <span title="Repeats">
                        <Repeat />
                        <span className="sr-only">Repeats</span>
                      </span>
                    )}
                    {!item.mine && (
                      <span title="Shared with the workspace">
                        <Users /> Shared
                      </span>
                    )}
                  </div>
                </div>
              </li>
            </Fragment>
          ))}
          {marker === items.length && <NowMarker now={now} />}
        </ol>
      )}
    </section>
  );
}

function NowMarker({ now }: { now: Date }) {
  return (
    <li className="timeline-now" aria-label={`Now, ${formatTime(now)}`}>
      <span>{formatTime(now)}</span>
    </li>
  );
}
