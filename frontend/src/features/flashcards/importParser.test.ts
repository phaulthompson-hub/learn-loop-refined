import { describe, expect, it } from 'vitest';
import { BACK_MAX, FRONT_MAX, countImportLines, normaliseFront, parseImport } from './importParser';

describe('parseImport', () => {
  it('accepts front :: back with an optional hint', () => {
    const { accepted, rejected } = parseImport('Mitosis :: Two identical cells\nMeiosis :: Gametes :: Half the chromosomes');
    expect(rejected).toEqual([]);
    expect(accepted).toEqual([
      { line: 1, front: 'Mitosis', back: 'Two identical cells', hint: '' },
      { line: 2, front: 'Meiosis', back: 'Gametes', hint: 'Half the chromosomes' },
    ]);
  });

  it('skips blank lines and comments but keeps real line numbers (also with Windows line endings)', () => {
    const { accepted } = parseImport('# Chapter 3\r\n\r\n   \r\nATP :: Energy currency');
    expect(accepted.map((a) => a.line)).toEqual([4]);
  });

  it.each([
    ['No separator', "Missing the ' :: ' separator between front and back"],
    [' :: back only', 'Front is empty'],
    ['front only ::', 'Back is empty'],
    ['a :: b :: c :: d', "Too many ' :: ' separators (use front :: back :: hint)"],
    [`${'x'.repeat(FRONT_MAX + 1)} :: back`, `Front is longer than ${FRONT_MAX} characters`],
    [`front :: ${'y'.repeat(BACK_MAX + 1)}`, `Back is longer than ${BACK_MAX} characters`],
    [`front :: back :: ${'z'.repeat(256)}`, 'Hint is longer than 255 characters'],
  ])('rejects %j', (line, reason) => {
    const { accepted, rejected } = parseImport(line);
    expect(accepted).toEqual([]);
    expect(rejected[0]).toMatchObject({ line: 1, reason });
  });

  it('points duplicates at the first occurrence and flags existing cards', () => {
    const { accepted, rejected } = parseImport('ATP :: energy\n  atp   :: again\nWhat is a gene? :: DNA', ['what is  a GENE?']);
    expect(accepted.map((a) => a.front)).toEqual(['ATP']);
    expect(rejected).toEqual([
      { line: 2, text: 'atp   :: again', reason: 'Duplicate of line 1' },
      { line: 3, text: 'What is a gene? :: DNA', reason: 'A card with this front already exists' },
    ]);
  });

  it('truncates long rejected lines for display', () => {
    expect(parseImport('q'.repeat(600)).rejected[0].text).toHaveLength(200);
  });
});

describe('helpers', () => {
  it('counts only lines that would be imported', () => {
    expect(countImportLines('a :: b\n\n# note\nbroken\n')).toBe(2);
  });

  it('normalises fronts for duplicate detection', () => {
    expect(normaliseFront('  What IS\tATP? ')).toBe('what is atp?');
  });
});
