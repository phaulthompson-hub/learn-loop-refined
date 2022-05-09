import type { KeyboardEvent } from 'react';
import { Check } from 'lucide-react';
import { COURSE_COLORS } from '../wizard';

type Props = { value: string; onChange: (color: string) => void; label?: string };

/** Radio group of course colours with roving focus (arrow keys move and select). */
export function ColorSwatches({ value, onChange, label = 'Course colour' }: Props) {
  const current = COURSE_COLORS.findIndex((c) => c.toLowerCase() === value.toLowerCase());

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = (Math.max(0, current) + step + COURSE_COLORS.length) % COURSE_COLORS.length;
    onChange(COURSE_COLORS[next]);
    event.currentTarget.querySelectorAll<HTMLButtonElement>('button')[next]?.focus();
  };

  return (
    <div className="course-swatches" role="radiogroup" aria-label={label} onKeyDown={onKeyDown}>
      {COURSE_COLORS.map((color, index) => {
        const selected = index === current;
        return (
          <button
            key={color}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={color}
            tabIndex={selected || (current < 0 && index === 0) ? 0 : -1}
            className="course-swatch"
            style={{ background: color }}
            onClick={() => onChange(color)}
          >
            {selected && <Check />}
          </button>
        );
      })}
    </div>
  );
}
