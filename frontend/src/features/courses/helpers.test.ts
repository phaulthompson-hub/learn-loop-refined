import { describe, expect, it } from 'vitest';
import { optionForKey, quizLength, roundHeadline, summariseRound } from './quiz';
import { canDeleteCourse, canEditCourse, changedDetails, confirmsTitle, isDirty, moveItem } from './settings';
import { highlightSegments, termCounts, tutorSuggestions } from './text';
import type { AnswerResult, Concept, CourseDetails } from './types';
import { firstInvalidStep, initialWizard, materialStats, validateStep, type FileLike, type WizardState } from './wizard';

const result = (concept_id: number, previous: number, mastery: number, correct: boolean): AnswerResult => ({
  correct,
  correct_index: 0,
  concept_id,
  concept: `C${concept_id}`,
  previous_mastery: previous,
  mastery,
  recommendation: { concept_id: null, concept: null, mastery: null, reason: '' },
});

describe('quiz helpers', () => {
  it('clamps the preferred round length to 1–10', () => {
    expect(quizLength(4)).toBe(4);
    expect(quizLength(0)).toBe(4);
    expect(quizLength(25)).toBe(10);
    expect(quizLength(null)).toBe(4);
  });

  it('maps number and letter keys to options', () => {
    expect(optionForKey('1', 4)).toBe(0);
    expect(optionForKey('4', 4)).toBe(3);
    expect(optionForKey('5', 4)).toBeNull();
    expect(optionForKey('B', 4)).toBe(1);
    expect(optionForKey('Enter', 4)).toBeNull();
  });

  it('summarises a round per concept, from the first "before" to the last "after"', () => {
    const summary = summariseRound([result(1, 35, 53.2, true), result(2, 40, 28.8, false), result(1, 53.2, 66.3, true), result(3, 82.5, 87.4, true)]);
    expect(summary.total).toBe(4);
    expect(summary.correct).toBe(3);
    expect(summary.accuracy).toBe(75);
    expect(summary.concepts.find((c) => c.conceptId === 1)).toMatchObject({ before: 35, after: 66.3, answers: 2, correct: 2 });
    expect(summary.netChange).toBe(Math.round((31.3 - 11.2 + 4.9) * 10) / 10);
    expect(summary.newlyMastered).toEqual(['C3']);
    expect(roundHeadline(summary)).toBe('Strong round');
  });

  it('handles an empty round', () => {
    expect(summariseRound([])).toMatchObject({ total: 0, accuracy: 0, netChange: 0 });
    expect(roundHeadline(summariseRound([]))).toBe('No questions answered');
  });
});

describe('settings helpers', () => {
  const saved: CourseDetails = { title: 'SQL', description: 'Joins', subject: 'Data', difficulty: 'intro', tags: ['sql'], color: '#1d6d45' };

  it('reports only fields that really changed', () => {
    expect(changedDetails(saved, { ...saved, title: '  SQL  ' })).toEqual({});
    expect(changedDetails(saved, { ...saved, title: 'SQL 2', tags: ['sql', 'db'], color: '#1D6D45' })).toEqual({ title: 'SQL 2', tags: ['sql', 'db'] });
    expect(isDirty(saved, { ...saved, difficulty: 'advanced' })).toBe(true);
  });

  it('moves items within bounds', () => {
    expect(moveItem(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c']);
    expect(moveItem(['a', 'b', 'c'], 2, -2)).toEqual(['c', 'a', 'b']);
    expect(moveItem(['a', 'b', 'c'], 2, 1)).toEqual(['a', 'b', 'c']);
  });

  it('mirrors the API permission rules', () => {
    const course = { owner_id: 7, workspace_id: 1 };
    expect(canEditCourse(course, 7, 'learner')).toBe(true);
    expect(canEditCourse(course, 8, 'learner')).toBe(false);
    expect(canEditCourse(course, 8, 'instructor')).toBe(true);
    expect(canDeleteCourse(course, 8, 'instructor')).toBe(false);
    expect(canDeleteCourse(course, 8, 'admin')).toBe(true);
  });

  it('needs the exact title to confirm deletion', () => {
    expect(confirmsTitle(' SQL ', 'SQL')).toBe(true);
    expect(confirmsTitle('sql', 'SQL')).toBe(false);
  });
});

describe('text helpers', () => {
  it('highlights whole words, plurals included, preferring longer terms', () => {
    const segments = highlightSegments('A primary key and two keys. Keyboard!', ['key', 'primary key']);
    expect(segments.filter((s) => s.term).map((s) => [s.text, s.term])).toEqual([
      ['primary key', 'primary key'],
      ['keys', 'key'],
    ]);
    expect(segments.map((s) => s.text).join('')).toBe('A primary key and two keys. Keyboard!');
  });

  it('counts term occurrences case-insensitively', () => {
    expect(termCounts('Loss and LOSS, but not glossary.', ['Loss']).get('Loss')).toBe(2);
  });

  it('suggests tutor questions for the weakest unlocked concepts', () => {
    const concept = (id: number, name: string, mastery: number, unlocked = true): Concept => ({
      id,
      name,
      summary: '',
      mastery,
      order_index: id,
      prerequisite_id: null,
      level: 'learning',
      unlocked,
    });
    const suggestions = tutorSuggestions([concept(1, 'Model', 70), concept(2, 'Loss', 40), concept(3, 'Gradient Descent', 20, false)]);
    expect(suggestions[0]).toBe('Explain loss more simply');
    expect(suggestions.join(' ')).not.toContain('gradient descent');
  });
});

describe('wizard', () => {
  const valid = (): WizardState<FileLike> => {
    const state = initialWizard<FileLike>();
    return { ...state, details: { ...state.details, title: 'Genetics', subject: 'Biology' }, text: 'x'.repeat(90) };
  };

  it('validates each step on its own', () => {
    const empty = initialWizard<FileLike>();
    expect(Object.keys(validateStep('details', empty))).toEqual(['title', 'subject']);
    expect(Object.keys(validateStep('material', empty))).toEqual(['text']);
    expect(validateStep('material', { ...empty, mode: 'upload' })).toEqual({ file: 'Choose a PDF, TXT, or Markdown file.' });
    expect(validateStep('details', valid())).toEqual({});
  });

  it('points "create" at the first step that needs attention', () => {
    expect(firstInvalidStep(initialWizard<FileLike>())).toBe('details');
    expect(firstInvalidStep({ ...valid(), text: 'short' })).toBe('material');
    expect(firstInvalidStep({ ...valid(), mode: 'upload', file: { name: 'notes.md', size: 20 } })).toBeNull();
    expect(firstInvalidStep(valid())).toBeNull();
  });

  it('measures pasted material', () => {
    expect(materialStats('   ')).toEqual({ characters: 0, words: 0, sentences: 0, readingMinutes: 0 });
    const text = 'Photosynthesis converts light energy into chemical energy. ' + 'Short. ';
    expect(materialStats(text)).toMatchObject({ words: 8, sentences: 1, readingMinutes: 1 });
  });
});
