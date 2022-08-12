import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Clock3, Search, Search as SearchIcon } from 'lucide-react';
import { useWorkspace } from '../../app/auth';
import { useNow } from '../../app/clock';
import { Tabs } from '../../components/Tabs';
import { EmptyState, ErrorBanner, Loading, PageHeader } from '../../components/ui';
import { plural, relativeTime } from '../../lib/format';
import { Highlight } from './HighlightedText';
import { TYPE_ICONS } from './icons';
import { loadRecent, pushRecent, saveRecent } from './recent';
import { SEARCH_TYPES, TYPE_LABELS, type SearchHit, type SearchResult, type SearchType } from './types';
import { useDebouncedValue } from './useDebouncedValue';
import { useSearch } from './useSearch';
import './search.css';

type Tab = 'all' | SearchType;

const PREVIEW_PER_GROUP = 5;
const MAX_RESULTS = 50;
const DATED_TYPES: SearchType[] = ['note', 'task', 'course'];

const isTab = (value: string | null): value is Tab => value === 'all' || SEARCH_TYPES.includes(value as SearchType);

/** The hits a tab shows: each group's best few on "All", every loaded hit on a type tab. */
function visibleHits(result: SearchResult | null, tab: Tab): { type: SearchType; label: string; count: number; items: SearchHit[] }[] {
  if (!result) return [];
  if (tab === 'all') return result.groups.map((group) => ({ ...group, items: group.items.slice(0, PREVIEW_PER_GROUP) }));
  return result.groups.filter((group) => group.type === tab);
}

function ResultRow({ hit, now, onOpen }: { hit: SearchHit; now: Date; onOpen: () => void }) {
  const Icon = TYPE_ICONS[hit.type];
  return (
    <li>
      <Link to={hit.link} className="search-result" data-result onClick={onOpen}>
        <span className={`palette-icon type-${hit.type}`}>
          <Icon />
        </span>
        <span className="search-result-body">
          <b>
            <Highlight text={hit.title} ranges={hit.title_highlights} />
          </b>
          <small className="muted">
            {hit.subtitle}
            {hit.updated_at && DATED_TYPES.includes(hit.type) && ` · updated ${relativeTime(hit.updated_at, now)}`}
          </small>
          {hit.snippet && (
            <span className="search-snippet">
              <Highlight text={hit.snippet.text} ranges={hit.snippet.highlights} />
            </span>
          )}
        </span>
      </Link>
    </li>
  );
}

