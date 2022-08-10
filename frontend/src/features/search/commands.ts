// Built-in command palette actions and the fuzzy matcher that filters them as you type.
import type { Range } from './types';

export type CommandIcon = 'home' | 'courses' | 'review' | 'planner' | 'board' | 'notes' | 'analytics' | 'goals' | 'activity' | 'members' | 'settings' | 'new-note' | 'new-task' | 'search';

export type Command = { id: string; label: string; hint: string; to: string; icon: CommandIcon; keywords: string[] };

export const COMMANDS: Command[] = [
  { id: 'new-note', label: 'New note', hint: 'Create', to: '/notes/new', icon: 'new-note', keywords: ['write', 'markdown', 'create'] },
  { id: 'new-task', label: 'New task', hint: 'Create', to: '/board?new=1', icon: 'new-task', keywords: ['todo', 'kanban', 'create'] },
  { id: 'start-review', label: 'Start review', hint: 'Flashcards', to: '/review', icon: 'review', keywords: ['flashcards', 'study', 'due', 'cards'] },
  { id: 'go-home', label: 'Go to Home', hint: 'Navigate', to: '/', icon: 'home', keywords: ['dashboard', 'today'] },
  { id: 'go-courses', label: 'Go to Courses', hint: 'Navigate', to: '/courses', icon: 'courses', keywords: ['catalogue', 'learn'] },
  { id: 'go-planner', label: 'Go to Planner', hint: 'Navigate', to: '/planner', icon: 'planner', keywords: ['calendar', 'schedule', 'events'] },
  { id: 'go-board', label: 'Go to Board', hint: 'Navigate', to: '/board', icon: 'board', keywords: ['tasks', 'kanban'] },
  { id: 'go-notes', label: 'Go to Notes', hint: 'Navigate', to: '/notes', icon: 'notes', keywords: ['knowledge', 'wiki'] },
  { id: 'go-analytics', label: 'Go to Analytics', hint: 'Navigate', to: '/analytics', icon: 'analytics', keywords: ['stats', 'progress', 'charts'] },
  { id: 'go-goals', label: 'Go to Goals', hint: 'Navigate', to: '/goals', icon: 'goals', keywords: ['targets', 'streak'] },
  { id: 'go-activity', label: 'Go to Activity', hint: 'Navigate', to: '/activity', icon: 'activity', keywords: ['feed', 'history'] },
  { id: 'go-members', label: 'Go to Members', hint: 'Workspace', to: '/members', icon: 'members', keywords: ['people', 'team', 'invite'] },
  { id: 'go-settings', label: 'Go to Settings', hint: 'Workspace', to: '/settings', icon: 'settings', keywords: ['preferences', 'profile'] },
];

export type FuzzyMatch = { score: number; ranges: Range[] };

const isBoundary = (text: string, index: number) => index === 0 || /[\s\-_/]/.test(text[index - 1]);

/**
 * Subsequence match of `query` in `label` ("gtp" matches "Go to Planner"). Consecutive characters and
 * word starts score higher, so "plan" ranks "Go to Planner" above "Explain". Returns null for no match.
 */
export function fuzzyMatch(query: string, label: string): FuzzyMatch | null {
  const q = query.toLowerCase().replace(/\s+/g, '');
  if (!q) return { score: 0, ranges: [] };
  const text = label.toLowerCase();
  // A plain substring is the strongest signal; prefer one that starts a word.
  const direct = [...text.matchAll(new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))].map((m) => m.index!);
  if (direct.length) {
    const at = direct.find((index) => isBoundary(text, index)) ?? direct[0];
    return { score: 100 + q.length * 3 + (isBoundary(text, at) ? 20 : 0) - at * 0.1, ranges: [[at, at + q.length]] };
  }
  let score = 0;
  let cursor = 0;
  let previous = -2;
  const ranges: Range[] = [];
  for (const char of q) {
    const index = text.indexOf(char, cursor);
    if (index === -1) return null;
    score += 1 + (index === previous + 1 ? 4 : 0) + (isBoundary(text, index) ? 6 : 0);
    const last = ranges[ranges.length - 1];
    if (last && last[1] === index) last[1] = index + 1;
    else ranges.push([index, index + 1]);
    previous = index;
    cursor = index + 1;
  }
  return { score: score - ranges.length, ranges };
}

export type CommandMatch = { command: Command; score: number; ranges: Range[] };

/** Commands matching `query` on their label (highlighted) or keywords, best first; all of them for an empty query. */
export function filterCommands(commands: Command[], query: string, limit = 6): CommandMatch[] {
  if (!query.trim()) return commands.slice(0, limit).map((command) => ({ command, score: 0, ranges: [] }));
  const matches: CommandMatch[] = [];
  for (const command of commands) {
    const onLabel = fuzzyMatch(query, command.label);
    const onKeyword = command.keywords.some((word) => word.startsWith(query.trim().toLowerCase()));
    if (onLabel) matches.push({ command, score: onLabel.score, ranges: onLabel.ranges });
    else if (onKeyword) matches.push({ command, score: 50, ranges: [] });
  }
  // Only keep fuzzy matches that are reasonably tight, so random letters do not match every command.
  const minimum = Math.min(query.replace(/\s+/g, '').length * 4, 24);
  return matches
    .filter((m) => m.score >= minimum)
    .sort((a, b) => b.score - a.score || a.command.label.localeCompare(b.command.label))
    .slice(0, limit);
}
