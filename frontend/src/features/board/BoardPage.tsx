import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Columns, Trello, List, Plus } from 'lucide-react';
import { useUser, useWorkspace } from '../../app/auth';
import { useNow } from '../../app/clock';
import { useToast } from '../../app/toast';
import { Tabs } from '../../components/Tabs';
import { EmptyState, ErrorBanner, Loading, PageHeader } from '../../components/ui';
import { plural } from '../../lib/format';
import { boardApi } from './api';
import { filterTasks, readFilters, summarize, writeFilters, type BoardFilters, type GroupBy, type ViewMode } from './board';
import { BoardView } from './BoardView';
import { FilterBar } from './FilterBar';
import { ListView } from './ListView';
import { NewTaskModal } from './NewTaskModal';
import { TaskDrawer } from './TaskDrawer';
import { useBoard } from './useBoard';
import type { Task, TaskDetail, TaskStatus } from './types';
import './board.css';

const GROUPS: { key: GroupBy; label: string }[] = [
  { key: 'none', label: 'No swimlanes' },
  { key: 'assignee', label: 'By assignee' },
  { key: 'priority', label: 'By priority' },
];

function isTyping(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  return !!element && (['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName) || element.isContentEditable);
}

/** /board — the workspace's study tasks as a kanban or a table, with URL-persisted filters. */
export function BoardPage() {
  const workspace = useWorkspace();
  const user = useUser();
  const now = useNow();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const data = useBoard(workspace.id);
  const [creatingIn, setCreatingIn] = useState<TaskStatus | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const filters = useMemo(() => readFilters(params), [params]);
  const view: ViewMode = params.get('view') === 'list' ? 'list' : 'board';
  const groupBy: GroupBy = GROUPS.find((g) => g.key === params.get('group'))?.key ?? 'none';
  const taskNumber = Number(params.get('task')) || null;
  const visible = useMemo(() => filterTasks(data.tasks, filters, now), [data.tasks, filters, now]);

  const setParam = useCallback(
    (key: string, value: string | null, replace = true) =>
      setParams(
        (previous) => {
          const next = new URLSearchParams(previous);
          if (value) next.set(key, value);
          else next.delete(key);
          return next;
        },
        { replace },
      ),
    [setParams],
  );
  const setFilters = (next: BoardFilters) => setParams((previous) => writeFilters(previous, next), { replace: true });
  // Opening a task pushes a history entry, so Back closes the drawer.
  const openTask = useCallback((task: Task) => setParam('task', String(task.number), false), [setParam]);
  const closeTask = useCallback(() => setParam('task', null), [setParam]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || isTyping(event.target) || document.body.classList.contains('modal-open')) return;
      if (event.key === 'n') {
        event.preventDefault();
        setCreatingIn('todo');
      } else if (event.key === '/') {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const { upsertTask } = data;
  const quickAdd = useCallback(
    async (status: TaskStatus, title: string) => {
      try {
        const task = await boardApi.create(workspace.id, { title, description: '', status, priority: 'medium', assignee_id: null, course_id: null, due_date: null, estimate: null, label_ids: [], checklist: [] });
        upsertTask(summarize(task));
        return true;
      } catch (err) {
        toast.error((err as Error).message);
        return false;
      }
    },
    [toast, upsertTask, workspace.id],
  );

  const onCreated = (task: TaskDetail) => {
    upsertTask(summarize(task));
    setCreatingIn(null);
    toast.success(`Created ${task.key}`);
  };

  if (data.loading) return <Loading label="Loading the board…" />;
  if (!data.board) return <ErrorBanner message={data.error ?? 'Could not load the board.'} onRetry={data.reload} />;
  const board = data.board;

  const open = data.tasks.filter((t) => t.status !== 'done');
  const overdue = open.filter((t) => t.overdue).length;
  const mine = open.filter((t) => t.assignee?.id === user.id).length;

  return (
    <div className="board-page">
      <PageHeader
        eyebrow={`${workspace.name} · Study board`}
        title="Board"
        subtitle={
          <>
            {plural(open.length, 'open task')} · <span className={overdue ? 'bad' : undefined}>{overdue} overdue</span> · {mine} assigned to you
          </>
        }
        aside={
          <div className="board-actions">
            <Tabs
              label="View"
              value={view}
              onChange={(next) => setParam('view', next === 'list' ? 'list' : null)}
              items={[
                { key: 'board', label: 'Board', icon: <Trello /> },
                { key: 'list', label: 'List', icon: <List /> },
              ]}
            />
            {view === 'board' && (
              <label className="group-select">
                <Columns aria-hidden />
                <span className="sr-only">Swimlanes</span>
                <select className="input" value={groupBy} onChange={(event) => setParam('group', event.target.value === 'none' ? null : event.target.value)}>
                  {GROUPS.map((group) => (
                    <option key={group.key} value={group.key}>
                      {group.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <button type="button" className="primary" onClick={() => setCreatingIn('todo')} title="New task (N)">
              <Plus /> New task
            </button>
          </div>
        }
      />

      {data.error && <ErrorBanner message={data.error} onRetry={data.reload} />}

      {data.tasks.length === 0 ? (
        <EmptyState icon={<Trello />} title="Plan your study work">
          <p>Break courses into tasks: readings, exercises, exam prep and group projects. Drag them across the board as you go.</p>
          <button type="button" className="primary" onClick={() => setCreatingIn('todo')}>
            <Plus /> Create the first task
          </button>
        </EmptyState>
      ) : (
        <>
          <FilterBar
            filters={filters}
            onChange={setFilters}
            members={board.members}
            labels={data.labels}
            courses={board.courses}
            meId={user.id}
            shown={visible.length}
            total={data.tasks.length}
            searchRef={searchRef}
          />
          {view === 'board' ? (
            <BoardView
              columns={board.columns}
              allTasks={data.tasks}
              visibleTasks={visible}
              groupBy={groupBy}
              members={board.members}
              now={now}
              onOpen={openTask}
              onMove={data.moveTask}
              onQuickAdd={quickAdd}
              onAddInColumn={setCreatingIn}
            />
          ) : (
            <ListView tasks={visible} now={now} onOpen={openTask} />
          )}
        </>
      )}

      {creatingIn && (
        <NewTaskModal
          workspaceId={workspace.id}
          members={board.members}
          labels={data.labels}
          courses={board.courses}
          initialStatus={creatingIn}
          onClose={() => setCreatingIn(null)}
          onCreated={onCreated}
        />
      )}
      {taskNumber && (
        <TaskDrawer
          key={taskNumber}
          workspaceId={workspace.id}
          number={taskNumber}
          members={board.members}
          labels={data.labels}
          courses={board.courses}
          canManageLabels={workspace.can('admin')}
          me={user}
          onClose={closeTask}
          onChanged={upsertTask}
          onDeleted={(taskId) => {
            data.removeTask(taskId);
            closeTask();
          }}
          onLabelCreated={data.addLabel}
        />
      )}
    </div>
  );
}
