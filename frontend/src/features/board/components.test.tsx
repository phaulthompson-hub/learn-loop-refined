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

