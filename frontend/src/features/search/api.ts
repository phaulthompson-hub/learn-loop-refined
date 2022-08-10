import { http, query } from '../../lib/http';
import type { SearchResult, SearchType } from './types';

export function searchWorkspace(workspaceId: number, q: string, options: { types?: SearchType[]; limit?: number } = {}) {
  return http.get<SearchResult>(`/workspaces/${workspaceId}/search${query({ q, types: options.types?.join(','), limit: options.limit })}`);
}
