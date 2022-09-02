import { Link } from 'react-router-dom';
import { Activity } from 'lucide-react';
import { useWorkspace } from '../../app/auth';
import { useNow } from '../../app/clock';
import { ErrorBanner } from '../../components/ui';
import { useLoader } from '../../hooks/useLoader';
import { homeApi } from './api';
import { ActivityList } from './components/ActivityList';
import { needsOnboarding } from './homeLogic';
import { AgendaPanel } from './sections/AgendaPanel';
import { ContinueLearning } from './sections/ContinueLearning';
import { FocusCard } from './sections/FocusCard';
import { GoalsPanel } from './sections/GoalsPanel';
import { HomeHero } from './sections/HomeHero';
import { OnboardingPanel } from './sections/OnboardingPanel';
import { TasksPanel } from './sections/TasksPanel';
import { WeekPanel } from './sections/WeekPanel';
import './home.css';

/** The first screen after sign-in: today's plan, what to study next and how the week is going. */
export function HomePage() {
  const workspace = useWorkspace();
  const now = useNow();
  const { data: home, error, loading, reload } = useLoader(() => homeApi.home(workspace.id), `home:${workspace.id}`);

  if (!home) {
    return (
      <div className="home">
        {error ? <ErrorBanner message={error} onRetry={reload} /> : <HomeSkeleton />}
      </div>
    );
  }

  return (
    <div className="home" aria-busy={loading}>
      {error && <ErrorBanner message={error} onRetry={reload} />}
      <HomeHero home={home} now={now} />
      {needsOnboarding(home.onboarding) && <OnboardingPanel onboarding={home.onboarding} />}
      <div className="home-grid">
        <div className="home-main">
          <FocusCard focus={home.focus} />
          <ContinueLearning courses={home.continue_learning} now={now} />
          <AgendaPanel items={home.agenda} now={now} />
        </div>
        <div className="home-side">
          <WeekPanel week={home.week} />
          <TasksPanel tasks={home.tasks} />
          <GoalsPanel goals={home.goals} />
          <section className="panel home-panel" aria-labelledby="recent-title">
            <header className="panel-head">
              <h2 id="recent-title">
                <Activity /> In {workspace.name}
              </h2>
              <Link className="ghost small" to="/activity">
                All activity
              </Link>
            </header>
            {home.activity.length ? (
              <ActivityList items={home.activity} />
            ) : (
              <p className="section-empty muted">Things your classmates do, like publishing courses and mastering concepts, will show up here.</p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function HomeSkeleton() {
  return (
    <div role="status" aria-label="Loading your dashboard">
      <div className="home-hero skeleton-hero">
        <div className="hero-copy">
          <div className="skeleton" style={{ width: '30%' }} />
          <div className="skeleton" style={{ width: '60%', height: 34 }} />
          <div className="skeleton" style={{ width: '45%' }} />
        </div>
      </div>
      <div className="home-grid">
        <div className="home-main">
          {[180, 260, 200].map((height, index) => (
            <div key={index} className="panel skeleton-panel" style={{ height }}>
              <div className="skeleton" style={{ width: '35%' }} />
              <div className="skeleton" style={{ width: '90%' }} />
              <div className="skeleton" style={{ width: '70%' }} />
            </div>
          ))}
        </div>
        <div className="home-side">
          {[220, 180, 160].map((height, index) => (
            <div key={index} className="panel skeleton-panel" style={{ height }}>
              <div className="skeleton" style={{ width: '40%' }} />
              <div className="skeleton" style={{ width: '80%' }} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
