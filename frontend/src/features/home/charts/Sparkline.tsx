import { toneColor, type Tone } from './ChartFrame';
import { areaPath, linearScale, linePath, niceMax, pointPositions } from './scale';

type SparklineProps = {
  values: number[];
  tone?: Tone;
  width?: number;
  height?: number;
  /** Accessible summary; without it the sparkline is decorative (its numbers are shown nearby). */
  label?: string;
};

/** A tiny trend line with a soft area and an end-point dot. */
export function Sparkline({ values, tone = 'brand', width = 96, height = 28, label }: SparklineProps) {
  const pad = 3;
  const xs = pointPositions(values.length, pad, width - pad);
  const y = linearScale([0, niceMax(values, 1, 2)], [height - pad, pad]);
  const points = values.map((value, index) => ({ x: xs[index], y: y(value) }));
  const last = points[points.length - 1];
  return (
    <svg
      className="sparkline"
      viewBox={`0 0 ${width} ${height}`}
      style={{ color: toneColor(tone) }}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {points.length > 1 && <path className="chart-area" d={areaPath(points, height - pad)} />}
      <path className="chart-line" d={linePath(points)} />
      {last && <circle className="chart-dot" cx={last.x} cy={last.y} r={2.5} />}
    </svg>
  );
}
