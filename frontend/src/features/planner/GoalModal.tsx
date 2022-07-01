import { useState, type FormEvent } from 'react';
import { Wand2 } from 'lucide-react';
import { useNow } from '../../app/clock';
import { Field } from '../../components/Field';
import { Modal } from '../../components/Modal';
import { ErrorBanner } from '../../components/ui';
import { dayKey } from '../../lib/dates';
import { cx } from '../../lib/cx';
import { goalsApi } from './api';
import {
  ALLOWED_PERIODS,
  GOAL_KIND_META,
  GOAL_KINDS,
  GOAL_TITLE_MAX,
  PERIOD_LABELS,
  emptyGoalForm,
  formFromGoal,
  goalFormToPayload,
  suggestedTitle,
  targetLimits,
  validateGoalForm,
  withKind,
  type GoalFormState,
} from './goalForm';
import type { CourseOption, Goal, GoalKind, GoalPeriod } from './types';

type GoalModalProps = {
  workspaceId: number;
  goal: Goal | null;
  courses: CourseOption[];
  onClose: () => void;
  onSaved: (goal: Goal) => void;
};

/** Create or edit a goal; the fields shown depend on the goal kind. */
export function GoalModal({ workspaceId, goal, courses, onClose, onSaved }: GoalModalProps) {
  const now = useNow();
  const [form, setForm] = useState<GoalFormState>(() => (goal ? formFromGoal(goal) : emptyGoalForm()));
  const [titleTouched, setTitleTouched] = useState(Boolean(goal));
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  // Until the learner types their own title, keep it in step with the chosen kind and target.
  const shown = titleTouched ? form : { ...form, title: suggestedTitle(form, courses) };
  const errors = submitted ? validateGoalForm(shown, now, goal?.due_date ?? null) : {};
  const [low, high] = targetLimits(form.kind, form.period);
  const set = <K extends keyof GoalFormState>(key: K, value: GoalFormState[K]) => setForm((f) => ({ ...f, [key]: value }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (Object.keys(validateGoalForm(shown, now, goal?.due_date ?? null)).length) return;
    setBusy(true);
    setServerError(null);
    try {
      const payload = goalFormToPayload(shown);
      onSaved(goal ? await goalsApi.update(goal.id, payload) : await goalsApi.create(workspaceId, payload));
    } catch (err) {
      setServerError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <Modal
      title={goal ? 'Edit goal' : 'New goal'}
      description="Goals track real activity: answers, reviews, logged minutes and mastery."
      onClose={onClose}
      footer={
        <>
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="goal-form" className="primary" disabled={busy}>
            {busy ? 'Saving…' : goal ? 'Save goal' : 'Create goal'}
          </button>
        </>
      }
    >
      <form id="goal-form" className="stack goal-form" onSubmit={submit} noValidate>
        {serverError && <ErrorBanner message={serverError} />}
        <fieldset className="goal-kind-picker">
          <legend>What do you want to track?</legend>
          {GOAL_KINDS.map((kind: GoalKind) => (
            <label key={kind} className={cx('goal-kind-option', form.kind === kind && 'active')}>
              <input type="radio" name="goal-kind" value={kind} checked={form.kind === kind} onChange={() => setForm((f) => withKind(f, kind))} />
              <b>{GOAL_KIND_META[kind].label}</b>
              <small>{GOAL_KIND_META[kind].help}</small>
            </label>
          ))}
        </fieldset>

        <div className="form-row">
          {ALLOWED_PERIODS[form.kind].length > 1 ? (
            <Field label="Period">
              <select value={form.period} onChange={(e) => setForm((f) => withKind(f, f.kind, e.target.value as GoalPeriod))}>
                {ALLOWED_PERIODS[form.kind].map((period) => (
                  <option key={period} value={period}>
                    {PERIOD_LABELS[period]}
                  </option>
                ))}
              </select>
            </Field>
          ) : (
            <Field label="Period" hint={form.period === 'week' ? 'Weeks start on the day set in your preferences.' : undefined}>
              <input value={PERIOD_LABELS[form.period]} readOnly />
            </Field>
          )}
          <Field label={`Target (${GOAL_KIND_META[form.kind].unit})`} error={errors.target} hint={`${low}–${high}`}>
            <input type="number" inputMode="numeric" min={low} max={high} step={form.kind === 'course_mastery' ? 0.5 : 1} value={form.target} onChange={(e) => set('target', e.target.value)} />
          </Field>
        </div>

        <div className="form-row">
          <Field label="Course" error={errors.courseId} hint={form.kind === 'course_mastery' ? undefined : 'Optional: count only this course.'}>
            <select value={form.courseId} onChange={(e) => set('courseId', e.target.value)}>
              <option value="">{form.kind === 'course_mastery' ? 'Choose a course…' : 'All courses'}</option>
              {courses.map((course) => (
                <option key={course.id} value={course.id}>
                  {course.title}
                </option>
              ))}
            </select>
          </Field>
          {form.period === 'once' && (
            <Field label="Due date" error={errors.dueDate} hint="Optional. Pace is measured against it.">
              <input type="date" min={dayKey(now)} value={form.dueDate} onChange={(e) => set('dueDate', e.target.value)} />
            </Field>
          )}
        </div>

        <Field
          label="Title"
          error={errors.title}
          aside={`${shown.title.trim().length}/${GOAL_TITLE_MAX}`}
          hint={
            titleTouched ? (
              <button type="button" className="plan-link-button" onClick={() => setTitleTouched(false)}>
                <Wand2 aria-hidden /> Use a suggested title
              </button>
            ) : (
              'Suggested from the kind and target; type to replace it.'
            )
          }
        >
          <input
            value={shown.title}
            maxLength={GOAL_TITLE_MAX + 20}
            onChange={(e) => {
              setTitleTouched(true);
              set('title', e.target.value);
            }}
          />
        </Field>
      </form>
    </Modal>
  );
}
