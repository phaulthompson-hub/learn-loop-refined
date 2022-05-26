// Client mirror of `parse_import` in backend/app/schemas/flashcards.py, so the import dialog can preview
// which lines will be accepted before anything is sent. The server re-validates on submit.
import type { ImportedLine, RejectedLine } from './types';

export const FRONT_MAX = 500;
export const BACK_MAX = 2000;
export const HINT_MAX = 255;
export const IMPORT_MAX_LINES = 500;
const SEPARATOR = '::';

export type ParsedImport = { accepted: ImportedLine[]; rejected: RejectedLine[] };

/** Key used to detect duplicate cards: case- and whitespace-insensitive. */
export function normaliseFront(text: string): string {
  return text.split(/\s+/).filter(Boolean).join(' ').toLowerCase();
}

const isContent = (line: string) => line.length > 0 && !line.startsWith('#');

/** Lines that count towards the import limit (not blank, not a `#` comment). */
export function countImportLines(text: string): number {
  return text.split(/\r\n|\r|\n/).filter((raw) => isContent(raw.trim())).length;
}

function parseLine(line: string): { reason: string } | { card: Omit<ImportedLine, 'line'> } {
  if (!line.includes(SEPARATOR)) return { reason: "Missing the ' :: ' separator between front and back" };
  const parts = line.split(SEPARATOR).map((part) => part.trim());
  if (parts.length > 3) return { reason: "Too many ' :: ' separators (use front :: back :: hint)" };
  const [front, back, hint = ''] = parts;
  const checks: [string, string, number, boolean][] = [
    [front, 'Front', FRONT_MAX, true],
    [back, 'Back', BACK_MAX, true],
    [hint, 'Hint', HINT_MAX, false],
  ];
  for (const [value, label, limit, required] of checks) {
    if (required && !value) return { reason: `${label} is empty` };
    if (value.length > limit) return { reason: `${label} is longer than ${limit} characters` };
  }
  return { card: { front, back, hint } };
}

/** Split pasted `front :: back [:: hint]` lines into accepted cards and rejected lines with reasons. */
export function parseImport(text: string, existingFronts: Iterable<string> = []): ParsedImport {
  const seen = new Map<string, number>();
  for (const front of existingFronts) seen.set(normaliseFront(front), 0);
  const accepted: ImportedLine[] = [];
  const rejected: RejectedLine[] = [];
  text.split(/\r\n|\r|\n/).forEach((raw, index) => {
    const number = index + 1;
    const line = raw.trim();
    if (!isContent(line)) return;
    const parsed = parseLine(line);
    if ('reason' in parsed) {
      rejected.push({ line: number, text: line.slice(0, 200), reason: parsed.reason });
      return;
    }
    const key = normaliseFront(parsed.card.front);
    const first = seen.get(key);
    if (first !== undefined) {
      const reason = first ? `Duplicate of line ${first}` : 'A card with this front already exists';
      rejected.push({ line: number, text: line.slice(0, 200), reason });
      return;
    }
    seen.set(key, number);
    accepted.push({ line: number, ...parsed.card });
  });
  return { accepted, rejected };
}
