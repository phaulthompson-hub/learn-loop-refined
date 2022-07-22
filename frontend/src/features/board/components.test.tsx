// @vitest-environment jsdom
import { useState } from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../test/render';
import { boardApi } from './api';
import { STATUS_LABELS } from './board';
import { BoardView } from './BoardView';
import { MentionTextarea } from './MentionTextarea';
import { NewTaskModal } from './NewTaskModal';
import { TaskCard } from './TaskCard';
import type { BoardColumn, BoardMember, Task, TaskDetail } from './types';

const NOW = new Date('2022-03-14T09:00:00Z');
const MEMBERS: BoardMember[] = [
  { id: 1, name: 'Alex Rivera', email: 'alex@x.dev', avatar_color: '#123', role: 'admin' },
  { id: 3, name: 'Priya Nair', email: 'priya@x.dev', avatar_color: '#456', role: 'learner' },
];

const TASK: Task = {
  id: 7,
  workspace_id: 1,
  number: 7,
  key: 'NDA-7',
  title: 'Read chapter 4: confidence intervals',
  description: '',
  status: 'todo',
  priority: 'high',
  assignee: MEMBERS[1],
  reporter: MEMBERS[0],
  course: { id: 2, title: 'Statistics', color: '#2563eb' },
  due_date: '2022-03-13',
  estimate: 2,
  position: 1024,
  labels: [{ id: 1, workspace_id: 1, name: 'Reading', color: '#2563eb', task_count: 1 }],
  checklist_done: 1,
  checklist_total: 3,
  comment_count: 2,
  overdue: true,
  created_at: '2022-03-03T10:00:00',
  updated_at: '2022-03-03T10:00:00',
  completed_at: null,
};

afterEach(() => {
  vi.restoreAllMocks();
});

function renderCard() {
  const handlers = { onOpen: vi.fn(), onDragStart: vi.fn(), onDragEnd: vi.fn(), onMenuMove: vi.fn(), onKeyboardMove: vi.fn() };
  renderWithProviders(<TaskCard task={TASK} now={NOW} dragging={false} {...handlers} />);
  return { card: screen.getByRole('article'), ...handlers };
}

describe('TaskCard', () => {
  it('shows key, urgency and progress at a glance', () => {
    const { card } = renderCard();
    expect(card.textContent).toContain('NDA-7');
    expect(card.textContent).toContain('1 day overdue');
    expect(card.textContent).toContain('1/3');
    expect(card.textContent).toContain('Reading');
    expect(card.getAttribute('aria-label')).toContain('assigned to Priya Nair');
  });

  it('opens with Enter and moves with Alt+Arrow keys', () => {
    const { card, onOpen, onKeyboardMove } = renderCard();
    fireEvent.keyDown(card, { key: 'Enter' });
    expect(onOpen).toHaveBeenCalledWith(TASK);
    fireEvent.keyDown(card, { key: 'ArrowRight', altKey: true });
    expect(onKeyboardMove).toHaveBeenCalledWith(TASK, 'ArrowRight');
    fireEvent.keyDown(card, { key: 'ArrowRight' });
    expect(onKeyboardMove).toHaveBeenCalledTimes(1);
  });

  it('offers a "Move to" menu that does not open the drawer', async () => {
    const user = userEvent.setup();
    const { onMenuMove, onOpen } = renderCard();
    await user.click(screen.getByRole('button', { name: 'Actions for NDA-7' }));
    await user.click(screen.getByRole('menuitem', { name: 'Move to Review' }));
    expect(onMenuMove).toHaveBeenCalledWith(TASK, 'review', 'bottom');
    expect(onOpen).not.toHaveBeenCalled();
  });
});

