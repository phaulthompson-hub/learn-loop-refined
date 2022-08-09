import { AtSign, Award, CalendarDays, Layers, ListChecks, Megaphone, Target, UserPlus, type Icon as LucideIcon } from 'lucide-react';
import { KIND_META } from './notificationLogic';
import type { NotificationKind } from './types';

const ICONS: Record<NotificationKind, LucideIcon> = {
  review_due: Layers,
  task_assigned: ListChecks,
  comment: AtSign,
  invite: UserPlus,
  goal: Target,
  mastery: Award,
  event: CalendarDays,
  system: Megaphone,
};

/** A tinted round icon for a notification kind. */
export function NotificationIcon({ kind }: { kind: NotificationKind }) {
  const Icon = ICONS[kind] ?? Megaphone;
  const tone = KIND_META[kind]?.tone ?? 'muted';
  return (
    <span className={`notification-icon tone-${tone}`} aria-hidden="true">
      <Icon />
    </span>
  );
}
