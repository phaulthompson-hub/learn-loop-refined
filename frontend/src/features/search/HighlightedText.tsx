import { splitHighlights } from './highlight';
import type { Range } from './types';

/** Text with the given ranges wrapped in <mark>. */
export function Highlight({ text, ranges }: { text: string; ranges: readonly Range[] }) {
  return (
    <>
      {splitHighlights(text, ranges).map((segment, index) => (segment.match ? <mark key={index}>{segment.text}</mark> : <span key={index}>{segment.text}</span>))}
    </>
  );
}
