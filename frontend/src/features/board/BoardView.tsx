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

