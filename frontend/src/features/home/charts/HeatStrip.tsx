import { cx } from '../../../lib/cx';
import { heatLevel } from './scale';
import './charts.css';

export type HeatCell = { key: string; label: string; value: number; detail: string };

/** A row of intensity squares (e.g. activity per day), each with a hover title and a screen-reader list. */
export function HeatStrip({ cells, label }: { cells: HeatCell[]; label: string }) {
  const max = Math.max(0, ...cells.map((c) => c.value));
  return (
    <div className="heat-strip" role="group" aria-label={label}>
      {cells.map((cell) => (
        <span key={cell.key} className="heat-cell-wrap">
          <span className={cx('heat-cell', `strip-${heatLevel(cell.value, max)}`)} title={`${cell.label}: ${cell.detail}`}>
            <span className="sr-only">{`${cell.label}: ${cell.detail}`}</span>
          </span>
          <small aria-hidden="true">{cell.label}</small>
        </span>
      ))}
    </div>
  );
}
