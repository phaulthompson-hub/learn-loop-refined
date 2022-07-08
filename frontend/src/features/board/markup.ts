// A deliberately small Markdown subset for task descriptions: headings, bullet/numbered lists,
// paragraphs, **bold**, *italic*, `code` and bare links. It produces a tree that React renders
// as elements (never raw HTML), so user text cannot inject markup.

export type Inline = { kind: 'text' | 'bold' | 'italic' | 'code' | 'link'; text: string };
export type Block =
  | { kind: 'heading'; inline: Inline[] }
  | { kind: 'paragraph'; inline: Inline[] }
  | { kind: 'bullets' | 'numbers'; items: Inline[][] };

const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*|https?:\/\/[^\s)]+)/g;

export function parseInline(text: string): Inline[] {
  const parts: Inline[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    const index = match.index ?? 0;
    if (index > last) parts.push({ kind: 'text', text: text.slice(last, index) });
    const token = match[0];
    if (token.startsWith('**')) parts.push({ kind: 'bold', text: token.slice(2, -2) });
    else if (token.startsWith('`')) parts.push({ kind: 'code', text: token.slice(1, -1) });
    else if (token.startsWith('*')) parts.push({ kind: 'italic', text: token.slice(1, -1) });
    else parts.push({ kind: 'link', text: token });
    last = index + token.length;
  }
  if (last < text.length) parts.push({ kind: 'text', text: text.slice(last) });
  return parts;
}

const BULLET = /^\s*[-*]\s+(.*)$/;
const NUMBER = /^\s*\d+[.)]\s+(.*)$/;
const HEADING = /^#{1,3}\s+(.*)$/;

export function parseMarkup(source: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) blocks.push({ kind: 'paragraph', inline: parseInline(paragraph.join(' ')) });
    paragraph = [];
  };
  for (const line of source.replace(/\r\n/g, '\n').split('\n')) {
    const bullet = BULLET.exec(line);
    const number = bullet ? null : NUMBER.exec(line);
    const heading = HEADING.exec(line);
    if (bullet || number) {
      flush();
      const kind = bullet ? 'bullets' : 'numbers';
      const item = parseInline((bullet ?? number)![1]);
      const previous = blocks[blocks.length - 1];
      if (previous && previous.kind === kind) previous.items.push(item);
      else blocks.push({ kind, items: [item] });
    } else if (heading) {
      flush();
      blocks.push({ kind: 'heading', inline: parseInline(heading[1]) });
    } else if (!line.trim()) {
      flush();
    } else {
      paragraph.push(line.trim());
    }
  }
  flush();
  return blocks;
}
