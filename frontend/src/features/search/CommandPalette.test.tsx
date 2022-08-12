// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../test/render';
import { searchWorkspace } from './api';
import { CommandPalette } from './CommandPalette';
import { loadRecent, saveRecent } from './recent';
import type { SearchResult } from './types';

vi.mock('../../app/auth', () => ({
  useWorkspace: () => ({ id: 7, name: 'Northwind', slug: 'northwind', color: '#1d6d45', role: 'learner', can: () => false }),
}));
vi.mock('./api', () => ({ searchWorkspace: vi.fn() }));

const RESULT: SearchResult = {
  query: 'joins',
  terms: ['joins'],
  total: 2,
  counts: { note: 1, task: 1 },
  groups: [
    {
      type: 'note',
      label: 'Notes',
      count: 1,
      items: [
        {
          type: 'note',
          id: 3,
          title: 'SQL joins field guide',
          title_highlights: [[4, 9]],
          subtitle: 'Relational Databases & SQL',
          snippet: { text: 'Every join is a match', highlights: [[6, 10]] },
          link: '/notes/3',
          score: 90,
          updated_at: '2022-03-11T21:00:00',
        },
      ],
    },
    {
      type: 'task',
      label: 'Tasks',
      count: 1,
      items: [
        { type: 'task', id: 9, title: 'Practise joins', title_highlights: [[9, 14]], subtitle: 'LL-4 · Todo', snippet: null, link: '/board?task=4', score: 36, updated_at: null },
      ],
    },
  ],
};

function Location() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname + location.search}</output>;
}

function renderPalette() {
  const onClose = vi.fn();
  renderWithProviders(
    <>
      <CommandPalette onClose={onClose} />
      <Location />
    </>,
  );
  return { onClose, input: screen.getByRole('combobox'), user: userEvent.setup() };
}

describe('CommandPalette', () => {
  beforeEach(() => {
    vi.mocked(searchWorkspace).mockReset().mockResolvedValue(RESULT);
  });

  it('shows quick actions first and runs the highlighted one with the keyboard', async () => {
    const { onClose, input, user } = renderPalette();
    expect(input).toBe(document.activeElement);
    const options = screen.getAllByRole('option');
    expect(options[0].textContent).toContain('New note');
    expect(options[0].getAttribute('aria-selected')).toBe('true');
    await user.keyboard('{ArrowDown}');
    expect(screen.getAllByRole('option')[1].getAttribute('aria-selected')).toBe('true');
    expect(input.getAttribute('aria-activedescendant')).toBe(screen.getAllByRole('option')[1].id);
    await user.keyboard('{ArrowUp}{ArrowUp}');
    expect(screen.getAllByRole('option').at(-1)?.getAttribute('aria-selected')).toBe('true'); // wraps around
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    expect(screen.getByTestId('location').textContent).toBe('/board?new=1');
    expect(onClose).toHaveBeenCalled();
    expect(searchWorkspace).not.toHaveBeenCalled();
  });

  it('searches as you type and opens a result, remembering the query', async () => {
    const { onClose, input, user } = renderPalette();
    await user.type(input, 'joins');
    await waitFor(() => expect(screen.getByText('Notes')).toBeTruthy());
    expect(searchWorkspace).toHaveBeenLastCalledWith(7, 'joins', { types: undefined, limit: 4 });
    const note = screen.getAllByRole('option').find((o) => o.textContent?.includes('SQL joins field guide'))!;
    expect(note.querySelector('mark')?.textContent).toBe('joins');
    await user.hover(note);
    await user.keyboard('{Enter}');
    expect(screen.getByTestId('location').textContent).toBe('/notes/3');
    expect(onClose).toHaveBeenCalled();
    expect(loadRecent(7)).toEqual(['joins']);
  });

  it('offers all results on the search page and closes on Escape', async () => {
    const { onClose, input, user } = renderPalette();
    await user.type(input, 'joins');
    const all = await screen.findByText(/See all results/);
    await user.click(all);
    expect(screen.getByTestId('location').textContent).toBe('/search?q=joins');
    onClose.mockClear();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('lists recent searches and fills the box when one is chosen', async () => {
    saveRecent(7, ['window functions', 'joins']);
    const { input, user } = renderPalette();
    expect(screen.getByText('Recent searches')).toBeTruthy();
    await user.keyboard('{Enter}');
    expect((input as HTMLInputElement).value).toBe('window functions');
    await user.clear(input);
    await user.click(screen.getByRole('button', { name: 'Remove “joins” from recent searches' }));
    expect(loadRecent(7)).toEqual(['window functions']);
  });

  it('says so when nothing matches', async () => {
    vi.mocked(searchWorkspace).mockResolvedValue({ query: 'zzz', terms: ['zzz'], total: 0, counts: {}, groups: [] });
    const { input, user } = renderPalette();
    await user.type(input, 'zzz');
    expect(await screen.findByText(/No notes, courses, tasks, cards or events match/)).toBeTruthy();
  });
});
