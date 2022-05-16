import { describe, expect, it } from 'vitest';
import { CELL_HEIGHT, CELL_WIDTH, NODE_RADIUS, PAD_X, PAD_Y, columnsFor, labelLines, layoutConceptMap, nextFocusIndex, ringPath } from './conceptMap';

const chain = (count: number, unlockedUpTo = count) =>
  Array.from({ length: count }, (_, i) => ({ id: 10 + i, prerequisite_id: i === 0 ? null : 9 + i, unlocked: i < unlockedUpTo }));

describe('layoutConceptMap', () => {
  it('snakes left to right, then right to left', () => {
    const { nodes } = layoutConceptMap(chain(6), 3);
    expect(nodes.map((n) => [n.row, n.col])).toEqual([
      [0, 0],
      [0, 1],
      [0, 2],
      [1, 2],
      [1, 1],
      [1, 0],
    ]);
    expect(nodes[3].x).toBe(nodes[2].x);
    expect(nodes[3].y - nodes[2].y).toBe(CELL_HEIGHT);
  });

  it('sizes the drawing to the columns actually used', () => {
    const wide = layoutConceptMap(chain(6), 4);
    expect(wide.width).toBe(PAD_X * 2 + 3 * CELL_WIDTH);
    const short = layoutConceptMap(chain(2), 5);
    expect(short.width).toBe(PAD_X * 2 + CELL_WIDTH);
    expect(short.nodes.every((n) => n.y === PAD_Y)).toBe(true);
  });

  it('draws one edge per prerequisite, dashed when the target is locked', () => {
    const { edges } = layoutConceptMap(chain(4, 2), 4);
    expect(edges.map((e) => [e.from, e.to, e.locked])).toEqual([
      [10, 11, false],
      [11, 12, true],
      [12, 13, true],
    ]);
  });

  it('uses straight lines within a row and curves between rows', () => {
    const { edges, nodes } = layoutConceptMap(chain(3), 2);
    expect(edges[0].path).toBe(`M ${nodes[0].x + NODE_RADIUS} ${PAD_Y} L ${nodes[1].x - NODE_RADIUS} ${PAD_Y}`);
    expect(edges[1].path.startsWith(`M ${nodes[1].x + NODE_RADIUS} ${PAD_Y} C`)).toBe(true);
  });

  it('ignores prerequisites that are not on the map', () => {
    const { edges } = layoutConceptMap([{ id: 1, prerequisite_id: 99, unlocked: true }], 3);
    expect(edges).toEqual([]);
  });
});

describe('columnsFor', () => {
  it('fits fewer nodes per row on narrow screens', () => {
    expect(columnsFor(360)).toBe(2);
    expect(columnsFor(600)).toBe(3);
    expect(columnsFor(800)).toBe(4);
    expect(columnsFor(1200)).toBe(5);
  });
});

describe('ringPath', () => {
  it('starts at 12 o’clock and uses the large arc past halfway', () => {
    expect(ringPath(0, 0, 10, 25)).toBe('M 0 -10 A 10 10 0 0 1 10.00 0.00');
    expect(ringPath(0, 0, 10, 75)).toContain(' 0 1 1 ');
  });

  it('never draws a degenerate full circle', () => {
    expect(ringPath(0, 0, 10, 100)).not.toBe(ringPath(0, 0, 10, 0));
  });
});

describe('labelLines', () => {
  it('wraps long names over two lines and truncates the rest', () => {
    expect(labelLines('Gradient Descent')).toEqual(['Gradient Descent']);
    expect(labelLines('Probability Distribution')).toEqual(['Probability', 'Distribution']);
    const lines = labelLines('Very long concept name that keeps going and going');
    expect(lines).toHaveLength(2);
    expect(lines[1].endsWith('…')).toBe(true);
  });
});

describe('nextFocusIndex', () => {
  it('moves along the path and stops at both ends', () => {
    expect(nextFocusIndex('ArrowRight', 0, 6)).toBe(1);
    expect(nextFocusIndex('ArrowDown', 5, 6)).toBe(5);
    expect(nextFocusIndex('ArrowLeft', 0, 6)).toBe(0);
    expect(nextFocusIndex('End', 2, 6)).toBe(5);
    expect(nextFocusIndex('Home', 4, 6)).toBe(0);
    expect(nextFocusIndex('a', 1, 6)).toBeNull();
  });
});
