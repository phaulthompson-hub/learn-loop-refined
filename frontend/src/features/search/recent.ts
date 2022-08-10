// Recent searches, remembered per workspace in localStorage (via lib/storage, which never throws).
import { readJson, writeJson } from '../../lib/storage';

export const MAX_RECENT = 6;
export const recentKey = (workspaceId: number) => `learnloop.recent-searches.${workspaceId}`;

/** Put `query` first, dropping an earlier copy (case-insensitive) and anything beyond the limit. */
export function pushRecent(list: readonly string[], query: string, max = MAX_RECENT): string[] {
  const clean = query.replace(/\s+/g, ' ').trim();
  if (clean.length < 2) return [...list];
  return [clean, ...list.filter((item) => item.toLowerCase() !== clean.toLowerCase())].slice(0, max);
}

export const removeRecent = (list: readonly string[], query: string): string[] => list.filter((item) => item !== query);

export function loadRecent(workspaceId: number): string[] {
  const stored = readJson<unknown>(recentKey(workspaceId), []);
  return Array.isArray(stored) ? stored.filter((item): item is string => typeof item === 'string').slice(0, MAX_RECENT) : [];
}

export const saveRecent = (workspaceId: number, list: string[]) => writeJson(recentKey(workspaceId), list);
