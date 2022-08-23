import type { ReactNode } from 'react';
import { ringDash } from './scale';
import './charts.css';

type ProgressRingProps = {
  /** 0–100 */
  value: number;
  label: string;
  size?: number;
  stroke?: number;
  /** Any CSS colour; defaults to the brand token. */
  color?: string;
  children?: ReactNode;
};

/** Circular progress indicator with arbitrary content in the middle. */
export function ProgressRing({ value, label, size = 64, stroke = 7, color = 'var(--brand)', children }: ProgressRingProps) {
  const radius = (size - stroke) / 2;
  const { circumference, offset } = ringDash(value, radius);
  const rounded = Math.round(Math.min(100, Math.max(0, value)));
  return (
    <div className="progress-ring" style={{ width: size, height: size }} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={rounded}>
      <svg viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle className="ring-track" cx={size / 2} cy={size / 2} r={radius} strokeWidth={stroke} />
        <circle
          className="ring-value"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={stroke}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ stroke: color }}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <span className="ring-content">{children ?? `${rounded}%`}</span>
    </div>
  );
}
