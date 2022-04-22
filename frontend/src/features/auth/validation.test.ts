import { describe, expect, it } from 'vitest';
import { passwordProblems, passwordStrength, STRENGTH_LABELS, validateEmail, validateName, validateNewPassword } from './validation';

describe('validateEmail', () => {
  it('requires an address', () => {
    expect(validateEmail('   ')).toBe('Enter your email address.');
  });

  it.each(['demo@learnloop.dev', ' Nora@Example.org ', 'a.b+tag@sub.example.co'])('accepts %s', (email) => {
    expect(validateEmail(email)).toBeUndefined();
  });

  it.each(['plainaddress', 'no-tld@example', '@example.com', 'two@@example.com', 'space in@example.com', 'x@y.c'])('rejects %s', (email) => {
    expect(validateEmail(email)).toMatch(/valid email/);
  });
});

describe('password rules (mirror of backend/app/security.py)', () => {
  it('lists every problem', () => {
    expect(passwordProblems('abc')).toEqual(['at least 8 characters', 'a mix of letters and numbers or symbols']);
    expect(passwordProblems('12345678')).toEqual(['a mix of letters and numbers or symbols']);
    expect(passwordProblems(' padded-pass-1 ')).toEqual(['no leading or trailing spaces']);
    expect(passwordProblems('learnloop123')).toEqual([]);
  });

  it('turns problems into one sentence', () => {
    expect(validateNewPassword('')).toBe('Choose a password.');
    expect(validateNewPassword('abcdefgh')).toBe('Use a mix of letters and numbers or symbols.');
    expect(validateNewPassword('learnloop123')).toBeUndefined();
  });

  it('scores strength from length and variety, capped when the password is not acceptable', () => {
    expect(passwordStrength('')).toBe(0);
    expect(passwordStrength('abcdefghijkl')).toBe(1);
    expect(passwordStrength('learnloop123')).toBe(2);
    expect(passwordStrength('Learnloop123')).toBe(3);
    expect(passwordStrength('Learn-loop-2022')).toBe(4);
    expect(STRENGTH_LABELS[passwordStrength('Learn-loop-2022')]).toBe('Strong');
  });
});

describe('validateName', () => {
  it('trims and enforces 2 to 80 characters', () => {
    expect(validateName(' A ')).toMatch(/at least 2/);
    expect(validateName('x'.repeat(81))).toMatch(/at most 80/);
    expect(validateName('  Sam Okafor ')).toBeUndefined();
  });
});
