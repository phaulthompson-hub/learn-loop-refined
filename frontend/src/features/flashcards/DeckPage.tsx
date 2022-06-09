import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ChevronLeft, FileUp, Lightbulb, MoreHorizontal, Pencil, Play, Plus, Search, Wand2, Trash2 } from 'lucide-react';
import { useNow } from '../../app/clock';
import { useToast } from '../../app/toast';
import { DataTable, type Column } from '../../components/DataTable';
import { Menu } from '../../components/Menu';
import { ConfirmDialog } from '../../components/Modal';
import { Tabs } from '../../components/Tabs';
import { EmptyState, ErrorBanner, Loading, MasteryBar, StatCard } from '../../components/ui';
import { useLoader } from '../../hooks/useLoader';
import { cx } from '../../lib/cx';
import { formatDate, plural, relativeDay, relativeTime, truncate } from '../../lib/format';
import { flashcardsApi } from './api';
import { CardFormModal } from './components/CardFormModal';
import { CardPreviewModal } from './components/CardPreviewModal';
import { DeckFormModal } from './components/DeckFormModal';
import { ForecastBars } from './components/ForecastBars';
import { ImportModal } from './components/ImportModal';
import { STATUS_HINTS, STATUS_LABELS, STATUS_TONES, countStatuses, filterCards, studyAction } from './decks';
import { formatInterval } from './scheduler';
import type { Card, CardStatus, DeckDetail } from './types';
import './flashcards.css';

const STATUS_ORDER: CardStatus[] = ['new', 'learning', 'young', 'mature'];

type Dialog =
  | { kind: 'add-card' }
  | { kind: 'edit-card'; card: Card }
  | { kind: 'preview'; card: Card }
  | { kind: 'delete-card'; card: Card }
  | { kind: 'import' }
  | { kind: 'generate' }
  | { kind: 'edit-deck' }
  | { kind: 'delete-deck' };

