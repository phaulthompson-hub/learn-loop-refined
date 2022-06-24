// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/render';
import { parseDate } from '../../lib/dates';
import { plannerApi } from './api';
import { emptyEventForm } from './eventForm';
import { EventModal } from './EventModal';
import type { EventSaved, PlannerEvent } from './types';

vi.mock('./api', () => ({ plannerApi: { create: vi.fn(), update: vi.fn() } }));

const saved = (conflicts: EventSaved['conflicts']): EventSaved => ({
  event: { id: 41, title: 'Focus block', recurrence: 'none' } as PlannerEvent,
  conflicts,
});

function renderModal({ canAnnounce = false } = {}) {
  const onClose = vi.fn();
  const onSaved = vi.fn();
  renderWithProviders(
    <EventModal
      workspaceId={7}
      target={{ mode: 'create', form: emptyEventForm(parseDate('2022-03-16'), 15 * 60 + 30) }}
      courses={[{ id: 3, title: 'SQL for Analysts', color: '#0f766e' }]}
      canAnnounce={canAnnounce}
      onClose={onClose}
      onSaved={onSaved}
    />,
  );
  return { onClose, onSaved, user: userEvent.setup() };
}

describe('EventModal', () => {
  beforeEach(() => {
    vi.mocked(plannerApi.create).mockReset();
  });

  it('validates on the client before calling the API', async () => {
    const { user } = renderModal();
    await user.click(screen.getByRole('button', { name: 'Create event' }));
    expect(screen.getByText(/at least 2 characters/)).toBeTruthy();
    expect(plannerApi.create).not.toHaveBeenCalled();
  });

  it('creates the event with the chosen slot and course', async () => {
    vi.mocked(plannerApi.create).mockResolvedValue(saved([]));
    const { user, onSaved, onClose } = renderModal();
    await user.type(screen.getByLabelText(/^Title/), 'Focus block');
    await user.selectOptions(screen.getByLabelText('Course'), '3');
    await user.click(screen.getByRole('button', { name: 'Create event' }));
    expect(plannerApi.create).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ title: 'Focus block', course_id: 3, starts_at: '2022-03-16T15:30:00', ends_at: '2022-03-16T16:30:00' }),
    );
    expect(onSaved).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('shows overlaps reported by the API before closing', async () => {
    vi.mocked(plannerApi.create).mockResolvedValue(
      saved([{ event_id: 9, title: 'SQL workshop: window functions', kind: 'live', starts_at: '2022-03-16T15:00:00', ends_at: '2022-03-16T16:30:00', index: 0 }]),
    );
    const { user, onClose } = renderModal();
    await user.type(screen.getByLabelText(/^Title/), 'Focus block');
    await user.click(screen.getByRole('button', { name: 'Create event' }));
    expect(screen.getByText('Saved, with overlaps')).toBeTruthy();
    expect(screen.getByText('SQL workshop: window functions')).toBeTruthy();
    expect(screen.getByText(/15:00 – 16:30/)).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Keep it' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('only lets instructors announce live sessions', async () => {
    const { user } = renderModal();
    await user.type(screen.getByLabelText(/^Title/), 'Office hours');
    await user.click(screen.getByLabelText('Live session'));
    await user.click(screen.getByRole('switch', { name: /Share with the workspace/ }));
    await user.click(screen.getByRole('button', { name: 'Create event' }));
    expect(screen.getByText('Only instructors can share exams and live sessions with the workspace.')).toBeTruthy();
    expect(plannerApi.create).not.toHaveBeenCalled();
  });

  it('shows the server error when saving fails', async () => {
    vi.mocked(plannerApi.create).mockRejectedValueOnce(new Error('Choose a course from this workspace'));
    const { user } = renderModal();
    await user.type(screen.getByLabelText(/^Title/), 'Focus block');
    await user.click(screen.getByRole('button', { name: 'Create event' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Choose a course from this workspace');
  });
});
