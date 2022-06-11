// @vitest-environment jsdom
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../../test/render';
import { flashcardsApi } from '../api';
import { previewIntervals } from '../scheduler';
import type { Grade, ReviewCard, ReviewResult } from '../types';
import { ReviewSession } from './ReviewSession';

vi.mock('../api', () => ({ flashcardsApi: { review: vi.fn(), finishSession: vi.fn() } }));

const review = vi.mocked(flashcardsApi.review);
const finishSession = vi.mocked(flashcardsApi.finishSession);

function card(id: number): ReviewCard {
  const schedule = { ease: 2.5, interval_days: 6, repetitions: 2, lapses: 0 };
  return {
    id,
    deck_id: 7,
    deck_name: 'Cell Biology',
    course_id: 3,
    course_title: 'Biology',
    course_color: '#be123c',
    front: `Question ${id}`,
    back: `Answer ${id}`,
    hint: id === 1 ? 'Think energy' : '',
    concept_name: null,
    status: 'young',
    due_at: '2022-03-14T08:00:00',
    ...schedule,
    previews: previewIntervals(schedule),
  };
}

function reviewed(cardId: number, grade: Grade): ReviewResult {
  const forgot = grade === 0;
  return {
    card_id: cardId,
    grade,
    status: forgot ? 'learning' : 'young',
    ease: forgot ? 2.3 : 2.5,
    interval_before: 6,
    interval_days: forgot ? 0 : 15,
    repetitions: forgot ? 0 : 3,
    lapses: forgot ? 1 : 0,
    due_at: forgot ? '2022-03-14T09:10:00' : '2022-03-29T09:00:00',
    display: forgot ? '10m' : '15d',
  };
}

const press = (key: string) => fireEvent.keyDown(window, { key });

function renderSession(cards = [card(1), card(2)]) {
  return renderWithProviders(<ReviewSession cards={cards} title="Cell Biology" workspaceId={4} deckId={7} exitTo="/decks/7" onStudyMore={vi.fn()} />);
}

describe('ReviewSession', () => {
  beforeEach(() => {
    review.mockReset();
    finishSession.mockReset();
    review.mockImplementation(async (cardId, grade) => reviewed(cardId, grade));
  });

  it('flips with Space and labels the grades with the next intervals', () => {
    renderSession();
    expect(screen.getByText('Question 1', { selector: '.fc-face-text' })).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'How well did you remember?' })).toBeNull();
    press(' ');
    const grades = screen.getByRole('group', { name: 'How well did you remember?' });
    expect([...grades.querySelectorAll('button')].map((b) => b.getAttribute('aria-label'))).toEqual([
      'Again: next review in 10m',
      'Hard: next review in 7d',
      'Good: next review in 15d',
      'Easy: next review in 20d',
    ]);
  });

  it('does not grade before the answer is shown', () => {
    renderSession();
    press('3');
    expect(review).not.toHaveBeenCalled();
  });

  it('grades with number keys and moves to the next card', async () => {
    renderSession();
    press(' ');
    press('3');
    await waitFor(() => expect(screen.getByText('Question 2', { selector: '.fc-face-text' })).toBeTruthy());
    expect(review).toHaveBeenCalledWith(1, 2);
    expect(screen.getByText('1 of 2 answered')).toBeTruthy();
  });

  it('toggles the hint with H', () => {
    renderSession();
    expect(screen.queryByText('Think energy')).toBeNull();
    press('h');
    expect(screen.getByText('Think energy')).toBeTruthy();
  });

  it('brings forgotten cards back, then summarises and logs the session', async () => {
    finishSession.mockResolvedValue({ study_log_id: 1, course_id: 3, minutes: 1, reviewed: 2, accuracy: 50 });
    renderSession();
    press(' ');
    fireEvent.click(screen.getByRole('button', { name: 'Again: next review in 10m' }));
    await screen.findByText('Question 2', { selector: '.fc-face-text' });
    expect(screen.getByText('1 of 3 answered')).toBeTruthy();

    press(' ');
    press('3');
    await screen.findByText('Question 1', { selector: '.fc-face-text' });
    press(' ');
    // A relearning card restarts the ladder: "good" is one day now.
    expect(screen.getByRole('button', { name: 'Good: next review in 1d' })).toBeTruthy();
    press('3');

    await screen.findByText('Session complete');
    expect(screen.getByText('50%')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Finish & log 1 min/ }));
    await screen.findByText(/Logged 1 minute of flashcard practice/);
    expect(finishSession).toHaveBeenCalledWith(4, expect.objectContaining({ deck_id: 7, reviewed: 2, again: 1 }));
    expect(review.mock.calls).toEqual([
      [1, 0],
      [2, 2],
      [1, 2],
    ]);
  });

  it('keeps the card on screen when saving an answer fails', async () => {
    review.mockRejectedValueOnce(new Error('Network down'));
    renderSession();
    press(' ');
    press('4');
    await screen.findByText('Network down');
    expect(screen.getByText('Question 1', { selector: '.fc-face-text' })).toBeTruthy();
    expect(screen.getByText('0 of 2 answered')).toBeTruthy();
  });

  it('ends early with Escape and explains when nothing was answered', () => {
    renderSession();
    press('Escape');
    expect(screen.getByText('No cards reviewed')).toBeTruthy();
    expect(finishSession).not.toHaveBeenCalled();
  });
});
