import { initials } from '../lib/format';
import { cx } from '../lib/cx';

type AvatarProps = { name: string; color?: string; size?: 'xs' | 'sm' | 'md' | 'lg'; title?: string };

export function Avatar({ name, color = '#1d6d45', size = 'sm', title }: AvatarProps) {
  return (
    <span className={cx('avatar', `avatar-${size}`)} style={{ background: color }} title={title ?? name} aria-label={name} role="img">
      {initials(name)}
    </span>
  );
}

/** Overlapping avatars with a "+3" chip when there are more than `max`. */
export function AvatarStack({ people, max = 4 }: { people: { id: number; name: string; avatar_color: string }[]; max?: number }) {
  const shown = people.slice(0, max);
  const rest = people.length - shown.length;
  return (
    <span className="avatar-stack">
      {shown.map((p) => (
        <Avatar key={p.id} name={p.name} color={p.avatar_color} size="xs" />
      ))}
      {rest > 0 && <span className="avatar avatar-xs avatar-more">+{rest}</span>}
    </span>
  );
}
