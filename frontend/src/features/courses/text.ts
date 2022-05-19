// Text helpers for the source reader and the tutor.
import type { Concept } from './types';

export type Segment = { text: string; term?: string };

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Split `text` into plain and highlighted segments for every whole-word occurrence of `terms`
 * (case-insensitive, simple plurals included). Longer terms win when terms overlap.
 */
export function highlightSegments(text: string, terms: readonly string[]): Segment[] {
  const cleaned = [...new Set(terms.map((t) => t.trim()).filter(Boolean))].sort((a, b) => b.length - a.length);
  if (!cleaned.length || !text) return text ? [{ text }] : [];
  const pattern = new RegExp(`\\b(${cleaned.map(escapeRegExp).join('|')})s?\\b`, 'gi');
  const segments: Segment[] = [];
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    if (start > last) segments.push({ text: text.slice(last, start) });
    const term = cleaned.find((t) => t.toLowerCase() === match[1].toLowerCase()) ?? match[1];
    segments.push({ text: match[0], term });
    last = start + match[0].length;
  }
  if (last < text.length) segments.push({ text: text.slice(last) });
  return segments;
}

/** How many times each term occurs in the text (same matching rules as `highlightSegments`). */
export function termCounts(text: string, terms: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>(terms.map((t) => [t, 0]));
  for (const segment of highlightSegments(text, terms)) {
    if (segment.term) counts.set(segment.term, (counts.get(segment.term) ?? 0) + 1);
  }
  return counts;
}

/** Starter questions for the tutor, aimed at the learner's weakest unlocked concepts first. */
export function tutorSuggestions(concepts: readonly Concept[], limit = 4): string[] {
  const open = [...concepts].filter((c) => c.unlocked).sort((a, b) => a.mastery - b.mastery || a.order_index - b.order_index);
  const [first, second, third] = open;
  const suggestions: string[] = [];
  if (first) suggestions.push(`Explain ${first.name.toLowerCase()} more simply`);
  if (first && second) suggestions.push(`How does ${first.name.toLowerCase()} relate to ${second.name.toLowerCase()}?`);
  if (second) suggestions.push(`Give me an example of ${second.name.toLowerCase()}`);
  if (third) suggestions.push(`What should I remember about ${third.name.toLowerCase()}?`);
  return suggestions.slice(0, limit);
}
