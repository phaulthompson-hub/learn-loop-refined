// Catalogue filter state <-> URL search params <-> API query, kept pure so it can be unit tested.
import type { CourseStatus, Difficulty } from './types';

export type CatalogStatus = CourseStatus | 'all';
export type CatalogView = 'grid' | 'list';

export const DIFFICULTIES: Difficulty[] = ['intro', 'intermediate', 'advanced'];

export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  intro: 'Intro',
  intermediate: 'Intermediate',
  advanced: 'Advanced',
};

export const STATUS_LABELS: Record<CatalogStatus, string> = {
  active: 'Active',
  draft: 'Drafts',
  archived: 'Archived',
  all: 'All',
};

export const SORT_OPTIONS = [
  { value: '-updated_at', label: 'Recently updated' },
  { value: '-last_opened_at', label: 'Recently opened' },
  { value: '-created_at', label: 'Newest first' },
  { value: 'title', label: 'Title A–Z' },
  { value: '-mastery', label: 'Highest mastery' },
  { value: 'mastery', label: 'Lowest mastery' },
  { value: '-learners', label: 'Most learners' },
  { value: 'difficulty', label: 'Easiest first' },
] as const;

export type CatalogFilters = {
  q: string;
  status: CatalogStatus;
  subject: string;
  difficulty: Difficulty | '';
  tag: string;
  /** Only courses I follow ("My courses"). */
  mine: boolean;
  sort: string;
  page: number;
  view: CatalogView;
};

export const DEFAULT_FILTERS: CatalogFilters = {
  q: '',
  status: 'active',
  subject: '',
  difficulty: '',
  tag: '',
  mine: false,
  sort: '-updated_at',
  page: 1,
  view: 'grid',
};

const STATUSES: CatalogStatus[] = ['active', 'draft', 'archived', 'all'];

function oneOf<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  return value !== null && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

/** Read filters from the URL, falling back to defaults for anything missing or invalid. */
export function parseFilters(params: URLSearchParams): CatalogFilters {
  const page = Number.parseInt(params.get('page') ?? '', 10);
  return {
    q: (params.get('q') ?? '').slice(0, 100),
    status: oneOf(params.get('status'), STATUSES, DEFAULT_FILTERS.status),
    subject: params.get('subject') ?? '',
    difficulty: oneOf<Difficulty | ''>(params.get('difficulty'), ['', ...DIFFICULTIES], ''),
    tag: params.get('tag') ?? '',
    mine: params.get('mine') === '1',
    sort: oneOf(
      params.get('sort'),
      SORT_OPTIONS.map((option) => option.value),
      DEFAULT_FILTERS.sort,
    ),
    page: Number.isFinite(page) && page > 0 ? page : 1,
    view: oneOf(params.get('view'), ['grid', 'list'] as const, DEFAULT_FILTERS.view),
  };
}

/** Only non-default values go into the URL, so a fresh catalogue has a clean `/courses`. */
export function filtersToParams(filters: CatalogFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.q.trim()) params.set('q', filters.q.trim());
  if (filters.status !== DEFAULT_FILTERS.status) params.set('status', filters.status);
  if (filters.subject) params.set('subject', filters.subject);
  if (filters.difficulty) params.set('difficulty', filters.difficulty);
  if (filters.tag) params.set('tag', filters.tag);
  if (filters.mine) params.set('mine', '1');
  if (filters.sort !== DEFAULT_FILTERS.sort) params.set('sort', filters.sort);
  if (filters.page > 1) params.set('page', String(filters.page));
  if (filters.view !== DEFAULT_FILTERS.view) params.set('view', filters.view);
  return params;
}

/** Apply a change; any change other than paging or the view mode sends the user back to page 1. */
export function updateFilters(filters: CatalogFilters, patch: Partial<CatalogFilters>): CatalogFilters {
  const keepsPage = Object.keys(patch).every((key) => key === 'page' || key === 'view');
  return { ...filters, ...patch, page: patch.page ?? (keepsPage ? filters.page : 1) };
}

export function hasNarrowingFilters(filters: CatalogFilters): boolean {
  return Boolean(filters.q.trim() || filters.subject || filters.difficulty || filters.tag || filters.mine);
}

export function clearNarrowingFilters(filters: CatalogFilters): CatalogFilters {
  return { ...filters, q: '', subject: '', difficulty: '', tag: '', mine: false, page: 1 };
}

/** Query parameters for `GET /workspaces/{id}/courses`. */
export function catalogQuery(filters: CatalogFilters, pageSize: number) {
  return {
    q: filters.q.trim() || undefined,
    status: filters.status,
    subject: filters.subject || undefined,
    difficulty: filters.difficulty || undefined,
    tag: filters.tag || undefined,
    enrolled: filters.mine ? true : undefined,
    sort: filters.sort,
    page: filters.page,
    page_size: pageSize,
  };
}
