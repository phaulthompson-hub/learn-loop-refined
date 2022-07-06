import type { Person, Role } from '../../app/types';

export type TaskStatus = 'backlog' | 'todo' | 'in_progress' | 'review' | 'done';
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';

export type Label = { id: number; workspace_id: number; name: string; color: string; task_count: number };
export type CourseBrief = { id: number; title: string; color: string };
export type BoardMember = Person & { role: Role };

export type Task = {
  id: number;
  workspace_id: number;
  number: number;
  key: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  assignee: Person | null;
  reporter: Person | null;
  course: CourseBrief | null;
  due_date: string | null;
  estimate: number | null;
  position: number;
  labels: Label[];
  checklist_done: number;
  checklist_total: number;
  comment_count: number;
  overdue: boolean;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

export type ChecklistItem = { id: number; text: string; done: boolean; position: number };

export type TaskComment = {
  id: number;
  task_id: number;
  author: Person | null;
  body: string;
  mentions: number[];
  created_at: string;
  edited_at: string | null;
  can_edit: boolean;
  can_delete: boolean;
};

export type TaskDetail = Task & { checklist: ChecklistItem[]; comments: TaskComment[]; can_delete: boolean };

export type BoardColumn = {
  status: TaskStatus;
  title: string;
  count: number;
  points: number;
  wip_limit: number | null;
  over_limit: boolean;
  tasks: Task[];
};

export type Board = {
  workspace_id: number;
  prefix: string;
  columns: BoardColumn[];
  members: BoardMember[];
  labels: Label[];
  courses: CourseBrief[];
};

export type MoveResult = { task: Task; column: { id: number; position: number }[]; rebalanced: boolean };

export type TaskInput = {
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  assignee_id: number | null;
  course_id: number | null;
  due_date: string | null;
  estimate: number | null;
  label_ids: number[];
  checklist: string[];
};

export type TaskPatch = Partial<Omit<TaskInput, 'checklist'>>;
