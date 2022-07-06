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

/** Same midpoint rule as backend `position_between`. */
export function positionBetween(upper: number | null, lower: number | null): number {
  if (upper === null && lower === null) return POSITION_STEP;
  if (upper === null) return lower! > POSITION_STEP ? lower! - POSITION_STEP : lower! / 2;
  if (lower === null) return upper + POSITION_STEP;
  return (upper + lower) / 2;
}

/** Convert a drop-indicator index (counted over the list *as displayed*, dragged card included) to a final index. */
export function dropToFinalIndex(visibleIds: readonly number[], taskId: number, dropIndex: number): number {
  const current = visibleIds.indexOf(taskId);
  return current !== -1 && current < dropIndex ? dropIndex - 1 : dropIndex;
}

export type MoveTarget = { status: TaskStatus; after_id: number | null; before_id: number | null };
export type PlannedMove = { tasks: Task[]; target: MoveTarget };

/**
 * Plan an optimistic move of `taskId` to `finalIndex` within `visible` (the cards shown in the target
 * cell, which may be filtered or one swimlane of the column). Neighbours come from what the user saw;
 * the provisional position is computed against the full column, exactly as the server will.
 * Returns null when nothing would change.
 */
export function planMove(tasks: readonly Task[], taskId: number, status: TaskStatus, visible: readonly Task[], finalIndex: number): PlannedMove | null {
  const moving = tasks.find((task) => task.id === taskId);
  if (!moving) return null;
  const others = visible.filter((task) => task.id !== taskId);
  const index = Math.max(0, Math.min(finalIndex, others.length));
  const after = index > 0 ? others[index - 1] : null;
  const before = index < others.length ? others[index] : null;

  const column = columnTasks(tasks, status).filter((task) => task.id !== taskId);
  const slot = after ? column.indexOf(after) + 1 : before ? column.indexOf(before) : column.length;
  const upper = slot > 0 ? column[slot - 1].position : null;
  const lower = slot < column.length ? column[slot].position : null;

  const original = columnTasks(tasks, moving.status);
  const originalIndex = original.findIndex((task) => task.id === taskId);
  const unchanged = moving.status === status && original[originalIndex - 1]?.id === column[slot - 1]?.id && original[originalIndex + 1]?.id === column[slot]?.id;
  if (unchanged) return null;

  const moved: Task = { ...moving, status, position: positionBetween(upper, lower) };
  return {
    tasks: tasks.map((task) => (task.id === taskId ? moved : task)),
    target: { status, after_id: after?.id ?? null, before_id: before?.id ?? null },
  };
}

/** Merge the server's answer to a move: the canonical task plus (possibly rebalanced) column positions. */
export function applyMoveResult(tasks: readonly Task[], result: MoveResult): Task[] {
  const positions = new Map(result.column.map((entry) => [entry.id, entry.position]));
  return tasks.map((task) => {
    if (task.id === result.task.id) return result.task;
    const position = positions.get(task.id);
    return position === undefined ? task : { ...task, position };
  });
}

export type KeyboardMove = { status: TaskStatus; index: number };

/**
 * Alt+Arrow on a focused card: Up/Down reorder inside its visible column, Left/Right move it to the
 * neighbouring column at the same height (clamped). Returns null at the edges.
 */
export function keyboardMove(key: string, task: Task, visibleByStatus: Record<TaskStatus, readonly Task[]>): KeyboardMove | null {
  const column = visibleByStatus[task.status];
  const index = column.findIndex((t) => t.id === task.id);
  if (key === 'ArrowUp') return index > 0 ? { status: task.status, index: index - 1 } : null;
  if (key === 'ArrowDown') return index !== -1 && index < column.length - 1 ? { status: task.status, index: index + 1 } : null;
  const offset = key === 'ArrowLeft' ? -1 : key === 'ArrowRight' ? 1 : 0;
  const status = STATUSES[STATUSES.indexOf(task.status) + offset];
  if (!offset || !status) return null;
  return { status, index: Math.min(Math.max(index, 0), visibleByStatus[status].length) };
}

// ---------- @mentions ----------

export type MentionQuery = { start: number; query: string };

/** The "@partial name" being typed just before the caret, if any ("Thanks @pri|" → {start: 7, query: 'pri'}). */
export function mentionQuery(text: string, caret: number): MentionQuery | null {
  const match = /(^|\s)@([^\s@]*(?: [^\s@]*)?)$/.exec(text.slice(0, caret));
  if (!match) return null;
  return { start: match.index + match[1].length, query: match[2] };
}

export function mentionSuggestions<T extends Person>(people: readonly T[], query: string, limit = 6): T[] {
  const needle = query.trim().toLowerCase();
  const matching = people.filter((person) => {
    const name = person.name.toLowerCase();
    return !needle || name.startsWith(needle) || name.split(/\s+/).some((word) => word.startsWith(needle));
  });
  return matching.slice(0, limit);
}

/** Replace the "@partial" at `start..caret` with "@Full Name " and return the new text and caret. */
export function insertMention(text: string, start: number, caret: number, name: string): { text: string; caret: number } {
  const inserted = `@${name} `;
  return { text: text.slice(0, start) + inserted + text.slice(caret), caret: start + inserted.length };
}

export type MentionSegment = { text: string; person?: Person };

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Split a comment into plain text and mention segments, using the same rules as the server:
 * "@Full Name" always, "@First" only when that first name is unique among `people`.
 */
export function mentionSegments(body: string, people: readonly Person[]): MentionSegment[] {
  const firstCounts = new Map<string, number>();
  people.forEach((p) => {
    const first = p.name.split(/\s+/)[0].toLowerCase();
    firstCounts.set(first, (firstCounts.get(first) ?? 0) + 1);
  });
  const tokens: { token: string; person: Person }[] = [];
  people.forEach((person) => {
    tokens.push({ token: person.name, person });
    const first = person.name.split(/\s+/)[0];
    if (first !== person.name && firstCounts.get(first.toLowerCase()) === 1) tokens.push({ token: first, person });
  });
  if (!tokens.length) return [{ text: body }];
  // Longest tokens first so "@Maya Chen" wins over "@Maya".
  tokens.sort((a, b) => b.token.length - a.token.length);
  const pattern = new RegExp(`(?<![\\w@])@(${tokens.map((t) => escapeRegExp(t.token)).join('|')})(?!\\w)`, 'gi');
  const segments: MentionSegment[] = [];
  let last = 0;
  for (const match of body.matchAll(pattern)) {
    const person = tokens.find((t) => t.token.toLowerCase() === match[1].toLowerCase())!.person;
    const index = match.index ?? 0;
    if (index > last) segments.push({ text: body.slice(last, index) });
    segments.push({ text: match[0], person });
    last = index + match[0].length;
  }
  if (last < body.length) segments.push({ text: body.slice(last) });
  return segments;
}

// ---------- Small display helpers ----------

/** Board-card view of a task the drawer has edited locally (checklist ticks and comments update the counters). */
export function summarize(detail: TaskDetail): Task {
  return {
    ...detail,
    checklist_done: detail.checklist.filter((item) => item.done).length,
    checklist_total: detail.checklist.length,
    comment_count: detail.comments.length,
  };
}

export function flattenBoard(board: Board): Task[] {
  return board.columns.flatMap((column) => column.tasks);
}

export function progressPercent(done: number, total: number): number {
  return total ? Math.round((done / total) * 100) : 0;
}

export function nextStatus(status: TaskStatus): TaskStatus | null {
  return STATUSES[STATUSES.indexOf(status) + 1] ?? null;
}
