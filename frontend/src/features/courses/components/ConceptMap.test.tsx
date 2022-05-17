// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Concept } from '../types';
import { ConceptMap } from './ConceptMap';

const concepts: Concept[] = [
  { id: 1, name: 'Machine Learning', summary: 's', mastery: 87.4, order_index: 0, prerequisite_id: null, level: 'mastered', unlocked: true },
  { id: 2, name: 'Loss Function', summary: 's', mastery: 45, order_index: 1, prerequisite_id: 1, level: 'learning', unlocked: true },
  { id: 3, name: 'Gradient Descent', summary: 's', mastery: 35, order_index: 2, prerequisite_id: 2, level: 'learning', unlocked: false },
];

describe('ConceptMap', () => {
  it('renders one labelled, focusable node per concept', () => {
    render(<ConceptMap concepts={concepts} selectedId={2} recommendedId={2} onSelect={() => undefined} />);
    const nodes = screen.getAllByRole('button');
    expect(nodes).toHaveLength(3);
    expect(nodes[0].getAttribute('aria-label')).toBe('1. Machine Learning: 87% (mastered)');
    expect(nodes[1].getAttribute('aria-label')).toContain('recommended next');
    expect(nodes[2].getAttribute('aria-label')).toContain('locked');
    expect(nodes.map((n) => n.getAttribute('tabindex'))).toEqual(['-1', '0', '-1']);
    expect(nodes[1].getAttribute('aria-pressed')).toBe('true');
  });

  it('draws locked prerequisite links as dashed edges', () => {
    const { container } = render(<ConceptMap concepts={concepts} selectedId={null} recommendedId={null} onSelect={() => undefined} />);
    const edges = container.querySelectorAll('.map-edge');
    expect(edges).toHaveLength(2);
    expect(edges[1].classList.contains('locked')).toBe(true);
  });

  it('selects with the keyboard and moves along the path with arrow keys', () => {
    const onSelect = vi.fn();
    render(<ConceptMap concepts={concepts} selectedId={1} recommendedId={null} onSelect={onSelect} />);
    const [first] = screen.getAllByRole('button');
    fireEvent.keyDown(first, { key: 'ArrowRight' });
    expect(onSelect).toHaveBeenLastCalledWith(concepts[1]);
    fireEvent.keyDown(first, { key: 'End' });
    expect(onSelect).toHaveBeenLastCalledWith(concepts[2]);
    fireEvent.keyDown(first, { key: 'Enter' });
    expect(onSelect).toHaveBeenLastCalledWith(concepts[0]);
  });
});
