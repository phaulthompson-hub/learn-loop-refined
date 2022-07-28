// Wiki link helpers shared by the editor (autocomplete) and the preview (live link resolution).
// Resolution mirrors backend/app/services/wikilinks.py: titles match case-insensitively with
// whitespace collapsed, the viewer's own note wins over a teammate's, then the most recent one.
import type { NoteTitle } from './types';

export const normaliseTitle = (title: string) => title.replace(/\s+/g, ' ').trim().toLowerCase();

export function buildTitleIndex(titles: NoteTitle[]): Map<string, NoteTitle> {
  const index = new Map<string, NoteTitle>();
  for (const entry of titles) {
    const key = normaliseTitle(entry.title);
    const current = index.get(key);
    const better =
      !current ||
      (entry.mine && !current.mine) ||
      (entry.mine === current.mine && (entry.updated_at > current.updated_at || (entry.updated_at === current.updated_at && entry.id > current.id)));
    if (better) index.set(key, entry);
  }
  return index;
}

export type WikilinkQuery = { start: number; query: string };

/**
 * If the caret sits inside an unfinished `[[…` on the current line, return where it starts and what
 * has been typed so far (the part before any `|` alias or `#` heading). Otherwise null.
 */
export function wikilinkQueryAt(text: string, caret: number): WikilinkQuery | null {
  const lineStart = text.lastIndexOf('\n', caret - 1) + 1;
  const before = text.slice(lineStart, caret);
  const open = before.lastIndexOf('[[');
  if (open === -1) return null;
  const typed = before.slice(open + 2);
  if (typed.includes(']]') || typed.includes('[') || /[|#]/.test(typed) || typed.length > 80) return null;
  // Inside inline code the brackets are literal.
  if ((before.slice(0, open).match(/`/g)?.length ?? 0) % 2 === 1) return null;
  return { start: lineStart + open, query: typed };
}

/** Replace the unfinished `[[query` at `start…caret` with a complete link, returning the new text and caret. */
export function completeWikilink(text: string, start: number, caret: number, title: string): { text: string; caret: number } {
  const closesAlready = text.slice(caret, caret + 2) === ']]';
  const link = `[[${title}]]`;
  const next = text.slice(0, start) + link + text.slice(closesAlready ? caret + 2 : caret);
  return { text: next, caret: start + link.length };
}

/** Rank note titles for the `[[` menu: prefix matches first, then word starts, then substrings. */
export function suggestTitles(titles: NoteTitle[], query: string, exclude: number | null, limit = 8): NoteTitle[] {
  const q = normaliseTitle(query);
  const scored: { entry: NoteTitle; score: number }[] = [];
  for (const entry of titles) {
    if (entry.id === exclude) continue;
    const title = normaliseTitle(entry.title);
    let score: number;
    if (!q) score = 1;
    else if (title.startsWith(q)) score = 4;
    else if (title.split(' ').some((word) => word.startsWith(q))) score = 3;
    else if (title.includes(q)) score = 2;
    else continue;
    scored.push({ entry, score: score + (entry.mine ? 0.5 : 0) });
  }
  return scored
    .sort((a, b) => b.score - a.score || b.entry.updated_at.localeCompare(a.entry.updated_at) || a.entry.title.localeCompare(b.entry.title))
    .slice(0, limit)
    .map((s) => s.entry);
}
