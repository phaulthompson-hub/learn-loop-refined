// Pure helpers for the adaptive quiz round: keyboard mapping, round length and the end-of-round summary.
import { MASTERED_THRESHOLD } from '../../lib/mastery';
import type { AnswerResult } from './types';

export const QUIZ_MIN = 1;
export const QUIZ_MAX = 10;

/** The user's preferred round length, clamped to what the API accepts. */
export function quizLength(preference: number | null | undefined): number {
  if (!preference || !Number.isFinite(preference)) return 4;
  return Math.min(QUIZ_MAX, Math.max(QUIZ_MIN, Math.round(preference)));
}

/** "1".."4" (or "a".."d") pick an option; anything else returns null. */
export function optionForKey(key: string, optionCount: number): number | null {
  const lower = key.toLowerCase();
  let index = -1;
  if (/^[1-9]$/.test(lower)) index = Number(lower) - 1;
  else if (/^[a-z]$/.test(lower)) index = lower.charCodeAt(0) - 97;
  return index >= 0 && index < optionCount ? index : null;
}

export type ConceptChange = { conceptId: number; name: string; before: number; after: number; answers: number; correct: number };

export type RoundSummary = {
  total: number;
  correct: number;
  accuracy: number;
  /** Net mastery change summed over every concept practised in the round. */
  netChange: number;
  concepts: ConceptChange[];
  /** Concepts that crossed the mastered threshold during this round. */
  newlyMastered: string[];
};

export function summariseRound(results: readonly AnswerResult[]): RoundSummary {
  const byConcept = new Map<number, ConceptChange>();
  for (const result of results) {
    const entry = byConcept.get(result.concept_id);
    if (entry) {
      entry.after = result.mastery;
      entry.answers += 1;
      entry.correct += Number(result.correct);
    } else {
      byConcept.set(result.concept_id, {
        conceptId: result.concept_id,
        name: result.concept,
        before: result.previous_mastery,
        after: result.mastery,
        answers: 1,
        correct: Number(result.correct),
      });
    }
  }
  const concepts = [...byConcept.values()];
  const correct = results.filter((r) => r.correct).length;
  return {
    total: results.length,
    correct,
    accuracy: results.length ? Math.round((correct / results.length) * 100) : 0,
    netChange: Math.round(concepts.reduce((sum, c) => sum + (c.after - c.before), 0) * 10) / 10,
    concepts,
    newlyMastered: concepts.filter((c) => c.before < MASTERED_THRESHOLD && c.after >= MASTERED_THRESHOLD).map((c) => c.name),
  };
}

export function roundHeadline(summary: RoundSummary): string {
  if (!summary.total) return 'No questions answered';
  if (summary.correct === summary.total) return 'Perfect round!';
  if (summary.accuracy >= 75) return 'Strong round';
  if (summary.accuracy >= 50) return 'Solid progress';
  return 'Good practice — these concepts need another pass';
}
