import { useState } from 'react';
import { AlertTriangle, BookOpen, CalendarClock, MapPin, Pencil, Repeat, Trash2, Users } from 'lucide-react';
import { useToast } from '../../app/toast';
import { Avatar } from '../../components/Avatar';
import { ConfirmDialog, Modal } from '../../components/Modal';
import { useLoader } from '../../hooks/useLoader';
import { formatLongDate, formatWeekday } from '../../lib/format';
import { plannerApi } from './api';
import { describeRecurrence, timeLabel } from './calendar';
import { KindBadge, KindDot } from './EventBits';
import type { Occurrence, PlannerEvent } from './types';

type EventDrawerProps = {
  item: Occurrence;
  onClose: () => void;
  onEdit: (event: PlannerEvent) => void;
  onDeleted: () => void;
};

function Conflicts({ event }: { event: PlannerEvent }) {
  const { data, loading } = useLoader(() => plannerApi.conflicts(event.id), `conflicts:${event.id}:${event.starts_at}:${event.ends_at}`);
  if (loading || !data?.length) return null;
  return (
    <section className="event-drawer-section">
      <h3>
        <AlertTriangle aria-hidden /> Overlaps
      </h3>
      <ul className="drawer-conflicts">
        {data.map((c) => (
          <li key={`${c.event_id}:${c.index}`}>
            <KindDot kind={c.kind} />
            <span>{c.title}</span>
            <small>
              {formatWeekday(c.starts_at)} · {timeLabel({ ...c, event: { all_day: false } })}
            </small>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Details of one occurrence, with edit and delete for people allowed to change the event. */
export function EventDrawer({ item, onClose, onEdit, onDeleted }: EventDrawerProps) {
  const { event } = item;
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const repeating = event.recurrence !== 'none';

  const remove = async () => {
    setBusy(true);
    try {
      await plannerApi.remove(event.id);
      toast.success(repeating ? `Deleted the series “${event.title}”` : `Deleted “${event.title}”`);
      onDeleted();
    } catch (err) {
      toast.error((err as Error).message);
      setBusy(false);
      setConfirming(false);
    }
  };

  // The confirmation replaces the drawer, so Escape closes one layer at a time.
  if (confirming) {
    return (
      <ConfirmDialog
        title={repeating ? 'Delete the whole series?' : 'Delete this event?'}
        message={
          repeating
            ? `“${event.title}” repeats. Deleting it removes every past and future occurrence${event.shared ? ' for everyone in the workspace' : ''}.`
            : `“${event.title}” will be removed${event.shared ? ' from everyone’s planner' : ''}.`
        }
        confirmLabel={repeating ? 'Delete series' : 'Delete event'}
        busy={busy}
        onConfirm={remove}
        onCancel={() => setConfirming(false)}
      />
    );
  }

  return (
    <Modal
      variant="drawer"
      title={event.title}
      description={<KindBadge kind={event.kind} />}
      onClose={onClose}
      footer={
        event.can_edit ? (
          <>
            <button type="button" className="danger" onClick={() => setConfirming(true)}>
              <Trash2 aria-hidden /> {repeating ? 'Delete series' : 'Delete'}
            </button>
            <span className="spacer" />
            <button type="button" className="primary" onClick={() => onEdit(event)} data-autofocus>
              <Pencil aria-hidden /> {repeating ? 'Edit series' : 'Edit'}
            </button>
          </>
        ) : (
          <span className="muted drawer-readonly">Only {event.owner.name} or a workspace admin can change this event.</span>
        )
      }
    >
      <dl className="event-facts">
        <div>
          <dt>
            <CalendarClock aria-label="When" />
          </dt>
          <dd>
            <b>{formatLongDate(item.starts_at)}</b>
            <span>{timeLabel(item)}</span>
          </dd>
        </div>
        {repeating && (
          <div>
            <dt>
              <Repeat aria-label="Repeats" />
            </dt>
            <dd>
              <b>{describeRecurrence(event.recurrence, event.starts_at, event.recurrence_until)}</b>
              <span>Occurrence {item.index + 1} of the series · edits apply to every occurrence</span>
            </dd>
          </div>
        )}
        {event.course && (
          <div>
            <dt>
              <BookOpen aria-label="Course" />
            </dt>
            <dd>
              <span className="course-pill">
                <span className="color-dot" style={{ background: event.course.color }} />
                {event.course.title}
              </span>
            </dd>
          </div>
        )}
        {event.location && (
          <div>
            <dt>
              <MapPin aria-label="Location" />
            </dt>
            <dd>{event.location}</dd>
          </div>
        )}
        <div>
          <dt>
            <Users aria-label="Visibility" />
          </dt>
          <dd>
            <span className="organiser">
              <Avatar name={event.owner.name} color={event.owner.avatar_color} size="xs" />
              {event.owner.name}
            </span>
            <span>{event.shared ? 'Shared with the whole workspace' : 'Private to the organiser'}</span>
          </dd>
        </div>
      </dl>
      {event.notes && (
        <section className="event-drawer-section">
          <h3>Notes</h3>
          <p className="event-notes">{event.notes}</p>
        </section>
      )}
      {!event.all_day && <Conflicts event={event} />}
    </Modal>
  );
}
