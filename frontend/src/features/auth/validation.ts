// Mirrors backend/app/security.py `password_problems` and the email check in schemas/common.py.
export const PASSWORD_MIN = 8;
const EMAIL = /^[^@\s]+@[^@\s]+\.[a-zA-Z]{2,}$/;

export function validateEmail(email: string): string | undefined {
  const value = email.trim();
  if (!value) return 'Enter your email address.';
  if (!EMAIL.test(value)) return 'Enter a valid email address, like name@example.com.';
  return undefined;
}

export function passwordProblems(password: string): string[] {
  const problems: string[] = [];
  if (password.length < PASSWORD_MIN) problems.push(`at least ${PASSWORD_MIN} characters`);
  if (/^[A-Za-z]+$/.test(password) || /^\d+$/.test(password)) problems.push('a mix of letters and numbers or symbols');
  if (password.trim() !== password) problems.push('no leading or trailing spaces');
  return problems;
}

export function validateNewPassword(password: string): string | undefined {
  if (!password) return 'Choose a password.';
  const problems = passwordProblems(password);
  return problems.length ? `Use ${problems.join(', ')}.` : undefined;
}

/** 0–4 strength score for the meter: length, character variety and absence of problems. */
export function passwordStrength(password: string): number {
  if (!password) return 0;
  let score = 0;
  if (password.length >= PASSWORD_MIN) score += 1;
  if (password.length >= 12) score += 1;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1;
  if (/\d/.test(password) && /[^A-Za-z0-9]/.test(password)) score += 1;
  if (passwordProblems(password).length) score = Math.min(score, 1);
  return score;
}

export const STRENGTH_LABELS = ['Too weak', 'Weak', 'Fair', 'Good', 'Strong'];

export function validateName(name: string): string | undefined {
  const length = name.trim().length;
  if (length < 2) return 'Enter your name (at least 2 characters).';
  if (length > 80) return 'Name must be at most 80 characters.';
  return undefined;
}
