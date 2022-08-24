import { Minus, TrendingDown, TrendingUp } from 'lucide-react';
import { cx } from '../../../lib/cx';
import { deltaInfo } from '../homeLogic';
import type { Comparison } from '../types';
import './shared.css';

type DeltaProps = { comparison: Comparison; unit?: string; higherIsBetter?: boolean; period?: string };

/** "+12 ↗" style change badge, coloured by whether the change is good, with a full sentence for screen readers. */
export function Delta({ comparison, unit, higherIsBetter, period }: DeltaProps) {
  const info = deltaInfo(comparison, { unit, higherIsBetter, period });
  const Icon = info.tone === 'up' ? TrendingUp : info.tone === 'down' ? TrendingDown : Minus;
  return (
    <span className={cx('delta', info.good === true && 'good', info.good === false && 'bad')} title={info.title}>
      <Icon aria-hidden="true" />
      <span aria-hidden="true">{info.text}</span>
      <span className="sr-only">{info.title}</span>
    </span>
  );
}
