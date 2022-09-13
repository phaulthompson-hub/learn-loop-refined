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

