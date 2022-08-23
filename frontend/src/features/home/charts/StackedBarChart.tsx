import { useId, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { cx } from '../../../lib/cx';
import { ChartTable, ChartTooltip, Legend, stepIndex, toneColor, type Tone } from './ChartFrame';
import { bands, labelStride, linearScale, nearestIndex, niceMax, niceTicks, showLabel, stack, totals } from './scale';

export type BarSeries = { key: string; label: string; values: number[]; tone: Tone };

type StackedBarChartProps = {
  title: string;
  description: string;
  labels: string[];
  fullLabels?: string[];
  series: BarSeries[];
  formatValue?: (value: number) => string;
  height?: number;
  /** Index to emphasise (e.g. today in a forecast). */
  highlight?: number;
};

const WIDTH = 640;
const MARGIN = { top: 14, right: 10, bottom: 28, left: 36 };

/** Stacked (or single-series) bar chart with hover/keyboard readout and a table fallback. */
export function StackedBarChart({ title, description, labels, fullLabels = labels, series, formatValue = String, height = 200, highlight }: StackedBarChartProps) {
  const titleId = useId();
  const descId = useId();
  const [active, setActive] = useState<number | null>(null);

  const count = labels.length;
  const layout = bands(count, MARGIN.left, WIDTH - MARGIN.right, count > 40 ? 0.15 : 0.3);
  const sums = totals(series.map((s) => s.values));
  const max = niceMax(sums, 4);
  const ticks = niceTicks(0, max, 4);
  const y = linearScale([0, max], [height - MARGIN.bottom, MARGIN.top]);
  const stacked = stack(series.map((s) => s.values));
  const stride = labelStride(count, 8);
  const centers = layout.map((band) => band.center);

  const onPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width) return;
    setActive(nearestIndex(((event.clientX - rect.left) / rect.width) * WIDTH, centers));
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
        {active !== null && layout[active] && (
          <rect className="chart-hover-band" x={layout[active].center - (WIDTH - MARGIN.left - MARGIN.right) / count / 2} width={(WIDTH - MARGIN.left - MARGIN.right) / count} y={MARGIN.top} height={height - MARGIN.top - MARGIN.bottom} />
        )}
        {series.map((s, seriesIndex) => (
          <g key={s.key} style={{ color: toneColor(s.tone) }}>
            {layout.map((band, index) => {
              const segment = stacked[seriesIndex][index];
              const barHeight = y(segment.y0) - y(segment.y1);
              if (barHeight <= 0) return null;
              return (
                <rect
                  key={index}
                  className={cx('chart-bar', highlight !== undefined && index !== highlight && 'muted-bar')}
                  x={band.x}
                  width={band.width}
                  y={y(segment.y1)}
                  height={barHeight}
                  rx={Math.min(3, band.width / 3)}
                />
              );
            })}
          </g>
        ))}
        {labels.map((label, index) =>
          showLabel(index, count, stride) ? (
            <text key={index} className="chart-axis-label" x={centers[index]} y={height - 8} textAnchor="middle">
              {label}
            </text>
          ) : null,
        )}
      </svg>
      {active !== null && (
        <ChartTooltip left={(centers[active] / WIDTH) * 100} heading={fullLabels[active]}>
          {series.map((s) => (
            <span key={s.key}>
              <i className="color-dot" style={{ background: toneColor(s.tone) }} />
              {s.label}: <b>{formatValue(s.values[active] ?? 0)}</b>
            </span>
          ))}
          {series.length > 1 && (
            <span className="tooltip-total">
              Total: <b>{formatValue(sums[active])}</b>
            </span>
          )}
        </ChartTooltip>
      )}
      {series.length > 1 && <Legend items={series.map((s) => ({ key: s.key, label: s.label, tone: s.tone }))} />}
      <ChartTable caption={title} rowHeader="Date" rows={fullLabels} columns={series.map((s) => ({ label: s.label, values: s.values }))} format={formatValue} />
    </figure>
  );
}
