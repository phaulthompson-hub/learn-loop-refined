import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, BookOpenCheck, CheckCircle2, FileText, Lock, MessageCircle, Wand2, Target, XCircle } from 'lucide-react';
import { useNow } from '../../app/clock';
import { EmptyState, ErrorBanner, LevelBadge, MasteryBar, StatCard } from '../../components/ui';
import { useLoader } from '../../hooks/useLoader';
import { plural, relativeTime } from '../../lib/format';
import { answersToReach, formatDelta, MASTERED_THRESHOLD, prerequisiteName, progressCounts, UNLOCK_THRESHOLD } from '../../lib/mastery';
import { courseApi } from './api';
import { ConceptMap } from './components/ConceptMap';
import { ActivityChart, LevelDistribution } from './components/ProgressCharts';
import { useCourse } from './courseContext';
import type { Concept } from './types';

function ConceptDetails({ concept, concepts, courseId }: { concept: Concept; concepts: Concept[]; courseId: number }) {
  const prerequisite = prerequisiteName(concept, concepts);
  const toMaster = answersToReach(concept.mastery);
  return (
    <aside className="concept-details" aria-live="polite">
      <div className="row">
        <h3>{concept.name}</h3>
        <span className="spacer" />
        <LevelBadge value={concept.mastery} />
      </div>
      <MasteryBar value={concept.mastery} label={`${concept.name} mastery`} />
      <p className="concept-details-meta">
        <b>{Math.round(concept.mastery)}%</b> mastery ·{' '}
        {toMaster === 0 ? 'mastered' : `${plural(toMaster, 'correct answer')} to reach ${MASTERED_THRESHOLD}%`}
      </p>
      <p className="concept-summary">{concept.summary}</p>
      {prerequisite && (
        <p className="hint">
          {concept.unlocked ? (
            <>Builds on {prerequisite}.</>
          ) : (
            <>
              <Lock className="inline-icon" /> Unlocks when {prerequisite} reaches {UNLOCK_THRESHOLD}%.
            </>
          )}
        </p>
      )}
      <div className="actions">
        <Link className="secondary small" to={`/courses/${courseId}/tutor?ask=${encodeURIComponent(`Explain ${concept.name.toLowerCase()} more simply`)}`}>
          <MessageCircle /> Ask the tutor
        </Link>
      </div>
    </aside>
  );
}

