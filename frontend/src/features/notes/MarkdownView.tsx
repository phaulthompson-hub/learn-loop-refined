import { useMemo, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cx } from '../../lib/cx';
import { inlineText, parseMarkdown, slugify, type Block, type Inline } from './markdown';

export type ResolvedLink = { href: string | null };

type Props = {
  source: string;
  /** Where a `[[wiki link]]` points; `href: null` renders it as a missing note. */
  resolveLink: (target: string, heading: string | null) => ResolvedLink;
  /** Makes task checkboxes clickable; receives the task's source line. */
  onToggleTask?: (line: number) => void;
  /** Called when a missing wiki link is clicked (e.g. to create that note). */
  onMissingLink?: (target: string) => void;
  className?: string;
};

type RenderContext = Omit<Props, 'source' | 'className'>;

function renderInline(nodes: Inline[], ctx: RenderContext): ReactNode[] {
  return nodes.map((node, index) => {
    switch (node.type) {
      case 'text':
        return node.text;
      case 'br':
        return <br key={index} />;
      case 'code':
        return <code key={index}>{node.text}</code>;
      case 'strong':
        return <strong key={index}>{renderInline(node.children, ctx)}</strong>;
      case 'em':
        return <em key={index}>{renderInline(node.children, ctx)}</em>;
      case 'del':
        return <del key={index}>{renderInline(node.children, ctx)}</del>;
      case 'link':
        return (
          <a key={index} href={node.href} target="_blank" rel="noopener noreferrer nofollow">
            {renderInline(node.children, ctx)}
          </a>
        );
      case 'wikilink': {
        const { href } = ctx.resolveLink(node.target, node.heading);
        if (href) {
          return (
            <Link key={index} to={href} className="wikilink" title={node.target}>
              {node.label}
            </Link>
          );
        }
        return ctx.onMissingLink ? (
          <button key={index} type="button" className="wikilink missing" title={`Create “${node.target}”`} onClick={() => ctx.onMissingLink?.(node.target)}>
            {node.label}
          </button>
        ) : (
          <span key={index} className="wikilink missing" title="No note with this title yet">
            {node.label}
          </span>
        );
      }
    }
  });
}

function renderBlocks(blocks: Block[], ctx: RenderContext): ReactNode[] {
  return blocks.map((block, index) => {
    switch (block.type) {
      case 'heading': {
        const Tag = `h${block.level}` as 'h1';
        return (
          <Tag key={index} id={block.id}>
            {renderInline(block.children, ctx)}
          </Tag>
        );
      }
      case 'paragraph':
        return <p key={index}>{renderInline(block.children, ctx)}</p>;
      case 'code':
        return (
          <pre key={index} data-lang={block.lang || undefined}>
            <code>{block.text}</code>
          </pre>
        );
      case 'hr':
        return <hr key={index} />;
      case 'blockquote':
        return <blockquote key={index}>{renderBlocks(block.children, ctx)}</blockquote>;
      case 'table':
        return (
          <div key={index} className="md-table">
            <table>
              <thead>
                <tr>
                  {block.head.map((cell, column) => (
                    <th key={column} style={{ textAlign: block.align[column] ?? undefined }}>
                      {renderInline(cell, ctx)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    {row.map((cell, column) => (
                      <td key={column} style={{ textAlign: block.align[column] ?? undefined }}>
                        {renderInline(cell, ctx)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      case 'list': {
        const items = block.items.map((item, itemIndex) => {
          // A single paragraph renders inline so tight lists do not get paragraph spacing.
          const content =
            item.children.length === 1 && item.children[0].type === 'paragraph'
              ? renderInline(item.children[0].children, ctx)
              : renderBlocks(item.children, ctx);
          if (item.checked === null) return <li key={itemIndex}>{content}</li>;
          const label = item.children[0]?.type === 'paragraph' ? inlineText(item.children[0].children) : 'task';
          return (
            <li key={itemIndex} className={cx('task-item', item.checked && 'done')}>
              <input
                type="checkbox"
                checked={item.checked}
                disabled={!ctx.onToggleTask}
                aria-label={`${item.checked ? 'Completed' : 'Open'} task: ${label}`}
                onChange={() => ctx.onToggleTask?.(item.line)}
              />
              <div>{content}</div>
            </li>
          );
        });
        return block.ordered ? (
          <ol key={index} start={block.start === 1 ? undefined : block.start}>
            {items}
          </ol>
        ) : (
          <ul key={index} className={cx(block.items.some((item) => item.checked !== null) && 'task-list')}>
            {items}
          </ul>
        );
      }
    }
  });
}

/** Rendered markdown. Everything goes through React elements, so note text can never inject HTML. */
export function MarkdownView({ source, className, ...ctx }: Props) {
  const blocks = useMemo(() => parseMarkdown(source), [source]);
  if (!blocks.length) return <div className={cx('markdown', 'markdown-empty', className)}>Nothing written yet.</div>;
  return <div className={cx('markdown', className)}>{renderBlocks(blocks, ctx)}</div>;
}

/** The `/notes/{id}#heading` URL for a resolved wiki link. */
export const noteHref = (id: number, heading: string | null) => `/notes/${id}${heading ? `#${slugify(heading)}` : ''}`;
