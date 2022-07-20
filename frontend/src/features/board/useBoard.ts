import { useCallback, useEffect, useRef, useState } from 'react';
import { useToast } from '../../app/toast';
import { useLoader } from '../../hooks/useLoader';
import { boardApi } from './api';
import { applyMoveResult, applyPatch, flattenBoard, planMove } from './board';
import type { Board, Label, Task, TaskPatch, TaskStatus } from './types';

type Local = { source: Board | null; tasks: Task[]; labels: Label[] };

export type MoveRequest = {
  taskId: number;
  status: TaskStatus;
  /** Cards shown in the destination cell (filtered, one swimlane), in display order. */
  visible: readonly Task[];
  finalIndex: number;
  /** Field changes implied by dropping into another swimlane. */
  lanePatch?: TaskPatch;
};

/**
 * Board data plus optimistic mutations. The server snapshot seeds local state; moves and edits
 * update local state first and roll the affected task back if the API refuses.
 */
export function useBoard(workspaceId: number) {
  const toast = useToast();
  const loader = useLoader(() => boardApi.board(workspaceId), `board:${workspaceId}`);
  const [local, setLocal] = useState<Local>({ source: null, tasks: [], labels: [] });
  if (loader.data && loader.data !== local.source) {
    setLocal({ source: loader.data, tasks: flattenBoard(loader.data), labels: loader.data.labels });
  }
  // Latest tasks for async callbacks, so a move never plans against a stale snapshot.
  const tasksRef = useRef(local.tasks);
  useEffect(() => {
    tasksRef.current = local.tasks;
  });

  const setTasks = useCallback((update: (tasks: Task[]) => Task[]) => setLocal((l) => ({ ...l, tasks: update(l.tasks) })), []);

  const upsertTask = useCallback(
    (task: Task) => setTasks((tasks) => (tasks.some((t) => t.id === task.id) ? tasks.map((t) => (t.id === task.id ? task : t)) : [...tasks, task])),
    [setTasks],
  );

  const removeTask = useCallback((taskId: number) => setTasks((tasks) => tasks.filter((t) => t.id !== taskId)), [setTasks]);

  const addLabel = useCallback((label: Label) => setLocal((l) => ({ ...l, labels: [...l.labels, label].sort((a, b) => a.name.localeCompare(b.name)) })), []);

  /** Returns false when the move was a no-op or failed (so callers can skip announcements). */
  const moveTask = useCallback(
    async ({ taskId, status, visible, finalIndex, lanePatch }: MoveRequest): Promise<boolean> => {
      const original = tasksRef.current.find((t) => t.id === taskId);
      if (!original || !local.source) return false;
      const patch = lanePatch && Object.keys(lanePatch).length ? lanePatch : null;
      const lookups = { members: local.source.members, courses: local.source.courses, labels: local.labels };
      const base = patch ? tasksRef.current.map((t) => (t.id === taskId ? applyPatch(t, patch, lookups) : t)) : tasksRef.current;
      const plan = planMove(base, taskId, status, visible, finalIndex);
      if (!plan && !patch) return false;
      setTasks(() => plan?.tasks ?? base);
      try {
        if (patch) upsertTask(await boardApi.update(taskId, patch));
        if (plan) {
          const result = await boardApi.move(taskId, plan.target);
          setTasks((tasks) => applyMoveResult(tasks, result));
        }
        return true;
      } catch (err) {
        setTasks((tasks) => tasks.map((t) => (t.id === taskId ? original : t)));
        toast.error(`Could not move ${original.key}: ${(err as Error).message}`);
        return false;
      }
    },
    [local.labels, local.source, setTasks, toast, upsertTask],
  );

  return {
    board: local.source,
    tasks: local.tasks,
    labels: local.labels,
    error: loader.error,
    loading: loader.loading && !local.source,
    reload: loader.reload,
    upsertTask,
    removeTask,
    addLabel,
    moveTask,
  };
}
