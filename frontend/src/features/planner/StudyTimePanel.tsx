import { Clock, Plus, Trash2 } from 'lucide-react';
import { DataTable, type Column } from '../../components/DataTable';
import { MasteryBar } from '../../components/ui';
import { isSameDay, parseDate } from '../../lib/dates';
import { cx } from '../../lib/cx';
import { formatDateTime, formatDuration, formatShortDate, formatWeekday } from '../../lib/format';
import { gridlines, niceCeiling } from './charts';
import { ACTIVITY_LABELS } from './goalForm';
import type { StudyLog, StudySummary } from './types';

const CHART = { width: 640, height: 180, top: 12, bottom: 28, left: 40 };

/** Daily minutes over the summary's weeks as bars, with the daily goal as a dashed reference line. */
function MinutesChart({ summary, now }: { summary: StudySummary; now: Date }) {
  const days = summary.weeks.flatMap((week) => week.days);
  const max = niceCeiling(Math.max(summary.daily_goal_minutes, ...days.map((d) => d.minutes)));
  const plotHeight = CHART.height - CHART.top - CHART.bottom;
  const slot = (CHART.width - CHART.left) / days.length;
  const y = (minutes: number) => CHART.top + plotHeight * (1 - minutes / max);
  return (
    <svg className="minutes-chart" viewBox={`0 0 ${CHART.width} ${CHART.height}`} role="img" aria-label={`Study minutes per day over the last ${summary.weeks.length} weeks`}>
      {gridlines(max).map((value) => (
        <g key={value} className="study-chart-grid">
          <line x1={CHART.left} x2={CHART.width} y1={y(value)} y2={y(value)} />
          <text x={CHART.left - 6} y={y(value) + 4} textAnchor="end">
            {value}
          </text>
        </g>
      ))}
      {days.map((day, index) => {
        const x = CHART.left + index * slot;
        const height = plotHeight - (y(day.minutes) - CHART.top);
        const today = isSameDay(parseDate(day.date), now);
        return (
          <g key={day.date}>
            <rect
              className={cx('study-chart-bar', today && 'today', day.minutes >= summary.daily_goal_minutes && 'met', parseDate(day.date) > now && 'future')}
              x={x + slot * 0.18}
              y={y(day.minutes)}
              width={slot * 0.64}
              height={Math.max(height, day.minutes ? 2 : 0)}
              rx={3}
            >
              <title>{`${formatWeekday(day.date)}: ${formatDuration(day.minutes)}`}</title>
            </rect>
            {index % 7 === 0 && (
              <text className="chart-label" x={x + 2} y={CHART.height - 8}>
                {formatShortDate(day.date)}
              </text>
            )}
          </g>
        );
      })}
      <line className="chart-goal" x1={CHART.left} x2={CHART.width} y1={y(summary.daily_goal_minutes)} y2={y(summary.daily_goal_minutes)} />
      <text className="chart-goal-label" x={CHART.width - 4} y={y(summary.daily_goal_minutes) - 5} textAnchor="end">
        Daily goal {summary.daily_goal_minutes} min
      </text>
    </svg>
  );
}

type StudyTimePanelProps = {
  summary: StudySummary;
  logs: StudyLog[];
  now: Date;
  onLog: () => void;
  onDelete: (log: StudyLog) => void;
};

export function StudyTimePanel({ summary, logs, now, onLog, onDelete }: StudyTimePanelProps) {
  const thisWeek = summary.weeks[summary.weeks.length - 1];
  const lastWeek = summary.weeks[summary.weeks.length - 2];
  const todayShare = Math.min(100, (100 * summary.today_minutes) / Math.max(1, summary.daily_goal_minutes));
  const courseMax = Math.max(1, ...summary.by_course.map((c) => c.minutes));

  const columns: Column<StudyLog>[] = [
    { key: 'when', header: 'When', render: (log) => formatDateTime(log.logged_at), sortValue: (log) => log.logged_at },
    { key: 'minutes', header: 'Time', render: (log) => formatDuration(log.minutes), sortValue: (log) => log.minutes, align: 'right' },
    { key: 'activity', header: 'Activity', render: (log) => ACTIVITY_LABELS[log.activity], sortValue: (log) => log.activity },
    {
      key: 'course',
      header: 'Course',
      render: (log) =>
        log.course ? (
          <span className="course-pill">
            <span className="color-dot" style={{ background: log.course.color }} />
            {log.course.title}
          </span>
        ) : (
          <span className="muted">General</span>
        ),
      sortValue: (log) => log.course?.title ?? '',
    },
    { key: 'note', header: 'Note', render: (log) => log.note || <span className="muted">—</span>, className: 'log-note' },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      render: (log) => (
        <button type="button" className="icon-only" aria-label={`Delete ${formatDuration(log.minutes)} logged ${formatDateTime(log.logged_at)}`} onClick={() => onDelete(log)}>
          <Trash2 />
        </button>
      ),
      width: '48px',
    },
  ];

  return (
    <section className="panel study-panel">
      <div className="panel-head">
        <h2>
          <Clock aria-hidden /> Study time
        </h2>
        <button type="button" className="primary small" onClick={onLog}>
          <Plus aria-hidden /> Log time
        </button>
      </div>

      <div className="study-stats">
        <div>
          <span>This week</span>
          <b>{formatDuration(thisWeek?.minutes ?? 0)}</b>
          {lastWeek && <small>{formatDuration(lastWeek.minutes)} last week</small>}
        </div>
        <div>
          <span>Today</span>
          <b>{formatDuration(summary.today_minutes)}</b>
          <MasteryBar value={todayShare} label="Today's minutes against your daily goal" />
          <small>of {summary.daily_goal_minutes} min daily goal</small>
        </div>
        <div>
          <span>Per active day</span>
          <b>{formatDuration(summary.average_per_active_day)}</b>
          <small>{summary.active_days} active days in {summary.weeks.length} weeks</small>
        </div>
      </div>

      <MinutesChart summary={summary} now={now} />

      {summary.by_course.length > 0 && (
        <div className="course-split">
          <h3>By course</h3>
          <ul>
            {summary.by_course.map((row) => (
              <li key={row.course_id ?? 'general'}>
                <span className="course-split-name">
                  <span className="color-dot" style={{ background: row.color ?? 'var(--faint)' }} />
                  {row.title}
                </span>
                <span className="course-split-bar">
                  <i style={{ width: `${(100 * row.minutes) / courseMax}%`, background: row.color ?? 'var(--faint)' }} />
                </span>
                <b>{formatDuration(row.minutes)}</b>
              </li>
            ))}
          </ul>
        </div>
      )}

      <h3 className="study-log-title">Recent logs</h3>
      <DataTable
        rows={logs}
        columns={columns}
        rowKey={(log) => log.id}
        pageSize={8}
        caption="Recent study logs"
        empty="No study time logged yet. Use “Log time” after a reading or revision session."
      />
    </section>
  );
}
