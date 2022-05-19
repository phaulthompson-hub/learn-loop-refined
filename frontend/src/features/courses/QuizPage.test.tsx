// @vitest-environment jsdom
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { renderWithProviders } from '../../test/render';
import { courseApi } from './api';
import { QuizPage } from './QuizPage';
import type { AnswerResult, Course, Question } from './types';

const reloadCourse = vi.fn();

vi.mock('../../app/auth', () => ({ useUser: () => ({ quiz_length: 2 }) }));
vi.mock('./api', () => ({ courseApi: { quiz: vi.fn(), answer: vi.fn() } }));
vi.mock('./courseContext', () => ({
  useCourse: () => ({
    course: { id: 7, concepts: [{ id: 1 }, { id: 2 }] } as unknown as Course,
    reload: reloadCourse,
  }),
}));

const api = courseApi as unknown as { quiz: Mock; answer: Mock };

const questions: Question[] = [
  { id: '7:1', concept_id: 1, concept: 'Loss Function', prompt: 'Which statement best explains Loss Function?', options: ['A1', 'B1', 'C1', 'D1'] },
  { id: '7:2', concept_id: 2, concept: 'Gradient Descent', prompt: 'Which statement best explains Gradient Descent?', options: ['A2', 'B2', 'C2', 'D2'] },
];

const graded = (question: Question, correct: boolean, previous: number, mastery: number): AnswerResult => ({
  correct,
  correct_index: 1,
  concept_id: question.concept_id,
  concept: question.concept,
  previous_mastery: previous,
  mastery,
  recommendation: { concept_id: 2, concept: 'Gradient Descent', mastery, reason: 'Gradient Descent is your weakest open concept.' },
});

describe('QuizPage', () => {
  beforeEach(() => {
    api.quiz.mockReset().mockResolvedValue(questions);
    api.answer.mockReset();
    reloadCourse.mockReset();
  });

  it('asks for as many questions as the user prefers', async () => {
    renderWithProviders(<QuizPage />);
    await screen.findByText(questions[0].prompt);
    expect(api.quiz).toHaveBeenCalledWith(7, 2);
    expect(screen.getByText('Round 1 · Question 1 of 2')).toBeTruthy();
  });

  it('answers with number keys, shows the mastery change and ends with a round summary', async () => {
    const user = userEvent.setup();
    api.answer.mockResolvedValueOnce(graded(questions[0], true, 35, 53.2)).mockResolvedValueOnce(graded(questions[1], false, 35, 25.2));
    renderWithProviders(<QuizPage />);
    await screen.findByText(questions[0].prompt);

    await user.keyboard('2');
    expect(api.answer).toHaveBeenCalledWith(7, questions[0], 1);
    expect(await screen.findByText('Correct!')).toBeTruthy();
    expect(screen.getByText('(+18.2)')).toBeTruthy();
    expect(reloadCourse).toHaveBeenCalledTimes(1);

    // The "Next question" button takes focus, so Enter moves on.
    await user.keyboard('{Enter}');
    await screen.findByText(questions[1].prompt);
    await user.click(screen.getByRole('button', { name: /A2/ }));
    expect(api.answer).toHaveBeenLastCalledWith(7, questions[1], 0);
    expect(await screen.findByText(/Not quite — the answer was option 2/)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: /See results/ }));
    expect(await screen.findByText('Solid progress')).toBeTruthy();
    expect(screen.getByText(/1 of 2 correct/)).toBeTruthy();
    expect(screen.getByText(/Gradient Descent is your weakest open concept/)).toBeTruthy();
  });

  it('keeps the question open when grading fails', async () => {
    const user = userEvent.setup();
    api.answer.mockRejectedValueOnce(new Error('Invalid question'));
    renderWithProviders(<QuizPage />);
    await screen.findByText(questions[0].prompt);
    await user.keyboard('1');
    expect((await screen.findByRole('alert')).textContent).toContain('Invalid question');
    expect(screen.getAllByRole('button', { name: /A1|B1|C1|D1/ }).every((b) => !b.hasAttribute('disabled'))).toBe(true);
  });
});
