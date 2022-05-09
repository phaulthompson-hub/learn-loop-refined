import { masteryLevel, levelSlug } from '../../../lib/mastery';

type Props = { value: number; size?: number; label?: string; caption?: string };

/** Circular mastery gauge; the arc colour follows the mastery level. */
export function MasteryRing({ value, size = 64, label = 'Mastery', caption }: Props) {
  const stroke = Math.max(4, Math.round(size / 11));
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.min(100, Math.max(0, value));
  const rounded = Math.round(clamped);
  return (
    <div className={`mastery-ring ring-${levelSlug(masteryLevel(clamped))}`} style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} role="img" aria-label={`${label}: ${rounded}%`}>
        <circle className="course-ring-track" cx={size / 2} cy={size / 2} r={radius} strokeWidth={stroke} />
        <circle
          className="course-ring-value"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={stroke}
          strokeDasharray={`${(clamped / 100) * circumference} ${circumference}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <span className="ring-label" aria-hidden="true">
        <b style={{ fontSize: Math.max(11, size / 4.4) }}>{rounded}%</b>
        {caption && <small>{caption}</small>}
      </span>
    </div>
  );
}
