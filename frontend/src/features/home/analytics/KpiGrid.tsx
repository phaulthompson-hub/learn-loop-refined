import { Sparkline } from '../charts/Sparkline';
import type { Tone } from '../charts/ChartFrame';
import { Delta } from '../components/Delta';
import { formatKpi, KPI_DEFS } from '../analyticsLogic';
import type { Analytics, DailyPoint, KpiKey } from '../types';

const SPARKS: Partial<Record<KpiKey, { tone: Tone; value: (d: DailyPoint) => number }>> = {
  mastery: { tone: 'brand', value: (d) => d.mastery },
  answers: { tone: 'info', value: (d) => d.correct + d.incorrect },
  reviews: { tone: 'violet', value: (d) => d.reviews },
  minutes: { tone: 'warn', value: (d) => d.minutes },
};

/** Eight KPI tiles with period-over-period deltas; volume KPIs also get a daily sparkline. */
export function KpiGrid({ data }: { data: Analytics }) {
  const period = `the previous ${data.range.days} days`;
  return (
    <ul className="kpi-grid">
      {KPI_DEFS.map((def) => {
        const comparison = data.kpis[def.key];
        const spark = SPARKS[def.key];
        const empty = def.key === 'retention' && data.flashcards.retention === null;
        return (
          <li key={def.key} className="kpi">
            <span className="kpi-label">{def.label}</span>
            <b className="kpi-value">{empty ? '–' : formatKpi(def.key, comparison.value)}</b>
            <span className="kpi-foot">
              {empty ? <small className="muted">No reviews yet</small> : <Delta comparison={comparison} unit={def.unit} higherIsBetter={def.higherIsBetter} period={period} />}
              {spark && <Sparkline values={data.daily.map(spark.value)} tone={spark.tone} width={80} height={24} />}
            </span>
            <small className="kpi-hint">{def.hint}</small>
          </li>
        );
      })}
    </ul>
  );
}
