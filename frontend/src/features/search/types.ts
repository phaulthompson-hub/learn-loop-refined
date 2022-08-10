/** [start, end) character offsets into the string they accompany. */
export type Range = [number, number];

export type Snippet = { text: string; highlights: Range[] };

export type SearchType = 'course' | 'concept' | 'note' | 'task' | 'card' | 'event';

export type SearchHit = {
  type: SearchType;
  id: number;
  title: string;
  title_highlights: Range[];
  subtitle: string;
  snippet: Snippet | null;
  link: string;
  score: number;
  updated_at: string | null;
};

export type SearchGroup = { type: SearchType; label: string; count: number; items: SearchHit[] };

export type SearchResult = {
  query: string;
  terms: string[];
  total: number;
  counts: Partial<Record<SearchType, number>>;
  groups: SearchGroup[];
};

export const SEARCH_TYPES: SearchType[] = ['note', 'course', 'concept', 'task', 'card', 'event'];

export const TYPE_LABELS: Record<SearchType, string> = {
  course: 'Courses',
  concept: 'Concepts',
  note: 'Notes',
  task: 'Tasks',
  card: 'Flashcards',
  event: 'Events',
};
