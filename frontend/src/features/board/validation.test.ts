import { describe, expect, it } from 'vitest';
import { parseInline, parseMarkup } from './markup';
import { checklistLines, toTaskInput, validateDueDate, validateEstimate, validateLabelName, validateTaskForm, type TaskFormValues } from './validation';

const VALID: TaskFormValues = {
  title: 'Revise joins',
  description: '',
  status: 'todo',
  priority: 'medium',
  assigneeId: '',
  courseId: '',
  dueDate: '',
  estimate: '',
  labelIds: [],
  checklist: '',
};

describe('task form validation', () => {
  it('accepts a minimal task', () => {
    expect(validateTaskForm(VALID)).toEqual({});
  });

  it('requires a trimmed title of 2 to 200 characters', () => {
    expect(validateTaskForm({ ...VALID, title: '  a ' }).title).toMatch(/at least 2/);
    expect(validateTaskForm({ ...VALID, title: 'x'.repeat(201) }).title).toMatch(/under 200/);
  });

  it('checks estimates are whole points within range', () => {
    expect(validateEstimate('')).toBeUndefined();
    expect(validateEstimate('5')).toBeUndefined();
    expect(validateEstimate('2.5')).toBeDefined();
    expect(validateEstimate('-1')).toBeDefined();
    expect(validateEstimate('101')).toBeDefined();
  });

  it('checks due dates are real calendar dates', () => {
    expect(validateDueDate('')).toBeUndefined();
    expect(validateDueDate('2022-03-18')).toBeUndefined();
    expect(validateDueDate('2022-02-30')).toBe('That date does not exist.');
    expect(validateDueDate('18/03/2022')).toBeDefined();
  });

  it('limits description length and checklist items', () => {
    expect(validateTaskForm({ ...VALID, description: 'x'.repeat(5001) }).description).toBeDefined();
    expect(validateTaskForm({ ...VALID, checklist: Array.from({ length: 31 }, (_, i) => `item ${i}`).join('\n') }).checklist).toMatch(/at most 30/);
    expect(validateTaskForm({ ...VALID, checklist: `ok\n${'y'.repeat(201)}` }).checklist).toMatch(/Item 2/);
  });

  it('parses checklist lines, stripping bullets and blank lines', () => {
    expect(checklistLines('- Read chapter\n\n* [ ] Exercises\n  [] Quiz  \n')).toEqual(['Read chapter', 'Exercises', 'Quiz']);
  });

  it('converts form values to the API payload', () => {
    const input = toTaskInput({ ...VALID, title: '  Revise joins ', assigneeId: '3', courseId: '', dueDate: '2022-03-18', estimate: '5', checklist: 'a\nb', labelIds: [2] });
    expect(input).toEqual({
      title: 'Revise joins',
      description: '',
      status: 'todo',
      priority: 'medium',
      assignee_id: 3,
      course_id: null,
      due_date: '2022-03-18',
      estimate: 5,
      label_ids: [2],
      checklist: ['a', 'b'],
    });
  });

  it('rejects blank, long and duplicate label names (case-insensitive)', () => {
    const existing = [{ name: 'Reading' }];
    expect(validateLabelName('  ', existing)).toBeDefined();
    expect(validateLabelName('x'.repeat(41), existing)).toBeDefined();
    expect(validateLabelName('reading', existing)).toMatch(/already exists/);
    expect(validateLabelName('Revision', existing)).toBeUndefined();
  });
});

describe('description markup', () => {
  it('parses inline emphasis, code and links', () => {
    expect(parseInline('Use **LAG** with `OVER` and *care*, see https://sql.dev/x.')).toEqual([
      { kind: 'text', text: 'Use ' },
      { kind: 'bold', text: 'LAG' },
      { kind: 'text', text: ' with ' },
      { kind: 'code', text: 'OVER' },
      { kind: 'text', text: ' and ' },
      { kind: 'italic', text: 'care' },
      { kind: 'text', text: ', see ' },
      { kind: 'link', text: 'https://sql.dev/x.' },
    ]);
  });

  it('groups lines into headings, paragraphs and lists', () => {
    const blocks = parseMarkup('# Plan\nRead the\nchapter.\n\n- one\n- two\n1. first\n2) second');
    expect(blocks.map((b) => b.kind)).toEqual(['heading', 'paragraph', 'bullets', 'numbers']);
    expect(blocks[1]).toEqual({ kind: 'paragraph', inline: [{ kind: 'text', text: 'Read the chapter.' }] });
    expect(blocks[2].kind === 'bullets' && blocks[2].items).toHaveLength(2);
    expect(blocks[3].kind === 'numbers' && blocks[3].items.map((item) => item[0].text)).toEqual(['first', 'second']);
  });

  it('treats markup-looking text safely as text', () => {
    expect(parseMarkup('<script>alert(1)</script>')).toEqual([{ kind: 'paragraph', inline: [{ kind: 'text', text: '<script>alert(1)</script>' }] }]);
    expect(parseMarkup('')).toEqual([]);
  });
});
