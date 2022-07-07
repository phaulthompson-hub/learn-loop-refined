// Task form rules, mirroring backend/app/schemas/board.py so users see problems before submitting.
import type { TaskInput, TaskPriority, TaskStatus } from './types';

export const TITLE_MIN = 2;
export const TITLE_MAX = 200;
export const DESCRIPTION_MAX = 5000;
export const ESTIMATE_MAX = 100;
export const CHECKLIST_MAX_ITEMS = 30;
export const CHECKLIST_TEXT_MAX = 200;
export const LABEL_NAME_MAX = 40;
export const COMMENT_MAX = 4000;

/** What the new-task form holds: text inputs keep raw strings until submit. */
export type TaskFormValues = {
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  assigneeId: string;
  courseId: string;
  dueDate: string;
  estimate: string;
  labelIds: number[];
  checklist: string;
};

export type TaskFormErrors = Partial<Record<'title' | 'description' | 'dueDate' | 'estimate' | 'checklist', string>>;

export function validateTitle(title: string): string | undefined {
  const length = title.trim().length;
  if (length < TITLE_MIN) return `Give the task a title of at least ${TITLE_MIN} characters.`;
  if (length > TITLE_MAX) return `Keep the title under ${TITLE_MAX} characters.`;
  return undefined;
}

export function validateEstimate(raw: string): string | undefined {
  if (!raw.trim()) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > ESTIMATE_MAX) return `Use a whole number of points from 0 to ${ESTIMATE_MAX}.`;
  return undefined;
}

export function validateDueDate(raw: string): string | undefined {
  if (!raw) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return 'Pick a date from the calendar.';
  const parsed = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== raw) return 'That date does not exist.';
  return undefined;
}

/** Checklist textarea: one item per non-blank line. */
export function checklistLines(raw: string): string[] {
  return raw
    .split('\n')
    .map((line) => line.replace(/^\s*(?:[-*]\s*)?(?:\[\s?\]\s*)?/, '').trim())
    .filter(Boolean);
}

export function validateChecklist(raw: string): string | undefined {
  const lines = checklistLines(raw);
  if (lines.length > CHECKLIST_MAX_ITEMS) return `Add at most ${CHECKLIST_MAX_ITEMS} checklist items here; you can add more later.`;
  const long = lines.findIndex((line) => line.length > CHECKLIST_TEXT_MAX);
  if (long !== -1) return `Item ${long + 1} is longer than ${CHECKLIST_TEXT_MAX} characters.`;
  return undefined;
}

export function validateTaskForm(values: TaskFormValues): TaskFormErrors {
  const errors: TaskFormErrors = {
    title: validateTitle(values.title),
    description: values.description.length > DESCRIPTION_MAX ? `Keep the description under ${DESCRIPTION_MAX} characters.` : undefined,
    dueDate: validateDueDate(values.dueDate),
    estimate: validateEstimate(values.estimate),
    checklist: validateChecklist(values.checklist),
  };
  return Object.fromEntries(Object.entries(errors).filter(([, message]) => message)) as TaskFormErrors;
}

export function toTaskInput(values: TaskFormValues): TaskInput {
  return {
    title: values.title.trim(),
    description: values.description.trim(),
    status: values.status,
    priority: values.priority,
    assignee_id: values.assigneeId ? Number(values.assigneeId) : null,
    course_id: values.courseId ? Number(values.courseId) : null,
    due_date: values.dueDate || null,
    estimate: values.estimate.trim() ? Number(values.estimate) : null,
    label_ids: values.labelIds,
    checklist: checklistLines(values.checklist),
  };
}

/** Label names are unique per workspace, ignoring case (the API answers 409 otherwise). */
export function validateLabelName(name: string, existing: readonly { name: string }[]): string | undefined {
  const trimmed = name.trim();
  if (!trimmed) return 'Name the label.';
  if (trimmed.length > LABEL_NAME_MAX) return `Keep label names under ${LABEL_NAME_MAX} characters.`;
  if (existing.some((label) => label.name.toLowerCase() === trimmed.toLowerCase())) return 'A label with this name already exists.';
  return undefined;
}
