import type { ReactNode } from 'react';
import './charts.css';

/** Chart colours come from design tokens so light and dark themes both work. */
export type Tone = 'brand' | 'accent' | 'info' | 'warn' | 'bad' | 'violet' | 'ok' | 'muted';

export const toneColor = (tone: Tone) => `var(--${tone})`;

type TableProps = {
  caption: string;
  rowHeader: string;
  rows: string[];
  columns: { label: string; values: (number | null)[] }[];
  format?: (value: number) => string;
};

/** Screen-reader fallback: the chart's numbers as a plain table (visually hidden). */
export function ChartTable({ caption, rowHeader, rows, columns, format = String }: TableProps) {
  return (
    <table className="sr-only">
      <caption>{caption}</caption>
      <thead>
        <tr>
          <th scope="col">{rowHeader}</th>
          {columns.map((column) => (
            <th key={column.label} scope="col">
              {column.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <tr key={row}>
            <th scope="row">{row}</th>
            {columns.map((column) => {
              const value = column.values[index];
              return <td key={column.label}>{value === null || value === undefined ? '–' : format(value)}</td>;
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export type LegendItem = { key: string; label: string; tone?: Tone; color?: string };

export function Legend({ items }: { items: LegendItem[] }) {
  return (
    <ul className="chart-legend" aria-hidden="true">
      {items.map((item) => (
        <li key={item.key}>
          <span className="color-dot" style={{ background: item.color ?? toneColor(item.tone ?? 'brand') }} />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

type TooltipProps = { left: number; heading: ReactNode; children: ReactNode };

/** Floating readout positioned horizontally at `left` (percent of the chart width). */
export function ChartTooltip({ left, heading, children }: TooltipProps) {
  const alignment = left > 70 ? 'align-end' : left < 30 ? 'align-start' : '';
  return (
    <div className={`chart-tooltip ${alignment}`} style={{ left: `${left}%` }} aria-hidden="true">
      <b>{heading}</b>
      {children}
    </div>
  );
}

/** Arrow-key navigation shared by the cartesian charts: returns the next active index, or undefined. */
export function stepIndex(key: string, current: number | null, count: number): number | null | undefined {
  if (!count) return undefined;
  if (key === 'ArrowRight') return current === null ? 0 : Math.min(count - 1, current + 1);
  if (key === 'ArrowLeft') return current === null ? count - 1 : Math.max(0, current - 1);
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  if (key === 'Escape') return null;
  return undefined;
}
