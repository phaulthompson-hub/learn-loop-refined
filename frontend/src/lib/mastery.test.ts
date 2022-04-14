import { describe, expect, it } from 'vitest';
import {
  type Concept,
  LEVELS,
  answersToReach,
  averageMastery,
  formatDelta,
  isUnlocked,
  levelSlug,
  masteryLevel,
  nextMastery,
  prerequisiteName,
  progressCounts,
} from './mastery';

const concept = (id: number, mastery: number, prerequisite_id: number | null = null): Concept => ({
  id,
  name: `C${id}`,
  mastery,
  prerequisite_id,
});

describe('masteryLevel', () => {
  it.each([
    [0, 'needs review'],
    [34.9, 'needs review'],
    [35, 'learning'],
    [59.9, 'learning'],
    [60, 'proficient'],
    [85, 'mastered'],
  ])('%s%% is %s', (value, level) => {
    expect(masteryLevel(value)).toBe(level);
  });
});

describe('averageMastery', () => {
  it('returns 0 for an empty course', () => {
    expect(averageMastery([])).toBe(0);
  });

  it('rounds to one decimal place', () => {
    expect(averageMastery([{ mastery: 35 }, { mastery: 53.2 }, { mastery: 25.2 }])).toBe(37.8);
  });
});

describe('isUnlocked', () => {
  const chain = [concept(1, 59.9), concept(2, 35, 1), concept(3, 35, 2)];

  it('always unlocks concepts without prerequisites', () => {
    expect(isUnlocked(chain[0], chain)).toBe(true);
  });

  it('locks a concept until its prerequisite reaches 60%', () => {
    expect(isUnlocked(chain[1], chain)).toBe(false);
    const unlockedChain = [concept(1, 60), concept(2, 35, 1)];
    expect(isUnlocked(unlockedChain[1], unlockedChain)).toBe(true);
  });

  it('treats a missing prerequisite as unlocked', () => {
    const orphan = concept(9, 35, 404);
    expect(isUnlocked(orphan, [orphan])).toBe(true);
  });

  it('names the prerequisite', () => {
    expect(prerequisiteName(chain[2], chain)).toBe('C2');
    expect(prerequisiteName(chain[0], chain)).toBeNull();
  });
});

describe('formatDelta', () => {
  it('formats gains, losses, and no change', () => {
    expect(formatDelta(35, 53.2)).toBe('+18.2');
    expect(formatDelta(35, 25.2)).toBe('−9.8');
    expect(formatDelta(40, 40)).toBe('±0');
  });
});

describe('progressCounts', () => {
  it('counts concepts per mastery level', () => {
    const counts = progressCounts([concept(1, 90), concept(2, 70), concept(3, 40), concept(4, 10), concept(5, 86)]);
    expect(counts).toEqual({ mastered: 2, proficient: 1, learning: 1, 'needs review': 1 });
  });
});

describe('nextMastery', () => {
  it('mirrors the backend model', () => {
    expect(nextMastery(35, true)).toBeCloseTo(53.2, 1);
    expect(nextMastery(35, false)).toBeCloseTo(25.2, 1);
    expect(nextMastery(100, true)).toBe(100);
  });
});

describe('answersToReach', () => {
  it('counts the correct answers needed to reach a threshold', () => {
    // 35 -> 53.2 -> 66.3 -> 75.7 -> 82.5 -> 87.4
    expect(answersToReach(35)).toBe(5);
    expect(answersToReach(35, 60)).toBe(2);
    expect(answersToReach(90)).toBe(0);
  });
});

describe('levels', () => {
  it('are ordered weakest first and map to badge classes', () => {
    expect(LEVELS.map((level) => masteryLevel({ 'needs review': 10, learning: 40, proficient: 70, mastered: 90 }[level]))).toEqual(LEVELS);
    expect(levelSlug('needs review')).toBe('needs-review');
  });
});
