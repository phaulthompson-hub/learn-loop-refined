// @vitest-environment jsdom
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { TagInput } from './TagInput';

function Harness({ initial }: { initial: string[] }) {
  const [tags, setTags] = useState(initial);
  return (
    <>
      <TagInput tags={tags} onChange={setTags} />
      <output data-testid="tags">{tags.join('|')}</output>
    </>
  );
}

const tags = () => screen.getByTestId('tags').textContent;

describe('TagInput', () => {
  it('adds normalised tags on Enter and comma, skipping duplicates', async () => {
    const user = userEvent.setup();
    render(<Harness initial={['sql']} />);
    const input = screen.getByRole('textbox', { name: 'Add a tag' });
    await user.type(input, 'Machine Learning{Enter}');
    await user.type(input, '#SQL,joins,');
    expect(tags()).toBe('sql|machine-learning|joins');
    expect((input as HTMLInputElement).value).toBe('');
  });

  it('removes the last tag with Backspace and a specific tag with its button', async () => {
    const user = userEvent.setup();
    render(<Harness initial={['a', 'b', 'c']} />);
    await user.click(screen.getByRole('textbox', { name: 'Add a tag' }));
    await user.keyboard('{Backspace}');
    expect(tags()).toBe('a|b');
    await user.click(screen.getByRole('button', { name: 'Remove tag a' }));
    expect(tags()).toBe('b');
  });

  it('explains why a tag was rejected', async () => {
    const user = userEvent.setup();
    render(<Harness initial={[]} />);
    await user.type(screen.getByRole('textbox', { name: 'Add a tag' }), `${'x'.repeat(30)}{Enter}`);
    expect(screen.getByRole('alert').textContent).toBe('Tags can be at most 24 characters.');
    expect(tags()).toBe('');
  });

  it('hides the input once the tag limit is reached', () => {
    render(<Harness initial={Array.from({ length: 10 }, (_, i) => `t${i}`)} />);
    expect(screen.queryByRole('textbox', { name: 'Add a tag' })).toBeNull();
  });
});
