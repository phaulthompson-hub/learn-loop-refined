// Small presentational pieces shared by cards, the list view and the task drawer.
import { Fragment } from 'react';
import { CalendarClock, ChevronsUp, ChevronUp, Equal, ChevronDown, ListChecks } from 'lucide-react';
import type { Person } from '../../app/types';
import { cx } from '../../lib/cx';
import { dueLabel, dueStatus, mentionSegments, PRIORITY_LABELS, progressPercent } from './board';
import { parseMarkup, type Inline } from './markup';
import type { Label, TaskPriority, TaskStatus } from './types';

const PRIORITY_ICONS = { urgent: ChevronsUp, high: ChevronUp, medium: Equal, low: ChevronDown };

export function PriorityIcon({ priority, withLabel = false }: { priority: TaskPriority; withLabel?: boolean }) {
  const Icon = PRIORITY_ICONS[priority];
  return (
    <span className={cx('task-priority', `task-priority-${priority}`)} title={`${PRIORITY_LABELS[priority]} priority`}>
      <Icon aria-hidden />
      {withLabel ? PRIORITY_LABELS[priority] : <span className="sr-only">{PRIORITY_LABELS[priority]} priority</span>}
    </span>
  );
}

export function DueBadge({ due, status, now }: { due: string | null; status: TaskStatus; now: Date }) {
  if (!due) return null;
  const state = dueStatus(due, status, now);
  return (
    <span className={cx('task-due', `task-due-${state}`)} title={`Due ${due}`}>
      <CalendarClock aria-hidden />
      {dueLabel(due, status, now)}
    </span>
  );
}

export function LabelChip({ label }: { label: Pick<Label, 'name' | 'color'> }) {
  return (
    <span className="label-chip" style={{ '--label': label.color } as React.CSSProperties}>
      {label.name}
    </span>
  );
}

export function ChecklistMeter({ done, total }: { done: number; total: number }) {
  if (!total) return null;
  return (
    <span className={cx('task-checklist-meter', done === total && 'complete')} title={`${done} of ${total} checklist items done`}>
      <ListChecks aria-hidden />
      {done}/{total}
    </span>
  );
}

export function ProgressBar({ done, total, label }: { done: number; total: number; label: string }) {
  const percent = progressPercent(done, total);
  return (
    <div className="bar" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
      <i style={{ width: `${percent}%` }} />
    </div>
  );
}

function InlineText({ parts }: { parts: Inline[] }) {
  return (
    <>
      {parts.map((part, index) => {
        if (part.kind === 'bold') return <strong key={index}>{part.text}</strong>;
        if (part.kind === 'italic') return <em key={index}>{part.text}</em>;
        if (part.kind === 'code') return <code key={index}>{part.text}</code>;
        if (part.kind === 'link')
          return (
            <a key={index} href={part.text} target="_blank" rel="noreferrer noopener">
              {part.text}
            </a>
          );
        return <Fragment key={index}>{part.text}</Fragment>;
      })}
    </>
  );
}

/** Render a description written in the small Markdown subset from markup.ts. */
export function Markup({ source }: { source: string }) {
  return (
    <div className="task-markup">
      {parseMarkup(source).map((block, index) => {
        if (block.kind === 'heading')
          return (
            <h4 key={index}>
              <InlineText parts={block.inline} />
            </h4>
          );
        if (block.kind === 'paragraph')
          return (
            <p key={index}>
              <InlineText parts={block.inline} />
            </p>
          );
        const List = block.kind === 'bullets' ? 'ul' : 'ol';
        return (
          <List key={index}>
            {block.items.map((item, i) => (
              <li key={i}>
                <InlineText parts={item} />
              </li>
            ))}
          </List>
        );
      })}
    </div>
  );
}

/** Comment text with @mentions highlighted. */
export function MentionText({ body, people }: { body: string; people: readonly Person[] }) {
  return (
    <>
      {mentionSegments(body, people).map((segment, index) =>
        segment.person ? (
          <span key={index} className="task-mention" title={segment.person.email}>
            {segment.text}
          </span>
        ) : (
          <Fragment key={index}>{segment.text}</Fragment>
        ),
      )}
    </>
  );
}
