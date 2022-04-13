// Client-side sorting, filtering and paging used by DataTable and list pages.
export type SortDirection = 'asc' | 'desc';
export type SortState<K extends string = string> = { key: K; direction: SortDirection };

type Comparable = string | number | boolean | null | undefined | Date;

export function compareValues(a: Comparable, b: Comparable): number {
  if (a === b) return 0;
  // Missing values sort last in both directions (handled by the caller flipping only present values).
  if (a === null || a === undefined) return 1;
  if (b === null || b === undefined) return -1;
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  if (typeof a === 'string' && typeof b === 'string') return a.localeCompare(b, 'en', { sensitivity: 'base', numeric: true });
  return a < b ? -1 : 1;
}

export function sortBy<T>(rows: readonly T[], value: (row: T) => Comparable, direction: SortDirection): T[] {
  const present = rows.filter((row) => value(row) !== null && value(row) !== undefined);
  const missing = rows.filter((row) => value(row) === null || value(row) === undefined);
  const sign = direction === 'asc' ? 1 : -1;
  // Array.prototype.sort is stable, so equal rows keep their incoming order.
  return [...present].sort((a, b) => sign * compareValues(value(a), value(b))).concat(missing);
}

export function toggleSort<K extends string>(current: SortState<K> | null, key: K): SortState<K> {
  if (!current || current.key !== key) return { key, direction: 'asc' };
  return { key, direction: current.direction === 'asc' ? 'desc' : 'asc' };
}

/** True when every whitespace-separated word of `query` appears in one of the fields (case-insensitive). */
export function matchesQuery(query: string, ...fields: (string | null | undefined)[]): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const haystack = fields.filter(Boolean).join(' ').toLowerCase();
  return words.every((word) => haystack.includes(word));
}

export type PageSlice<T> = { rows: T[]; page: number; pageCount: number; total: number; from: number; to: number };

export function paginate<T>(rows: readonly T[], page: number, pageSize: number): PageSlice<T> {
  const total = rows.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(1, page), pageCount);
  const start = (current - 1) * pageSize;
  const slice = rows.slice(start, start + pageSize);
  return { rows: slice, page: current, pageCount, total, from: total ? start + 1 : 0, to: start + slice.length };
}

/** Page numbers to show in a pager, with `null` for gaps: [1, null, 4, 5, 6, null, 10]. */
export function pageWindow(page: number, pageCount: number, radius = 1): (number | null)[] {
  const pages = new Set([1, pageCount]);
  for (let p = page - radius; p <= page + radius; p += 1) if (p >= 1 && p <= pageCount) pages.add(p);
  const sorted = [...pages].sort((a, b) => a - b);
  const result: (number | null)[] = [];
  sorted.forEach((p, index) => {
    if (index > 0 && p - sorted[index - 1] > 1) result.push(null);
    result.push(p);
  });
  return result;
}

export function groupBy<T, K extends string | number>(rows: readonly T[], key: (row: T) => K): Map<K, T[]> {
  const groups = new Map<K, T[]>();
  for (const row of rows) {
    const k = key(row);
    const list = groups.get(k);
    if (list) list.push(row);
    else groups.set(k, [row]);
  }
  return groups;
}

export function countBy<T, K extends string>(rows: readonly T[], key: (row: T) => K): Record<K, number> {
  const counts = {} as Record<K, number>;
  for (const row of rows) counts[key(row)] = (counts[key(row)] ?? 0) + 1;
  return counts;
}
