// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LineChart } from './LineChart';

const props = {
  title: 'Average mastery per day',
  description: 'Mastery rose from 40% to 55%.',
  labels: ['Mon', 'Tue', 'Wed'],
  fullLabels: ['14 Mar', '15 Mar', '16 Mar'],
  series: [{ key: 'mastery', label: 'Mastery', values: [40, null, 55], tone: 'brand' as const, area: true }],
  yDomain: [0, 100] as [number, number],
  formatValue: (v: number) => `${v}%`,
};

describe('LineChart', () => {
  it('is labelled by its title and description', () => {
    render(<LineChart {...props} />);
    const chart = screen.getByRole('img', { name: /Average mastery per day Mastery rose/ });
    expect(chart.tagName.toLowerCase()).toBe('svg');
  });

  it('renders an accessible data table with every point, including gaps', () => {
    render(<LineChart {...props} />);
    const rows = screen.getAllByRole('row');
    expect(rows).toHaveLength(4); // header + 3 days
    expect(rows[1].textContent).toBe('14 Mar40%');
    expect(rows[2].textContent).toBe('15 Mar–');
  });

  it('shows a readout when navigating with the keyboard', () => {
    const { container } = render(<LineChart {...props} />);
    const svg = container.querySelector('svg')!;
    fireEvent.keyDown(svg, { key: 'End' });
    const tooltip = container.querySelector('.chart-tooltip')!;
    expect(tooltip.textContent).toContain('16 Mar');
    expect(tooltip.textContent).toContain('Mastery: 55%');
    fireEvent.keyDown(svg, { key: 'ArrowLeft' });
    expect(container.querySelector('.chart-tooltip')!.textContent).toContain('Mastery: –');
    fireEvent.keyDown(svg, { key: 'Escape' });
    expect(container.querySelector('.chart-tooltip')).toBeNull();
  });

  it('draws y-axis ticks for the fixed domain and breaks the line at gaps', () => {
    const { container } = render(<LineChart {...props} />);
    const ticks = [...container.querySelectorAll('.chart-grid text')].map((t) => t.textContent);
    expect(ticks).toEqual(['0%', '25%', '50%', '75%', '100%']);
    const line = container.querySelector('.chart-line')!.getAttribute('d')!;
    expect(line.match(/M/g)).toHaveLength(2);
  });
});
