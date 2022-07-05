// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/render';
import { goalsApi } from './api';
import { GoalModal } from './GoalModal';
import type { Goal } from './types';

vi.mock('./api', () => ({ goalsApi: { create: vi.fn(), update: vi.fn() } }));

const COURSES = [{ id: 3, title: 'Statistics', color: '#2563eb' }];

function renderModal(goal: Goal | null = null) {
  const onSaved = vi.fn();
  renderWithProviders(<GoalModal workspaceId={7} goal={goal} courses={COURSES} onClose={vi.fn()} onSaved={onSaved} />);
  return { onSaved, user: userEvent.setup() };
}

describe('GoalModal', () => {
  beforeEach(() => {
    vi.mocked(goalsApi.create).mockReset().mockResolvedValue({ id: 1, title: 'x' } as Goal);
    vi.mocked(goalsApi.update).mockReset().mockResolvedValue({ id: 5, title: 'x' } as Goal);
  });

  it('suggests a title that follows the target until the learner types one', async () => {
    const { user } = renderModal();
    const title = screen.getByLabelText(/^Title/) as HTMLInputElement;
    expect(title.value).toBe('Answer 8 questions a day');
    const target = screen.getByLabelText(/^Target/);
    await user.clear(target);
    await user.type(target, '12');
    expect(title.value).toBe('Answer 12 questions a day');
    await user.clear(title);
    await user.type(title, 'My own title');
    await user.clear(target);
    await user.type(target, '5');
    expect(title.value).toBe('My own title');
  });

  it('asks for a course before creating a mastery goal', async () => {
    const { user, onSaved } = renderModal();
    await user.click(screen.getByLabelText(/Course mastery/));
    await user.click(screen.getByRole('button', { name: 'Create goal' }));
    expect(screen.getByText('Choose the course this goal is for.')).toBeTruthy();
    expect(goalsApi.create).not.toHaveBeenCalled();

    await user.selectOptions(screen.getByRole('combobox', { name: 'Course' }), '3');
    await user.click(screen.getByRole('button', { name: 'Create goal' }));
    expect(goalsApi.create).toHaveBeenCalledWith(7, {
      title: 'Reach 80% in Statistics',
      kind: 'course_mastery',
      period: 'once',
      target: 80,
      course_id: 3,
      due_date: null,
    });
    expect(onSaved).toHaveBeenCalled();
  });

  it('offers a period choice only for study time and checks its target range', async () => {
    const { user } = renderModal();
    expect((screen.getByLabelText(/^Period/) as HTMLInputElement).readOnly).toBe(true);
    await user.click(screen.getByLabelText(/Study time/));
    await user.selectOptions(screen.getByLabelText(/^Period/), 'week');
    const target = screen.getByLabelText(/^Target/);
    await user.clear(target);
    await user.type(target, '10');
    await user.click(screen.getByRole('button', { name: 'Create goal' }));
    expect(screen.getByText('The target must be between 15 and 4200.')).toBeTruthy();
  });

  it('edits an existing goal', async () => {
    const goal = {
      id: 5,
      title: 'Daily answers',
      kind: 'daily_answers',
      period: 'day',
      target: 8,
      course: null,
      due_date: null,
    } as Goal;
    const { user } = renderModal(goal);
    const target = screen.getByLabelText(/^Target/);
    await user.clear(target);
    await user.type(target, '10');
    await user.click(screen.getByRole('button', { name: 'Save goal' }));
    expect(goalsApi.update).toHaveBeenCalledWith(5, expect.objectContaining({ title: 'Daily answers', target: 10 }));
  });
});
