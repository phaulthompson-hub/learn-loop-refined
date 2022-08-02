import { useCallback, useEffect, useRef, useState } from 'react';
import { NOTES_PAGE_SIZE, notesApi } from './api';
import type { NoteCounts, NoteFilters, NoteSummary } from './types';

type ListState = { key: string; items: NoteSummary[]; total: number; counts: NoteCounts | null; error: string | null };

const MAX_PAGE_SIZE = 100;

/**
 * The note list for the current filters. Unlike `useLoader`, the previous items stay on screen while
 * a refresh is in flight (autosave refreshes the list often), and "load more" appends pages.
 */
export function useNoteList(workspaceId: number, filters: NoteFilters) {
  const key = `${workspaceId}|${JSON.stringify(filters)}`;
  const [state, setState] = useState<ListState>({ key: '', items: [], total: 0, counts: null, error: null });
  const [version, setVersion] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const loaded = useRef(0);

  useEffect(() => {
    let cancelled = false;
    // A refresh reloads everything already shown, so "load more" progress is kept.
    const size = Math.min(MAX_PAGE_SIZE, Math.max(NOTES_PAGE_SIZE, loaded.current));
    notesApi.list(workspaceId, filters, 1, size).then(
      (page) => {
        if (cancelled) return;
        loaded.current = page.items.length;
        setState({ key, items: page.items, total: page.total, counts: page.counts, error: null });
      },
      (err: Error) => !cancelled && setState((previous) => ({ ...previous, key, error: err.message })),
    );
    return () => {
      cancelled = true;
    };
    // `filters` is captured through `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, version, workspaceId]);

  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  const loadMore = useCallback(() => {
    const nextPage = Math.floor(state.items.length / NOTES_PAGE_SIZE) + 1;
    setLoadingMore(true);
    notesApi
      .list(workspaceId, filters, nextPage)
      .then((page) => {
        setState((previous) => {
          const seen = new Set(previous.items.map((n) => n.id));
          const items = [...previous.items, ...page.items.filter((n) => !seen.has(n.id))];
          loaded.current = items.length;
          return { ...previous, items, total: page.total, counts: page.counts };
        })
      })
      .catch((err: Error) => setState((previous) => ({ ...previous, error: err.message })))
      .finally(() => setLoadingMore(false));
  }, [filters, state.items.length, workspaceId]);

  const fresh = state.key === key;
  return {
    items: fresh || state.key.startsWith(`${workspaceId}|`) ? state.items : [],
    total: state.total,
    counts: state.counts,
    error: state.error,
    loading: !fresh,
    loadingMore,
    refresh,
    loadMore,
  };
}
