import { useState, type FormEvent } from 'react';
import { AlertTriangle, Info, Repeat } from 'lucide-react';
import { Field, Switch } from '../../components/Field';
import { Modal } from '../../components/Modal';
import { ErrorBanner } from '../../components/ui';
import { parseDate } from '../../lib/dates';
import { cx } from '../../lib/cx';
import { formatDuration, formatWeekday, plural } from '../../lib/format';
import { plannerApi } from './api';
import { KIND_LABELS, KINDS, RECURRENCE_LABELS, recurrencePreview, timeLabel } from './calendar';
import {
  ANNOUNCED_KINDS,
  LOCATION_MAX,
  NOTES_MAX,
  TITLE_MAX,
  allDaySpan,
  durationMinutes,
  formFromEvent,
  formToPayload,
  validateEventForm,
  type EventFormState,
} from './eventForm';
import { KindDot } from './EventBits';
import type { CourseOption, EventSaved, PlannerEvent, Recurrence } from './types';

export type EventModalTarget = { mode: 'create'; form: EventFormState } | { mode: 'edit'; event: PlannerEvent };

type EventModalProps = {
  workspaceId: number;
  target: EventModalTarget;
  courses: CourseOption[];
  /** Instructors and above may share exams and live sessions (which notify the workspace). */
  canAnnounce: boolean;
  onClose: () => void;
  onSaved: (saved: EventSaved) => void;
};

const RECURRENCES: Recurrence[] = ['none', 'daily', 'weekdays', 'weekly'];

