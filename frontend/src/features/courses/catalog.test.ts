import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FILTERS,
  catalogQuery,
  clearNarrowingFilters,
  filtersToParams,
  hasNarrowingFilters,
  parseFilters,
  updateFilters,
} from './catalog';

const parse = (search: string) => parseFilters(new URLSearchParams(search));

describe('parseFilters', () => {
  it('returns the defaults for an empty URL', () => {
    expect(parse('')).toEqual(DEFAULT_FILTERS);
  });

  it('reads every supported parameter', () => {
    expect(parse('q=ml&status=draft&subject=Biology&difficulty=advanced&tag=exam-1&mine=1&sort=title&page=3&view=list')).toEqual({
      q: 'ml',
      status: 'draft',
      subject: 'Biology',
      difficulty: 'advanced',
      tag: 'exam-1',
      mine: true,
      sort: 'title',
      page: 3,
      view: 'list',
    });
  });

  it('falls back to defaults for invalid values instead of sending them to the API', () => {
    const filters = parse('status=deleted&difficulty=expert&sort=-owner&page=-2&view=cards&mine=yes');
    expect(filters.status).toBe('active');
    expect(filters.difficulty).toBe('');
    expect(filters.sort).toBe('-updated_at');
    expect(filters.page).toBe(1);
    expect(filters.view).toBe('grid');
    expect(filters.mine).toBe(false);
  });

  it('caps the search text at the API limit', () => {
    expect(parse(`q=${'x'.repeat(150)}`).q).toHaveLength(100);
  });
});

describe('filtersToParams', () => {
  it('omits defaults so the plain catalogue URL stays clean', () => {
    expect(filtersToParams(DEFAULT_FILTERS).toString()).toBe('');
  });

  it('round-trips through the URL', () => {
    const filters = { ...DEFAULT_FILTERS, q: 'neural', status: 'all' as const, tag: 'ml', mine: true, page: 2, view: 'list' as const };
    expect(parseFilters(filtersToParams(filters))).toEqual(filters);
  });

  it('trims the search text', () => {
    expect(filtersToParams({ ...DEFAULT_FILTERS, q: '  sql  ' }).get('q')).toBe('sql');
  });
});

describe('updateFilters', () => {
  const onPage3 = { ...DEFAULT_FILTERS, page: 3 };

  it('returns to page 1 when a filter changes', () => {
    expect(updateFilters(onPage3, { subject: 'Biology' }).page).toBe(1);
    expect(updateFilters(onPage3, { sort: 'title' }).page).toBe(1);
  });

  it('keeps the page when only paging or the layout changes', () => {
    expect(updateFilters(onPage3, { view: 'list' }).page).toBe(3);
    expect(updateFilters(onPage3, { page: 4 }).page).toBe(4);
  });
});

describe('narrowing filters', () => {
  it('ignores status, sort and layout but not search, subject, tag or "my courses"', () => {
    expect(hasNarrowingFilters({ ...DEFAULT_FILTERS, status: 'all', sort: 'title', view: 'list' })).toBe(false);
    expect(hasNarrowingFilters({ ...DEFAULT_FILTERS, q: '  ' })).toBe(false);
    expect(hasNarrowingFilters({ ...DEFAULT_FILTERS, mine: true })).toBe(true);
    expect(hasNarrowingFilters({ ...DEFAULT_FILTERS, tag: 'ml' })).toBe(true);
  });

  it('clears them while keeping the status tab and sort order', () => {
    const cleared = clearNarrowingFilters({ ...DEFAULT_FILTERS, q: 'x', subject: 'Bio', difficulty: 'intro', tag: 't', mine: true, status: 'draft', sort: 'title', page: 4 });
    expect(cleared).toEqual({ ...DEFAULT_FILTERS, status: 'draft', sort: 'title' });
  });
});

describe('catalogQuery', () => {
  it('maps filters onto API query parameters', () => {
    expect(catalogQuery({ ...DEFAULT_FILTERS, q: ' ml ', mine: true, page: 2 }, 12)).toEqual({
      q: 'ml',
      status: 'active',
      subject: undefined,
      difficulty: undefined,
      tag: undefined,
      enrolled: true,
      sort: '-updated_at',
      page: 2,
      page_size: 12,
    });
  });

  it('does not filter by enrolment unless "my courses" is on', () => {
    expect(catalogQuery(DEFAULT_FILTERS, 12).enrolled).toBeUndefined();
  });
});
