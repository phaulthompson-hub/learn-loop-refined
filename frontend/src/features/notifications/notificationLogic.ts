// Pure helpers for the notification bell and inbox: kind metadata, badge text and optimistic list updates.
import type { AppNotification, NotificationKind } from './types';

export type KindMeta = { label: string; tone: 'ok' | 'warn' | 'bad' | 'info' | 'violet' | 'brand' | 'muted' };

export const KIND_META: Record<NotificationKind, KindMeta> = {
  review_due: { label: 'Reviews', tone: 'violet' },
  task_assigned: { label: 'Tasks', tone: 'info' },
  comment: { label: 'Comments', tone: 'brand' },
  invite: { label: 'Members', tone: 'ok' },
  goal: { label: 'Goals', tone: 'warn' },
  mastery: { label: 'Mastery', tone: 'ok' },
  event: { label: 'Calendar', tone: 'info' },
  system: { label: 'LearnLoop', tone: 'muted' },
};

export const KINDS = Object.keys(KIND_META) as NotificationKind[];

export const isKind = (value: string | null): value is NotificationKind => value !== null && value in KIND_META;

/** Badge text on the bell: nothing for zero, "9+" above nine. */
export function badgeText(count: number): string {
  if (count <= 0) return '';
  return count > 9 ? '9+' : String(count);
}

export function bellLabel(count: number): string {
  if (count <= 0) return 'Notifications, all caught up';
  return `Notifications, ${count} unread`;
}

/** Apply a read/unread toggle locally (the server answers with the same state). */
export function withRead(items: readonly AppNotification[], id: number, read: boolean, now: string): AppNotification[] {
  return items.map((item) => (item.id === id ? { ...item, read, read_at: read ? (item.read_at ?? now) : null } : item));
}

export function withAllRead(items: readonly AppNotification[], now: string): AppNotification[] {
  return items.map((item) => (item.read ? item : { ...item, read: true, read_at: now }));
}

export const withoutIds = (items: readonly AppNotification[], ids: ReadonlySet<number>) => items.filter((item) => !ids.has(item.id));

/** Links are app paths; anything else (empty, external) is not navigable from the inbox. */
export const isInternalLink = (link: string) => link.startsWith('/') && !link.startsWith('//');
