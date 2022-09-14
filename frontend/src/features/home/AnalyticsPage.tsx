import { Link, useSearchParams } from 'react-router-dom';
import { BarChart3, Clock, LineChart as LineIcon, Users } from 'lucide-react';
import { useWorkspace } from '../../app/auth';
import { Tabs } from '../../components/Tabs';
import { EmptyState, ErrorBanner, PageHeader } from '../../components/ui';
import { useLoader } from '../../hooks/useLoader';
import { formatDuration, formatShortDate } from '../../lib/format';
import { http, type Page } from '../../lib/http';
import { analyticsSearch, axisLabel, parseAnalyticsSearch, rangeCaption, RANGES, type AnalyticsState } from './analyticsLogic';
import { homeApi } from './api';
import { CourseBreakdown, Leaderboard, WeakestConcepts } from './analytics/Breakdowns';
import { ConceptTable } from './analytics/ConceptTable';
import { FlashcardPanel } from './analytics/FlashcardPanel';
import { KpiGrid } from './analytics/KpiGrid';
import { LearnersTab } from './analytics/LearnersTab';
import { Donut } from './charts/Donut';
import { LineChart } from './charts/LineChart';
import { StackedBarChart } from './charts/StackedBarChart';
import type { Analytics, CourseBrief, RangeDays } from './types';
import './insights.css';

/** Personal learning analytics with a range + course filter kept in the URL, and a learners tab for staff. */
export function AnalyticsPage() {
  const workspace = useWorkspace();
  const [search, setSearch] = useSearchParams();
  const state = parseAnalyticsSearch(search);
  const staff = workspace.can('instructor');
  const tab = staff ? state.tab : 'overview';
  const courses = useLoader(
    () => http.get<Page<CourseBrief>>(`/workspaces/${workspace.id}/courses?page_size=100&sort=title`),
    `analytics-courses:${workspace.id}`,
  ).data?.items;

  const update = (patch: Partial<AnalyticsState>) => setSearch(new URLSearchParams(analyticsSearch({ ...state, ...patch })), { replace: true });

  return (
    <div className="insights">
      <PageHeader
        eyebrow="Insights"
        title="Analytics"
        subtitle="How your mastery, practice and memory are trending."
        aside={
          <div className="analytics-controls">
            <Tabs
              label="Date range"
              value={String(state.days)}
              onChange={(value) => update({ days: Number(value) as RangeDays })}
              items={RANGES.map((days) => ({ key: String(days), label: `${days} days` }))}
            />
            {tab === 'overview' && (
              <select
                className="input"
                aria-label="Course"
                value={state.courseId ?? ''}
                onChange={(e) => update({ courseId: e.target.value ? Number(e.target.value) : null })}
              >
                <option value="">All my courses</option>
                {courses?.map((course) => (
                  <option key={course.id} value={course.id}>
                    {course.title}
                  </option>
                ))}
              </select>
            )}
          </div>
        }
      />
      {staff && (
        <Tabs
          label="Analytics views"
          value={tab}
          onChange={(value) => update({ tab: value })}
          items={[
            { key: 'overview', label: 'My progress', icon: <LineIcon /> },
            { key: 'learners', label: 'Learners', icon: <Users /> },
          ]}
        />
      )}
      {tab === 'learners' ? <LearnersTab workspaceId={workspace.id} days={state.days} /> : <Overview state={state} workspaceId={workspace.id} onCourse={(courseId) => update({ courseId })} />}
    </div>
  );
}

type OverviewProps = { state: AnalyticsState; workspaceId: number; onCourse: (courseId: number | null) => void };

function Overview({ state, workspaceId, onCourse }: OverviewProps) {
  const { data, error, loading, reload } = useLoader(
    () => homeApi.analytics(workspaceId, state.days, state.courseId),
    `analytics:${workspaceId}:${state.days}:${state.courseId ?? 'all'}`,
  );

  if (!data) {
    if (!error) return <OverviewSkeleton />;
    return (
      <>
        <ErrorBanner message={error} onRetry={reload} />
        {state.courseId !== null && (
          <button type="button" className="secondary" onClick={() => onCourse(null)}>
            Show all my courses
          </button>
        )}
      </>
    );
  }

  const nothingYet = data.courses_in_scope.length === 0;
  return (
    <div className="analytics" aria-busy={loading}>
      {error && <ErrorBanner message={error} onRetry={reload} />}
      <p className="range-caption muted">{rangeCaption(data.range)}</p>
      {nothingYet ? (
        <EmptyState icon={<BarChart3 />} title="No learning data yet">
          <p>Enrol in a course and answer a few quiz questions. Your mastery trend, accuracy and memory stats will build up here.</p>
          <Link className="primary" to="/courses">
            Browse courses
          </Link>
        </EmptyState>
      ) : (
        <>
          <KpiGrid data={data} />
          <div className="analytics-row wide-left">
            <MasteryTrend data={data} />
            <TimeSplit data={data} />
          </div>
          <div className="analytics-row wide-left">
            <DailyActivity data={data} />
            <FlashcardPanel cards={data.flashcards} />
          </div>
          <div className="analytics-row thirds">
            <CourseBreakdown courses={data.courses} onSelect={onCourse} />
            <WeakestConcepts rows={data.weakest} />
            <Leaderboard rows={data.leaderboard} days={data.range.days} />
          </div>
          <ConceptTable rows={data.concepts} days={data.range.days} />
        </>
      )}
    </div>
  );
}

