import { useState, type FormEvent } from 'react';
import { Check } from 'lucide-react';
import { Field } from '../../components/Field';
import { Modal } from '../../components/Modal';
import { ErrorBanner } from '../../components/ui';
import { cx } from '../../lib/cx';
import { boardApi } from './api';
import { PRIORITIES, PRIORITY_LABELS, STATUS_LABELS, STATUSES } from './board';
import {
  checklistLines,
  DESCRIPTION_MAX,
  ESTIMATE_MAX,
  TITLE_MAX,
  toTaskInput,
  validateTaskForm,
  type TaskFormErrors,
  type TaskFormValues,
} from './validation';
import type { BoardMember, CourseBrief, Label, TaskDetail, TaskStatus } from './types';

type NewTaskModalProps = {
  workspaceId: number;
  members: BoardMember[];
  labels: Label[];
  courses: CourseBrief[];
  initialStatus: TaskStatus;
  onClose: () => void;
  onCreated: (task: TaskDetail) => void;
};

export function NewTaskModal({ workspaceId, members, labels, courses, initialStatus, onClose, onCreated }: NewTaskModalProps) {
  const [values, setValues] = useState<TaskFormValues>({
    title: '',
    description: '',
    status: initialStatus,
    priority: 'medium',
    assigneeId: '',
    courseId: '',
    dueDate: '',
    estimate: '',
    labelIds: [],
    checklist: '',
  });
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  // Validate live only after the first submit attempt, so the form is not red while typing.
  const errors: TaskFormErrors = submitted ? validateTaskForm(values) : {};
  const set = <K extends keyof TaskFormValues>(key: K, value: TaskFormValues[K]) => setValues((v) => ({ ...v, [key]: value }));
  const toggleLabel = (id: number) =>
    set('labelIds', values.labelIds.includes(id) ? values.labelIds.filter((l) => l !== id) : [...values.labelIds, id]);
  const checklistCount = checklistLines(values.checklist).length;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (Object.keys(validateTaskForm(values)).length) return;
    setBusy(true);
    setServerError(null);
    try {
      onCreated(await boardApi.create(workspaceId, toTaskInput(values)));
    } catch (err) {
      setServerError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <Modal
      title="New study task"
      description="Plan a piece of study work and put it on the board."
      onClose={onClose}
      size="lg"
      footer={
        <>
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="new-task-form" className="primary" disabled={busy}>
            {busy ? 'Creating…' : 'Create task'}
          </button>
        </>
      }
    >
      <form id="new-task-form" className="stack new-task-form" onSubmit={submit} noValidate>
        {serverError && <ErrorBanner message={serverError} />}
        <Field label="Title" error={errors.title} aside={`${values.title.trim().length}/${TITLE_MAX}`}>
          <input
            data-autofocus
            value={values.title}
            maxLength={TITLE_MAX + 20}
            placeholder="e.g. Finish gradient descent exercises"
            onChange={(event) => set('title', event.target.value)}
          />
        </Field>
        <Field label="Description" error={errors.description} hint="Supports **bold**, *italic*, `code` and - lists." aside={`${values.description.length}/${DESCRIPTION_MAX}`}>
          <textarea rows={4} value={values.description} onChange={(event) => set('description', event.target.value)} />
        </Field>
        <div className="form-row">
          <Field label="Status">
            <select value={values.status} onChange={(event) => set('status', event.target.value as TaskStatus)}>
              {STATUSES.map((status) => (
                <option key={status} value={status}>
                  {STATUS_LABELS[status]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Priority">
            <select value={values.priority} onChange={(event) => set('priority', event.target.value as TaskFormValues['priority'])}>
              {PRIORITIES.map((priority) => (
                <option key={priority} value={priority}>
                  {PRIORITY_LABELS[priority]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Assignee">
            <select value={values.assigneeId} onChange={(event) => set('assigneeId', event.target.value)}>
              <option value="">Unassigned</option>
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="form-row">
          <Field label="Course">
            <select value={values.courseId} onChange={(event) => set('courseId', event.target.value)}>
              <option value="">No course</option>
              {courses.map((course) => (
                <option key={course.id} value={course.id}>
                  {course.title}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Due date" error={errors.dueDate}>
            <input type="date" value={values.dueDate} onChange={(event) => set('dueDate', event.target.value)} />
          </Field>
          <Field label="Estimate" error={errors.estimate} hint="Story points">
            <input type="number" inputMode="numeric" min={0} max={ESTIMATE_MAX} step={1} value={values.estimate} onChange={(event) => set('estimate', event.target.value)} />
          </Field>
        </div>
        {labels.length > 0 && (
          <fieldset className="label-fieldset">
            <legend>Labels</legend>
            <div className="label-options">
              {labels.map((label) => {
                const on = values.labelIds.includes(label.id);
                return (
                  <button
                    key={label.id}
                    type="button"
                    className={cx('label-option', on && 'active')}
                    style={{ '--label': label.color } as React.CSSProperties}
                    aria-pressed={on}
                    onClick={() => toggleLabel(label.id)}
                  >
                    {on && <Check aria-hidden />}
                    {label.name}
                  </button>
                );
              })}
            </div>
          </fieldset>
        )}
        <Field label="Checklist" error={errors.checklist} hint="One item per line." aside={checklistCount ? `${checklistCount} items` : undefined}>
          <textarea rows={3} value={values.checklist} placeholder={'Read the chapter\nDo the exercises'} onChange={(event) => set('checklist', event.target.value)} />
        </Field>
      </form>
    </Modal>
  );
}
