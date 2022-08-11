import { useEffect, useState } from 'react';
import { searchWorkspace } from './api';
import type { SearchResult, SearchType } from './types';
import { useDebouncedValue } from './useDebouncedValue';

type SearchState = { key: string; result: SearchResult | null; error: string | null };

/**
 * Debounced workspace search. Responses for outdated queries are dropped, and the previous result
 * stays visible while the next one loads so the list does not flicker on every keystroke.
 */
export function useSearch(workspaceId: number, query: string, options: { types?: SearchType[]; limit?: number; delay?: number } = {}) {
  const { types, limit, delay = 180 } = options;
  const typesKey = types?.join(',') ?? '';
  const debounced = useDebouncedValue(query.trim(), delay);
  const key = `${workspaceId}|${debounced}|${typesKey}|${limit ?? ''}`;
  const [state, setState] = useState<SearchState>({ key: '', result: null, error: null });

  useEffect(() => {
    if (!debounced) return;
    let cancelled = false;
    searchWorkspace(workspaceId, debounced, { types: typesKey ? (typesKey.split(',') as SearchType[]) : undefined, limit })
      .then((result) => !cancelled && setState({ key, result, error: null }))
      .catch((err: Error) => !cancelled && setState((previous) => ({ key, result: previous.result, error: err.message })));
    return () => {
      cancelled = true;
    };
  }, [key, debounced, workspaceId, typesKey, limit]);

  const active = query.trim() !== '';
  return {
    result: active ? state.result : null,
    error: active && state.key === key ? state.error : null,
    loading: active && (state.key !== key || debounced !== query.trim()),
  };
}
