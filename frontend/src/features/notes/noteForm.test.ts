import { describe, expect, it } from 'vitest';
import { listParams } from './api';
import { buildTitleIndex, completeWikilink, normaliseTitle, suggestTitles, wikilinkQueryAt } from './links';
import { addTags, diffDraft, emptyDraft, isDirty, normaliseTag, validateDraft } from './noteForm';
import type { NoteDraft, NoteFilters, NoteTitle } from './types';

const draft = (patch: Partial<NoteDraft> = {}): NoteDraft => ({ ...emptyDraft('Joins'), ...patch });
const title = (id: number, text: string, mine: boolean, updated = '2022-03-08T09:00:00'): NoteTitle => ({ id, title: text, mine, updated_at: updated });

describe('tags', () => {
  it('normalises like the API', () => {
    expect(normaliseTag('  #Machine Learning ')).toBe('machine-learning');
    expect(normaliseTag('l2/penalty!')).toBe('l2penalty');
    expect(normaliseTag('--a -- b--')).toBe('a-b');
  });

  it('adds comma-separated tags without duplicates', () => {
    expect(addTags(['sql'], 'SQL, joins,  , #Joins')).toEqual({ tags: ['sql', 'joins'], error: null });
  });

  it('rejects overlong tags and tags beyond the limit but keeps valid ones', () => {
    expect(addTags([], `ok, ${'x'.repeat(25)}`)).toEqual({ tags: ['ok'], error: 'Tags can be at most 24 characters.' });
    const nine = Array.from({ length: 9 }, (_, i) => `t${i}`);
    expect(addTags(nine, 'ten, eleven')).toEqual({ tags: [...nine, 'ten'], error: 'A note can have at most 10 tags.' });
  });
});

describe('validateDraft', () => {
  it('requires a title within 160 characters', () => {
    expect(validateDraft(draft({ title: '   ' })).title).toBe('Give the note a title.');
    expect(validateDraft(draft({ title: 'x'.repeat(161) })).title).toMatch(/at most 160/);
    expect(validateDraft(draft({ title: 'x'.repeat(160) }))).toEqual({});
  });

  it('limits the body to 50,000 characters', () => {
    expect(validateDraft(draft({ body: 'x'.repeat(50_001) })).body).toMatch(/50,000/);
    expect(validateDraft(draft({ body: 'x'.repeat(50_000) }))).toEqual({});
  });
});

describe('diffDraft', () => {
  it('returns only changed fields, comparing titles trimmed', () => {
    const saved = draft({ body: 'a', tags: ['x'] });
    expect(diffDraft(saved, { ...saved, title: ' Joins ' })).toEqual({});
    expect(diffDraft(saved, { ...saved, title: ' Keys ', body: 'b' })).toEqual({ title: 'Keys', body: 'b' });
    expect(diffDraft(saved, { ...saved, tags: ['x', 'y'] })).toEqual({ tags: ['x', 'y'] });
  });

  it('sends the cleared concept along with a course change', () => {
    const saved = draft({ course_id: 1, concept_id: 5 });
    expect(diffDraft(saved, { ...saved, course_id: 2, concept_id: null })).toEqual({ course_id: 2, concept_id: null });
    expect(diffDraft(saved, { ...saved, course_id: null, concept_id: null })).toEqual({ course_id: null, concept_id: null });
  });

  it('drives the dirty flag', () => {
    expect(isDirty(draft(), draft())).toBe(false);
    expect(isDirty(draft(), draft({ body: 'new' }))).toBe(true);
  });
});

describe('wiki link helpers', () => {
  it('resolves titles preferring own notes, then the most recent', () => {
    const index = buildTitleIndex([
      title(1, 'Joins', false, '2022-03-10T09:00:00'),
      title(2, 'joins', true, '2022-02-27T09:00:00'),
      title(3, 'Keys', false, '2022-02-27T09:00:00'),
      title(4, 'KEYS ', false, '2022-03-03T09:00:00'),
    ]);
    expect(index.get(normaliseTitle('JOINS'))?.id).toBe(2);
    expect(index.get('keys')?.id).toBe(4);
  });

  it('detects an unfinished [[ before the caret', () => {
    expect(wikilinkQueryAt('See [[Gra', 9)).toEqual({ start: 4, query: 'Gra' });
    expect(wikilinkQueryAt('See [[', 6)).toEqual({ start: 4, query: '' });
    expect(wikilinkQueryAt('See [[Done]] and', 16)).toBeNull();
    expect(wikilinkQueryAt('See [[Title|ali', 15)).toBeNull();
    expect(wikilinkQueryAt('Code `[[x', 9)).toBeNull();
    expect(wikilinkQueryAt('[[a\nnext line', 13)).toBeNull();
  });

  it('completes the link and places the caret after it', () => {
    expect(completeWikilink('See [[Gra and more', 4, 9, 'Gradient descent')).toEqual({ text: 'See [[Gradient descent]] and more', caret: 24 });
    // An auto-closed "]]" after the caret is reused rather than doubled.
    expect(completeWikilink('See [[Gra]]', 4, 9, 'Gradient descent').text).toBe('See [[Gradient descent]]');
  });

  it('ranks suggestions by prefix, word start, then substring, excluding the current note', () => {
    const titles = [title(1, 'Loss functions', true), title(2, 'Gradient descent', true), title(3, 'Why gradients vanish', false), title(4, 'Upgrade notes', true)];
    expect(suggestTitles(titles, 'grad', null).map((t) => t.id)).toEqual([2, 3, 4]);
    expect(suggestTitles(titles, 'grad', 2).map((t) => t.id)).toEqual([3, 4]);
    expect(suggestTitles(titles, 'zzz', null)).toEqual([]);
    expect(suggestTitles(titles, '', null, 2)).toHaveLength(2);
  });
});

describe('listParams', () => {
  const filters: NoteFilters = { tab: 'mine', q: '', tag: null, courseId: null, sort: 'updated_at' };

  it('maps tabs onto author and archived filters', () => {
    expect(listParams(filters)).toMatchObject({ author: 'me', archived: undefined, sort: '-updated_at' });
    expect(listParams({ ...filters, tab: 'shared' })).toMatchObject({ author: 'others' });
    expect(listParams({ ...filters, tab: 'archived' })).toMatchObject({ author: 'me', archived: true });
  });

  it('lets the API rank by relevance while searching with the default sort', () => {
    expect(listParams({ ...filters, q: ' joins ' })).toMatchObject({ q: 'joins', sort: undefined });
    expect(listParams({ ...filters, q: 'joins', sort: 'title' })).toMatchObject({ sort: 'title' });
    expect(listParams({ ...filters, sort: 'created_at' }, 2, 50)).toMatchObject({ sort: '-created_at', page: 2, page_size: 50 });
  });
});
