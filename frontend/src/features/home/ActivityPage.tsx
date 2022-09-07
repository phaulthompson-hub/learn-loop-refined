import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Activity, Loader2, X } from 'lucide-react';
import { useWorkspace } from '../../app/auth';
import { useNow } from '../../app/clock';
import { EmptyState, ErrorBanner, PageHeader } from '../../components/ui';
import { useLoader } from '../../hooks/useLoader';
import { formatNumber, plural } from '../../lib/format';
import { appendPage, groupByDay, objectTypeLabel } from './activityLogic';
import { homeApi, type ActivityFilters } from './api';
import { ActivityList } from './components/ActivityList';
import type { ActivityItem, ActivityPage as Page } from './types';
import './insights.css';

const PAGE_SIZE = 20;

/** The workspace feed, grouped by day, filterable by person and type, with cursor-based "Load more". */
export function ActivityPage() {
  const workspace = useWorkspace();
  const [search, setSearch] = useSearchParams();
  const actorId = Number(search.get('person')) || null;
  const objectType = search.get('type') || null;
  const filters: ActivityFilters = { actor_id: actorId, object_type: objectType, limit: PAGE_SIZE };
  const key = `activity:${workspace.id}:${actorId ?? ''}:${objectType ?? ''}`;
  const first = useLoader(() => homeApi.activity(workspace.id, filters), key);
  // Filter options do not depend on the filters themselves, so they load once per workspace.
  const facets = useLoader(() => homeApi.activity(workspace.id, { limit: 1 }), `activity-facets:${workspace.id}`).data?.facets;
  const filtered = actorId !== null || objectType !== null;

  const setFilter = (name: 'person' | 'type', value: string) => {
    const next = new URLSearchParams(search);
    if (value) next.set(name, value);
    else next.delete(name);
    setSearch(next, { replace: true });
  };

  return (
    <div className="insights">
      <PageHeader eyebrow={workspace.name} title="Activity" subtitle="What everyone in this workspace has been learning, building and planning." />
      <div className="filter-bar" role="group" aria-label="Filter activity">
        <label className="sr-only" htmlFor="activity-person">
          Person
        </label>
        <select id="activity-person" className="input" value={actorId ?? ''} onChange={(e) => setFilter('person', e.target.value)}>
          <option value="">Everyone</option>
          {facets?.actors.map((actor) => (
            <option key={actor.id} value={actor.id}>
              {actor.name}
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor="activity-type">
          Type
        </label>
        <select id="activity-type" className="input" value={objectType ?? ''} onChange={(e) => setFilter('type', e.target.value)}>
          <option value="">All types</option>
          {facets?.object_types.map((type) => (
            <option key={type} value={type}>
              {objectTypeLabel(type)}
            </option>
          ))}
        </select>
        {filtered && (
          <button type="button" className="ghost small" onClick={() => setSearch(new URLSearchParams(), { replace: true })}>
            <X /> Clear filters
          </button>
        )}
        {first.data && <span className="muted filter-count">{plural(first.data.total, 'entry', 'entries')}</span>}
      </div>
      {first.error && <ErrorBanner message={first.error} onRetry={first.reload} />}
      {first.data ? (
        <Feed key={key} first={first.data} filters={filters} workspaceId={workspace.id} filtered={filtered} onClear={() => setSearch(new URLSearchParams(), { replace: true })} />
      ) : (
        !first.error && <FeedSkeleton />
      )}
    </div>
  );
}

type FeedProps = { first: Page; filters: ActivityFilters; workspaceId: number; filtered: boolean; onClear: () => void };

/** Keyed by the filters, so its "loaded more" pages reset whenever the filters change. */
function Feed({ first, filters, workspaceId, filtered, onClear }: FeedProps) {
  const now = useNow();
  const [older, setOlder] = useState<ActivityItem[]>([]);
  const [cursor, setCursor] = useState(first.next_before_id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const items = appendPage(first.items, older);

  const loadMore = async () => {
    if (cursor === null) return;
    setBusy(true);
    setError(null);
    try {
      const page = await homeApi.activity(workspaceId, { ...filters, before_id: cursor });
      setOlder((current) => appendPage(current, page.items));
      setCursor(page.next_before_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load older activity');
    } finally {
      setBusy(false);
    }
  };

  if (!items.length) {
    return (
      <EmptyState icon={<Activity />} title={filtered ? 'No activity matches these filters' : 'Nothing has happened here yet'}>
        <p>
          {filtered
            ? 'Try another person or type, or clear the filters to see the whole workspace.'
            : 'Creating courses, reviewing flashcards and planning sessions all show up in this feed.'}
        </p>
        {filtered && (
          <button type="button" className="secondary" onClick={onClear}>
            Clear filters
          </button>
        )}
      </EmptyState>
    );
  }

  return (
    <div className="feed-page">
      {groupByDay(items, now).map((group) => (
        <section key={group.key} className="feed-day" aria-labelledby={`day-${group.key}`}>
          <h2 id={`day-${group.key}`} className="feed-day-title">
            {group.label}
            <small>{plural(group.items.length, 'update')}</small>
          </h2>
          <div className="panel feed-panel">
            <ActivityList items={group.items} timestamps="time" />
          </div>
        </section>
      ))}
      {error && <ErrorBanner message={error} onRetry={loadMore} />}
      <div className="feed-footer">
        <span className="muted">
          Showing {formatNumber(items.length)} of {formatNumber(first.total)}
        </span>
        {cursor !== null && (
          <button type="button" className="secondary" onClick={loadMore} disabled={busy}>
            {busy ? <Loader2 className="spin" /> : null}
            {busy ? 'Loading…' : 'Load more'}
          </button>
        )}
      </div>
    </div>
  );
}

function FeedSkeleton() {
  return (
    <div className="panel feed-panel" role="status" aria-label="Loading activity">
      {Array.from({ length: 6 }, (_, index) => (
        <div key={index} className="feed-skeleton">
          <div className="skeleton avatar-skeleton" />
          <div>
            <div className="skeleton" style={{ width: `${50 + ((index * 13) % 40)}%` }} />
            <div className="skeleton" style={{ width: '20%' }} />
          </div>
        </div>
      ))}
    </div>
  );
}