describe('NewTaskModal', () => {
  const renderModal = () => {
    const onCreated = vi.fn();
    renderWithProviders(
      <NewTaskModal workspaceId={1} members={MEMBERS} labels={TASK.labels} courses={[TASK.course!]} initialStatus="review" onClose={vi.fn()} onCreated={onCreated} />,
    );
    return onCreated;
  };

  it('validates before calling the API', async () => {
    const user = userEvent.setup();
    const create = vi.spyOn(boardApi, 'create');
    renderModal();
    await user.type(screen.getByLabelText(/Estimate/), '2.5');
    await user.click(screen.getByRole('button', { name: 'Create task' }));
    screen.getByText(/title of at least 2 characters/);
    screen.getByText(/whole number of points/);
    expect(create).not.toHaveBeenCalled();
  });

  it('submits the typed task with its labels and checklist', async () => {
    const user = userEvent.setup();
    const created = { ...TASK, key: 'NDA-24', checklist: [], comments: [], can_delete: true } as TaskDetail;
    const create = vi.spyOn(boardApi, 'create').mockResolvedValue(created);
    const onCreated = renderModal();
    await user.type(screen.getByLabelText(/^Title/), 'Revise joins');
    await user.selectOptions(screen.getByLabelText('Assignee'), '3');
    await user.click(screen.getByRole('button', { name: 'Reading' }));
    await user.type(screen.getByLabelText(/^Checklist/), 'Inner{enter}Left');
    await user.click(screen.getByRole('button', { name: 'Create task' }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(created));
    expect(create).toHaveBeenCalledWith(1, expect.objectContaining({ title: 'Revise joins', status: 'review', assignee_id: 3, label_ids: [1], checklist: ['Inner', 'Left'] }));
  });

  it('shows the server error and stays open', async () => {
    const user = userEvent.setup();
    vi.spyOn(boardApi, 'create').mockRejectedValue(new Error('The assignee must be a member of this workspace'));
    const onCreated = renderModal();
    await user.type(screen.getByLabelText(/^Title/), 'Revise joins');
    await user.click(screen.getByRole('button', { name: 'Create task' }));
    expect((await screen.findByRole('alert')).textContent).toContain('must be a member');
    expect(onCreated).not.toHaveBeenCalled();
  });
});

describe('BoardView', () => {
  const COLUMNS: BoardColumn[] = (['backlog', 'todo', 'in_progress', 'review', 'done'] as const).map((status) => ({
    status,
    title: STATUS_LABELS[status],
    count: 0,
    points: 0,
    wip_limit: status === 'in_progress' ? 1 : null,
    over_limit: false,
    tasks: [],
  }));
  const tasks: Task[] = [
    { ...TASK, id: 1, key: 'NDA-1', title: 'First', position: 1 },
    { ...TASK, id: 2, key: 'NDA-2', title: 'Second', position: 2, assignee: null },
    { ...TASK, id: 3, key: 'NDA-3', title: 'Third', status: 'in_progress', estimate: 5 },
    { ...TASK, id: 4, key: 'NDA-4', title: 'Fourth', status: 'in_progress', estimate: 3 },
  ];

  function renderBoard(groupBy: 'none' | 'assignee' = 'none') {
    const props = { onOpen: vi.fn(), onMove: vi.fn().mockResolvedValue(true), onQuickAdd: vi.fn().mockResolvedValue(true), onAddInColumn: vi.fn() };
    renderWithProviders(<BoardView columns={COLUMNS} allTasks={tasks} visibleTasks={tasks} groupBy={groupBy} members={MEMBERS} now={NOW} {...props} />);
    return props;
  }

  it('shows per-column counts, points and an over-limit WIP warning', () => {
    renderBoard();
    const head = screen.getByRole('heading', { name: 'In progress' }).parentElement!;
    expect(head.textContent).toContain('8 pts');
    expect(head.className).toContain('is-over');
    expect(head.textContent).toContain('2/1');
  });

  it('moves a focused card to the next column with Alt+ArrowRight', async () => {
    const { onMove } = renderBoard();
    const second = screen.getByRole('article', { name: /NDA-2/ });
    fireEvent.keyDown(second, { key: 'ArrowRight', altKey: true });
    await waitFor(() => expect(onMove).toHaveBeenCalled());
    const request = onMove.mock.calls[0][0];
    expect(request).toMatchObject({ taskId: 2, status: 'in_progress', finalIndex: 1, lanePatch: undefined });
    expect(request.visible.map((t: Task) => t.id)).toEqual([3, 4]);
    await screen.findByText('Moved NDA-2 to In progress, position 2 of 3.');
  });

  it('quick-adds a task at the bottom of a column', async () => {
    const user = userEvent.setup();
    const { onQuickAdd } = renderBoard();
    const [, todoAdd] = screen.getAllByRole('button', { name: 'Add a task' });
    await user.click(todoAdd);
    await user.type(screen.getByLabelText('New task title in To do'), 'x{enter}');
    screen.getByText(/at least 2 characters/);
    await user.type(screen.getByLabelText('New task title in To do'), 'yz{enter}');
    expect(onQuickAdd).toHaveBeenCalledWith('todo', 'xyz');
  });

  it('splits the board into assignee swimlanes and keeps keyboard moves inside the lane', async () => {
    const { onMove } = renderBoard('assignee');
    expect(screen.getAllByRole('region').map((lane) => lane.getAttribute('aria-label'))).toEqual(['Priya Nair', 'Unassigned']);
    expect(screen.queryAllByRole('button', { name: 'Add a task' })).toEqual([]);
    const first = screen.getByRole('article', { name: /NDA-1/ });
    // NDA-1 is alone in Priya's "To do" cell (NDA-2 is in the Unassigned lane), so it cannot move down.
    fireEvent.keyDown(first, { key: 'ArrowDown', altKey: true });
    expect(onMove).not.toHaveBeenCalled();
    screen.getByText('NDA-1 cannot move further that way.');
    fireEvent.keyDown(first, { key: 'ArrowRight', altKey: true });
    await waitFor(() => expect(onMove).toHaveBeenCalled());
    expect(onMove.mock.calls[0][0]).toMatchObject({ taskId: 1, status: 'in_progress', finalIndex: 0, lanePatch: undefined });
    expect(onMove.mock.calls[0][0].visible.map((t: Task) => t.id)).toEqual([3, 4]);
  });
});

describe('MentionTextarea', () => {
  function Harness({ onSubmit = vi.fn() }: { onSubmit?: () => void }) {
    const [value, setValue] = useState('');
    return <MentionTextarea value={value} onChange={setValue} people={MEMBERS} onSubmit={onSubmit} label="Comment" />;
  }

  it('suggests members after @ and inserts the chosen full name', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness />);
    const box = screen.getByRole('combobox', { name: 'Comment' });
    await user.type(box, 'Thanks @pr');
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['PNPriya Nairpriya@x.dev']);
    await user.keyboard('{Enter}');
    expect((box as HTMLTextAreaElement).value).toBe('Thanks @Priya Nair ');
    expect(screen.queryByRole('option')).toBeNull();
  });

  it('dismisses suggestions with Escape and submits with Ctrl+Enter', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    renderWithProviders(<Harness onSubmit={onSubmit} />);
    const box = screen.getByRole('combobox', { name: 'Comment' });
    await user.type(box, '@');
    expect(screen.getAllByRole('option')).toHaveLength(2);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('option')).toBeNull();
    await user.keyboard('{Control>}{Enter}{/Control}');
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});
