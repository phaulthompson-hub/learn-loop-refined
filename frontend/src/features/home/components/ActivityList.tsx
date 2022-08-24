import { Link } from 'react-router-dom';
import {
  Archive,
  Award,
  BookOpen,
  CalendarDays,
  CircleDot,
  Layers,
  ListChecks,
  FileEdit,
  Rocket,
  Wand2,
  Target,
  UserPlus,
  type Icon as LucideIcon,
} from 'lucide-react';
import { useNow } from '../../../app/clock';
import { Avatar } from '../../../components/Avatar';
import { formatTime, relativeTime } from '../../../lib/format';
import { actorName, verbMeta, type VerbKind } from '../activityLogic';
import type { ActivityItem } from '../types';
import './shared.css';

export const VERB_ICONS: Record<VerbKind, LucideIcon> = {
  course: BookOpen,
  publish: Rocket,
  archive: Archive,
  mastery: Award,
  quiz: Wand2,
  member: UserPlus,
  deck: Layers,
  review: Layers,
  task: ListChecks,
  event: CalendarDays,
  goal: Target,
  note: FileEdit,
  other: CircleDot,
};

type ActivityListProps = {
  items: ActivityItem[];
  /** "time" shows 14:05 (for lists already grouped by day); "relative" shows "3 h ago". */
  timestamps?: 'time' | 'relative';
};

/** Feed entries: avatar with a verb badge, "<actor> <summary>", and a link to the object when there is one. */
export function ActivityList({ items, timestamps = 'relative' }: ActivityListProps) {
  const now = useNow();
  return (
    <ol className="feed">
      {items.map((item) => {
        const meta = verbMeta(item.verb, item.object_type);
        const Icon = VERB_ICONS[meta.kind];
        const text = (
          <>
            <b>{actorName(item)}</b> {item.summary}
          </>
        );
        return (
          <li key={item.id} className="feed-item">
            <span className="feed-avatar">
              <Avatar name={actorName(item)} color={item.actor?.avatar_color ?? 'var(--forest-3)'} size="sm" />
              <span className={`feed-verb verb-${meta.kind}`} aria-hidden="true">
                <Icon />
              </span>
            </span>
            <div className="feed-body">
              <p>{item.link ? <Link to={item.link}>{text}</Link> : text}</p>
              {item.detail && <p className="feed-detail">{item.detail}</p>}
              <span className="feed-meta">
                <span className={`feed-kind verb-${meta.kind}`}>{meta.label}</span>
                <time dateTime={item.created_at}>{timestamps === 'time' ? formatTime(item.created_at) : relativeTime(item.created_at, now)}</time>
              </span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
