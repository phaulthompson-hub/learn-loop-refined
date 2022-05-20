import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Highlighter, Search } from 'lucide-react';
import { Switch } from '../../components/Field';
import { EmptyState, ErrorBanner, Loading } from '../../components/ui';
import { useLoader } from '../../hooks/useLoader';
import { formatNumber, plural } from '../../lib/format';
import { levelSlug } from '../../lib/mastery';
import { courseApi } from './api';
import { useCourse } from './courseContext';
import { highlightSegments, termCounts } from './text';

export function SourceViewPage() {
  const { course } = useCourse();
  const sourceId = Number(useParams().sourceId);
  const { data: source, error, loading, reload } = useLoader(() => courseApi.source(course.id, sourceId), `source:${course.id}:${sourceId}`);
  const [highlight, setHighlight] = useState(true);
  const names = useMemo(() => course.concepts.map((c) => c.name), [course.concepts]);
  const levels = useMemo(() => new Map(course.concepts.map((c) => [c.name.toLowerCase(), levelSlug(c.level)])), [course.concepts]);
  const segments = useMemo(() => (source ? highlightSegments(source.content, highlight ? names : []) : []), [source, names, highlight]);
  const counts = useMemo(() => (source ? termCounts(source.content, names) : new Map<string, number>()), [source, names]);

  if (error && !source) {
    if (/not found/i.test(error)) {
      return (
        <EmptyState icon={<Search />} title="Source not found">
          <Link className="secondary" to={`/courses/${course.id}/sources`}>
            <ArrowLeft /> Back to sources
          </Link>
        </EmptyState>
      );
    }
    return <ErrorBanner message={error} onRetry={reload} />;
  }
  if (loading && !source) return <Loading label="Loading source…" />;
  if (!source) return null;

  return (
    <div className="reader-layout">
      <article className="panel reader" aria-labelledby="reader-title">
        <Link to={`/courses/${course.id}/sources`} className="back-link">
          <ArrowLeft /> All sources
        </Link>
        <h2 id="reader-title">{source.name}</h2>
        <p className="muted">
          {plural(source.words, 'word')} · {formatNumber(source.characters)} characters · about {Math.max(1, Math.round(source.words / 220))} min read
        </p>
        <div className="source-text">
          {segments.map((segment, index) =>
            segment.term ? (
              <mark key={index} className={`term term-${levels.get(segment.term.toLowerCase()) ?? 'learning'}`} title={segment.term}>
                {segment.text}
              </mark>
            ) : (
              <span key={index}>{segment.text}</span>
            ),
          )}
        </div>
      </article>
      <aside className="panel reader-side">
        <p className="eyebrow">
          <Highlighter className="inline-icon" /> Concepts in this text
        </p>
        <Switch checked={highlight} onChange={setHighlight} label="Highlight concepts" description="Colours follow your mastery level" />
        <ul className="term-list">
          {course.concepts.map((concept) => (
            <li key={concept.id}>
              <span className={`legend-dot fill-${levelSlug(concept.level)}`} aria-hidden="true" />
              <span>{concept.name}</span>
              <b>{counts.get(concept.name) ?? 0}×</b>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
