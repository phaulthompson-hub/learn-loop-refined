import { describe, expect, it } from 'vitest';
import { actorName, appendPage, dayLabel, groupByDay, objectTypeLabel, verbMeta } from './activityLogic';

const NOW = new Date('2022-03-14T09:00:00Z');

describe('groupByDay', () => {
  it('groups consecutive items by UTC day with friendly labels', () => {
    const items = [
      { id: 5, created_at: '2022-03-14T08:10:00' },
      { id: 4, created_at: '2022-03-14T00:05:00' },
      { id: 3, created_at: '2022-03-13T23:59:00' },
      { id: 2, created_at: '2022-03-10T10:00:00' },
    ];
    const groups = groupByDay(items, NOW);
    expect(groups.map((g) => [g.label, g.items.map((i) => i.id)])).toEqual([
      ['Today', [5, 4]],
      ['Yesterday', [3]],
      ['Thursday 10 March', [2]],
    ]);
    expect(groups[0].key).toBe('2022-03-14');
  });

  it('returns no groups for no items', () => {
    expect(groupByDay([], NOW)).toEqual([]);
  });

  it('labels days relative to now', () => {
    expect(dayLabel('2022-03-14T23:00:00', NOW)).toBe('Today');
    expect(dayLabel('2022-03-13T00:00:00', NOW)).toBe('Yesterday');
    expect(dayLabel('2022-03-12T12:00:00', NOW)).toBe('Saturday 12 March');
  });
});

describe('verbMeta', () => {
  it('knows the core verbs', () => {
    expect(verbMeta('concept.mastered')).toEqual({ kind: 'mastery', label: 'Mastered' });
    expect(verbMeta('course.published')).toEqual({ kind: 'publish', label: 'Published' });
    expect(verbMeta('course.active')).toEqual({ kind: 'publish', label: 'Published' });
    expect(verbMeta('quiz.completed').kind).toBe('quiz');
    expect(verbMeta('member.joined').kind).toBe('member');
  });

  it('falls back to the verb prefix, then the object type', () => {
    expect(verbMeta('task.moved')).toEqual({ kind: 'task', label: 'Board' });
    expect(verbMeta('deck.created').kind).toBe('deck');
    expect(verbMeta('shared', 'note').kind).toBe('note');
    expect(verbMeta('badge.earned', 'badge')).toEqual({ kind: 'other', label: 'Badge' });
  });
});

describe('helpers', () => {
  it('labels object types', () => {
    expect(objectTypeLabel('task')).toBe('Board tasks');
    expect(objectTypeLabel('study_log')).toBe('Study log');
  });

  it('appends pages without duplicating items', () => {
    const merged = appendPage([{ id: 3 }, { id: 2 }], [{ id: 2 }, { id: 1 }]);
    expect(merged.map((i) => i.id)).toEqual([3, 2, 1]);
  });

  it('names system entries', () => {
    expect(actorName({ actor: null })).toBe('LearnLoop');
    expect(actorName({ actor: { id: 1, name: 'Maya Chen', avatar_color: '#000' } })).toBe('Maya Chen');
  });
});
