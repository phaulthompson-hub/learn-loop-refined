// @vitest-environment jsdom
import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { renderWithProviders } from '../../test/render';
import type { Home } from './types';


vi.mock('../../app/auth', () => ({
  useWorkspace: () => ({ id: 7, name: 'Test Space', slug: 'test-space', color: '#1d6d45', role: 'owner', can: () => true }),
}));
vi.mock('./api', () => ({ homeApi: { home: vi.fn() } }));

const { HomePage } = await import('./HomePage');
const api = (await import('./api')).homeApi as unknown as { home: Mock };

const zero = { value: 0, previous: 0, change: 0, percent: null };

function emptyHome(): Home {
  return {
    greeting: { first_name: 'Robin', part_of_day: 'afternoon', today: '2022-03-14', now: '2022-03-14T14:00:00' },
    streak: { current: 0, longest: 0, active_today: false, active_days_last_30: 0 },
    flashcards: { due: 0, new: 0, total: 0 },
    agenda: [],
    continue_learning: [],
    focus: null,
    tasks: { items: [], total_open: 0, overdue: 0 },
    goals: [],
    week: {
      answers: zero,
      accuracy: zero,
      reviews: zero,
      minutes: zero,
      days: Array.from({ length: 7 }, (_, i) => ({ date: `2022-03-${String(8 + i).padStart(2, '0')}`, answers: 0, reviews: 0, minutes: 0 })),
    },
    activity: [],
    onboarding: { courses: 0, enrolled: 0, decks: 0, events: 0, goals: 0, can_create_courses: true },
  };
}

describe('HomePage', () => {
  beforeEach(() => api.home.mockReset());

  it('greets a brand-new workspace with onboarding steps and intentional empty states', async () => {
    api.home.mockResolvedValue(emptyHome());
    renderWithProviders(<HomePage />);
    expect(await screen.findByRole('heading', { name: 'Good afternoon, Robin' })).toBeTruthy();
    expect(api.home).toHaveBeenCalledWith(7);
    expect(screen.getByRole('heading', { name: 'Set up your learning loop' })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Create a course/ }).getAttribute('href')).toBe('/courses/new');
    expect(screen.getByRole('link', { name: /Open decks/ }).getAttribute('href')).toBe('/decks');
    const planner = screen.getAllByRole('link', { name: /Open planner/ }); // hero shortcut + onboarding step
    expect(planner.map((link) => link.getAttribute('href'))).toEqual(['/planner', '/planner']);
    expect(screen.getByRole('link', { name: /Create your first deck/ })).toBeTruthy();
    expect(screen.getByText('Nothing scheduled today.')).toBeTruthy();
    expect(screen.getByText('Nothing assigned to you.')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Nothing urgent to fix' })).toBeTruthy();
  });

  it('hides onboarding once every step is done and offers the review queue', async () => {
    api.home.mockResolvedValue({
      ...emptyHome(),
      flashcards: { due: 16, new: 9, total: 43 },
      onboarding: { courses: 3, enrolled: 2, decks: 3, events: 4, goals: 1, can_create_courses: true },
    });
    renderWithProviders(<HomePage />);
    expect(await screen.findByRole('link', { name: /Review 16 cards/ })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Set up your learning loop' })).toBeNull();
  });

  it('shows an error with a retry when the dashboard cannot load', async () => {
    api.home.mockRejectedValueOnce(new Error('Workspace not found'));
    renderWithProviders(<HomePage />);
    expect((await screen.findByRole('alert')).textContent).toContain('Workspace not found');
  });
});
