import { describe, expect, it } from 'vitest';
import { COMMANDS, filterCommands, fuzzyMatch } from './commands';
import { findRanges, foldWithOffsets, normaliseRanges, splitHighlights } from './highlight';
import { MAX_RECENT, pushRecent, removeRecent } from './recent';

const marked = (text: string, ranges: [number, number][]) => ranges.map(([s, e]) => text.slice(s, e));

describe('normaliseRanges', () => {
  it('clamps, sorts, merges and drops empty ranges', () => {
    expect(normaliseRanges([[8, 20], [0, 2], [1, 4], [5, 5], [-3, 0]], 10)).toEqual([
      [0, 4],
      [8, 10],
    ]);
  });
});

describe('splitHighlights', () => {
  it('alternates plain and matched segments', () => {
    expect(splitHighlights('SQL joins field guide', [[4, 9], [16, 21]])).toEqual([
      { text: 'SQL ', match: false },
      { text: 'joins', match: true },
      { text: ' field ', match: false },
      { text: 'guide', match: true },
    ]);
  });

  it('returns the whole text when there are no ranges, even if empty', () => {
    expect(splitHighlights('plain', [])).toEqual([{ text: 'plain', match: false }]);
    expect(splitHighlights('', [])).toEqual([{ text: '', match: false }]);
  });

  it('survives ranges from a stale response that no longer fit the text', () => {
    expect(splitHighlights('short', [[3, 40]])).toEqual([
      { text: 'sho', match: false },
      { text: 'rt', match: true },
    ]);
  });
});

describe('findRanges', () => {
  it('matches every query word, case- and accent-insensitively', () => {
    const text = 'Café notes about the CAFE menu';
    expect(marked(text, findRanges(text, 'cafe'))).toEqual(['Café', 'CAFE']);
  });

  it('prefers matches at word starts and falls back to substrings', () => {
    expect(marked('Adjoin a join', findRanges('Adjoin a join', 'join'))).toEqual(['join']);
    expect(findRanges('Adjoin a join', 'join')).toEqual([[9, 13]]);
    expect(marked('Adjoining', findRanges('Adjoining', 'join'))).toEqual(['join']);
  });

  it('maps folded offsets back to the original text', () => {
    expect(foldWithOffsets('Éa').offsets).toEqual([0, 1]);
    expect(findRanges('naïve plan', 'naive')).toEqual([[0, 5]]);
  });
});

describe('fuzzyMatch', () => {
  it('prefers substrings at word starts', () => {
    const planner = fuzzyMatch('plan', 'Go to Planner')!;
    expect(planner.ranges).toEqual([[6, 10]]);
    expect(planner.score).toBeGreaterThan(fuzzyMatch('plan', 'Explanation')!.score);
  });

  it('matches initials as a subsequence', () => {
    const match = fuzzyMatch('gtp', 'Go to Planner');
    expect(match?.ranges).toEqual([
      [0, 1],
      [3, 4],
      [6, 7],
    ]);
  });

  it('returns null when letters are missing and ignores spaces in the query', () => {
    expect(fuzzyMatch('xyz', 'Go to Planner')).toBeNull();
    expect(fuzzyMatch('new note', 'New note')?.ranges).toEqual([
      [0, 3],
      [4, 8],
    ]);
  });
});

describe('filterCommands', () => {
  it('lists the first commands when the query is empty', () => {
    expect(filterCommands(COMMANDS, '  ', 3).map((m) => m.command.id)).toEqual(['new-note', 'new-task', 'start-review']);
  });

  it('ranks the best label match first', () => {
    expect(filterCommands(COMMANDS, 'planner')[0].command.id).toBe('go-planner');
    expect(filterCommands(COMMANDS, 'new t')[0].command.id).toBe('new-task');
  });

  it('matches keywords when the label does not match', () => {
    const match = filterCommands(COMMANDS, 'calendar');
    expect(match.map((m) => m.command.id)).toEqual(['go-planner']);
    expect(match[0].ranges).toEqual([]);
  });

  it('drops loose fuzzy matches', () => {
    expect(filterCommands(COMMANDS, 'qzx')).toEqual([]);
    expect(filterCommands(COMMANDS, 'ote').map((m) => m.command.id)).not.toContain('go-settings');
  });
});

describe('recent searches', () => {
  it('puts the newest first, de-duplicates case-insensitively and caps the list', () => {
    expect(pushRecent(['joins', 'sql'], '  JOINS ')).toEqual(['JOINS', 'sql']);
    const full = Array.from({ length: MAX_RECENT }, (_, i) => `query ${i}`);
    expect(pushRecent(full, 'latest')).toEqual(['latest', ...full.slice(0, MAX_RECENT - 1)]);
  });

  it('ignores queries that are too short', () => {
    expect(pushRecent(['sql'], ' a ')).toEqual(['sql']);
  });

  it('removes one entry', () => {
    expect(removeRecent(['a b', 'c d'], 'a b')).toEqual(['c d']);
  });
});
