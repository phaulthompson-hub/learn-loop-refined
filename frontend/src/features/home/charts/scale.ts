// Pure geometry for the SVG chart kit: scales, "nice" axis ticks, path builders, stacking and arcs.
// Nothing here touches the DOM, so every chart's maths is unit-tested in node.

export type Point = { x: number; y: number };

export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Map a value from `domain` onto `range` linearly. A zero-width domain maps everything to the range start. */
export function linearScale([d0, d1]: [number, number], [r0, r1]: [number, number]): (value: number) => number {
  const span = d1 - d0;
  return (value) => (span === 0 ? r0 : r0 + ((value - d0) / span) * (r1 - r0));
}

/** A "nice" step (1, 2, 2.5 or 5 × 10ⁿ) that splits `span` into roughly `count` intervals. */
export function niceStep(span: number, count: number): number {
  if (span <= 0 || count <= 0) return 1;
  const raw = span / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const residual = raw / magnitude;
  const factor = residual <= 1 ? 1 : residual <= 2 ? 2 : residual <= 2.5 ? 2.5 : residual <= 5 ? 5 : 10;
  return factor * magnitude;
}

/** Evenly spaced round tick values covering [min, max]; the last tick is at or above `max`. */
export function niceTicks(min: number, max: number, count = 4): number[] {
  if (max <= min) return [min];
  const step = niceStep(max - min, count);
  const start = Math.floor(min / step) * step;
  const ticks: number[] = [];
  // Multiply rather than accumulate so floating-point error does not drift across ticks.
  for (let i = 0; i <= 1000; i += 1) {
    const value = Number((start + i * step).toFixed(10));
    ticks.push(value);
    if (value >= max) break;
  }
  return ticks;
}

/** Upper bound for a zero-based axis: the smallest nice tick at or above the largest value (at least `floor`). */
export function niceMax(values: readonly (number | null)[], floor = 1, count = 4): number {
  const largest = Math.max(floor, ...values.filter((v): v is number => v !== null && Number.isFinite(v)));
  const ticks = niceTicks(0, largest, count);
  return ticks[ticks.length - 1];
}

/** Evenly spaced x positions for `count` points across `[start, end]` (a single point sits in the middle). */
export function pointPositions(count: number, start: number, end: number): number[] {
  if (count <= 0) return [];
  if (count === 1) return [(start + end) / 2];
  const step = (end - start) / (count - 1);
  return Array.from({ length: count }, (_, i) => start + i * step);
}

export type Band = { x: number; width: number; center: number };

/** Bars for `count` categories across `[start, end]`, with `padding` (0–1) of each slot left empty. */
export function bands(count: number, start: number, end: number, padding = 0.25): Band[] {
  if (count <= 0) return [];
  const slot = (end - start) / count;
  const width = Math.max(1, slot * (1 - clamp(padding, 0, 0.9)));
  return Array.from({ length: count }, (_, i) => {
    const center = start + slot * (i + 0.5);
    return { x: center - width / 2, width, center };
  });
}

const fmt = (n: number) => Number(n.toFixed(2)).toString();

/** SVG path through the points; `null` points break the line into separate segments. */
export function linePath(points: readonly (Point | null)[]): string {
  let path = '';
  let drawing = false;
  for (const point of points) {
    if (!point) {
      drawing = false;
      continue;
    }
    path += `${drawing ? 'L' : 'M'}${fmt(point.x)},${fmt(point.y)}`;
    drawing = true;
  }
  return path;
}

/** Closed area under each continuous run of points, down to `baseline`. */
export function areaPath(points: readonly (Point | null)[], baseline: number): string {
  const runs: Point[][] = [];
  let current: Point[] = [];
  for (const point of points) {
    if (point) current.push(point);
    else if (current.length) {
      runs.push(current);
      current = [];
    }
  }
  if (current.length) runs.push(current);
  return runs
    .map((run) => {
      const first = run[0];
      const last = run[run.length - 1];
      return `M${fmt(first.x)},${fmt(baseline)}${run.map((p) => `L${fmt(p.x)},${fmt(p.y)}`).join('')}L${fmt(last.x)},${fmt(baseline)}Z`;
    })
    .join('');
}

export type Segment = { y0: number; y1: number };

/** Stack series on top of each other: result[series][index] is that series' [y0, y1) at the index. */
export function stack(series: readonly (readonly number[])[]): Segment[][] {
  const length = Math.max(0, ...series.map((s) => s.length));
  const totals = new Array<number>(length).fill(0);
  return series.map((values) =>
    Array.from({ length }, (_, i) => {
      const y0 = totals[i];
      totals[i] += Math.max(0, values[i] ?? 0);
      return { y0, y1: totals[i] };
    }),
  );
}

/** Per-index totals of several series (the height of each stacked bar). */
export function totals(series: readonly (readonly number[])[]): number[] {
  const length = Math.max(0, ...series.map((s) => s.length));
  return Array.from({ length }, (_, i) => series.reduce((sum, s) => sum + Math.max(0, s[i] ?? 0), 0));
}

