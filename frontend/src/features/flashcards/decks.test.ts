import { describe, expect, it } from 'vitest';
import { countStatuses, filterCards, filterDecks, groupDecksByCourse, sortDecks, studyAction, validateCard, validateDeck } from './decks';
import type { Card, DeckSummary } from './types';

function deck(id: number, overrides: Partial<DeckSummary> = {}): DeckSummary {
  return {
    id,
    workspace_id: 1,
    course_id: 1,
    course_title: 'Statistics',
    course_color: '#2563eb',
    name: `Deck ${id}`,
    description: '',
    created_by_id: null,
    created_by_name: null,
    created_at: '2022-01-30T10:00:00',
    card_count: 10,
    due: 0,
    new: 0,
    learning: 0,
    young: 0,
    mature: 0,
    mastery: 50,
    retention: null,
    last_reviewed_at: null,
    next_due_at: null,
    can_edit: false,
    ...overrides,
  };
}

function card(id: number, overrides: Partial<Card> = {}): Card {
  return {
    id,
    deck_id: 1,
    concept_id: null,
    concept_name: null,
    front: `Front ${id}`,
    back: `Back ${id}`,
    hint: '',
    position: id,
    created_at: '2022-01-30T10:00:00',
    status: 'new',
    due_at: null,
    interval_days: 0,
    ease: null,
    repetitions: 0,
    lapses: 0,
    reviews: 0,
    last_reviewed_at: null,
    ...overrides,
  };
}

const DECKS = [
  deck(1, { name: 'SQL joins', course_id: 3, course_title: 'Databases', due: 2, mastery: 70 }),
  deck(2, { name: 'Distributions', description: 'Normal and binomial', due: 9, mastery: 20 }),
  deck(3, { name: 'Hypothesis tests', new: 5, mastery: 35 }),
  deck(4, { name: 'Indexes', course_id: 3, course_title: 'Databases', mastery: 90 }),
];

describe('deck list helpers', () => {
  it('filters by course and by words in name, description or course', () => {
    expect(filterDecks(DECKS, { query: '', courseId: 3 }).map((d) => d.id)).toEqual([1, 4]);
    expect(filterDecks(DECKS, { query: 'binomial', courseId: null }).map((d) => d.id)).toEqual([2]);
    expect(filterDecks(DECKS, { query: 'databases index', courseId: null }).map((d) => d.id)).toEqual([4]);
  });

  it('sorts by workload, name, course or weakest first', () => {
    expect(sortDecks(DECKS, 'due').map((d) => d.id)).toEqual([2, 1, 3, 4]);
    expect(sortDecks(DECKS, 'name').map((d) => d.name)).toEqual(['Distributions', 'Hypothesis tests', 'Indexes', 'SQL joins']);
    expect(sortDecks(DECKS, 'course').map((d) => d.id)).toEqual([4, 1, 2, 3]);
    expect(sortDecks(DECKS, 'mastery').map((d) => d.id)).toEqual([2, 3, 1, 4]);
  });

  it('groups decks under their course in order and totals what is due', () => {
    const groups = groupDecksByCourse(sortDecks(DECKS, 'course'));
    expect(groups.map((g) => [g.title, g.decks.map((d) => d.id), g.due])).toEqual([
      ['Databases', [4, 1], 2],
      ['Statistics', [2, 3], 9],
    ]);
  });

  it.each([
    [{ due: 3, new: 4 }, Infinity, { label: 'Review 3', kind: 'due' }],
    [{ due: 0, new: 4 }, Infinity, { label: 'Learn 4 new', kind: 'new' }],
    [{ due: 0, new: 4 }, 2, { label: 'Learn 2 new', kind: 'new' }],
    [{ due: 0, new: 4 }, 0, { label: 'Caught up', kind: 'done' }],
    [{ due: 0, new: 0 }, 20, { label: 'Caught up', kind: 'done' }],
  ])('study action for %j with allowance %s', (counts, allowance, expected) => {
    expect(studyAction(counts, allowance)).toEqual(expected);
  });
});

describe('card list helpers', () => {
  const cards = [
    card(1, { front: 'What is ATP?', status: 'young' }),
    card(2, { front: 'Golgi apparatus', hint: 'post office', status: 'new' }),
    card(3, { back: 'Adenosine triphosphate', concept_name: 'Mitochondria', status: 'mature' }),
  ];

  it('filters by status and searches every text field', () => {
    expect(filterCards(cards, { query: 'post office', status: 'all' }).map((c) => c.id)).toEqual([2]);
    expect(filterCards(cards, { query: 'mitochondria', status: 'all' }).map((c) => c.id)).toEqual([3]);
    expect(filterCards(cards, { query: '', status: 'young' }).map((c) => c.id)).toEqual([1]);
  });

  it('counts cards per status', () => {
    expect(countStatuses(cards)).toEqual({ all: 3, new: 1, learning: 0, young: 1, mature: 1 });
  });
});

describe('validation', () => {
  it('requires a course and a sensible, unique deck name', () => {
    expect(validateDeck({ courseId: null, name: ' x ', description: '' })).toEqual({
      course: 'Choose the course this deck belongs to.',
      name: 'Name must be at least 2 characters.',
    });
    expect(validateDeck({ courseId: 1, name: 'sql Joins', description: '' }, ['SQL joins']).name).toMatch(/already has a deck/);
    expect(validateDeck({ courseId: 1, name: 'Fine', description: 'd'.repeat(501) })).toEqual({ description: 'Description must be at most 500 characters.' });
    expect(validateDeck({ courseId: 1, name: 'Fine', description: '' })).toEqual({});
  });

  it('checks card sides, hint length and duplicate fronts', () => {
    const siblings = [card(1, { front: 'What is ATP?' })];
    expect(validateCard({ front: '  ', back: '', hint: '', concept_id: null })).toEqual({
      front: 'Write the question or prompt.',
      back: 'Write the answer.',
    });
    expect(validateCard({ front: 'what is  atp?', back: 'Energy', hint: '', concept_id: null }, siblings).front).toMatch(/same front/);
    // Editing the card itself is not a duplicate.
    expect(validateCard({ front: 'What is ATP?', back: 'Energy', hint: '', concept_id: null }, siblings, 1)).toEqual({});
    expect(validateCard({ front: 'Q', back: 'A', hint: 'h'.repeat(256), concept_id: null }).hint).toMatch(/255/);
    expect(validateCard({ front: 'Q', back: 'b'.repeat(2001), hint: '', concept_id: null }).back).toMatch(/2000/);
  });
});
