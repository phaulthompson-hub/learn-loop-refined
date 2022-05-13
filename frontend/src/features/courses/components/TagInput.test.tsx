// @vitest-environment jsdom
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { TagInput } from './TagInput';

function Harness({ initial = [] as string[] }) {
  const [tags, setTags] = useState(initial);
  return (
    <>
      <TagInput value={tags} onChange={setTags} />
      <output data-testid="tags">{tags.join('|')}</output>
    </>
  );
}

describe('TagInput', () => {
  it('adds normalised tags with Enter or a comma', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByRole('textbox');
    await user.type(input, '  Machine-Learning {Enter}');
    await user.type(input, 'stats,');
    expect(screen.getByTestId('tags').textContent).toBe('machine-learning|stats');
    expect(input).toHaveProperty('value', '');
  });

  it('explains why a duplicate is rejected', async () => {
    const user = userEvent.setup();
    render(<Harness initial={['ml']} />);
    await user.type(screen.getByRole('textbox'), 'ML{Enter}');
    expect(screen.getByRole('alert').textContent).toMatch(/already added/);
    expect(screen.getByTestId('tags').textContent).toBe('ml');
  });

  it('removes the last tag with Backspace and a specific tag with its button', async () => {
    const user = userEvent.setup();
    render(<Harness initial={['a1', 'b2', 'c3']} />);
    await user.click(screen.getByRole('textbox'));
    await user.keyboard('{Backspace}');
    expect(screen.getByTestId('tags').textContent).toBe('a1|b2');
    await user.click(screen.getByRole('button', { name: 'Remove tag a1' }));
    expect(screen.getByTestId('tags').textContent).toBe('b2');
  });

  it('stops accepting tags at the limit', () => {
    render(<Harness initial={Array.from({ length: 10 }, (_, i) => `t${i}`)} />);
    expect(screen.getByRole('textbox')).toHaveProperty('disabled', true);
  });
});
