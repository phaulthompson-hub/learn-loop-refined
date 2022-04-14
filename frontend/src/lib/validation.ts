// Client-side checks that mirror the API rules in backend/app/schemas/learning.py and routers/courses.py.
export const TITLE_MIN = 2;
export const TITLE_MAX = 160;
export const TEXT_MIN = 80;
export const TEXT_MAX = 200_000;
export const SUBJECT_MAX = 60;
export const DESCRIPTION_MAX = 600;
export const TAG_MAX_LENGTH = 30;
export const TAGS_MAX = 10;
export const SOURCE_NAME_MAX = 120;
export const CONCEPT_NAME_MIN = 2;
export const CONCEPT_NAME_MAX = 120;
export const CONCEPT_SUMMARY_MIN = 10;
export const CONCEPT_SUMMARY_MAX = 600;
export const FILE_MAX_BYTES = 8_000_000;
export const ALLOWED_EXTENSIONS = ['.pdf', '.txt', '.md'];

export type FieldErrors = Partial<Record<'title' | 'text' | 'file', string>>;

function lengthError(value: string, min: number, max: number, label: string): string | undefined {
  const length = value.trim().length;
  if (length < min) return min <= 1 ? `${label} is required.` : `${label} must be at least ${min} characters.`;
  if (length > max) return `${label} must be at most ${max.toLocaleString('en-US')} characters.`;
  return undefined;
}

export function validateTitle(title: string): string | undefined {
  return lengthError(title, TITLE_MIN, TITLE_MAX, 'Title');
}

export function validateText(text: string): string | undefined {
  const length = text.trim().length;
  if (length < TEXT_MIN) return `Paste at least ${TEXT_MIN} characters of material (currently ${length}).`;
  if (length > TEXT_MAX) return `Material must be at most ${TEXT_MAX.toLocaleString('en-US')} characters.`;
  return undefined;
}

export function validateSubject(subject: string): string | undefined {
  return lengthError(subject, 1, SUBJECT_MAX, 'Subject');
}

export function validateDescription(description: string): string | undefined {
  return lengthError(description, 0, DESCRIPTION_MAX, 'Description');
}

export function validateSourceName(name: string): string | undefined {
  return lengthError(name, 1, SOURCE_NAME_MAX, 'Name');
}

export function validateConceptName(name: string): string | undefined {
  return lengthError(name, CONCEPT_NAME_MIN, CONCEPT_NAME_MAX, 'Name');
}

export function validateConceptSummary(summary: string): string | undefined {
  return lengthError(summary, CONCEPT_SUMMARY_MIN, CONCEPT_SUMMARY_MAX, 'Summary');
}

/** Same normalisation as the API's `split_tags`: trimmed, lower case, unique, at most 10 tags of 30 characters. */
export function normaliseTags(values: string | readonly string[]): string[] {
  const parts = typeof values === 'string' ? values.split(',') : values;
  const tags: string[] = [];
  for (const part of parts) {
    const tag = part.trim().toLowerCase();
    if (tag && !tags.includes(tag)) tags.push(tag.slice(0, TAG_MAX_LENGTH));
  }
  return tags.slice(0, TAGS_MAX);
}

/** Why `tag` cannot be added to `current`, or undefined when it can. */
export function validateTag(tag: string, current: readonly string[]): string | undefined {
  const value = tag.trim().toLowerCase();
  if (!value) return 'Type a tag first.';
  if (value.length > TAG_MAX_LENGTH) return `Tags must be at most ${TAG_MAX_LENGTH} characters.`;
  if (current.includes(value)) return `“${value}” is already added.`;
  if (current.length >= TAGS_MAX) return `A course can have at most ${TAGS_MAX} tags.`;
  return undefined;
}

export function fileExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot).toLowerCase() : '';
}

export function validateFile(file: { name: string; size: number } | null): string | undefined {
  if (!file) return 'Choose a PDF, TXT, or Markdown file.';
  if (!ALLOWED_EXTENSIONS.includes(fileExtension(file.name))) return 'Only PDF, TXT, or Markdown files are supported.';
  if (file.size > FILE_MAX_BYTES) return 'File must be under 8 MB.';
  if (file.size === 0) return 'The selected file is empty.';
  return undefined;
}

export function validatePasteForm(title: string, text: string): FieldErrors {
  const errors: FieldErrors = {};
  const titleError = validateTitle(title);
  const textError = validateText(text);
  if (titleError) errors.title = titleError;
  if (textError) errors.text = textError;
  return errors;
}

export function validateUploadForm(title: string, file: { name: string; size: number } | null): FieldErrors {
  const errors: FieldErrors = {};
  const titleError = validateTitle(title);
  const fileError = validateFile(file);
  if (titleError) errors.title = titleError;
  if (fileError) errors.file = fileError;
  return errors;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
