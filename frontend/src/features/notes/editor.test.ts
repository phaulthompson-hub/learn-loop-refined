import { describe, expect, it } from 'vitest';
import { continueList, countWords, insertCode, insertLink, insertWikilink, readingMinutes, toggleLineStyle, toggleWrap, type TextState } from './editor';

/** Build a state from text with `[` `]` marking the selection (or `|` for a caret). */
function state(marked: string): TextState {
  if (marked.includes('|')) {
    const at = marked.indexOf('|');
    return { text: marked.replace('|', ''), start: at, end: at };
  }
  const start = marked.indexOf('[');
  const end = marked.indexOf(']') - 1;
  return { text: marked.replace('[', '').replace(']', ''), start, end };
}

const selected = (s: TextState) => s.text.slice(s.start, s.end);

describe('toggleWrap', () => {
  it('wraps the selection and keeps it selected', () => {
    const result = toggleWrap(state('make [this] bold'), '**');
    expect(result.text).toBe('make **this** bold');
    expect(selected(result)).toBe('this');
  });

  it('unwraps an already wrapped selection', () => {
    const wrapped = toggleWrap(state('make [this] bold'), '**');
    const result = toggleWrap(wrapped, '**');
    expect(result.text).toBe('make this bold');
    expect(selected(result)).toBe('this');
  });

  it('inserts a selected placeholder when nothing is selected', () => {
    const result = toggleWrap(state('x |y'), '*', '*', 'italic text');
    expect(result.text).toBe('x *italic text*y');
    expect(selected(result)).toBe('italic text');
  });
});

describe('toggleLineStyle', () => {
  it('prefixes every selected line and numbers ordered lists', () => {
    const result = toggleLineStyle(state('[one\ntwo\nthree]'), 'ordered');
    expect(result.text).toBe('1. one\n2. two\n3. three');
  });

  it('removes the style when every line already has it', () => {
    expect(toggleLineStyle(state('[- a\n- b]'), 'bullet').text).toBe('a\nb');
  });

  it('switches from one block style to another', () => {
    expect(toggleLineStyle(state('- [ ] |task'), 'h2').text).toBe('## task');
    expect(toggleLineStyle(state('## |Title'), 'task').text).toBe('- [ ] Title');
  });

  it('does not confuse task items with bullets', () => {
    expect(toggleLineStyle(state('- [ ] |a'), 'bullet').text).toBe('- a');
  });

  it('moves the caret with the inserted prefix', () => {
    const result = toggleLineStyle(state('first\nsec|ond'), 'quote');
    expect(result.text).toBe('first\n> second');
    expect(result.start).toBe(result.end);
    expect(result.text.slice(0, result.start)).toBe('first\n> sec');
  });

  it('only touches lines inside the selection', () => {
    expect(toggleLineStyle(state('a\n[b\n]c'), 'bullet').text).toBe('a\n- b\nc');
  });
});

describe('insertLink, insertCode and insertWikilink', () => {
  it('wraps a selection as a link and selects the URL', () => {
    const result = insertLink(state('read [the docs] now'));
    expect(result.text).toBe('read [the docs](https://) now');
    expect(selected(result)).toBe('https://');
  });

  it('uses inline code for a one-line selection and a fence otherwise', () => {
    expect(insertCode(state('run [npm test] now')).text).toBe('run `npm test` now');
    const fenced = insertCode(state('intro|'));
    expect(fenced.text).toBe('intro\n```\ncode\n```\n');
    expect(selected(fenced)).toBe('code');
  });

  it('opens a wiki link at the caret or wraps the selection', () => {
    const open = insertWikilink(state('see |'));
    expect(open.text).toBe('see [[');
    expect(open.start).toBe(6);
    expect(insertWikilink(state('see [Joins] too')).text).toBe('see [[Joins]] too');
  });
});

describe('continueList', () => {
  it('continues bullets and tasks (unchecked)', () => {
    expect(continueList(state('- one|'))?.text).toBe('- one\n- ');
    expect(continueList(state('  - [x] done|'))?.text).toBe('  - [x] done\n  - [ ] ');
  });

  it('counts numbered lists up', () => {
    const result = continueList(state('1. one\n2. two|'));
    expect(result?.text).toBe('1. one\n2. two\n3. ');
    expect(result?.start).toBe(result?.text.length);
  });

  it('ends the list on an empty item', () => {
    const result = continueList(state('- one\n- |'));
    expect(result?.text).toBe('- one\n');
    expect(result?.start).toBe(6);
  });

  it('ignores ordinary lines and selections', () => {
    expect(continueList(state('plain text|'))).toBeNull();
    expect(continueList(state('- [one]'))).toBeNull();
  });
});

describe('word count and reading time', () => {
  it('counts words, ignoring fences and URLs', () => {
    expect(countWords("# Title\n\nIt's a well-known [link](https://example.com/x).\n```sql\nSELECT 1;\n```")).toBe(7);
    expect(countWords('')).toBe(0);
  });

  it('rounds reading time with a one-minute floor', () => {
    expect(readingMinutes(0)).toBe(0);
    expect(readingMinutes(40)).toBe(1);
    expect(readingMinutes(660)).toBe(3);
  });
});
