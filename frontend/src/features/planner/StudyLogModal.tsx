import { useState, type FormEvent } from 'react';
import { Field } from '../../components/Field';
import { Modal } from '../../components/Modal';
import { ErrorBanner } from '../../components/ui';
import { dayKey } from '../../lib/dates';
import { formatDuration } from '../../lib/format';
import { goalsApi } from './api';
import { ACTIVITY_LABELS, MAX_LOG_MINUTES, NOTE_MAX, emptyStudyLog, studyLogToPayload, validateStudyLog, type StudyLogFormState } from './goalForm';
import type { CourseOption, StudyActivity, StudyLog } from './types';

const QUICK_MINUTES = [15, 25, 45, 60, 90];

type StudyLogModalProps = {
  workspaceId: number;
  courses: CourseOption[];
  now: Date;
  /** Minutes already logged per `YYYY-MM-DD`, so the 24-hour cap is checked before submitting. */
  minutesByDay: Map<string, number>;
  onClose: () => void;
  onSaved: (log: StudyLog) => void;
};

export function StudyLogModal({ workspaceId, courses, now, minutesByDay, onClose, onSaved }: StudyLogModalProps) {
  const [form, setForm] = useState<StudyLogFormState>(() => emptyStudyLog(now));
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const already = minutesByDay.get(form.date) ?? 0;
  const errors = submitted ? validateStudyLog(form, now, already) : {};
  const set = <K extends keyof StudyLogFormState>(key: K, value: StudyLogFormState[K]) => setForm((f) => ({ ...f, [key]: value }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (Object.keys(validateStudyLog(form, now, already)).length) return;
    setBusy(true);
    setServerError(null);
    try {
      onSaved(await goalsApi.logTime(workspaceId, studyLogToPayload(form)));
    } catch (err) {
      setServerError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Log study time"
      description="Time spent reading, practising or revising away from the quiz and card screens."
      onClose={onClose}
      size="sm"
      footer={
        <>
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="study-log-form" className="primary" disabled={busy}>
            {busy ? 'Saving…' : 'Log time'}
          </button>
        </>
      }
    >
      <form id="study-log-form" className="stack" onSubmit={submit} noValidate>
        {serverError && <ErrorBanner message={serverError} />}
        <Field label="Minutes" error={errors.minutes} hint={already ? `${formatDuration(already)} already logged that day.` : `Up to ${MAX_LOG_MINUTES} per entry.`}>
          <input data-autofocus type="number" inputMode="numeric" min={1} max={MAX_LOG_MINUTES} value={form.minutes} onChange={(e) => set('minutes', e.target.value)} />
        </Field>
        <div className="quick-minutes" role="group" aria-label="Quick durations">
          {QUICK_MINUTES.map((minutes) => (
            <button key={minutes} type="button" className="ghost small" aria-pressed={form.minutes === String(minutes)} onClick={() => set('minutes', String(minutes))}>
              {formatDuration(minutes)}
            </button>
          ))}
        </div>
        <div className="form-row">
          <Field label="Date" error={errors.date}>
            <input type="date" max={dayKey(now)} value={form.date} onChange={(e) => set('date', e.target.value)} />
          </Field>
          <Field label="Finished at" error={errors.time}>
            <input type="time" value={form.time} onChange={(e) => set('time', e.target.value)} />
          </Field>
        </div>
        <div className="form-row">
          <Field label="Activity">
            <select value={form.activity} onChange={(e) => set('activity', e.target.value as StudyActivity)}>
              {(Object.keys(ACTIVITY_LABELS) as StudyActivity[]).map((activity) => (
                <option key={activity} value={activity}>
                  {ACTIVITY_LABELS[activity]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Course">
            <select value={form.courseId} onChange={(e) => set('courseId', e.target.value)}>
              <option value="">General study</option>
              {courses.map((course) => (
                <option key={course.id} value={course.id}>
                  {course.title}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Note" error={errors.note} aside={`${form.note.length}/${NOTE_MAX}`}>
          <input value={form.note} placeholder="What did you work on?" onChange={(e) => set('note', e.target.value)} />
        </Field>
      </form>
    </Modal>
  );
}
