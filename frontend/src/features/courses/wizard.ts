// State and per-step validation for the "New course" wizard.
import {
  validateDescription,
  validateFile,
  validateSubject,
  validateText,
  validateTitle,
} from '../../lib/validation';
import type { CourseDetails } from './types';

/** Mirrors COURSE_COLORS in backend/app/services/learning.py. */
export const COURSE_COLORS = ['#1d6d45', '#2563eb', '#9333ea', '#c2410c', '#0f766e', '#be123c', '#4d7c0f', '#a16207'];

export type WizardStep = 'details' | 'material' | 'review';
export const STEPS: { key: WizardStep; label: string; hint: string }[] = [
  { key: 'details', label: 'Details', hint: 'Title, subject and look' },
  { key: 'material', label: 'Material', hint: 'Paste notes or upload a file' },
  { key: 'review', label: 'Review', hint: 'Check and create' },
];

export type MaterialMode = 'paste' | 'upload';
export type FileLike = { name: string; size: number };

export type WizardState<F extends FileLike = File> = {
  details: CourseDetails;
  mode: MaterialMode;
  text: string;
  file: F | null;
  status: 'active' | 'draft';
};

export type WizardErrors = Partial<Record<'title' | 'subject' | 'description' | 'text' | 'file', string>>;

export function initialWizard<F extends FileLike = File>(colorSeed = 0): WizardState<F> {
  return {
    details: {
      title: '',
      description: '',
      subject: '',
      difficulty: 'intro',
      tags: [],
      color: COURSE_COLORS[colorSeed % COURSE_COLORS.length],
    },
    mode: 'paste',
    text: '',
    file: null,
    status: 'active',
  };
}

function compact(errors: WizardErrors): WizardErrors {
  return Object.fromEntries(Object.entries(errors).filter(([, message]) => message)) as WizardErrors;
}

export function validateDetailsStep(details: CourseDetails): WizardErrors {
  return compact({
    title: validateTitle(details.title),
    subject: validateSubject(details.subject),
    description: validateDescription(details.description),
  });
}

export function validateMaterialStep(state: Pick<WizardState<FileLike>, 'mode' | 'text' | 'file'>): WizardErrors {
  return state.mode === 'paste' ? compact({ text: validateText(state.text) }) : compact({ file: validateFile(state.file) });
}

export function validateStep(step: WizardStep, state: WizardState<FileLike>): WizardErrors {
  if (step === 'details') return validateDetailsStep(state.details);
  if (step === 'material') return validateMaterialStep(state);
  return { ...validateDetailsStep(state.details), ...validateMaterialStep(state) };
}

/** The first step with a problem, so "Create" can send the user straight to it. */
export function firstInvalidStep(state: WizardState<FileLike>): WizardStep | null {
  if (Object.keys(validateDetailsStep(state.details)).length) return 'details';
  if (Object.keys(validateMaterialStep(state)).length) return 'material';
  return null;
}

export type MaterialStats = { characters: number; words: number; sentences: number; readingMinutes: number };

/** Rough size of pasted material, shown while typing and on the review step. */
export function materialStats(text: string): MaterialStats {
  const trimmed = text.trim();
  const words = trimmed ? trimmed.split(/\s+/).length : 0;
  const sentences = trimmed.split(/(?<=[.!?])\s+|\n+/).filter((s) => s.trim().length > 35).length;
  return { characters: trimmed.length, words, sentences, readingMinutes: words ? Math.max(1, Math.round(words / 220)) : 0 };
}
