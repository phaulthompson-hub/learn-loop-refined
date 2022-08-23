import { useId, useState, type ReactNode } from 'react';
import { cx } from '../../../lib/cx';
import { toneColor, type Tone } from './ChartFrame';
import { arcs, donutSegment } from './scale';

export type Slice = { key: string; label: string; value: number; color?: string; tone?: Tone };

type DonutProps = {
  title: string;
  slices: Slice[];
  /** Text in the middle of the ring (defaults to the total). */
  center?: ReactNode;
  centerCaption?: string;
  formatValue?: (value: number) => string;
};

const SIZE = 160;
const OUTER = 76;
const INNER = 52;
const GAP = 0.012; // radians left between slices

/** Donut with an interactive legend: hovering or focusing a legend row highlights its slice. */
export function Donut({ title, slices, center, centerCaption, formatValue = String }: DonutProps) {
  const titleId = useId();
  const [active, setActive] = useState<string | null>(null);
  const total = slices.reduce((sum, s) => sum + s.value, 0);
  const angles = arcs(slices.map((s) => s.value));
  const color = (slice: Slice) => slice.color ?? toneColor(slice.tone ?? 'brand');
  const focused = slices.find((s) => s.key === active);

  return (
    <figure className="donut">
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-labelledby={titleId}>
        <title id={titleId}>{`${title}: ${slices.map((s) => `${s.label} ${formatValue(s.value)}`).join(', ')}`}</title>
        <circle className="donut-track" cx={SIZE / 2} cy={SIZE / 2} r={(OUTER + INNER) / 2} strokeWidth={OUTER - INNER} />
        {slices.map((slice, index) => {
          const { start, end, fraction } = angles[index];
          const gap = fraction < 1 && slices.length > 1 ? GAP : 0;
          return (
            <path
              key={slice.key}
              className={cx('donut-slice', active && active !== slice.key && 'dimmed')}
              d={donutSegment(SIZE / 2, SIZE / 2, active === slice.key ? OUTER + 3 : OUTER, INNER, start + gap, end - gap)}
              style={{ fill: color(slice) }}
            />
          );
        })}
        <text className="donut-value" x={SIZE / 2} y={SIZE / 2} dy={centerCaption ? '-0.1em' : '0.35em'} textAnchor="middle">
          {focused ? formatValue(focused.value) : (center ?? formatValue(total))}
        </text>
        {centerCaption && (
          <text className="donut-caption" x={SIZE / 2} y={SIZE / 2} dy="1.35em" textAnchor="middle">
            {focused ? `${Math.round((focused.value / (total || 1)) * 100)}%` : centerCaption}
          </text>
        )}
      </svg>
      <ul className="donut-legend">
        {slices.map((slice, index) => (
          <li
            key={slice.key}
            tabIndex={0}
            className={cx(active === slice.key && 'active')}
            onMouseEnter={() => setActive(slice.key)}
            onMouseLeave={() => setActive(null)}
            onFocus={() => setActive(slice.key)}
            onBlur={() => setActive(null)}
          >
            <span className="color-dot" style={{ background: color(slice) }} />
            <span className="donut-label">{slice.label}</span>
            <b>{formatValue(slice.value)}</b>
            <small>{Math.round(angles[index].fraction * 100)}%</small>
          </li>
        ))}
      </ul>
    </figure>
  );
}
