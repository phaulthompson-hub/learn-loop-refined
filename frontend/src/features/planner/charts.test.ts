import { describe, expect, it } from 'vitest';
import { addDays, dayKey, parseDate } from '../../lib/dates';
import { gridlines, heatmapColumns, heatmapTitle, monthLabels, niceCeiling, ringGeometry } from './charts';
import type { HeatmapDay } from './types';

function days(start: string, count: number): HeatmapDay[] {
  return Array.from({ length: count }, (_, i) => ({
    date: dayKey(addDays(parseDate(start), i)),
    answers: 0,
    reviews: 0,
    minutes: 0,
    score: 0,
    level: 0,
    future: false,
  }));
}

describe('heatmap layout', () => {
  it('splits days into week columns', () => {
    const columns = heatmapColumns(days('2021-12-27', 84));
    expect(columns).toHaveLength(12);
    expect(columns.every((column) => column.length === 7)).toBe(true);
    expect(columns[11][0].date).toBe('2022-03-14');
  });

  it('labels a month above the first column it appears in', () => {
    const columns = heatmapColumns(days('2021-12-27', 84));
    expect(monthLabels(columns)).toEqual([
      { column: 1, label: 'Jan' },
      { column: 6, label: 'Feb' },
      { column: 10, label: 'Mar' },
    ]);
  });

  it('keeps the first label when the month does not change right away', () => {
    const columns = heatmapColumns(days('2022-01-03', 21));
    expect(monthLabels(columns)).toEqual([{ column: 0, label: 'Jan' }]);
  });

  it('describes each day for tooltips', () => {
    const [day] = days('2022-03-14', 1);
    expect(heatmapTitle(day)).toBe('Mon 14 Mar: no activity');
    expect(heatmapTitle({ ...day, answers: 3, minutes: 90, score: 12 })).toBe('Mon 14 Mar: 3 answers, 1 h 30 min');
    expect(heatmapTitle({ ...day, reviews: 1, score: 1 })).toBe('Mon 14 Mar: 1 review');
    expect(heatmapTitle({ ...day, future: true })).toBe('Mon 14 Mar: still ahead');
  });
});

describe('ring and bar geometry', () => {
  it('fills the ring proportionally and clamps', () => {
    const half = ringGeometry(50, 10);
    expect(half.circumference).toBeCloseTo(62.83, 2);
    expect(half.offset).toBeCloseTo(half.circumference / 2);
    expect(ringGeometry(140, 10).offset).toBe(0);
    expect(ringGeometry(-5, 10).offset).toBeCloseTo(ringGeometry(0, 10).circumference);
  });

  it('rounds chart maxima to readable steps', () => {
    expect(niceCeiling(0)).toBe(60);
    expect(niceCeiling(31)).toBe(45);
    expect(niceCeiling(95)).toBe(120);
    expect(niceCeiling(250)).toBe(300);
  });

  it('spaces gridlines evenly', () => {
    expect(gridlines(90)).toEqual([0, 30, 60, 90]);
    expect(gridlines(60, 2)).toEqual([0, 30, 60]);
  });
});
