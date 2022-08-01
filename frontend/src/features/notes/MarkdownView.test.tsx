// @vitest-environment jsdom
import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../test/render';
import { MarkdownView, noteHref } from './MarkdownView';

const resolveLink = (target: string, heading: string | null) => ({ href: target === 'Loss functions' ? noteHref(5, heading) : null });

describe('MarkdownView', () => {
  it('never turns note text into live HTML', () => {
    const source = [
      '<script>window.hacked = true</script>',
      '<img src=x onerror="window.hacked = true">',
      '[click](javascript:void0) and [data](data:text/html,hi)',
      '**<b>bold tag</b>**',
    ].join('\n\n');
    const { container } = renderWithProviders(<MarkdownView source={source} resolveLink={resolveLink} />);
    expect(container.querySelector('script, img, b')).toBeNull();
    expect(container.querySelectorAll('a')).toHaveLength(0);
    expect(container.textContent).toContain('<script>window.hacked = true</script>');
    expect(container.querySelector('strong')?.textContent).toBe('<b>bold tag</b>');
    expect((window as unknown as { hacked?: boolean }).hacked).toBeUndefined();
  });

  it('opens external links safely in a new tab', () => {
    renderWithProviders(<MarkdownView source="Read [the guide](https://example.com/guide)" resolveLink={resolveLink} />);
    const link = screen.getByRole('link', { name: 'the guide' });
    expect(link.getAttribute('href')).toBe('https://example.com/guide');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
  });

  it('links resolved wiki links to the note and heading, and offers to create missing ones', () => {
    const onMissingLink = vi.fn();
    renderWithProviders(<MarkdownView source="[[Loss functions#Rules of thumb|losses]] and [[Query plans]]" resolveLink={resolveLink} onMissingLink={onMissingLink} />);
    // Query by the visible alias: dom-accessibility-api 0.5 names links from their title attribute.
    const alias = screen.getByText('losses');
    expect(alias.tagName).toBe('A');
    expect(alias.getAttribute('href')).toBe('/notes/5#rules-of-thumb');
    expect(alias.getAttribute('title')).toBe('Loss functions');
    fireEvent.click(screen.getByRole('button', { name: 'Query plans' }));
    expect(onMissingLink).toHaveBeenCalledWith('Query plans');
  });

  it('toggles tasks by source line only when allowed', () => {
    const onToggleTask = vi.fn();
    const source = '# Plan\n\n- [x] Done thing\n- [ ] Open thing';
    const { unmount } = renderWithProviders(<MarkdownView source={source} resolveLink={resolveLink} onToggleTask={onToggleTask} />);
    const open = screen.getByRole('checkbox', { name: 'Open task: Open thing' });
    expect(screen.getByRole('checkbox', { name: 'Completed task: Done thing' })).toHaveProperty('checked', true);
    fireEvent.click(open);
    expect(onToggleTask).toHaveBeenCalledWith(3);
    unmount();
    renderWithProviders(<MarkdownView source={source} resolveLink={resolveLink} />);
    expect(screen.getByRole('checkbox', { name: 'Open task: Open thing' })).toHaveProperty('disabled', true);
  });

  it('renders tables, code and headings with anchors', () => {
    const { container } = renderWithProviders(
      <MarkdownView source={'## Joins\n\n| a | b |\n| - | -: |\n| 1 | 2 |\n\n```sql\nSELECT 1;\n```'} resolveLink={resolveLink} />,
    );
    expect(container.querySelector('h2')?.id).toBe('joins');
    expect(container.querySelectorAll('tbody td')).toHaveLength(2);
    expect((container.querySelectorAll('td')[1] as HTMLElement).style.textAlign).toBe('right');
    expect(container.querySelector('pre')?.dataset.lang).toBe('sql');
  });

  it('shows a placeholder for an empty note', () => {
    renderWithProviders(<MarkdownView source="   " resolveLink={resolveLink} />);
    expect(screen.getByText('Nothing written yet.')).toBeTruthy();
  });
});
