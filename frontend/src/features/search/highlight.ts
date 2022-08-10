// Turning highlight ranges (from the API, or computed here for local items such as commands) into
// text segments the UI can wrap in <mark>.
import type { Range } from './types';

export type Segment = { text: string; match: boolean };

/** Clamp ranges to the text, drop empty ones, sort them and merge overlaps. */
export function normaliseRanges(ranges: readonly Range[], length: number): Range[] {
  const clamped = ranges
    .map(([start, end]): Range => [Math.max(0, Math.min(start, length)), Math.max(0, Math.min(end, length))])
    .filter(([start, end]) => end > start)
    .sort((a, b) => a[0] - b[0]);
  const merged: Range[] = [];
  for (const [start, end] of clamped) {
    const last = merged[merged.length - 1];
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged;
}

export function splitHighlights(text: string, ranges: readonly Range[]): Segment[] {
  const segments: Segment[] = [];
  let cursor = 0;
  for (const [start, end] of normaliseRanges(ranges, text.length)) {
    if (start > cursor) segments.push({ text: text.slice(cursor, start), match: false });
    segments.push({ text: text.slice(start, end), match: true });
    cursor = end;
  }
  if (cursor < text.length || !segments.length) segments.push({ text: text.slice(cursor), match: false });
  return segments;
}

/** Lower-case and strip accents, remembering which original character each folded one came from. */
export function foldWithOffsets(text: string): { folded: string; offsets: number[] } {
  let folded = '';
  const offsets: number[] = [];
  for (let index = 0; index < text.length; index += 1) {
    const part = text[index].normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    for (const char of part) {
      folded += char;
      offsets.push(index);
    }
  }
  return { folded, offsets };
}

/** Where the words of `query` occur in `text` (case- and accent-insensitive), preferring word starts. */
export function findRanges(text: string, query: string): Range[] {
  const { folded, offsets } = foldWithOffsets(text);
  const terms = [...new Set(foldWithOffsets(query).folded.split(/[^\p{L}\p{N}]+/u).filter(Boolean))];
  const ranges: Range[] = [];
  for (const term of terms) {
    const hits: number[] = [];
    for (let at = folded.indexOf(term); at !== -1; at = folded.indexOf(term, at + 1)) hits.push(at);
    const wordStarts = hits.filter((at) => at === 0 || !/[\p{L}\p{N}]/u.test(folded[at - 1]));
    for (const at of wordStarts.length ? wordStarts : hits) ranges.push([offsets[at], offsets[at + term.length - 1] + 1]);
  }
  return normaliseRanges(ranges, text.length);
}