export function SearchPage() {
  const workspace = useWorkspace();
  const now = useNow();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const input = useRef<HTMLInputElement>(null);
  const results = useRef<HTMLDivElement>(null);
  const urlQuery = params.get('q') ?? '';
  const [draft, setDraft] = useState(urlQuery);
  const [seenUrlQuery, setSeenUrlQuery] = useState(urlQuery);
  if (urlQuery !== seenUrlQuery) {
    // The query changed from outside (e.g. the command palette's "See all results"): adopt it.
    setSeenUrlQuery(urlQuery);
    if (urlQuery !== draft.trim()) setDraft(urlQuery);
  }
  const [recent, setRecent] = useState(() => loadRecent(workspace.id));
  const typeParam = params.get('type');
  const tab: Tab = isTab(typeParam) ? typeParam : 'all';
  const { result, loading, error } = useSearch(workspace.id, draft, { limit: MAX_RESULTS });
  const settledQuery = useDebouncedValue(draft.trim(), 400);

  // Keep the URL in step with what is being searched, so results can be shared and survive reloads.
  useEffect(() => {
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (settledQuery) next.set('q', settledQuery);
        else next.delete('q');
        return next;
      },
      { replace: true },
    );
  }, [settledQuery, setParams]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (event.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) && !target.isContentEditable) {
        event.preventDefault();
        input.current?.focus();
        input.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const remember = () => {
    const next = pushRecent(recent, draft);
    setRecent(next);
    saveRecent(workspace.id, next);
  };

  const setTab = (next: Tab) =>
    setParams(
      (current) => {
        const updated = new URLSearchParams(current);
        if (next === 'all') updated.delete('type');
        else updated.set('type', next);
        return updated;
      },
      { replace: true },
    );

  const focusResult = (delta: number) => {
    const links = [...(results.current?.querySelectorAll<HTMLAnchorElement>('[data-result]') ?? [])];
    if (!links.length) return;
    const index = links.indexOf(document.activeElement as HTMLAnchorElement);
    const nextIndex = index === -1 ? (delta > 0 ? 0 : links.length - 1) : index + delta;
    if (nextIndex < 0) input.current?.focus();
    else links[Math.min(nextIndex, links.length - 1)].focus();
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') focusResult(1);
    else if (event.key === 'ArrowUp') focusResult(-1);
    else if (event.key === 'Enter' && event.target === input.current) {
      const first = results.current?.querySelector<HTMLAnchorElement>('[data-result]');
      if (!first) return;
      remember();
      navigate(first.getAttribute('href') ?? '/');
    } else return;
    event.preventDefault();
  };

  const trimmed = draft.trim();
  const groups = visibleHits(result, tab);
  const tabs = [
    { key: 'all' as Tab, label: 'All', count: result?.total },
    ...SEARCH_TYPES.map((type) => ({ key: type as Tab, label: TYPE_LABELS[type], count: result?.counts[type] ?? undefined })),
  ];

  return (
    <div className="search-page" onKeyDown={onKeyDown}>
      <PageHeader eyebrow="Search" title="Find anything" subtitle="Notes, courses, concepts, tasks, flashcards and events in this workspace." />
      <div className="search-box">
        <SearchIcon aria-hidden />
        <input
          ref={input}
          className="input"
          type="search"
          value={draft}
          autoFocus
          placeholder='Try "gradient descent" or joins sql'
          aria-label="Search this workspace"
          onChange={(event) => setDraft(event.target.value)}
        />
        <kbd aria-hidden>/</kbd>
      </div>
      {trimmed && (
        <div className="search-tabs">
          <Tabs label="Result types" items={tabs} value={tab} onChange={setTab} />
        </div>
      )}
      {error && <ErrorBanner message={error} />}
      <div ref={results} className="search-results" aria-live="polite" aria-busy={loading}>
        {!trimmed ? (
          <EmptyState icon={<SearchIcon />} title="Search your whole workspace">
            <p>
              All words must match. Put a phrase in quotes for an exact match. Press <kbd>/</kbd> to jump here, and <kbd>Ctrl K</kbd> anywhere for quick search.
            </p>
            {recent.length > 0 && (
              <div className="recent-chips" aria-label="Recent searches">
                {recent.map((q) => (
                  <button key={q} type="button" className="chip-button" onClick={() => setDraft(q)}>
                    <span className="row">
                      <Clock3 />
                      {q}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </EmptyState>
        ) : loading && !result ? (
          <Loading label="Searching…" />
        ) : result && result.total === 0 ? (
          <EmptyState icon={<Search />} title={`Nothing matches “${trimmed}”`}>
            <p>Check the spelling, use fewer words, or search for part of a word.</p>
          </EmptyState>
        ) : (
          groups.map((group) => (
            <section key={group.type} className="search-group" aria-label={group.label}>
              <header>
                <h2>{group.label}</h2>
                <span className="muted">{plural(group.count, 'result')}</span>
                {tab === 'all' && group.count > group.items.length && (
                  <button type="button" className="ghost small" onClick={() => setTab(group.type)}>
                    Show all {group.count}
                  </button>
                )}
              </header>
              <ul>
                {group.items.map((hit) => (
                  <ResultRow key={`${hit.type}-${hit.id}`} hit={hit} now={now} onOpen={remember} />
                ))}
              </ul>
              {tab !== 'all' && group.count > group.items.length && (
                <p className="muted search-more">Showing the best {group.items.length}. Add words to narrow the search.</p>
              )}
            </section>
          ))
        )}
        {trimmed && tab !== 'all' && result && result.total > 0 && !groups.length && (
          <p className="muted search-more">No {TYPE_LABELS[tab].toLowerCase()} match. Other types have results; switch tabs above.</p>
        )}
      </div>
    </div>
  );
}
