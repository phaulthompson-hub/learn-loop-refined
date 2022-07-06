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

export function matchesDue(task: Pick<Task, 'due_date' | 'status'>, filter: DueFilter, now: Date): boolean {
  if (filter === 'none') return task.due_date === null;
  if (!task.due_date) return false;
  const state = dueStatus(task.due_date, task.status, now);
  if (filter === 'overdue') return state === 'overdue';
  if (filter === 'today') return dayKey(task.due_date) === dayKey(now);
  const monday = startOfWeek(now);
  const due = parseDate(task.due_date);
  return task.status !== 'done' && due >= monday && due < addDays(monday, 7);
}

// ---------- Filtering, ordering, lanes ----------

export function filterTasks(tasks: readonly Task[], filters: BoardFilters, now: Date): Task[] {
  return tasks.filter((task) => {
    if (filters.assignees.length) {
      const key: AssigneeFilter = task.assignee ? task.assignee.id : 'none';
      if (!filters.assignees.includes(key)) return false;
    }
    if (filters.label && !task.labels.some((label) => label.id === filters.label)) return false;
    if (filters.priority && task.priority !== filters.priority) return false;
    if (filters.course && task.course?.id !== filters.course) return false;
    if (filters.due && !matchesDue(task, filters.due, now)) return false;
    return matchesQuery(filters.q, task.key, task.title, task.description, task.labels.map((l) => l.name).join(' '));
  });
}

export const byPosition = (a: Task, b: Task) => a.position - b.position || a.id - b.id;

export function columnTasks(tasks: readonly Task[], status: TaskStatus): Task[] {
  return tasks.filter((task) => task.status === status).sort(byPosition);
}

export function columnStats(tasks: readonly Task[]): { count: number; points: number } {
  return { count: tasks.length, points: tasks.reduce((sum, task) => sum + (task.estimate ?? 0), 0) };
}

export type WipState = 'none' | 'ok' | 'full' | 'over';

export function wipState(count: number, limit: number | null): WipState {
  if (limit === null) return 'none';
  if (count > limit) return 'over';
  return count === limit ? 'full' : 'ok';
}

export type Swimlane = { key: string; title: string; person?: Person; priority?: TaskPriority; tasks: Task[] };

export function laneKey(task: Task, groupBy: GroupBy): string {
  if (groupBy === 'assignee') return task.assignee ? `assignee:${task.assignee.id}` : 'assignee:none';
  if (groupBy === 'priority') return `priority:${task.priority}`;
  return 'all';
}

/**
 * Split tasks into horizontal lanes. Assignee lanes follow the member list (people with no visible
 * tasks are skipped) with "Unassigned" last; priority lanes always show urgent → low.
 */
export function buildSwimlanes(tasks: readonly Task[], groupBy: GroupBy, members: readonly BoardMember[]): Swimlane[] {
  if (groupBy === 'none') return [{ key: 'all', title: 'All tasks', tasks: [...tasks] }];
  if (groupBy === 'priority') {
    return PRIORITIES.map((priority) => ({
      key: `priority:${priority}`,
      title: PRIORITY_LABELS[priority],
      priority,
      tasks: tasks.filter((task) => task.priority === priority),
    }));
  }
  const people = new Map<number, Person>(members.map((m) => [m.id, m]));
  tasks.forEach((task) => task.assignee && !people.has(task.assignee.id) && people.set(task.assignee.id, task.assignee));
  const lanes: Swimlane[] = [...people.values()]
    .map((person) => ({
      key: `assignee:${person.id}`,
      title: person.name,
      person,
      tasks: tasks.filter((task) => task.assignee?.id === person.id),
    }))
    .filter((lane) => lane.tasks.length > 0);
  lanes.push({ key: 'assignee:none', title: 'Unassigned', tasks: tasks.filter((task) => !task.assignee) });
  return lanes;
}

/** The field change implied by dropping a card into another lane ("assignee:3" → assign to member 3). */
export function laneChange(key: string): TaskPatch {
  const [kind, value] = key.split(':');
  if (kind === 'assignee') return { assignee_id: value === 'none' ? null : Number(value) };
  if (kind === 'priority') return { priority: value as TaskPriority };
  return {};
}

export type PatchLookups = { members: readonly BoardMember[]; courses: readonly CourseBrief[]; labels: readonly Label[] };

/**
 * Apply a PATCH body to a task locally (for optimistic UI), resolving ids to the embedded objects
 * the API would return. Server-owned fields (completed_at, updated_at) are left for the response.
 */
export function applyPatch<T extends Task>(task: T, patch: TaskPatch, lookups: PatchLookups): T {
  const next: T = { ...task };
  if (patch.title !== undefined) next.title = patch.title.trim();
  if (patch.description !== undefined) next.description = patch.description;
  if (patch.status !== undefined) next.status = patch.status;
  if (patch.priority !== undefined) next.priority = patch.priority;
  if (patch.due_date !== undefined) next.due_date = patch.due_date;
  if (patch.estimate !== undefined) next.estimate = patch.estimate;
  if (patch.assignee_id !== undefined) {
    const member = lookups.members.find((m) => m.id === patch.assignee_id);
    next.assignee = member ? { id: member.id, name: member.name, email: member.email, avatar_color: member.avatar_color } : null;
  }
  if (patch.course_id !== undefined) next.course = lookups.courses.find((c) => c.id === patch.course_id) ?? null;
  if (patch.label_ids !== undefined) {
    next.labels = lookups.labels.filter((l) => patch.label_ids!.includes(l.id)).sort((a, b) => a.name.localeCompare(b.name));
  }
  return next;
}

export function laneMatches(task: Task, key: string, groupBy: GroupBy): boolean {
  return groupBy === 'none' || laneKey(task, groupBy) === key;
}

// ---------- Moves ----------

