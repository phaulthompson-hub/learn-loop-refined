// Pure study-board logic: URL filters, filtering, swimlanes, due states, optimistic moves and @mentions.
// Nothing here touches React or the network, so it is unit-tested directly (board.test.ts).
import type { Person } from '../../app/types';
import { addDays, dayKey, daysBetween, parseDate, startOfWeek } from '../../lib/dates';
import { formatShortDate, formatWeekday } from '../../lib/format';
import { matchesQuery } from '../../lib/table';
import type { Board, BoardMember, CourseBrief, Label, MoveResult, Task, TaskDetail, TaskPatch, TaskPriority, TaskStatus } from './types';

export const STATUSES: TaskStatus[] = ['backlog', 'todo', 'in_progress', 'review', 'done'];
export const STATUS_LABELS: Record<TaskStatus, string> = {
  backlog: 'Backlog',
  todo: 'To do',
  in_progress: 'In progress',
  review: 'Review',
  done: 'Done',
};
export const PRIORITIES: TaskPriority[] = ['urgent', 'high', 'medium', 'low'];
export const PRIORITY_LABELS: Record<TaskPriority, string> = { urgent: 'Urgent', high: 'High', medium: 'Medium', low: 'Low' };
export const PRIORITY_RANK: Record<TaskPriority, number> = { low: 0, medium: 1, high: 2, urgent: 3 };
/** Mirrors backend STEP in services/ordering.py. */
export const POSITION_STEP = 1024;
/** "Soon" means due within this many days (and not today/overdue). */
export const SOON_DAYS = 3;

// ---------- Filters in the URL ----------

export type DueFilter = 'overdue' | 'today' | 'week' | 'none';
export type AssigneeFilter = number | 'none';
export type BoardFilters = {
  q: string;
  assignees: AssigneeFilter[];
  label: number | null;
  priority: TaskPriority | null;
  course: number | null;
  due: DueFilter | null;
};
export type ViewMode = 'board' | 'list';
export type GroupBy = 'none' | 'assignee' | 'priority';

export const EMPTY_FILTERS: BoardFilters = { q: '', assignees: [], label: null, priority: null, course: null, due: null };
const DUE_FILTERS: DueFilter[] = ['overdue', 'today', 'week', 'none'];
export const DUE_FILTER_LABELS: Record<DueFilter, string> = {
  overdue: 'Overdue',
  today: 'Due today',
  week: 'Due this week',
  none: 'No due date',
};

const positiveInt = (value: string | null): number | null => {
  const parsed = Number(value);
  return value && Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

/** Read filters from the query string, dropping anything malformed (hand-edited URLs must not crash the page). */
export function readFilters(params: URLSearchParams): BoardFilters {
  const assignees = (params.get('assignee') ?? '')
    .split(',')
    .map((part): AssigneeFilter | null => (part === 'none' ? 'none' : positiveInt(part)))
    .filter((value): value is AssigneeFilter => value !== null);
  const priority = params.get('priority') as TaskPriority | null;
  const due = params.get('due') as DueFilter | null;
  return {
    q: (params.get('q') ?? '').slice(0, 100),
    assignees: [...new Set(assignees)],
    label: positiveInt(params.get('label')),
    priority: priority && PRIORITIES.includes(priority) ? priority : null,
    course: positiveInt(params.get('course')),
    due: due && DUE_FILTERS.includes(due) ? due : null,
  };
}

/** Write filters into a copy of `params`, keeping unrelated keys (view, group, task) and omitting empty ones. */
export function writeFilters(params: URLSearchParams, filters: BoardFilters): URLSearchParams {
  const next = new URLSearchParams(params);
  const values: Record<string, string> = {
    q: filters.q.trim() ? filters.q : '',
    assignee: filters.assignees.join(','),
    label: filters.label ? String(filters.label) : '',
    priority: filters.priority ?? '',
    course: filters.course ? String(filters.course) : '',
    due: filters.due ?? '',
  };
  for (const [key, value] of Object.entries(values)) {
    if (value) next.set(key, value);
    else next.delete(key);
  }
  return next;
}

export function activeFilterCount(filters: BoardFilters): number {
  return [filters.q.trim(), filters.assignees.length, filters.label, filters.priority, filters.course, filters.due].filter(Boolean).length;
}

export function toggleAssignee(filters: BoardFilters, value: AssigneeFilter): BoardFilters {
  const has = filters.assignees.includes(value);
  return { ...filters, assignees: has ? filters.assignees.filter((a) => a !== value) : [...filters.assignees, value] };
}

// ---------- Due dates ----------

export type DueStatus = 'none' | 'done' | 'overdue' | 'today' | 'soon' | 'later';

/** Same rules as backend `due_state`: a finished task is never overdue. */
export function dueStatus(due: string | null, status: TaskStatus, now: Date): DueStatus {
  if (!due) return 'none';
  if (status === 'done') return 'done';
  const diff = daysBetween(now, parseDate(due));
  if (diff < 0) return 'overdue';
  if (diff === 0) return 'today';
  return diff <= SOON_DAYS ? 'soon' : 'later';
}

/** Short badge text: "2 days overdue", "Due today", "Tomorrow", "Fri 18 Mar", "18 Apr". */
export function dueLabel(due: string, status: TaskStatus, now: Date): string {
  const diff = daysBetween(now, parseDate(due));
  const state = dueStatus(due, status, now);
  if (state === 'overdue') return diff === -1 ? '1 day overdue' : `${-diff} days overdue`;
  if (state === 'today') return 'Due today';
  if (diff === 1 && state !== 'done') return 'Tomorrow';
  return Math.abs(diff) < 7 ? formatWeekday(due) : formatShortDate(due);
}

