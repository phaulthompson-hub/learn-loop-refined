// Study-board API client. Mirrors backend/app/routers/board.py.
import { http } from '../../lib/http';
import type { Board, ChecklistItem, Label, MoveResult, TaskComment, TaskDetail, TaskInput, TaskPatch, TaskStatus } from './types';

export type MoveTarget = { status: TaskStatus; after_id?: number | null; before_id?: number | null; index?: number };

export const boardApi = {
  board: (workspaceId: number) => http.get<Board>(`/workspaces/${workspaceId}/board`),
  byNumber: (workspaceId: number, number: number) => http.get<TaskDetail>(`/workspaces/${workspaceId}/tasks/by-number/${number}`),
  create: (workspaceId: number, input: TaskInput) => http.post<TaskDetail>(`/workspaces/${workspaceId}/tasks`, input),
  update: (taskId: number, patch: TaskPatch) => http.patch<TaskDetail>(`/tasks/${taskId}`, patch),
  move: (taskId: number, target: MoveTarget) => http.post<MoveResult>(`/tasks/${taskId}/move`, target),
  remove: (taskId: number) => http.delete(`/tasks/${taskId}`),

  addItem: (taskId: number, text: string) => http.post<ChecklistItem>(`/tasks/${taskId}/checklist`, { text }),
  toggleItem: (taskId: number, itemId: number) => http.post<ChecklistItem>(`/tasks/${taskId}/checklist/${itemId}/toggle`),
  renameItem: (taskId: number, itemId: number, text: string) => http.patch<ChecklistItem>(`/tasks/${taskId}/checklist/${itemId}`, { text }),
  removeItem: (taskId: number, itemId: number) => http.delete(`/tasks/${taskId}/checklist/${itemId}`),
  reorderItems: (taskId: number, ids: number[]) => http.put<ChecklistItem[]>(`/tasks/${taskId}/checklist/order`, { ids }),

  addComment: (taskId: number, body: string) => http.post<TaskComment>(`/tasks/${taskId}/comments`, { body }),
  editComment: (taskId: number, commentId: number, body: string) => http.patch<TaskComment>(`/tasks/${taskId}/comments/${commentId}`, { body }),
  removeComment: (taskId: number, commentId: number) => http.delete(`/tasks/${taskId}/comments/${commentId}`),

  createLabel: (workspaceId: number, name: string, color: string) => http.post<Label>(`/workspaces/${workspaceId}/labels`, { name, color }),
};
