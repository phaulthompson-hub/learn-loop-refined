import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Loader2, Plus } from 'lucide-react';
import { Avatar } from '../../components/Avatar';
import { cx } from '../../lib/cx';
import { plural } from '../../lib/format';
import {
  buildSwimlanes,
  columnStats,
  columnTasks,
  dropToFinalIndex,
  keyboardMove,
  laneChange,
  laneKey,
  STATUS_LABELS,
  STATUSES,
  wipState,
  type GroupBy,
  type Swimlane,
} from './board';
import { TaskCard } from './TaskCard';
import { PriorityIcon } from './TaskBits';
import type { MoveRequest } from './useBoard';
import { validateTitle } from './validation';
import type { BoardColumn, BoardMember, Task, TaskStatus } from './types';

type BoardViewProps = {
  columns: BoardColumn[];
  allTasks: Task[];
  visibleTasks: Task[];
  groupBy: GroupBy;
  members: BoardMember[];
  now: Date;
  onOpen: (task: Task) => void;
  onMove: (request: MoveRequest) => Promise<boolean>;
  onQuickAdd: (status: TaskStatus, title: string) => Promise<boolean>;
  onAddInColumn: (status: TaskStatus) => void;
};

type DropTarget = { cell: string; index: number };

const cellId = (lane: string, status: TaskStatus) => `${lane}|${status}`;

function WipPill({ total, limit }: { total: number; limit: number | null }) {
  const state = wipState(total, limit);
  if (state === 'none') return null;
  const title = state === 'over' ? `Over the work-in-progress limit of ${limit}` : `Work-in-progress limit ${limit}`;
  return (
    <span className={cx('wip-pill', `wip-${state}`)} title={title}>
      {state === 'over' && <AlertTriangle aria-hidden />}
      {total}/{limit}
      <span className="sr-only">{title}</span>
    </span>
  );
}

function QuickAdd({ status, onAdd }: { status: TaskStatus; onAdd: BoardViewProps['onQuickAdd'] }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const problem = validateTitle(title);
    if (problem) return setError(problem);
    setBusy(true);
    const ok = await onAdd(status, title.trim());
    setBusy(false);
    if (ok) {
      setTitle('');
      setError(null);
    }
  };

  if (!open) {
    return (
      <button type="button" className="quick-add-toggle" onClick={() => setOpen(true)}>
        <Plus /> Add a task
      </button>
    );
  }
  return (
    <div className="quick-add">
      <input
        className="input"
        autoFocus
        value={title}
        maxLength={200}
        placeholder={`New task in ${STATUS_LABELS[status]}…`}
        aria-label={`New task title in ${STATUS_LABELS[status]}`}
        aria-invalid={error ? true : undefined}
        disabled={busy}
        onChange={(event) => {
          setTitle(event.target.value);
          setError(null);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            void submit();
          } else if (event.key === 'Escape') {
            setOpen(false);
            setTitle('');
            setError(null);
          }
        }}
        onBlur={() => !title.trim() && setOpen(false)}
      />
      {busy && <Loader2 className="spin quick-add-spinner" aria-hidden />}
      {error ? <small className="field-error">{error}</small> : <small className="hint">Enter to add · Esc to close</small>}
    </div>
  );
}

function LaneHeader({ lane }: { lane: Swimlane }) {
  const points = columnStats(lane.tasks).points;
  return (
    <header className="lane-head">
      {lane.person ? <Avatar name={lane.person.name} color={lane.person.avatar_color} size="xs" /> : lane.priority ? <PriorityIcon priority={lane.priority} /> : null}
      <b>{lane.title}</b>
      <span className="muted">
        {plural(lane.tasks.length, 'task')} · {points} pts
      </span>
    </header>
  );
}

