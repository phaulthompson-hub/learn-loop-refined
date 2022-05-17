import { useRef, type KeyboardEvent } from 'react';
import { Lock, Wand2 } from 'lucide-react';
import { levelSlug } from '../../../lib/mastery';
import { cx } from '../../../lib/cx';
import { NODE_RADIUS, columnsFor, labelLines, layoutConceptMap, nextFocusIndex, ringPath } from '../conceptMap';
import type { Concept } from '../types';
import { useElementWidth } from '../useElementWidth';

type Props = {
  concepts: Concept[];
  selectedId: number | null;
  recommendedId: number | null;
  onSelect: (concept: Concept) => void;
};

/**
 * The course's prerequisite chain drawn as a winding path. Nodes are coloured by mastery level,
 * locked concepts show a padlock, and every node is a keyboard-focusable button (arrows move along the path).
 */
export function ConceptMap({ concepts, selectedId, recommendedId, onSelect }: Props) {
  const [wrapper, width] = useElementWidth<HTMLDivElement>();
  const nodeRefs = useRef<(SVGGElement | null)[]>([]);
  const { nodes, edges, width: viewWidth, height } = layoutConceptMap(concepts, columnsFor(width));

  const onKeyDown = (event: KeyboardEvent<SVGGElement>, index: number) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSelect(concepts[index]);
      return;
    }
    const next = nextFocusIndex(event.key, index, concepts.length);
    if (next === null) return;
    event.preventDefault();
    nodeRefs.current[next]?.focus();
    onSelect(concepts[next]);
  };

  return (
    <div className="concept-map" ref={wrapper}>
      <svg
        viewBox={`0 0 ${viewWidth} ${height}`}
        width="100%"
        style={{ maxWidth: viewWidth }}
        role="group"
        aria-label={`Concept map with ${concepts.length} concepts; use the arrow keys to move along the path`}
      >
        <g className="map-edges" aria-hidden="true">
          {edges.map((edge) => (
            <path key={`${edge.from}-${edge.to}`} d={edge.path} className={cx('map-edge', edge.locked && 'locked')} />
          ))}
        </g>
        {nodes.map(({ concept, index, x, y }) => {
          const selected = concept.id === selectedId;
          const recommended = concept.id === recommendedId;
          const lines = labelLines(concept.name);
          return (
            <g
              key={concept.id}
              ref={(element) => {
                nodeRefs.current[index] = element;
              }}
              className={cx(
                'map-node',
                `node-${levelSlug(concept.level)}`,
                !concept.unlocked && 'locked',
                selected && 'selected',
                recommended && 'recommended',
              )}
              transform={`translate(${x} ${y})`}
              role="button"
              tabIndex={selected || (selectedId === null && index === 0) ? 0 : -1}
              aria-pressed={selected}
              aria-label={`${index + 1}. ${concept.name}: ${Math.round(concept.mastery)}% (${concept.level})${concept.unlocked ? '' : ', locked'}${recommended ? ', recommended next' : ''}`}
              onClick={() => onSelect(concept)}
              onKeyDown={(event) => onKeyDown(event, index)}
            >
              {recommended && <circle className="node-halo" r={NODE_RADIUS + 9} />}
              <circle className="node-disc" r={NODE_RADIUS} />
              <circle className="node-track" r={NODE_RADIUS - 4} />
              <path className="node-progress" d={ringPath(0, 0, NODE_RADIUS - 4, concept.mastery)} />
              {concept.unlocked ? (
                <text className="node-number" dy="0.35em">
                  {index + 1}
                </text>
              ) : (
                <Lock x={-8} y={-8} width={16} height={16} className="node-lock" />
              )}
              {recommended && <Wand2 x={NODE_RADIUS - 10} y={-NODE_RADIUS - 4} width={16} height={16} className="node-spark" />}
              <text className="node-label" y={NODE_RADIUS + 18}>
                {lines.map((line, i) => (
                  <tspan key={i} x={0} dy={i === 0 ? 0 : 15}>
                    {line}
                  </tspan>
                ))}
              </text>
              <text className="node-mastery" y={NODE_RADIUS + 18 + lines.length * 15}>
                {Math.round(concept.mastery)}%
              </text>
              <title>{concept.name}</title>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
