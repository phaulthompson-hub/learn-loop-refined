import { describe, expect, it } from 'vitest';
import {
  activeFilterCount,
  applyMoveResult,
  applyPatch,
  buildSwimlanes,
  columnStats,
  columnTasks,
  dropToFinalIndex,
  dueLabel,
  dueStatus,
  EMPTY_FILTERS,
  filterTasks,
  insertMention,
  keyboardMove,
  laneChange,
  matchesDue,
  mentionQuery,
  mentionSegments,
  mentionSuggestions,
  planMove,
  positionBetween,
  readFilters,
  summarize,
  toggleAssignee,
  wipState,
  writeFilters,
} from './board';
import type { BoardMember, Label, Task, TaskDetail, TaskStatus } from './types';

const NOW = new Date('2022-03-14T09:00:00Z'); // Monday

const person = (id: number, name: string) => ({ id, name, email: `${name.split(' ')[0].toLowerCase()}@x.dev`, avatar_color: '#123456' });
const ALEX = person(1, 'Alex Rivera');
const MAYA = person(2, 'Maya Chen');
const PRIYA = person(3, 'Priya Nair');
const MEMBERS: BoardMember[] = [
  { ...ALEX, role: 'admin' },
  { ...MAYA, role: 'owner' },
  { ...PRIYA, role: 'learner' },
];
const READING: Label = { id: 10, workspace_id: 1, name: 'Reading', color: '#2563eb', task_count: 0 };
const EXAM: Label = { id: 11, workspace_id: 1, name: 'Exam prep', color: '#c2410c', task_count: 0 };

let nextId = 1;
function task(overrides: Partial<Task> = {}): Task {
  const id = overrides.id ?? nextId++;
  return {
    id,
    workspace_id: 1,
    number: id,
    key: `NDA-${id}`,
    title: `Task ${id}`,
    description: '',
    status: 'todo',
    priority: 'medium',
    assignee: null,
    reporter: MAYA,
    course: null,
    due_date: null,
    estimate: null,
    position: id * 1024,
    labels: [],
    checklist_done: 0,
    checklist_total: 0,
    comment_count: 0,
    overdue: false,
    created_at: '2022-02-27T10:00:00',
    updated_at: '2022-02-27T10:00:00',
    completed_at: null,
    ...overrides,
  };
}

const ids = (tasks: readonly Task[]) => tasks.map((t) => t.id);

describe('URL filters', () => {
  it('round-trips through the query string and keeps unrelated params', () => {
    const filters = { q: 'joins', assignees: [3, 'none' as const], label: 10, priority: 'high' as const, course: 4, due: 'week' as const };
    const params = writeFilters(new URLSearchParams('view=list&task=7'), filters);
    expect(params.get('view')).toBe('list');
    expect(params.get('task')).toBe('7');
    expect(params.get('assignee')).toBe('3,none');
    expect(readFilters(params)).toEqual(filters);
  });

  it('removes keys for empty filters', () => {
    const params = writeFilters(new URLSearchParams('q=old&due=today&group=assignee'), EMPTY_FILTERS);
    expect(params.toString()).toBe('group=assignee');
  });

  it('ignores malformed values from hand-edited URLs', () => {
    const filters = readFilters(new URLSearchParams('assignee=abc,2,2,-1,none&label=x&priority=critical&due=soon&course=0'));
    expect(filters).toEqual({ ...EMPTY_FILTERS, assignees: [2, 'none'] });
  });

  it('counts active filters and toggles assignees', () => {
    expect(activeFilterCount(EMPTY_FILTERS)).toBe(0);
    expect(activeFilterCount({ ...EMPTY_FILTERS, q: '  ' })).toBe(0);
    const once = toggleAssignee(EMPTY_FILTERS, 3);
    expect(once.assignees).toEqual([3]);
    expect(toggleAssignee(once, 3).assignees).toEqual([]);
    expect(activeFilterCount({ ...once, due: 'overdue' })).toBe(2);
  });
});

describe('due dates', () => {
  it('classifies relative to the server clock', () => {
    expect(dueStatus(null, 'todo', NOW)).toBe('none');
    expect(dueStatus('2022-03-13', 'todo', NOW)).toBe('overdue');
    expect(dueStatus('2022-03-13', 'done', NOW)).toBe('done');
    expect(dueStatus('2022-03-14', 'review', NOW)).toBe('today');
    expect(dueStatus('2022-03-17', 'todo', NOW)).toBe('soon');
    expect(dueStatus('2022-03-18', 'todo', NOW)).toBe('later');
  });

  it('writes short badge labels', () => {
    expect(dueLabel('2022-03-13', 'todo', NOW)).toBe('1 day overdue');
    expect(dueLabel('2022-03-10', 'todo', NOW)).toBe('4 days overdue');
    expect(dueLabel('2022-03-14', 'todo', NOW)).toBe('Due today');
    expect(dueLabel('2022-03-15', 'todo', NOW)).toBe('Tomorrow');
    expect(dueLabel('2022-03-18', 'todo', NOW)).toBe('Fri 18 Mar');
    expect(dueLabel('2022-04-18', 'todo', NOW)).toBe('18 Apr');
  });

  it('matches the due filters like the API', () => {
    const open = (due: string | null, status: TaskStatus = 'todo') => ({ due_date: due, status });
    expect(matchesDue(open('2022-03-08'), 'overdue', NOW)).toBe(true);
    expect(matchesDue(open('2022-03-08', 'done'), 'overdue', NOW)).toBe(false);
    expect(matchesDue(open('2022-03-14'), 'today', NOW)).toBe(true);
    expect(matchesDue(open('2022-03-20'), 'week', NOW)).toBe(true);
    expect(matchesDue(open('2022-03-21'), 'week', NOW)).toBe(false);
    expect(matchesDue(open('2022-03-16', 'done'), 'week', NOW)).toBe(false);
    expect(matchesDue(open(null), 'none', NOW)).toBe(true);
    expect(matchesDue(open(null), 'week', NOW)).toBe(false);
  });
});

