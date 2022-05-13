// @vitest-environment jsdom
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { renderWithProviders } from '../../test/render';
import { courseApi } from './api';
import { NewCoursePage } from './NewCoursePage';

const workspace = { id: 3, name: 'Northwind', can: vi.fn() };

vi.mock('../../app/auth', () => ({ useWorkspace: () => workspace }));
vi.mock('./api', () => ({ courseApi: { facets: vi.fn(), create: vi.fn(), upload: vi.fn() } }));

const api = courseApi as unknown as { facets: Mock; create: Mock; upload: Mock };

const MATERIAL = 'Recursion solves a problem by solving smaller instances of the same problem until a base case is reached.';

describe('NewCoursePage', () => {
  beforeEach(() => {
    workspace.can.mockReturnValue(true);
    api.facets.mockResolvedValue({ subjects: ['Computer Science'], tags: ['algorithms'], statuses: {}, difficulties: {} });
    api.create.mockReset().mockResolvedValue({ id: 42, title: 'Recursion', concept_count: 5 });
  });

  it('turns learners away', () => {
    workspace.can.mockReturnValue(false);
    renderWithProviders(<NewCoursePage />);
    expect(screen.getByText('Only instructors can create courses')).toBeTruthy();
  });

  it('validates each step, keeps state when going back and creates the course', async () => {
    const user = userEvent.setup();
    renderWithProviders(<NewCoursePage />, { route: '/courses/new' });

    await user.click(screen.getByRole('button', { name: /Next/ }));
    expect(screen.getByText('Title must be at least 2 characters.')).toBeTruthy();
    expect(screen.getByText('Subject is required.')).toBeTruthy();

    await user.type(screen.getByLabelText(/Course title/), 'Recursion');
    await user.type(screen.getByLabelText(/^Subject/), 'Computer Science');
    await user.click(screen.getByRole('radio', { name: /Advanced/ }));
    await user.type(screen.getByLabelText(/^Tags/), 'Algorithms{Enter}');
    await user.click(screen.getByRole('button', { name: /Next/ }));

    expect(screen.getByText('Step 2 of 3: Material')).toBeTruthy();
    await user.type(screen.getByLabelText(/Learning material/), 'Too short.');
    await user.click(screen.getByRole('button', { name: /Next/ }));
    expect(screen.getByText(/Paste at least 80 characters/)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: /Back/ }));
    expect(screen.getByLabelText(/Course title/)).toHaveProperty('value', 'Recursion');
    await user.click(screen.getByRole('button', { name: /Next/ }));
    const material = screen.getByLabelText(/Learning material/);
    await user.clear(material);
    await user.click(material);
    await user.paste(MATERIAL);
    await user.click(screen.getByRole('button', { name: /Next/ }));

    expect(screen.getByText('Step 3 of 3: Review')).toBeTruthy();
    await user.click(screen.getByRole('radio', { name: /Save as draft/ }));
    await user.click(screen.getByRole('button', { name: /Create draft/ }));

    expect(api.create).toHaveBeenCalledWith(3, {
      title: 'Recursion',
      description: '',
      subject: 'Computer Science',
      difficulty: 'advanced',
      tags: ['algorithms'],
      color: '#1d6d45',
      status: 'draft',
      text: MATERIAL,
    });
  }, 15_000);

  it('shows the server error on the review step', async () => {
    const user = userEvent.setup();
    api.create.mockRejectedValueOnce(new Error('title: must be at most 160 characters'));
    renderWithProviders(<NewCoursePage />);
    await user.type(screen.getByLabelText(/Course title/), 'Recursion');
    await user.type(screen.getByLabelText(/^Subject/), 'CS');
    await user.click(screen.getByRole('button', { name: /Next/ }));
    await user.click(screen.getByLabelText(/Learning material/));
    await user.paste(MATERIAL);
    await user.click(screen.getByRole('button', { name: /Next/ }));
    await user.click(screen.getByRole('button', { name: /Create course/ }));
    expect((await screen.findByRole('alert')).textContent).toContain('must be at most 160 characters');
  });
});
