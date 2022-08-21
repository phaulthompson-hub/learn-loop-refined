import { useId, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { ChartTable, ChartTooltip, Legend, stepIndex, toneColor, type Tone } from './ChartFrame';
import { areaPath, labelStride, linearScale, linePath, nearestIndex, niceMax, niceTicks, pointPositions, showLabel } from './scale';

export type LineSeries = { key: string; label: string; values: (number | null)[]; tone: Tone; area?: boolean };

type LineChartProps = {
  title: string;
  description: string;
  /** Short x-axis labels, one per point. */
  labels: string[];
  /** Longer label for the tooltip heading and the fallback table; defaults to `labels`. */
  fullLabels?: string[];
  series: LineSeries[];
  /** Fixed y domain (e.g. [0, 100] for percentages); otherwise zero to a nice maximum. */
  yDomain?: [number, number];
  formatValue?: (value: number) => string;
  height?: number;
};

const WIDTH = 640;
const MARGIN = { top: 14, right: 14, bottom: 28, left: 40 };

/** Responsive line chart with optional area fill, hover/keyboard readout and a table fallback. */
export function LineChart({ title, description, labels, fullLabels = labels, series, yDomain, formatValue = String, height = 220 }: LineChartProps) {
  const titleId = useId();
  const descId = useId();
  const [active, setActive] = useState<number | null>(null);

  const count = labels.length;
  const xs = pointPositions(count, MARGIN.left, WIDTH - MARGIN.right);
  const domain = yDomain ?? [0, niceMax(series.flatMap((s) => s.values))];
  const ticks = niceTicks(domain[0], domain[1], 4);
  const top = Math.max(domain[1], ticks[ticks.length - 1]);
  const y = linearScale([domain[0], top], [height - MARGIN.bottom, MARGIN.top]);
  const baseline = y(domain[0]);
  const stride = labelStride(count, 7);

  const onPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width) return;
    setActive(nearestIndex(((event.clientX - rect.left) / rect.width) * WIDTH, xs));
  };
  const onKeyDown = (event: KeyboardEvent<SVGSVGElement>) => {
    const next = stepIndex(event.key, active, count);
    if (next === undefined) return;
    event.preventDefault();
    setActive(next);
  };

  return (
    <figure className="chart">
      <svg
        viewBox={`0 0 ${WIDTH} ${height}`}
        role="img"
        aria-labelledby={`${titleId} ${descId}`}
        tabIndex={0}
        onPointerMove={onPointerMove}
        onPointerLeave={() => setActive(null)}
        onKeyDown={onKeyDown}
        onBlur={() => setActive(null)}
      >
        <title id={titleId}>{title}</title>
        <desc id={descId}>{description}</desc>
        {ticks.map((tick) => (
          <g key={tick} className="chart-grid">
            <line x1={MARGIN.left} x2={WIDTH - MARGIN.right} y1={y(tick)} y2={y(tick)} />
            <text x={MARGIN.left - 8} y={y(tick)} dy="0.32em" textAnchor="end">
              {formatValue(tick)}
            </text>
          </g>
        ))}
        {labels.map((label, index) =>
          showLabel(index, count, stride) ? (
            <text key={index} className="chart-axis-label" x={xs[index]} y={height - 8} textAnchor={index === count - 1 && count > 1 ? 'end' : 'middle'}>
              {label}
            </text>
          ) : null,
        )}
        {series.map((s) => {
          const points = s.values.map((value, index) => (value === null ? null : { x: xs[index], y: y(value) }));
          return (
            <g key={s.key} style={{ color: toneColor(s.tone) }}>
              {s.area && <path className="chart-area" d={areaPath(points, baseline)} />}
              <path className="chart-line" d={linePath(points)} />
              {count === 1 && points[0] && <circle className="chart-dot" cx={points[0].x} cy={points[0].y} r={4} />}
            </g>
          );
        })}
        {active !== null && (
          <g className="chart-focus">
            <line x1={xs[active]} x2={xs[active]} y1={MARGIN.top} y2={baseline} />
            {series.map((s) =>
              s.values[active] === null ? null : (
                <circle key={s.key} cx={xs[active]} cy={y(s.values[active] as number)} r={4.5} style={{ color: toneColor(s.tone) }} />
              ),
            )}
          </g>
        )}
      </svg>
      {active !== null && (
        <ChartTooltip left={(xs[active] / WIDTH) * 100} heading={fullLabels[active]}>
          {series.map((s) => (
            <span key={s.key}>
              <i className="color-dot" style={{ background: toneColor(s.tone) }} />
              {s.label}: <b>{s.values[active] === null ? '–' : formatValue(s.values[active] as number)}</b>
            </span>
          ))}
        </ChartTooltip>
      )}
      {series.length > 1 && <Legend items={series.map((s) => ({ key: s.key, label: s.label, tone: s.tone }))} />}
      <ChartTable caption={title} rowHeader="Date" rows={fullLabels} columns={series.map((s) => ({ label: s.label, values: s.values }))} format={formatValue} />
    </figure>
  );
}
