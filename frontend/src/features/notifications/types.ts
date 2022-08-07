import type { PersonBrief } from '../home/types';

export type NotificationKind = 'review_due' | 'task_assigned' | 'comment' | 'invite' | 'goal' | 'mastery' | 'event' | 'system';

export type AppNotification = {
  id: number;
  kind: NotificationKind;
  title: string;
  body: string;
  link: string;
  created_at: string;
  read_at: string | null;
  read: boolean;
  actor: PersonBrief | null;
  workspace: { id: number; name: string; color: string } | null;
};

export type NotificationPage = {
  items: AppNotification[];
  total: number;
  unread: number;
  has_more: boolean;
  next_before_id: number | null;
  kinds: Record<NotificationKind, number>;
};

export type BulkResult = { changed: number; unread: number };
