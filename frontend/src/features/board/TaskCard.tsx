import { memo } from 'react';
import { ChevronsDown, ArrowRight, ChevronsUp, MessageSquare, MoreHorizontal, SidebarOpen } from 'lucide-react';
import { Avatar } from '../../components/Avatar';
import { Menu, type MenuItem } from '../../components/Menu';
import { cx } from '../../lib/cx';
import { STATUS_LABELS, STATUSES } from './board';
import { ChecklistMeter, DueBadge, LabelChip, PriorityIcon } from './TaskBits';
import type { Task, TaskStatus } from './types';

type TaskCardProps = {
  task: Task;
  now: Date;
  dragging: boolean;
  onOpen: (task: Task) => void;
  onDragStart: (task: Task, event: React.DragEvent) => void;
  onDragEnd: () => void;
  /** Move via the "Move to…" menu: to another column (at its end), or to the top/bottom of this one. */
  onMenuMove: (task: Task, status: TaskStatus, place: 'top' | 'bottom') => void;
  /** Alt+Arrow keys while the card is focused. */
  onKeyboardMove: (task: Task, key: string) => void;
};

const ARROWS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

function moveItems(task: Task, onMenuMove: TaskCardProps['onMenuMove']): MenuItem[] {
  return [
    { label: 'Move to top', icon: <ChevronsUp />, onSelect: () => onMenuMove(task, task.status, 'top') },
    { label: 'Move to bottom', icon: <ChevronsDown />, onSelect: () => onMenuMove(task, task.status, 'bottom') },
    'separator',
    ...STATUSES.filter((status) => status !== task.status).map((status) => ({
      label: `Move to ${STATUS_LABELS[status]}`,
      icon: <ArrowRight />,
      onSelect: () => onMenuMove(task, status, 'bottom'),
    })),
  ];
}

function describe(task: Task): string {
  const parts = [task.key, task.title, `${task.priority} priority`];
  if (task.assignee) parts.push(`assigned to ${task.assignee.name}`);
  if (task.due_date) parts.push(`due ${task.due_date}`);
  return parts.join(', ');
}

/** One kanban card. Click/Enter opens the drawer; drag, the "…" menu or Alt+Arrows move it. */
export const TaskCard = memo(function TaskCard({ task, now, dragging, onOpen, onDragStart, onDragEnd, onMenuMove, onKeyboardMove }: TaskCardProps) {
  const onKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget) return; // keys inside the menu belong to the menu
    if (event.altKey && ARROWS.has(event.key)) {
      event.preventDefault();
      onKeyboardMove(task, event.key);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onOpen(task);
    }
  };

  return (
    <article
      className={cx('task-card', dragging && 'is-dragging', task.status === 'done' && 'is-done')}
      data-task-id={task.id}
      draggable
      tabIndex={0}
      aria-label={describe(task)}
      aria-describedby="board-keyboard-help"
      onClick={() => onOpen(task)}
      onKeyDown={onKeyDown}
      onDragStart={(event) => onDragStart(task, event)}
      onDragEnd={onDragEnd}
    >
      {task.course && <span className="course-stripe" style={{ background: task.course.color }} title={task.course.title} />}
      <header className="task-card-head">
        <span className="task-key">{task.key}</span>
        <PriorityIcon priority={task.priority} />
        <span className="spacer" />
        <div onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
          <Menu
            className="card-menu"
            header={<span className="muted">{task.key}</span>}
            trigger={({ toggle, ref, open }) => (
              <button type="button" ref={ref} className="icon-only card-menu-button" aria-label={`Actions for ${task.key}`} aria-haspopup="menu" aria-expanded={open} onClick={toggle}>
                <MoreHorizontal />
              </button>
            )}
            items={[{ label: 'Open details', icon: <SidebarOpen />, onSelect: () => onOpen(task) }, 'separator', ...moveItems(task, onMenuMove)]}
          />
        </div>
      </header>
      <h3 className="task-title">{task.title}</h3>
      {task.labels.length > 0 && (
        <div className="task-labels">
          {task.labels.map((label) => (
            <LabelChip key={label.id} label={label} />
          ))}
        </div>
      )}
      <footer className="task-card-foot">
        <DueBadge due={task.due_date} status={task.status} now={now} />
        <ChecklistMeter done={task.checklist_done} total={task.checklist_total} />
        {task.comment_count > 0 && (
          <span className="task-meta" title={`${task.comment_count} comments`}>
            <MessageSquare aria-hidden />
            {task.comment_count}
          </span>
        )}
        <span className="spacer" />
        {task.estimate !== null && (
          <span className="task-points" title={`${task.estimate} points`}>
            {task.estimate}
          </span>
        )}
        {task.assignee ? (
          <Avatar name={task.assignee.name} color={task.assignee.avatar_color} size="xs" />
        ) : (
          <span className="avatar avatar-xs unassigned" title="Unassigned" aria-label="Unassigned" role="img" />
        )}
      </footer>
    </article>
  );
});