/** Kanban columns (optionally split into swimlanes) with native drag and drop plus keyboard moves. */
export function BoardView({ columns, allTasks, visibleTasks, groupBy, members, now, onOpen, onMove, onQuickAdd, onAddInColumn }: BoardViewProps) {
  const [dragId, setDragId] = useState<number | null>(null);
  const [drop, setDrop] = useState<DropTarget | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const focusAfterMove = useRef<number | null>(null);

  const lanes = useMemo(() => buildSwimlanes(visibleTasks, groupBy, members), [visibleTasks, groupBy, members]);
  const cells = useMemo(() => {
    const map = new Map<string, Task[]>();
    lanes.forEach((lane) => STATUSES.forEach((status) => map.set(cellId(lane.key, status), columnTasks(lane.tasks, status))));
    return map;
  }, [lanes]);

  useEffect(() => {
    if (focusAfterMove.current === null) return;
    document.querySelector<HTMLElement>(`[data-task-id="${focusAfterMove.current}"]`)?.focus();
    focusAfterMove.current = null;
  }, [visibleTasks]);

  const laneOf = useCallback((task: Task) => (groupBy === 'none' ? 'all' : laneKey(task, groupBy)), [groupBy]);

  const move = useCallback(
    async (task: Task, status: TaskStatus, lane: string, finalIndex: number) => {
      const visible = cells.get(cellId(lane, status)) ?? [];
      const lanePatch = groupBy !== 'none' && laneOf(task) !== lane ? laneChange(lane) : undefined;
      focusAfterMove.current = task.id;
      const moved = await onMove({ taskId: task.id, status, visible, finalIndex, lanePatch });
      if (moved) {
        const others = visible.filter((t) => t.id !== task.id).length;
        setAnnouncement(`Moved ${task.key} to ${STATUS_LABELS[status]}, position ${Math.min(finalIndex, others) + 1} of ${others + 1}.`);
      }
    },
    [cells, groupBy, laneOf, onMove],
  );

  const onKeyboardMove = useCallback(
    (task: Task, key: string) => {
      const lane = laneOf(task);
      const byStatus = Object.fromEntries(STATUSES.map((s) => [s, cells.get(cellId(lane, s)) ?? []])) as Record<TaskStatus, Task[]>;
      const target = keyboardMove(key, task, byStatus);
      if (target) void move(task, target.status, lane, target.index);
      else setAnnouncement(`${task.key} cannot move further that way.`);
    },
    [cells, laneOf, move],
  );

  const onMenuMove = useCallback(
    (task: Task, status: TaskStatus, place: 'top' | 'bottom') => {
      const lane = laneOf(task);
      void move(task, status, lane, place === 'top' ? 0 : (cells.get(cellId(lane, status))?.length ?? 0));
    },
    [cells, laneOf, move],
  );

  const onDragStart = useCallback((task: Task, event: React.DragEvent) => {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', String(task.id));
    setDragId(task.id);
  }, []);

  const onDragEnd = useCallback(() => {
    setDragId(null);
    setDrop(null);
  }, []);

  const onDragOver = (event: React.DragEvent<HTMLElement>, cell: string) => {
    if (dragId === null) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const cards = [...event.currentTarget.querySelectorAll<HTMLElement>('[data-task-id]')];
    const hit = cards.findIndex((card) => {
      const rect = card.getBoundingClientRect();
      return event.clientY < rect.top + rect.height / 2;
    });
    const index = hit === -1 ? cards.length : hit;
    if (drop?.cell !== cell || drop.index !== index) setDrop({ cell, index });
  };

  const onDrop = (event: React.DragEvent<HTMLElement>, lane: string, status: TaskStatus) => {
    event.preventDefault();
    const task = allTasks.find((t) => t.id === (dragId ?? Number(event.dataTransfer.getData('text/plain'))));
    const target = drop;
    onDragEnd();
    if (!task || !target) return;
    const visible = cells.get(cellId(lane, status)) ?? [];
    void move(task, status, lane, dropToFinalIndex(visible.map((t) => t.id), task.id, target.index));
  };

  return (
    <div className={cx('board-scroll', dragId !== null && 'is-dragging')}>
      <p id="board-keyboard-help" className="sr-only">
        Press Enter to open. Alt plus arrow keys move the card between columns and up or down within a column.
      </p>
      <div className="sr-only" role="status" aria-live="polite">
        {announcement}
      </div>
      <div className="board-grid">
        <div className="board-heads">
          {columns.map((column) => {
            const total = allTasks.filter((t) => t.status === column.status).length;
            const stats = columnStats(visibleTasks.filter((t) => t.status === column.status));
            return (
              <div key={column.status} className={cx('column-head', `task-status-${column.status}`, wipState(total, column.wip_limit) === 'over' && 'is-over')}>
                <span className="task-status-dot" aria-hidden />
                <h2>{column.title}</h2>
                <span className="column-count" title={stats.count === total ? undefined : `${stats.count} of ${total} shown`}>
                  {stats.count}
                </span>
                <span className="column-points" title="Story points">
                  {stats.points} pts
                </span>
                <span className="spacer" />
                <WipPill total={total} limit={column.wip_limit} />
                <button type="button" className="icon-only" aria-label={`Add task to ${column.title}`} onClick={() => onAddInColumn(column.status)}>
                  <Plus />
                </button>
              </div>
            );
          })}
        </div>
        {lanes.map((lane) => (
          <section key={lane.key} className={cx('board-lane', groupBy !== 'none' && 'has-head')} aria-label={groupBy === 'none' ? undefined : lane.title}>
            {groupBy !== 'none' && <LaneHeader lane={lane} />}
            <div className="lane-cells">
              {STATUSES.map((status) => {
                const id = cellId(lane.key, status);
                const tasks = cells.get(id) ?? [];
                const indicator = drop?.cell === id ? drop.index : -1;
                return (
                  <div
                    key={status}
                    className={cx('board-cell', indicator !== -1 && 'is-target')}
                    aria-label={groupBy === 'none' ? STATUS_LABELS[status] : `${lane.title}, ${STATUS_LABELS[status]}`}
                    role="group"
                    onDragOver={(event) => onDragOver(event, id)}
                    onDragLeave={(event) => !event.currentTarget.contains(event.relatedTarget as Node | null) && setDrop(null)}
                    onDrop={(event) => onDrop(event, lane.key, status)}
                  >
                    {tasks.map((task, index) => (
                      <Fragment key={task.id}>
                        {indicator === index && <div className="drop-indicator" aria-hidden />}
                        <TaskCard
                          task={task}
                          now={now}
                          dragging={dragId === task.id}
                          onOpen={onOpen}
                          onDragStart={onDragStart}
                          onDragEnd={onDragEnd}
                          onMenuMove={onMenuMove}
                          onKeyboardMove={onKeyboardMove}
                        />
                      </Fragment>
                    ))}
                    {indicator === tasks.length && <div className="drop-indicator" aria-hidden />}
                    {!tasks.length && indicator === -1 && <p className="cell-empty">{dragId !== null ? 'Drop here' : 'No tasks'}</p>}
                    {groupBy === 'none' && <QuickAdd status={status} onAdd={onQuickAdd} />}
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
