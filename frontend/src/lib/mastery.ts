/** The concept fields the mastery helpers need; course concepts from the API satisfy this. */
export type Concept = { id: number; name: string; mastery: number; prerequisite_id: number | null };

// Mirrors backend/app/mastery.py so the UI can explain states without another request.
export const UNLOCK_THRESHOLD = 60;
export const MASTERED_THRESHOLD = 85;
export const INITIAL_MASTERY = 35;
export const GAIN = 0.28;
export const DECAY = 0.72;

export type MasteryLevel = 'needs review' | 'learning' | 'proficient' | 'mastered';

/** Weakest to strongest, the order used by legends and distribution bars. */
export const LEVELS: MasteryLevel[] = ['needs review', 'learning', 'proficient', 'mastered'];

/** CSS-friendly name: 'needs review' -> 'needs-review' (matches the shared `.level-*` badge classes). */
export const levelSlug = (level: MasteryLevel): string => level.replace(' ', '-');

/** One answer's effect on mastery: a correct answer closes 28% of the gap to 100, a wrong one keeps 72%. */
export function nextMastery(value: number, correct: boolean): number {
  const next = correct ? value + (100 - value) * GAIN : value * DECAY;
  return Math.min(100, Math.max(0, next));
}

/** How many correct answers in a row take `value` to `target` (0 when it is already there). */
export function answersToReach(value: number, target = MASTERED_THRESHOLD): number {
  let current = value;
  let answers = 0;
  while (current < target && answers < 100) {
    current = nextMastery(current, true);
    answers += 1;
  }
  return answers;
}

export function masteryLevel(value: number): MasteryLevel {
  if (value >= MASTERED_THRESHOLD) return 'mastered';
  if (value >= UNLOCK_THRESHOLD) return 'proficient';
  if (value >= INITIAL_MASTERY) return 'learning';
  return 'needs review';
}

export function averageMastery(concepts: Pick<Concept, 'mastery'>[]): number {
  if (!concepts.length) return 0;
  return Math.round((concepts.reduce((sum, c) => sum + c.mastery, 0) / concepts.length) * 10) / 10;
}

export function isUnlocked(concept: Concept, concepts: Concept[]): boolean {
  if (concept.prerequisite_id === null) return true;
  const prerequisite = concepts.find((c) => c.id === concept.prerequisite_id);
  return !prerequisite || prerequisite.mastery >= UNLOCK_THRESHOLD;
}

export function prerequisiteName(concept: Concept, concepts: Concept[]): string | null {
  return concepts.find((c) => c.id === concept.prerequisite_id)?.name ?? null;
}

export function formatDelta(before: number, after: number): string {
  const delta = Math.round((after - before) * 10) / 10;
  if (delta === 0) return '±0';
  return `${delta > 0 ? '+' : '−'}${Math.abs(delta)}`;
}

export function progressCounts(concepts: Concept[]): Record<MasteryLevel, number> {
  const counts: Record<MasteryLevel, number> = { 'needs review': 0, learning: 0, proficient: 0, mastered: 0 };
  for (const concept of concepts) counts[masteryLevel(concept.mastery)] += 1;
  return counts;
}