function MasteryTrend({ data }: { data: Analytics }) {
  const first = data.daily[0]?.mastery ?? 0;
  const last = data.daily[data.daily.length - 1]?.mastery ?? 0;
  return (
    <section className="panel" aria-labelledby="trend-title">
      <header className="panel-head">
        <h2 id="trend-title">
          <LineIcon /> Mastery trend
        </h2>
        <small className="muted">Average across {data.concepts.length} concepts, rebuilt from your quiz history</small>
      </header>
      <LineChart
        title="Average mastery per day"
        description={`Average mastery moved from ${first.toFixed(1)}% to ${last.toFixed(1)}% over the last ${data.range.days} days.`}
        labels={data.daily.map((d) => axisLabel(d.date, data.range.days))}
        fullLabels={data.daily.map((d) => formatShortDate(d.date))}
        series={[{ key: 'mastery', label: 'Average mastery', values: data.daily.map((d) => d.mastery), tone: 'brand', area: true }]}
        yDomain={[0, 100]}
        formatValue={(v) => `${Math.round(v)}%`}
        height={240}
      />
    </section>
  );
}

function DailyActivity({ data }: { data: Analytics }) {
  const total = data.daily.reduce((sum, d) => sum + d.correct + d.incorrect + d.reviews, 0);
  return (
    <section className="panel" aria-labelledby="daily-title">
      <header className="panel-head">
        <h2 id="daily-title">
          <BarChart3 /> Daily practice
        </h2>
        <small className="muted">Quiz answers and flashcard reviews</small>
      </header>
      {total === 0 ? (
        <p className="muted chart-empty">No practice in this period yet.</p>
      ) : (
        <StackedBarChart
          title="Practice per day"
          description={`${total} quiz answers and flashcard reviews over the last ${data.range.days} days.`}
          labels={data.daily.map((d) => axisLabel(d.date, data.range.days))}
          fullLabels={data.daily.map((d) => formatShortDate(d.date))}
          series={[
            { key: 'correct', label: 'Correct answers', values: data.daily.map((d) => d.correct), tone: 'brand' },
            { key: 'incorrect', label: 'Incorrect answers', values: data.daily.map((d) => d.incorrect), tone: 'bad' },
            { key: 'reviews', label: 'Card reviews', values: data.daily.map((d) => d.reviews), tone: 'violet' },
          ]}
          height={230}
        />
      )}
    </section>
  );
}

const ACTIVITY_TONES = ['info', 'violet', 'warn', 'ok', 'muted'] as const;

function TimeSplit({ data }: { data: Analytics }) {
  const { time } = data;
  return (
    <section className="panel" aria-labelledby="time-title">
      <header className="panel-head">
        <h2 id="time-title">
          <Clock /> Study time
        </h2>
      </header>
      {time.total === 0 ? (
        <p className="muted chart-empty">No study time logged in this period.</p>
      ) : (
        <>
          <Donut
            title="Study time by course"
            slices={time.by_course.map((s) => ({ key: s.key, label: s.label, value: s.minutes, color: s.color ?? 'var(--faint)' }))}
            center={formatDuration(time.total)}
            centerCaption="total"
            formatValue={formatDuration}
          />
          <ul className="activity-split" aria-label="Study time by activity">
            {time.by_activity.map((slice, index) => (
              <li key={slice.key}>
                <span className="split-label">{slice.label}</span>
                <span className="split-bar" aria-hidden="true">
                  <i style={{ width: `${(slice.minutes / time.total) * 100}%`, background: `var(--${ACTIVITY_TONES[index % ACTIVITY_TONES.length]})` }} />
                </span>
                <b>{formatDuration(slice.minutes)}</b>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function OverviewSkeleton() {
  return (
    <div role="status" aria-label="Loading analytics">
      <ul className="kpi-grid">
        {Array.from({ length: 8 }, (_, index) => (
          <li key={index} className="kpi">
            <div className="skeleton" style={{ width: '60%' }} />
            <div className="skeleton" style={{ width: '40%', height: 26 }} />
          </li>
        ))}
      </ul>
      <div className="analytics-row wide-left">
        <div className="panel skeleton-panel" style={{ height: 300 }} />
        <div className="panel skeleton-panel" style={{ height: 300 }} />
      </div>
    </div>
  );
}
