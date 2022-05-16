// Geometry for the concept map: concepts snake left-to-right then right-to-left across rows, so each
// prerequisite sits next to (or directly above) the concept it unlocks.
export const NODE_RADIUS = 28;
export const CELL_WIDTH = 172;
export const CELL_HEIGHT = 138;
export const PAD_X = 92;
export const PAD_Y = 52;

type Placeable = { id: number; prerequisite_id: number | null; unlocked: boolean };

export type MapNode<C extends Placeable> = { concept: C; index: number; row: number; col: number; x: number; y: number };
export type MapEdge = { from: number; to: number; path: string; locked: boolean };
export type MapLayout<C extends Placeable> = { nodes: MapNode<C>[]; edges: MapEdge[]; width: number; height: number };

/** Pick how many nodes fit on one row for a container of `width` pixels. */
export function columnsFor(width: number): number {
  if (width < 460) return 2;
  if (width < 700) return 3;
  if (width < 900) return 4;
  return 5;
}

/** How far a row-turn connector bows out past the node, so it clears the label under the upper node. */
export const TURN_BULGE = 56;

function edgePath(a: { x: number; y: number }, b: { x: number; y: number }, outward: 1 | -1): string {
  if (Math.abs(a.y - b.y) < 1) {
    const direction = Math.sign(b.x - a.x) || 1;
    return `M ${a.x + direction * NODE_RADIUS} ${a.y} L ${b.x - direction * NODE_RADIUS} ${b.y}`;
  }
  // Row turns leave from the node's outer side and curve around the outside of the map.
  const start = { x: a.x + outward * NODE_RADIUS, y: a.y };
  const end = { x: b.x + outward * NODE_RADIUS, y: b.y };
  const control = outward * TURN_BULGE;
  return `M ${start.x} ${start.y} C ${start.x + control} ${start.y} ${end.x + control} ${end.y} ${end.x} ${end.y}`;
}

export function layoutConceptMap<C extends Placeable>(concepts: readonly C[], columns: number): MapLayout<C> {
  const perRow = Math.max(1, Math.min(columns, concepts.length));
  const nodes = concepts.map((concept, index) => {
    const row = Math.floor(index / perRow);
    const offset = index % perRow;
    const col = row % 2 === 0 ? offset : perRow - 1 - offset;
    return { concept, index, row, col, x: PAD_X + col * CELL_WIDTH, y: PAD_Y + row * CELL_HEIGHT };
  });
  const byId = new Map(nodes.map((node) => [node.concept.id, node]));
  const edges: MapEdge[] = [];
  for (const node of nodes) {
    const prerequisite = node.concept.prerequisite_id === null ? undefined : byId.get(node.concept.prerequisite_id);
    if (!prerequisite) continue;
    edges.push({
      from: prerequisite.concept.id,
      to: node.concept.id,
      // Turns at the right edge bow right, turns at the left edge bow left.
      path: edgePath(prerequisite, node, prerequisite.col === 0 && perRow > 1 ? -1 : 1),
      locked: !node.concept.unlocked,
    });
  }
  const rows = Math.max(1, Math.ceil(concepts.length / perRow));
  return {
    nodes,
    edges,
    width: PAD_X * 2 + (perRow - 1) * CELL_WIDTH,
    height: PAD_Y + (rows - 1) * CELL_HEIGHT + NODE_RADIUS + 58,
  };
}

/** SVG arc path for a progress ring around a node, starting at 12 o'clock. */
export function ringPath(cx: number, cy: number, radius: number, percent: number): string {
  const clamped = Math.min(99.99, Math.max(0, percent));
  const angle = (clamped / 100) * 2 * Math.PI;
  const x = cx + radius * Math.sin(angle);
  const y = cy - radius * Math.cos(angle);
  const large = clamped > 50 ? 1 : 0;
  // Snap tiny values to 0 so the path never contains "-0.00".
  const fixed = (value: number) => (Math.abs(value) < 0.005 ? 0 : value).toFixed(2);
  return `M ${cx} ${cy - radius} A ${radius} ${radius} 0 ${large} 1 ${fixed(x)} ${fixed(y)}`;
}

/** Split a concept name over at most two lines of roughly `width` characters for an SVG label. */
export function labelLines(name: string, width = 16): string[] {
  const words = name.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (current && `${current} ${word}`.length > width) {
      lines.push(current);
      current = word;
    } else {
      current = current ? `${current} ${word}` : word;
    }
  }
  if (current) lines.push(current);
  if (lines.length <= 2) return lines;
  const second = lines.slice(1).join(' ');
  return [lines[0], second.length > width ? `${second.slice(0, width - 1).trimEnd()}…` : second];
}

/** Index of the node keyboard focus should move to, or null when the key is not a navigation key. */
export function nextFocusIndex(key: string, index: number, count: number): number | null {
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return Math.min(count - 1, index + 1);
    case 'ArrowLeft':
    case 'ArrowUp':
      return Math.max(0, index - 1);
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}