function StatusBreakdown({ counts, total }: { counts: Record<CardStatus, number>; total: number }) {
  return (
    <div className="fc-breakdown">
      <div className="fc-breakdown-bar" aria-hidden="true">
        {STATUS_ORDER.map((status) => (
          <i key={status} className={`is-${status}`} style={{ flexGrow: counts[status] }} />
        ))}
      </div>
      <ul>
        {STATUS_ORDER.map((status) => (
          <li key={status} title={STATUS_HINTS[status]}>
            <span className={`fc-dot is-${status}`} />
            {STATUS_LABELS[status]}
            <b>{counts[status]}</b>
            <small className="muted">{total ? Math.round((100 * counts[status]) / total) : 0}%</small>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ConceptCoverage({ deck, onGenerate }: { deck: DeckDetail; onGenerate: () => void }) {
  const uncovered = deck.concepts.filter((c) => c.card_count === 0).length;
  return (
    <div className="panel flat">
      <div className="panel-head">
        <h2>Concept coverage</h2>
        <span className="muted">
          {deck.concepts.length - uncovered}/{deck.concepts.length}
        </span>
      </div>
      {deck.concepts.length === 0 ? (
        <p className="muted">This course has no extracted concepts yet.</p>
      ) : (
        <ul className="fc-concepts">
          {deck.concepts.map((concept) => (
            <li key={concept.id} className={cx(!concept.card_count && 'is-uncovered')} title={concept.summary}>
              <span>{concept.name}</span>
              <small>{concept.card_count ? plural(concept.card_count, 'card') : 'No cards'}</small>
            </li>
          ))}
        </ul>
      )}
      {deck.can_edit && (
        <button type="button" className="secondary wide" disabled={!uncovered} onClick={onGenerate} title={uncovered ? undefined : 'Every concept already has a card'}>
          <Wand2 /> Generate from concepts{uncovered ? ` (${uncovered})` : ''}
        </button>
      )}
    </div>
  );
}

/** One deck: stats and outlook, the card table with search/filters, and editing tools for instructors. */
export function DeckPage() {
  const deckId = Number(useParams().deckId);
  const navigate = useNavigate();
  const toast = useToast();
  const now = useNow();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<CardStatus | 'all'>('all');
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [busy, setBusy] = useState(false);

  const { data, error, loading, reload } = useLoader(async () => {
    if (!Number.isInteger(deckId) || deckId <= 0) throw new Error('Deck not found');
    const deck = await flashcardsApi.deck(deckId);
    const [cards, stats] = await Promise.all([flashcardsApi.cards(deckId), flashcardsApi.stats(deck.workspace_id, { deck_id: deckId })]);
    return { deck, cards, stats };
  }, `deck:${deckId}`);

  const cards = useMemo(() => data?.cards ?? [], [data]);
  const visible = useMemo(() => filterCards(cards, { query, status }), [cards, query, status]);
  const counts = useMemo(() => countStatuses(cards), [cards]);

  if (error === 'Deck not found') {
    return (
      <EmptyState icon={<Search />} title="Deck not found">
        <p>It may have been deleted, or it belongs to a course you cannot see.</p>
        <Link className="primary" to="/decks">
          Back to decks
        </Link>
      </EmptyState>
    );
  }
  if (loading && !data) return <Loading label="Loading deck…" />;
  if (error && !data) return <ErrorBanner message={error} onRetry={reload} />;
  if (!data) return null;

  const { deck, stats } = data;
  const action = studyAction(deck, stats.new_allowance);
  const uncovered = deck.concepts.filter((c) => !c.card_count);
  const close = () => setDialog(null);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    try {
      await work();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  const deleteCard = (card: Card) =>
    run(async () => {
      await flashcardsApi.deleteCard(card.id);
      toast.success('Card deleted');
      close();
      reload();
    });

  const deleteDeck = () =>
    run(async () => {
      await flashcardsApi.deleteDeck(deck.id);
      toast.success(`Deleted ${deck.name}`);
      navigate('/decks');
    });

  const generate = () =>
    run(async () => {
      const result = await flashcardsApi.generateCards(deck.id);
      toast.success(result.created.length ? `Generated ${plural(result.created.length, 'card')} from course concepts` : 'Every concept already has a card');
      close();
      reload();
    });

  const columns: Column<Card>[] = [
    {
      key: 'front',
      header: 'Front',
      sortValue: (c) => c.front,
      render: (c) => (
        <div className="fc-cell-front">
          <b>{truncate(c.front, 90)}</b>
          <span className="fc-cell-meta">
            {c.concept_name && <span className="tag">{c.concept_name}</span>}
            {c.hint && (
              <span className="muted" title={`Hint: ${c.hint}`}>
                <Lightbulb /> hint
              </span>
            )}
          </span>
        </div>
      ),
    },
    { key: 'back', header: 'Back', render: (c) => <span className="muted">{truncate(c.back, 90)}</span> },
    {
      key: 'status',
      header: 'Status',
      sortValue: (c) => STATUS_ORDER.indexOf(c.status),
      render: (c) => (
        <span className={`badge ${STATUS_TONES[c.status]}`} title={STATUS_HINTS[c.status]}>
          {STATUS_LABELS[c.status]}
        </span>
      ),
    },
    {
      key: 'due',
      header: 'Due',
      sortValue: (c) => c.due_at,
      render: (c) => (c.due_at ? <span title={formatDate(c.due_at)}>{relativeDay(c.due_at, now)}</span> : <span className="muted">—</span>),
    },
    {
      key: 'interval',
      header: 'Interval',
      align: 'right',
      sortValue: (c) => (c.status === 'new' ? null : c.interval_days),
      render: (c) => (c.status === 'new' ? <span className="muted">—</span> : formatInterval(c.interval_days)),
    },
  ];
  if (deck.can_edit) {
    columns.push({
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      align: 'right',
      width: '92px',
      render: (c) => (
        <div className="fc-row-actions" onClick={(event) => event.stopPropagation()}>
          <button type="button" className="icon-only" aria-label={`Edit card: ${c.front}`} onClick={() => setDialog({ kind: 'edit-card', card: c })}>
            <Pencil />
          </button>
          <button type="button" className="icon-only" aria-label={`Delete card: ${c.front}`} onClick={() => setDialog({ kind: 'delete-card', card: c })}>
            <Trash2 />
          </button>
        </div>
      ),
    });
  }

  return (
    <div className="fc-page">
      <nav className="fc-breadcrumb" aria-label="Breadcrumb">
        <Link to="/decks">
          <ChevronLeft /> Decks
        </Link>
        <span className="muted">/</span>
        <Link to={`/decks?course=${deck.course_id}`}>{deck.course_title}</Link>
      </nav>
      <header className="fc-deck-hero" style={{ ['--deck-color' as string]: deck.course_color }}>
        <div>
          <p className="eyebrow">Deck</p>
          <h1>{deck.name}</h1>
          {deck.description && <p className="fc-deck-hero-description">{deck.description}</p>}
          <p className="muted">
            {deck.created_by_name ? `Created by ${deck.created_by_name}` : 'Created'} on {formatDate(deck.created_at)}
            {deck.last_reviewed_at && ` · You studied it ${relativeTime(deck.last_reviewed_at, now)}`}
          </p>
        </div>
        <div className="actions">
          {action.kind === 'done' ? (
            <span className="fc-deck-done">All caught up{deck.next_due_at && ` · next ${relativeTime(deck.next_due_at, now)}`}</span>
          ) : (
            <Link className="primary" to={`/review/${deck.id}`}>
              <Play /> Study now · {action.kind === 'due' ? `${deck.due} due` : `${Math.min(deck.new, stats.new_allowance)} new`}
            </Link>
          )}
          {deck.can_edit && (
            <Menu
              trigger={({ toggle, ref, open }) => (
                <button type="button" ref={ref} className="secondary" aria-haspopup="menu" aria-expanded={open} onClick={toggle} aria-label="Deck actions">
                  <MoreHorizontal />
                </button>
              )}
              items={[
                { label: 'Edit details', icon: <Pencil />, onSelect: () => setDialog({ kind: 'edit-deck' }) },
                { label: 'Import cards', icon: <FileUp />, onSelect: () => setDialog({ kind: 'import' }) },
                { label: 'Generate from concepts', icon: <Wand2 />, onSelect: () => setDialog({ kind: 'generate' }) },
                'separator',
                { label: 'Delete deck', icon: <Trash2 />, danger: true, onSelect: () => setDialog({ kind: 'delete-deck' }) },
              ]}
            />
          )}
        </div>
      </header>

      <section className="stats">
        <StatCard label="Cards" value={deck.card_count} hint={`${deck.concepts.filter((c) => c.card_count).length} of ${deck.concepts.length} concepts covered`} />
        <StatCard label="Due today" value={deck.due} hint={deck.next_due_at ? `Then ${relativeTime(deck.next_due_at, now)}` : undefined} />
        <StatCard label="New" value={deck.new} hint={`${stats.new_allowance} new cards left today`} />
        <StatCard
          label="Settled"
          value={`${Math.round(deck.mastery)}%`}
          hint={<MasteryBar value={deck.mastery} label="Deck mastery" />}
        />
        <StatCard label="30-day recall" value={deck.retention === null ? '—' : `${Math.round(deck.retention)}%`} hint={plural(stats.reviews_30d, 'review')} />
      </section>

      <div className="fc-deck-layout">
        <section className="panel fc-cards-panel" aria-labelledby="fc-cards-title">
          <div className="panel-head">
            <h2 id="fc-cards-title">Cards</h2>
            {deck.can_edit && (
              <div className="actions">
                <button type="button" className="secondary small" onClick={() => setDialog({ kind: 'import' })}>
                  <FileUp /> Import
                </button>
                <button type="button" className="primary small" onClick={() => setDialog({ kind: 'add-card' })}>
                  <Plus /> Add card
                </button>
              </div>
            )}
          </div>
          {cards.length === 0 ? (
            <EmptyState icon={<Wand2 />} title="This deck is empty">
              <p>{deck.can_edit ? 'Add cards one by one, paste a list, or let LearnLoop draft one card per course concept.' : 'Your instructor has not added cards yet.'}</p>
              {deck.can_edit && (
                <div className="actions center">
                  <button type="button" className="primary" onClick={() => setDialog({ kind: 'add-card' })}>
                    <Plus /> Add a card
                  </button>
                  <button type="button" className="secondary" onClick={() => setDialog({ kind: 'import' })}>
                    <FileUp /> Import
                  </button>
                  <button type="button" className="secondary" disabled={!deck.concepts.length} onClick={() => setDialog({ kind: 'generate' })}>
                    <Wand2 /> Generate
                  </button>
                </div>
              )}
            </EmptyState>
          ) : (
            <>
              <div className="fc-card-toolbar">
                <label className="search-input">
                  <Search />
                  <span className="sr-only">Search cards</span>
                  <input className="input" type="search" placeholder="Search fronts, backs, hints…" value={query} onChange={(e) => setQuery(e.target.value)} />
                </label>
                <Tabs
                  label="Filter by status"
                  value={status}
                  onChange={setStatus}
                  items={[{ key: 'all' as const, label: 'All', count: counts.all }, ...STATUS_ORDER.map((s) => ({ key: s, label: STATUS_LABELS[s], count: counts[s] }))]}
                />
              </div>
              <DataTable
                rows={visible}
                columns={columns}
                rowKey={(c) => c.id}
                pageSize={12}
                caption={`Cards in ${deck.name}`}
                onRowClick={(c) => setDialog({ kind: 'preview', card: c })}
                empty={query || status !== 'all' ? 'No cards match these filters.' : 'No cards yet.'}
              />
            </>
          )}
        </section>

        <aside className="fc-deck-side">
          <div className="panel flat">
            <div className="panel-head">
              <h2>Your next two weeks</h2>
            </div>
            <ForecastBars days={stats.forecast} now={now} label={`Reviews due in ${deck.name}`} />
          </div>
          <div className="panel flat">
            <div className="panel-head">
              <h2>Card stages</h2>
            </div>
            <StatusBreakdown counts={counts} total={cards.length} />
          </div>
          <ConceptCoverage deck={deck} onGenerate={() => setDialog({ kind: 'generate' })} />
        </aside>
      </div>

      {(dialog?.kind === 'add-card' || dialog?.kind === 'edit-card') && (
        <CardFormModal deckId={deck.id} concepts={deck.concepts} cards={cards} card={dialog.kind === 'edit-card' ? dialog.card : undefined} onSaved={reload} onClose={close} />
      )}
      {dialog?.kind === 'preview' && <CardPreviewModal card={dialog.card} onClose={close} />}
      {dialog?.kind === 'import' && <ImportModal deckId={deck.id} deckName={deck.name} existingFronts={cards.map((c) => c.front)} onImported={reload} onClose={close} />}
      {dialog?.kind === 'edit-deck' && (
        <DeckFormModal
          workspaceId={deck.workspace_id}
          courses={[]}
          decks={[]}
          deck={deck}
          onClose={close}
          onSaved={() => {
            close();
            reload();
          }}
        />
      )}
      {dialog?.kind === 'delete-card' && (
        <ConfirmDialog
          title="Delete this card?"
          message={
            <>
              <b>{truncate(dialog.card.front, 120)}</b> and every learner&apos;s review history for it will be removed.
            </>
          }
          confirmLabel="Delete card"
          busy={busy}
          onConfirm={() => void deleteCard(dialog.card)}
          onCancel={close}
        />
      )}
      {dialog?.kind === 'delete-deck' && (
        <ConfirmDialog
          title={`Delete ${deck.name}?`}
          message={`All ${plural(deck.card_count, 'card')} and everyone's review history in this deck will be permanently removed.`}
          confirmLabel="Delete deck"
          busy={busy}
          onConfirm={() => void deleteDeck()}
          onCancel={close}
        />
      )}
      {dialog?.kind === 'generate' && (
        <ConfirmDialog
          title="Generate cards from concepts?"
          tone="primary"
          message={
            uncovered.length
              ? `LearnLoop will add ${plural(uncovered.length, 'card')}, one for each concept of ${deck.course_title} without a card yet (${uncovered.map((c) => c.name).join(', ')}). Each answer is the concept summary; edit the cards afterwards to sharpen them.`
              : 'Every concept of this course already has at least one card in this deck.'
          }
          confirmLabel="Generate cards"
          busy={busy}
          onConfirm={() => void generate()}
          onCancel={close}
        />
      )}
    </div>
  );
}