export function OverviewPage() {
  const { course } = useCourse();
  const now = useNow();
  const history = useLoader(
    async () => {
      const [activity, attempts] = await Promise.all([courseApi.activity(course.id), courseApi.attempts(course.id, 6)]);
      return { activity, attempts };
    },
    // Refetch whenever the learner's progress changes (answers, resets).
    `overview:${course.id}:${course.attempts}:${course.mastery}`,
  );
  const [selectedId, setSelectedId] = useState<number | null>(course.recommendation.concept_id ?? course.concepts[0]?.id ?? null);
  const selected = course.concepts.find((c) => c.id === selectedId) ?? course.concepts[0];
  const counts = progressCounts(course.concepts);
  const recommendation = course.recommendation;

  return (
    <div className="course-overview">
      <section className="next-up" aria-labelledby="next-up-title">
        <div className="next-up-icon" aria-hidden="true">
          {recommendation.concept ? <Target /> : <Wand2 />}
        </div>
        <div className="next-up-body">
          <p className="eyebrow">Next up</p>
          <h2 id="next-up-title">{recommendation.concept ?? 'Everything is mastered'}</h2>
          <p>{recommendation.reason}</p>
        </div>
        <div className="actions">
          <Link className="primary" to={`/courses/${course.id}/quiz`}>
            <BookOpenCheck /> {course.attempts ? 'Continue practising' : 'Start the first quiz'}
          </Link>
          {recommendation.concept && (
            <Link
              className="secondary"
              to={`/courses/${course.id}/tutor?ask=${encodeURIComponent(`Explain ${recommendation.concept.toLowerCase()} more simply`)}`}
            >
              <MessageCircle /> Ask about it
            </Link>
          )}
        </div>
      </section>

      <section className="stats">
        <StatCard label="Your mastery" value={`${Math.round(course.mastery)}%`} hint={`${course.mastered_concepts} of ${course.concept_count} concepts mastered`} />
        <StatCard
          label="Unlocked"
          value={`${course.concepts.filter((c) => c.unlocked).length}/${course.concept_count}`}
          hint={`Concepts unlock at ${UNLOCK_THRESHOLD}% on their prerequisite`}
        />
        <StatCard label="Answers" value={course.attempts} hint={course.attempts ? `${Math.round(course.accuracy)}% correct` : 'No answers yet'} />
        <StatCard label="Learners" value={course.learners} hint={course.enrolled ? 'Including you' : 'Follow to add it to My courses'} />
      </section>

      <div className="overview-grid">
        <section className="panel map-panel" aria-labelledby="map-title">
          <div className="panel-head">
            <div>
              <p className="eyebrow">Knowledge map</p>
              <h2 id="map-title">Your path through {course.concept_count} concepts</h2>
            </div>
            <ul className="map-key" aria-label="Legend">
              <li>
                <span className="legend-dot fill-mastered" /> mastered
              </li>
              <li>
                <span className="legend-dot fill-proficient" /> proficient
              </li>
              <li>
                <span className="legend-dot fill-learning" /> learning
              </li>
              <li>
                <span className="legend-dot fill-needs-review" /> needs review
              </li>
            </ul>
          </div>
          {course.concepts.length ? (
            <div className="map-layout">
              <ConceptMap concepts={course.concepts} selectedId={selected?.id ?? null} recommendedId={recommendation.concept_id} onSelect={(c) => setSelectedId(c.id)} />
              {selected && <ConceptDetails concept={selected} concepts={course.concepts} courseId={course.id} />}
            </div>
          ) : (
            <EmptyState icon={<FileText />} title="No concepts yet">
              <p>Add learning material to this course to generate concepts.</p>
            </EmptyState>
          )}
        </section>

        <div className="overview-side">
          <section className="panel">
            <p className="eyebrow">Level distribution</p>
            <LevelDistribution counts={counts} />
          </section>

          <section className="panel">
            <div className="panel-head compact">
              <p className="eyebrow">Last 14 days</p>
              {history.data && (
                <small className="muted">
                  {plural(history.data.activity.answers, 'answer')} · {history.data.activity.active_days} active days
                </small>
              )}
            </div>
            {history.error && !history.data && <ErrorBanner message={history.error} onRetry={history.reload} />}
            {history.data ? <ActivityChart days={history.data.activity.days} /> : !history.error && <div className="skeleton chart-skeleton" />}
          </section>

          <section className="panel">
            <div className="panel-head compact">
              <p className="eyebrow">Recent answers</p>
              <Link to={`/courses/${course.id}/quiz`} className="link-arrow">
                Practise <ArrowRight />
              </Link>
            </div>
            {history.data && history.data.attempts.length === 0 && <p className="muted">No answers yet. A short quiz shows how your mastery moves.</p>}
            {history.data && history.data.attempts.length > 0 && (
              <ul className="attempt-list">
                {history.data.attempts.map((a) => (
                  <li key={a.id}>
                    {a.correct ? <CheckCircle2 className="ok" aria-label="Correct" /> : <XCircle className="bad" aria-label="Wrong" />}
                    <span>
                      {a.concept_name}
                      <small className="muted"> · {relativeTime(a.created_at, now)}</small>
                    </span>
                    <small className={a.correct ? 'ok' : 'bad'}>
                      {Math.round(a.mastery_after)}% ({formatDelta(a.mastery_before, a.mastery_after)})
                    </small>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="panel">
            <div className="panel-head compact">
              <p className="eyebrow">Sources</p>
              <Link to={`/courses/${course.id}/sources`} className="link-arrow">
                All <ArrowRight />
              </Link>
            </div>
            <ul className="source-links">
              {course.sources.map((source) => (
                <li key={source.id}>
                  <Link to={`/courses/${course.id}/sources/${source.id}`}>
                    <FileText /> <span>{source.name}</span>
                  </Link>
                  <small className="muted">{plural(source.words, 'word')}</small>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
