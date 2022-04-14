export type Role = 'learner' | 'instructor' | 'admin' | 'owner';

export type User = {
  id: number;
  email: string;
  name: string;
  avatar_color: string;
  headline: string;
  bio: string;
  timezone: string;
  theme: 'light' | 'dark' | 'system';
  daily_goal_minutes: number;
  quiz_length: number;
  week_starts_on: number;
  email_digest: boolean;
  reduced_motion: boolean;
  created_at: string;
};

export type WorkspaceBrief = { id: number; name: string; slug: string; color: string; role: Role };

export type Me = {
  user: User;
  workspaces: WorkspaceBrief[];
  current_workspace_id: number | null;
  unread_notifications: number;
};

export type Meta = { now: string; frozen: boolean; ai_mode: string; version: string };

/** A person as embedded in other resources (task assignee, note author, member row). */
export type Person = { id: number; name: string; email: string; avatar_color: string };
