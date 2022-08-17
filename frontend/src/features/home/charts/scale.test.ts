import { describe, expect, it } from 'vitest';
import {
  areaPath,
  arcs,
  bands,
  clamp,
  donutSegment,
  heatLevel,
  labelStride,
  linearScale,
  linePath,
  nearestIndex,
  niceMax,
  niceStep,
  niceTicks,
  pointPositions,
  polar,
  ringDash,
  showLabel,
  stack,
  totals,
} from './scale';

describe('linearScale', () => {
  it('maps the domain onto the range, including inverted ranges', () => {
    const y = linearScale([0, 100], [200, 0]);
    expect(y(0)).toBe(200);
    expect(y(50)).toBe(100);
    expect(y(100)).toBe(0);
  });

  it('extrapolates outside the domain', () => {
    expect(linearScale([0, 10], [0, 100])(15)).toBe(150);
  });

  it('maps a zero-width domain to the start of the range', () => {
    expect(linearScale([5, 5], [10, 90])(5)).toBe(10);
  });
});

describe('nice ticks', () => {
  it.each([
    [10, 5, 2],
    [7, 4, 2],
    [100, 4, 25],
    [0.9, 3, 0.5],
    [130, 4, 50],
  ])('niceStep(%s, %s) = %s', (span, count, step) => {
    expect(niceStep(span, count)).toBe(step);
  });

  it('returns 1 for degenerate input', () => {
    expect(niceStep(0, 4)).toBe(1);
    expect(niceStep(10, 0)).toBe(1);
  });

  it('covers the whole range with round numbers', () => {
    expect(niceTicks(0, 7)).toEqual([0, 2, 4, 6, 8]);
    expect(niceTicks(0, 100)).toEqual([0, 25, 50, 75, 100]);
    expect(niceTicks(20, 80, 3)).toEqual([20, 40, 60, 80]);
  });

  it('avoids floating point noise', () => {
    expect(niceTicks(0, 0.3, 3)).toEqual([0, 0.1, 0.2, 0.3]);
  });

  it('collapses an empty range to a single tick', () => {
    expect(niceTicks(5, 5)).toEqual([5]);
  });

  it('niceMax rounds the largest value up to a tick and ignores nulls', () => {
    expect(niceMax([3, 7, null, 2])).toBe(8);
    expect(niceMax([])).toBe(1);
    expect(niceMax([0, 0], 4)).toBe(4);
    expect(niceMax([61, 72.5])).toBe(80);
  });
});

describe('positions', () => {
  it('spreads points evenly and centres a single point', () => {
    expect(pointPositions(3, 0, 100)).toEqual([0, 50, 100]);
    expect(pointPositions(1, 0, 100)).toEqual([50]);
    expect(pointPositions(0, 0, 100)).toEqual([]);
  });

  it('lays out padded bands inside equal slots', () => {
    const result = bands(4, 0, 100, 0.2);
    expect(result).toHaveLength(4);
    expect(result[0]).toEqual({ x: 2.5, width: 20, center: 12.5 });
    expect(result[3].center).toBe(87.5);
  });

  it('keeps bars at least one unit wide', () => {
    expect(bands(1000, 0, 100, 0.5)[0].width).toBe(1);
  });

  it('finds the nearest point to a pointer position', () => {
    expect(nearestIndex(48, [0, 25, 50, 75])).toBe(2);
    expect(nearestIndex(-10, [0, 25])).toBe(0);
    expect(nearestIndex(999, [0, 25])).toBe(1);
    expect(nearestIndex(5, [])).toBe(-1);
  });
});

describe('paths', () => {
  it('draws a polyline', () => {
    expect(linePath([{ x: 0, y: 10 }, { x: 5, y: 2.5 }, { x: 10, y: 0 }])).toBe('M0,10L5,2.5L10,0');
  });

  it('breaks the line at missing points', () => {
    expect(linePath([{ x: 0, y: 1 }, null, { x: 2, y: 3 }, { x: 3, y: 4 }])).toBe('M0,1M2,3L3,4');
  });

  it('rounds coordinates to two decimals', () => {
    expect(linePath([{ x: 1 / 3, y: 2 / 3 }])).toBe('M0.33,0.67');
  });

  it('closes an area down to the baseline for each run', () => {
    expect(areaPath([{ x: 0, y: 5 }, { x: 10, y: 2 }], 20)).toBe('M0,20L0,5L10,2L10,20Z');
    expect(areaPath([{ x: 0, y: 5 }, null, { x: 10, y: 2 }], 20)).toBe('M0,20L0,5L0,20ZM10,20L10,2L10,20Z');
    expect(areaPath([null], 20)).toBe('');
  });
});