function ConflictList({ saved }: { saved: EventSaved }) {
  return (
    <div className="conflict-box" role="status">
      <p>
        <AlertTriangle aria-hidden />
        <b>{saved.event.title}</b> overlaps {plural(saved.conflicts.length, 'other event')} in the next two months.
      </p>
      <ul>
        {saved.conflicts.map((c) => (
          <li key={`${c.event_id}:${c.index}`}>
            <KindDot kind={c.kind} />
            <span>{c.title}</span>
            <small>
              {formatWeekday(c.starts_at)} · {timeLabel({ starts_at: c.starts_at, ends_at: c.ends_at, event: { all_day: false } })}
            </small>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Create or edit an event. After saving, overlaps reported by the API are shown before closing. */
export function EventModal({ workspaceId, target, courses, canAnnounce, onClose, onSaved }: EventModalProps) {
  const [editing, setEditing] = useState<PlannerEvent | null>(target.mode === 'edit' ? target.event : null);
  const [form, setForm] = useState<EventFormState>(target.mode === 'edit' ? formFromEvent(target.event) : target.form);
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [overlaps, setOverlaps] = useState<EventSaved | null>(null);

  const errors = submitted ? validateEventForm(form, { canAnnounce }) : {};
  const set = <K extends keyof EventFormState>(key: K, value: EventFormState[K]) => setForm((f) => ({ ...f, [key]: value }));
  const minutes = durationMinutes(form);
  const preview = form.recurrence === 'none' ? [] : recurrencePreview(parseDate(form.date), form.recurrence, form.until || null, 4);
  const announceLocked = ANNOUNCED_KINDS.includes(form.kind) && !canAnnounce;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (Object.keys(validateEventForm(form, { canAnnounce })).length) return;
    setBusy(true);
    setServerError(null);
    try {
      const payload = formToPayload(form);
      const saved = editing ? await plannerApi.update(editing.id, payload) : await plannerApi.create(workspaceId, payload);
      onSaved(saved);
      if (saved.conflicts.length) {
        setEditing(saved.event);
        setOverlaps(saved);
      } else {
        onClose();
      }
    } catch (err) {
      setServerError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (overlaps) {
    return (
      <Modal
        title="Saved, with overlaps"
        description="Your calendar allows double-booking, but you may want to move one of these."
        onClose={onClose}
        footer={
          <>
            <button type="button" className="secondary" onClick={() => setOverlaps(null)}>
              Adjust the time
            </button>
            <button type="button" className="primary" onClick={onClose} data-autofocus>
              Keep it
            </button>
          </>
        }
      >
        <ConflictList saved={overlaps} />
      </Modal>
    );
  }

  return (
    <Modal
      title={editing ? 'Edit event' : 'New event'}
      description={editing ? undefined : 'Block time for study, reviews, exams or live sessions.'}
      onClose={onClose}
      size="lg"
      footer={
        <>
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="event-form" className="primary" disabled={busy}>
            {busy ? 'Saving…' : editing ? 'Save changes' : 'Create event'}
          </button>
        </>
      }
    >
      <form id="event-form" className="stack event-form" onSubmit={submit} noValidate>
        {serverError && <ErrorBanner message={serverError} />}
        {editing && editing.recurrence !== 'none' && (
          <p className="series-note">
            <Repeat aria-hidden /> This event repeats. Changes apply to <b>every occurrence</b> in the series.
          </p>
        )}
        <Field label="Title" error={errors.title} aside={`${form.title.trim().length}/${TITLE_MAX}`}>
          <input data-autofocus value={form.title} maxLength={TITLE_MAX + 20} placeholder="e.g. Gradient descent practice" onChange={(e) => set('title', e.target.value)} />
        </Field>

        <fieldset className="kind-picker">
          <legend>Type</legend>
          {KINDS.map((kind) => (
            <label key={kind} className={cx('kind-option', `kind-${kind}`, form.kind === kind && 'active')}>
              <input type="radio" name="event-kind" value={kind} checked={form.kind === kind} onChange={() => set('kind', kind)} />
              <KindDot kind={kind} />
              {KIND_LABELS[kind]}
            </label>
          ))}
        </fieldset>

        <div className="form-row">
          <Field label="Course">
            <select value={form.courseId} onChange={(e) => set('courseId', e.target.value)}>
              <option value="">No course</option>
              {courses.map((course) => (
                <option key={course.id} value={course.id}>
                  {course.title}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Location" error={errors.location}>
            <input value={form.location} maxLength={LOCATION_MAX + 20} placeholder="Room, link or place" onChange={(e) => set('location', e.target.value)} />
          </Field>
        </div>

        <Switch checked={form.allDay} onChange={(value) => set('allDay', value)} label="All day" description="Deadlines and exam days that do not block specific hours." />

        {form.allDay ? (
          <div className="form-row">
            <Field label="First day">
              <input type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value, endDate: f.endDate < e.target.value ? e.target.value : f.endDate }))} />
            </Field>
            <Field label="Last day" error={errors.endDate} hint={allDaySpan(form) > 1 ? `${allDaySpan(form)} days` : undefined}>
              <input type="date" value={form.endDate} min={form.date} onChange={(e) => set('endDate', e.target.value)} />
            </Field>
          </div>
        ) : (
          <div className="form-row">
            <Field label="Date">
              <input type="date" value={form.date} onChange={(e) => set('date', e.target.value)} />
            </Field>
            <Field label="Starts">
              <input type="time" step={300} value={form.startTime} onChange={(e) => set('startTime', e.target.value)} />
            </Field>
            <Field label="Ends" error={errors.endTime} hint={minutes && minutes > 0 ? formatDuration(minutes) : undefined}>
              <input type="time" step={300} value={form.endTime} onChange={(e) => set('endTime', e.target.value)} />
            </Field>
          </div>
        )}

        <div className="form-row">
          <Field label="Repeats" error={errors.recurrence}>
            <select value={form.recurrence} onChange={(e) => set('recurrence', e.target.value as Recurrence)}>
              {RECURRENCES.map((r) => (
                <option key={r} value={r}>
                  {RECURRENCE_LABELS[r]}
                </option>
              ))}
            </select>
          </Field>
          {form.recurrence !== 'none' && (
            <Field label="Until" error={errors.until} hint="Leave empty to repeat without an end date.">
              <input type="date" value={form.until} min={form.date} onChange={(e) => set('until', e.target.value)} />
            </Field>
          )}
        </div>
        {preview.length > 0 && !errors.recurrence && (
          <p className="recurrence-preview">
            <Info aria-hidden />
            Next: {preview.map((day) => formatWeekday(day)).join(', ')}
            {preview.length === 4 ? '…' : ''}
          </p>
        )}

        <Field label="Notes" error={errors.notes} aside={`${form.notes.length}/${NOTES_MAX}`}>
          <textarea rows={3} value={form.notes} placeholder="Agenda, materials to bring, links…" onChange={(e) => set('notes', e.target.value)} />
        </Field>

        <div>
          <Switch
            checked={form.shared}
            onChange={(value) => set('shared', value)}
            label="Share with the workspace"
            description={
              announceLocked
                ? 'Only instructors can share exams and live sessions, because members get notified.'
                : ANNOUNCED_KINDS.includes(form.kind)
                  ? 'Everyone in the workspace sees it and gets a notification.'
                  : 'Everyone in the workspace sees it on their planner.'
            }
          />
          {errors.shared && <small className="field-error">{errors.shared}</small>}
        </div>
      </form>
    </Modal>
  );
}
