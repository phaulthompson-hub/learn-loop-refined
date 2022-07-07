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

describe('filterTasks', () => {
  const tasks = [
    task({ id: 1, title: 'Gradient descent', assignee: ALEX, labels: [READING], priority: 'high' }),
    task({ id: 2, title: 'SQL joins', description: 'left and anti joins', course: { id: 4, title: 'SQL', color: '#000' } }),
    task({ id: 3, title: 'Mock exam', assignee: PRIYA, labels: [EXAM], due_date: '2022-03-10' }),
  ];

  it('returns everything without filters', () => {
    expect(ids(filterTasks(tasks, EMPTY_FILTERS, NOW))).toEqual([1, 2, 3]);
  });

  it('searches title, description, key and label names', () => {
    expect(ids(filterTasks(tasks, { ...EMPTY_FILTERS, q: 'anti' }, NOW))).toEqual([2]);
    expect(ids(filterTasks(tasks, { ...EMPTY_FILTERS, q: 'nda-3' }, NOW))).toEqual([3]);
    expect(ids(filterTasks(tasks, { ...EMPTY_FILTERS, q: 'reading gradient' }, NOW))).toEqual([1]);
  });

  it('combines assignee (including unassigned), label, priority, course and due', () => {
    expect(ids(filterTasks(tasks, { ...EMPTY_FILTERS, assignees: [1, 'none'] }, NOW))).toEqual([1, 2]);
    expect(ids(filterTasks(tasks, { ...EMPTY_FILTERS, label: 11 }, NOW))).toEqual([3]);
    expect(ids(filterTasks(tasks, { ...EMPTY_FILTERS, priority: 'high' }, NOW))).toEqual([1]);
    expect(ids(filterTasks(tasks, { ...EMPTY_FILTERS, course: 4 }, NOW))).toEqual([2]);
    expect(ids(filterTasks(tasks, { ...EMPTY_FILTERS, due: 'overdue', assignees: [3] }, NOW))).toEqual([3]);
    expect(filterTasks(tasks, { ...EMPTY_FILTERS, due: 'overdue', assignees: [1] }, NOW)).toEqual([]);
  });
});

describe('columns and swimlanes', () => {
  it('orders a column by position', () => {
    const tasks = [task({ id: 1, position: 3000 }), task({ id: 2, position: 1000 }), task({ id: 3, status: 'done', position: 1 })];
    expect(ids(columnTasks(tasks, 'todo'))).toEqual([2, 1]);
  });

  it('sums counts and points, ignoring missing estimates', () => {
    expect(columnStats([task({ estimate: 3 }), task({ estimate: null }), task({ estimate: 5 })])).toEqual({ count: 3, points: 8 });
  });

  it('describes work-in-progress limits', () => {
    expect(wipState(3, null)).toBe('none');
    expect(wipState(3, 6)).toBe('ok');
    expect(wipState(6, 6)).toBe('full');
    expect(wipState(7, 6)).toBe('over');
  });

  it('groups by assignee in member order, skipping empty lanes, unassigned last', () => {
    const tasks = [task({ id: 1, assignee: PRIYA }), task({ id: 2 }), task({ id: 3, assignee: ALEX })];
    const lanes = buildSwimlanes(tasks, 'assignee', MEMBERS);
    expect(lanes.map((l) => l.title)).toEqual(['Alex Rivera', 'Priya Nair', 'Unassigned']);
    expect(lanes.map((l) => ids(l.tasks))).toEqual([[3], [1], [2]]);
  });

  it('keeps lanes for former members who still have tasks', () => {
    const former = person(9, 'Jonas Weber');
    const lanes = buildSwimlanes([task({ id: 1, assignee: former })], 'assignee', MEMBERS);
    expect(lanes.map((l) => l.key)).toEqual(['assignee:9', 'assignee:none']);
  });

  it('always shows four priority lanes, most urgent first', () => {
    const lanes = buildSwimlanes([task({ priority: 'low' })], 'priority', MEMBERS);
    expect(lanes.map((l) => l.key)).toEqual(['priority:urgent', 'priority:high', 'priority:medium', 'priority:low']);
  });

  it('turns a lane key into the field change for a cross-lane drop', () => {
    expect(laneChange('assignee:3')).toEqual({ assignee_id: 3 });
    expect(laneChange('assignee:none')).toEqual({ assignee_id: null });
    expect(laneChange('priority:urgent')).toEqual({ priority: 'urgent' });
    expect(laneChange('all')).toEqual({});
  });
});

