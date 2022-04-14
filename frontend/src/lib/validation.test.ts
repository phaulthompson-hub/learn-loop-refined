import { describe, expect, it } from 'vitest';
import {
  formatBytes,
  normaliseTags,
  validateConceptName,
  validateConceptSummary,
  validateDescription,
  validateFile,
  validatePasteForm,
  validateSubject,
  validateTag,
  validateText,
  validateTitle,
  validateUploadForm,
} from './validation';

const longText = 'Photosynthesis converts light energy into chemical energy stored inside glucose molecules.';

describe('validateTitle', () => {
  it('requires at least 2 non-blank characters', () => {
    expect(validateTitle('A')).toMatch(/at least 2/);
    expect(validateTitle('    ')).toMatch(/at least 2/);
    expect(validateTitle(' ML ')).toBeUndefined();
  });

  it('rejects titles over 160 characters', () => {
    expect(validateTitle('x'.repeat(161))).toMatch(/at most 160/);
    expect(validateTitle('x'.repeat(160))).toBeUndefined();
  });
});

describe('validateText', () => {
  it('requires 80 characters and reports the current length', () => {
    expect(validateText('too short')).toBe('Paste at least 80 characters of material (currently 9).');
    expect(validateText(longText)).toBeUndefined();
  });

  it('ignores surrounding whitespace', () => {
    expect(validateText(`   ${'a'.repeat(79)}   `)).toMatch(/currently 79/);
  });
});

describe('validateFile', () => {
  it('requires a file', () => {
    expect(validateFile(null)).toMatch(/Choose/);
  });

  it.each(['notes.pdf', 'notes.TXT', 'README.md'])('accepts %s', (name) => {
    expect(validateFile({ name, size: 100 })).toBeUndefined();
  });

  it.each(['slides.pptx', 'image.png', 'noextension'])('rejects %s', (name) => {
    expect(validateFile({ name, size: 100 })).toMatch(/Only PDF/);
  });

  it('rejects empty and oversized files', () => {
    expect(validateFile({ name: 'a.txt', size: 0 })).toMatch(/empty/);
    expect(validateFile({ name: 'a.txt', size: 8_000_001 })).toMatch(/8 MB/);
  });
});

describe('form validation', () => {
  it('collects every field error for the paste form', () => {
    expect(validatePasteForm('', 'short')).toEqual({
      title: 'Title must be at least 2 characters.',
      text: 'Paste at least 80 characters of material (currently 5).',
    });
    expect(validatePasteForm('Biology', longText)).toEqual({});
  });

  it('collects every field error for the upload form', () => {
    expect(Object.keys(validateUploadForm('', null))).toEqual(['title', 'file']);
    expect(validateUploadForm('Biology', { name: 'notes.md', size: 10 })).toEqual({});
  });
});

describe('course details', () => {
  it('requires a subject of at most 60 characters', () => {
    expect(validateSubject('   ')).toBe('Subject is required.');
    expect(validateSubject('x'.repeat(61))).toMatch(/at most 60/);
    expect(validateSubject('Biology')).toBeUndefined();
  });

  it('allows an empty description but caps its length', () => {
    expect(validateDescription('')).toBeUndefined();
    expect(validateDescription('d'.repeat(601))).toMatch(/at most 600/);
  });

  it('checks concept names and summaries like the API', () => {
    expect(validateConceptName('X')).toMatch(/at least 2/);
    expect(validateConceptSummary('too short')).toMatch(/at least 10/);
    expect(validateConceptSummary('Long enough summary.')).toBeUndefined();
  });
});

describe('tags', () => {
  it('normalises like the API: trimmed, lower case, unique, capped', () => {
    expect(normaliseTags(' ML , ml,Stats,, ')).toEqual(['ml', 'stats']);
    expect(normaliseTags(Array.from({ length: 14 }, (_, i) => `t${i}`))).toHaveLength(10);
    expect(normaliseTags(['x'.repeat(40)])[0]).toHaveLength(30);
  });

  it('explains why a tag cannot be added', () => {
    expect(validateTag('  ', [])).toMatch(/Type a tag/);
    expect(validateTag('ML', ['ml'])).toMatch(/already added/);
    expect(validateTag('new', Array.from({ length: 10 }, (_, i) => `t${i}`))).toMatch(/at most 10 tags/);
    expect(validateTag('y'.repeat(31), [])).toMatch(/at most 30 characters/);
    expect(validateTag('graphs', ['ml'])).toBeUndefined();
  });
});

describe('formatBytes', () => {
  it('uses the largest sensible unit', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(3_400_000)).toBe('3.2 MB');
  });
});