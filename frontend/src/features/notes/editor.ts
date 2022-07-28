// Pure text transformations behind the markdown toolbar and keyboard shortcuts. Each takes the
// textarea's value and selection and returns the new value and selection, so they are easy to test
// and the component only has to apply the result.

export type TextState = { text: string; start: number; end: number };

export type LineStyle = 'h1' | 'h2' | 'h3' | 'bullet' | 'ordered' | 'task' | 'quote';

const LINE_PREFIX: Record<LineStyle, RegExp> = {
  h1: /^# /,
  h2: /^## /,
  h3: /^### /,
  bullet: /^[-*+] (?!\[[ xX]\] )/,
  ordered: /^\d+[.)] /,
  task: /^[-*+] \[[ xX]\] /,
  quote: /^> ?/,
};
// Any existing block prefix, replaced when switching a line from one style to another.
const ANY_PREFIX = /^(?:#{1,6} |[-*+] \[[ xX]\] |[-*+] |\d+[.)] |> ?)/;

function prefixFor(style: LineStyle, index: number): string {
  switch (style) {
    case 'h1':
      return '# ';
    case 'h2':
      return '## ';
    case 'h3':
      return '### ';
    case 'bullet':
      return '- ';
    case 'ordered':
      return `${index + 1}. `;
    case 'task':
      return '- [ ] ';
    case 'quote':
      return '> ';
  }
}

/** Wrap the selection in `before`/`after` (e.g. `**`), or unwrap it when it is already wrapped. */
export function toggleWrap({ text, start, end }: TextState, before: string, after = before, placeholder = 'text'): TextState {
  const outerStart = start - before.length;
  const wrapped = outerStart >= 0 && text.slice(outerStart, start) === before && text.slice(end, end + after.length) === after;
  if (wrapped && end > start) {
    return { text: text.slice(0, outerStart) + text.slice(start, end) + text.slice(end + after.length), start: outerStart, end: end - before.length };
  }
  const selected = text.slice(start, end) || placeholder;
  const next = text.slice(0, start) + before + selected + after + text.slice(end);
  return { text: next, start: start + before.length, end: start + before.length + selected.length };
}

function lineBounds(text: string, start: number, end: number): [number, number] {
  const from = text.lastIndexOf('\n', start - 1) + 1;
  const newline = text.indexOf('\n', end > start && text[end - 1] === '\n' ? end - 1 : end);
  return [from, newline === -1 ? text.length : newline];
}

/** Apply (or remove, if every selected line already has it) a block style to the selected lines. */
export function toggleLineStyle({ text, start, end }: TextState, style: LineStyle): TextState {
  const [from, to] = lineBounds(text, start, end);
  const lines = text.slice(from, to).split('\n');
  const content = lines.filter((line) => line.trim());
  const remove = content.length > 0 && content.every((line) => LINE_PREFIX[style].test(line));
  let counter = 0;
  const updated = lines.map((line) => {
    if (!line.trim() && lines.length > 1) return line;
    if (remove) return line.replace(LINE_PREFIX[style], '');
    return prefixFor(style, counter++) + line.replace(ANY_PREFIX, '');
  });
  const block = updated.join('\n');
  const next = text.slice(0, from) + block + text.slice(to);
  if (start === end && lines.length === 1) {
    const caret = Math.max(from, start + (block.length - (to - from)));
    return { text: next, start: caret, end: caret };
  }
  return { text: next, start: from, end: from + block.length };
}

/** Insert `[label](https://)`, selecting the URL so it can be typed over. */
export function insertLink({ text, start, end }: TextState): TextState {
  const label = text.slice(start, end) || 'link text';
  const url = 'https://';
  const next = `${text.slice(0, start)}[${label}](${url})${text.slice(end)}`;
  const urlStart = start + label.length + 3;
  return { text: next, start: urlStart, end: urlStart + url.length };
}

/** Inline code for a selection on one line, a fenced block for empty or multi-line selections. */
export function insertCode(state: TextState): TextState {
  const selected = state.text.slice(state.start, state.end);
  if (selected && !selected.includes('\n')) return toggleWrap(state, '`');
  const { text, start, end } = state;
  const needsBreak = start > 0 && text[start - 1] !== '\n';
  const opening = `${needsBreak ? '\n' : ''}\`\`\`\n`;
  const body = selected || 'code';
  const next = `${text.slice(0, start)}${opening}${body}\n\`\`\`\n${text.slice(end)}`;
  return { text: next, start: start + opening.length, end: start + opening.length + body.length };
}

/** Insert `[[` at the caret (or wrap the selection as a link target). */
export function insertWikilink({ text, start, end }: TextState): TextState {
  const selected = text.slice(start, end);
  if (selected) {
    const next = `${text.slice(0, start)}[[${selected}]]${text.slice(end)}`;
    return { text: next, start: start + selected.length + 4, end: start + selected.length + 4 };
  }
  const next = `${text.slice(0, start)}[[${text.slice(end)}`;
  return { text: next, start: start + 2, end: start + 2 };
}

const LIST_LINE = /^(\s*)([-*+]|(\d+)([.)]))( \[[ xX]\])? /;

/**
 * Enter inside a list item: start the next item (numbered lists count up, tasks start unchecked).
 * Enter on an empty item ends the list instead. Returns null when the caret is not in a list item.
 */
export function continueList({ text, start, end }: TextState): TextState | null {
  if (start !== end) return null;
  const lineStart = text.lastIndexOf('\n', start - 1) + 1;
  const line = text.slice(lineStart, start);
  const match = LIST_LINE.exec(line);
  if (!match) return null;
  const lineEnd = text.indexOf('\n', start);
  const after = text.slice(start, lineEnd === -1 ? text.length : lineEnd);
  if (!line.slice(match[0].length).trim() && !after.trim()) {
    return { text: text.slice(0, lineStart) + text.slice(start), start: lineStart, end: lineStart };
  }
  const [, indent, bullet, number, separator, task] = match;
  const marker = number ? `${parseInt(number, 10) + 1}${separator}` : bullet;
  const insert = `\n${indent}${marker}${task ? ' [ ]' : ''} `;
  const next = text.slice(0, start) + insert + text.slice(end);
  return { text: next, start: start + insert.length, end: start + insert.length };
}

const WORD = /[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu;

export function countWords(markdown: string): number {
  // Fence markers and link URLs are syntax, not words.
  const text = markdown.replace(/^ {0,3}(`{3,}|~{3,}).*$/gm, '').replace(/\]\([^)]*\)/g, ']');
  return text.match(WORD)?.length ?? 0;
}

/** Minutes to read at ~220 words per minute; at least 1 for any non-empty note. */
export function readingMinutes(words: number): number {
  return words === 0 ? 0 : Math.max(1, Math.round(words / 220));
}