describe('applyPatch', () => {
  const lookups = { members: MEMBERS, courses: [{ id: 4, title: 'SQL', color: '#111' }], labels: [READING, EXAM] };

  it('resolves ids to embedded objects', () => {
    const next = applyPatch(task({ assignee: ALEX }), { assignee_id: 3, course_id: 4, label_ids: [11, 10] }, lookups);
    expect(next.assignee?.name).toBe('Priya Nair');
    expect(next.course?.title).toBe('SQL');
    expect(next.labels.map((l) => l.name)).toEqual(['Exam prep', 'Reading']);
  });

  it('clears nullable fields and leaves untouched ones alone', () => {
    const original = task({ assignee: ALEX, due_date: '2022-03-18', priority: 'high' });
    const next = applyPatch(original, { assignee_id: null, due_date: null }, lookups);
    expect(next.assignee).toBeNull();
    expect(next.due_date).toBeNull();
    expect(next.priority).toBe('high');
    expect(original.assignee).toEqual(ALEX); // not mutated
  });
});

describe('moves', () => {
  it('uses the same midpoint rule as the server', () => {
    expect(positionBetween(null, null)).toBe(1024);
    expect(positionBetween(1024, 2048)).toBe(1536);
    expect(positionBetween(2048, null)).toBe(3072);
    expect(positionBetween(null, 4096)).toBe(3072);
    expect(positionBetween(null, 100)).toBe(50);
  });

  it('converts a drop index over the displayed list into a final index', () => {
    expect(dropToFinalIndex([1, 2, 3], 1, 3)).toBe(2); // dragging the first card below the last
    expect(dropToFinalIndex([1, 2, 3], 3, 0)).toBe(0);
    expect(dropToFinalIndex([1, 2, 3], 9, 2)).toBe(2); // card from another column
  });

  it('plans a move into another column between two neighbours', () => {
    const tasks = [task({ id: 1 }), task({ id: 2, status: 'review', position: 1000 }), task({ id: 3, status: 'review', position: 2000 })];
    const plan = planMove(tasks, 1, 'review', columnTasks(tasks, 'review'), 1)!;
    expect(plan.target).toEqual({ status: 'review', after_id: 2, before_id: 3 });
    const moved = plan.tasks.find((t) => t.id === 1)!;
    expect(moved.status).toBe('review');
    expect(moved.position).toBe(1500);
    expect(ids(columnTasks(plan.tasks, 'review'))).toEqual([2, 1, 3]);
  });

  it('plans a move to the top and bottom of the same column', () => {
    const tasks = [task({ id: 1, position: 1024 }), task({ id: 2, position: 2048 }), task({ id: 3, position: 3072 })];
    const top = planMove(tasks, 3, 'todo', columnTasks(tasks, 'todo'), 0)!;
    expect(top.target).toEqual({ status: 'todo', after_id: null, before_id: 1 });
    expect(ids(columnTasks(top.tasks, 'todo'))).toEqual([3, 1, 2]);
    const bottom = planMove(tasks, 1, 'todo', columnTasks(tasks, 'todo'), 2)!;
    expect(bottom.target.after_id).toBe(3);
    expect(ids(columnTasks(bottom.tasks, 'todo'))).toEqual([2, 3, 1]);
  });

  it('returns null when the card would land where it already is', () => {
    const tasks = [task({ id: 1, position: 1024 }), task({ id: 2, position: 2048 })];
    expect(planMove(tasks, 1, 'todo', columnTasks(tasks, 'todo'), 0)).toBeNull();
    expect(planMove(tasks, 2, 'todo', columnTasks(tasks, 'todo'), 5)).toBeNull();
  });

  it('places relative to visible neighbours when the column is filtered', () => {
    // Visible: 1 and 3 (2 is filtered out). Dropping 4 after 1 puts it directly after 1 in the full column.
    const tasks = [task({ id: 1, position: 1000 }), task({ id: 2, position: 2000 }), task({ id: 3, position: 3000 }), task({ id: 4, status: 'backlog' })];
    const visible = [tasks[0], tasks[2]];
    const plan = planMove(tasks, 4, 'todo', visible, 1)!;
    expect(plan.target).toEqual({ status: 'todo', after_id: 1, before_id: 3 });
    expect(ids(columnTasks(plan.tasks, 'todo'))).toEqual([1, 4, 2, 3]);
  });

  it('merges the server result, including rebalanced positions', () => {
    const tasks = [task({ id: 1, position: 1 }), task({ id: 2, position: 1.0000001 }), task({ id: 3, status: 'backlog' })];
    const serverTask = task({ id: 3, status: 'todo', position: 2048 });
    const merged = applyMoveResult(tasks, {
      task: serverTask,
      column: [
        { id: 1, position: 1024 },
        { id: 3, position: 2048 },
        { id: 2, position: 3072 },
      ],
      rebalanced: true,
    });
    expect(ids(columnTasks(merged, 'todo'))).toEqual([1, 3, 2]);
    expect(merged.find((t) => t.id === 3)).toBe(serverTask);
  });

  describe('keyboardMove', () => {
    const a = task({ id: 1 });
    const b = task({ id: 2 });
    const c = task({ id: 3, status: 'in_progress' });
    const byStatus: Record<TaskStatus, Task[]> = { backlog: [], todo: [a, b], in_progress: [c], review: [], done: [] };

    it('reorders within the column', () => {
      expect(keyboardMove('ArrowDown', a, byStatus)).toEqual({ status: 'todo', index: 1 });
      expect(keyboardMove('ArrowUp', b, byStatus)).toEqual({ status: 'todo', index: 0 });
      expect(keyboardMove('ArrowUp', a, byStatus)).toBeNull();
      expect(keyboardMove('ArrowDown', b, byStatus)).toBeNull();
    });

    it('moves across columns at a clamped height', () => {
      expect(keyboardMove('ArrowRight', b, byStatus)).toEqual({ status: 'in_progress', index: 1 });
      expect(keyboardMove('ArrowLeft', a, byStatus)).toEqual({ status: 'backlog', index: 0 });
      expect(keyboardMove('ArrowLeft', task({ status: 'backlog' }), { ...byStatus, backlog: [] })).toBeNull();
      expect(keyboardMove('Enter', a, byStatus)).toBeNull();
    });
  });
});

describe('mentions', () => {
  it('finds the partial mention before the caret', () => {
    expect(mentionQuery('Thanks @pri', 11)).toEqual({ start: 7, query: 'pri' });
    expect(mentionQuery('@', 1)).toEqual({ start: 0, query: '' });
    expect(mentionQuery('ping @Maya Ch', 13)).toEqual({ start: 5, query: 'Maya Ch' });
    expect(mentionQuery('mail alex@example', 17)).toBeNull();
    expect(mentionQuery('@Maya Chen is great', 19)).toBeNull();
  });

  it('suggests members by first or last name', () => {
    expect(mentionSuggestions(MEMBERS, 'ch').map((p) => p.name)).toEqual(['Maya Chen']);
    expect(mentionSuggestions(MEMBERS, 'P').map((p) => p.name)).toEqual(['Priya Nair']);
    expect(mentionSuggestions(MEMBERS, '')).toHaveLength(3);
    expect(mentionSuggestions(MEMBERS, 'zz')).toEqual([]);
  });

  it('inserts the full name and moves the caret after it', () => {
    expect(insertMention('Hi @pr, see', 3, 6, 'Priya Nair')).toEqual({ text: 'Hi @Priya Nair , see', caret: 15 });
  });

  it('splits comments into text and mention segments', () => {
    const segments = mentionSegments('@Maya Chen and @priya: see alex@x.dev', MEMBERS);
    expect(segments.map((s) => [s.text, s.person?.id ?? null])).toEqual([
      ['@Maya Chen', 2],
      [' and ', null],
      ['@priya', 3],
      [': see alex@x.dev', null],
    ]);
  });

  it('needs the full name when first names are shared', () => {
    const people = [person(1, 'Sam Okafor'), person(2, 'Sam Lee')];
    expect(mentionSegments('@Sam hi', people)).toEqual([{ text: '@Sam hi' }]);
    expect(mentionSegments('@Sam Lee hi', people)[0].person?.id).toBe(2);
  });
});

describe('summarize', () => {
  it('recomputes counters from the drawer detail', () => {
    const detail: TaskDetail = {
      ...task({ id: 1, checklist_done: 0, checklist_total: 0, comment_count: 0 }),
      checklist: [
        { id: 1, text: 'a', done: true, position: 0 },
        { id: 2, text: 'b', done: false, position: 1 },
      ],
      comments: [],
      can_delete: true,
    };
    const summary = summarize(detail);
    expect([summary.checklist_done, summary.checklist_total, summary.comment_count]).toEqual([1, 2, 0]);
  });
});
