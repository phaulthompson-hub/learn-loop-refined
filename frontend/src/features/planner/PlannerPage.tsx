import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CalendarDays, CalendarRange, ChevronLeft, ChevronRight, Download, List, Plus } from 'lucide-react';
import { useUser, useWorkspace } from '../../app/auth';
import { useNow } from '../../app/clock';
import { useToast } from '../../app/toast';
import { Tabs } from '../../components/Tabs';
import { ErrorBanner, Loading, PageHeader } from '../../components/ui';
import { useLoader } from '../../hooks/useLoader';
import { addDays, dayKey, parseDate, toApiDateTime } from '../../lib/dates';
import { cx } from '../../lib/cx';
import { plural } from '../../lib/format';
import { readJson, writeJson } from '../../lib/storage';
import { plannerApi, saveBlob } from './api';
import { AgendaView } from './AgendaView';
import { AGENDA_DAYS, KIND_LABELS, KINDS, VIEWS, monthMatrix, occurrencesByDay, rangeTitle, shiftAnchor, viewRange, weekDays, type CalendarView } from './calendar';
import { EventDrawer } from './EventDrawer';
import { KindDot, useCourses } from './EventBits';
import { emptyEventForm } from './eventForm';
import { EventModal, type EventModalTarget } from './EventModal';
import { MonthView } from './MonthView';
import { WeekView } from './WeekView';
import type { EventFilters, EventKind, Occurrence } from './types';
import './planner.css';

const PREFS_KEY = 'learnloop.planner.prefs';
const VIEW_ITEMS = [
  { key: 'month' as const, label: 'Month', icon: <CalendarDays aria-hidden /> },
  { key: 'week' as const, label: 'Week', icon: <CalendarRange aria-hidden /> },
  { key: 'agenda' as const, label: 'Agenda', icon: <List aria-hidden /> },
];
const SCOPES: { key: EventFilters['scope']; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'mine', label: 'Mine' },
  { key: 'shared', label: 'Shared' },
];

type Prefs = { view: CalendarView; kinds: EventKind[]; scope: EventFilters['scope'] };

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));
}

/** Calendar of study sessions, reviews, exams, deadlines and live sessions, with recurrence. */
export function PlannerPage() {
  const workspace = useWorkspace();
  const user = useUser();
  const now = useNow();
  const toast = useToast();
  const courses = useCourses(workspace.id);
  const [params, setParams] = useSearchParams();
  const [prefs, setPrefs] = useState<Prefs>(() => readJson<Prefs>(PREFS_KEY, { view: 'month', kinds: [], scope: 'all' }));
  const [courseId, setCourseId] = useState<number | null>(null);
  const [modal, setModal] = useState<EventModalTarget | null>(null);
  const [selected, setSelected] = useState<Occurrence | null>(null);
  const [exporting, setExporting] = useState(false);

  const weekStartsOn = user.week_starts_on;
  const view: CalendarView = VIEWS.includes(params.get('view') as CalendarView) ? (params.get('view') as CalendarView) : prefs.view;
  const dateParam = params.get('date');
  const anchor = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? parseDate(dateParam) : now;
  const filters: EventFilters = { kinds: prefs.kinds, courseId, scope: prefs.scope };
  const { start, end } = viewRange(view, anchor, weekStartsOn);
  const range = { start: toApiDateTime(start), end: toApiDateTime(end) };
  const filterKey = `${prefs.kinds.join(',')}|${courseId ?? ''}|${prefs.scope}`;
  const { data, error, loading, reload } = useLoader(
    () => plannerApi.events(workspace.id, range.start, range.end, filters),
    `events:${workspace.id}:${range.start}:${range.end}:${filterKey}`,
  );

  const matrix = monthMatrix(anchor, weekStartsOn);
  const days =
    view === 'month' ? matrix.flat() : view === 'week' ? weekDays(anchor, weekStartsOn) : Array.from({ length: AGENDA_DAYS }, (_, i) => addDays(start, i));
  const byDay = occurrencesByDay(data?.items ?? [], days);

  const updatePrefs = (patch: Partial<Prefs>) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    writeJson(PREFS_KEY, next);
  };

  const navigate = (nextView: CalendarView, nextAnchor: Date) => {
    const next = new URLSearchParams(params);
    next.set('view', nextView);
    next.set('date', dayKey(nextAnchor));
    next.delete('event');
    setParams(next, { replace: true });
    if (nextView !== prefs.view) updatePrefs({ view: nextView });
  };

  // Deep links (notifications, activity feed) open an event: /planner?date=2022-03-16&event=12
  const linkedEvent = params.get('event');
  const linked = linkedEvent && data ? (data.items.find((item) => String(item.event.id) === linkedEvent) ?? null) : null;
  const open = selected ?? linked;

  const closeDrawer = () => {
    setSelected(null);
    if (params.has('event')) {
      const next = new URLSearchParams(params);
      next.delete('event');
      setParams(next, { replace: true });
    }
  };

  const openCreate = (day: Date, minutes: number | null = null) =>
    setModal({ mode: 'create', form: emptyEventForm(day, minutes ?? 18 * 60, minutes === null && view === 'week') });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target) || document.body.classList.contains('modal-open')) return;
      const actions: Record<string, () => void> = {
        t: () => navigate(view, now),
        n: () => openCreate(anchor),
        j: () => navigate(view, shiftAnchor(view, anchor, 1)),
        k: () => navigate(view, shiftAnchor(view, anchor, -1)),
        m: () => navigate('month', anchor),
        w: () => navigate('week', anchor),
        a: () => navigate('agenda', anchor),
      };
      const action = actions[event.key.toLowerCase()];
      if (!action) return;
      event.preventDefault();
      action();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const toggleKind = (kind: EventKind) =>
    updatePrefs({ kinds: prefs.kinds.includes(kind) ? prefs.kinds.filter((k) => k !== kind) : [...prefs.kinds, kind] });

  const exportIcs = async () => {
    setExporting(true);
    try {
      saveBlob(await plannerApi.exportIcs(workspace.id, prefs.scope === 'mine'), `learnloop-${workspace.slug}.ics`);
      toast.success('Calendar exported. Import the .ics file into Google Calendar, Outlook or Apple Calendar.');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setExporting(false);
    }
  };

  const filtered = prefs.kinds.length > 0 || courseId !== null || prefs.scope !== 'all';

  return (
    <div className="planner-page">
      <PageHeader
        eyebrow="Planner"
        title="Study calendar"
        subtitle={`Your sessions plus everything shared in ${workspace.name}.`}
        aside={
          <div className="actions">
            <button type="button" className="secondary" onClick={exportIcs} disabled={exporting}>
              <Download aria-hidden /> {exporting ? 'Exporting…' : 'Export .ics'}
            </button>
            <button type="button" className="primary" onClick={() => openCreate(anchor)} title="Shortcut: N">
              <Plus aria-hidden /> New event
            </button>
          </div>
        }
      />

      <section className="panel planner-panel">
        <div className="planner-toolbar">
          <div className="planner-nav">
            <button type="button" className="secondary small" onClick={() => navigate(view, now)} title="Shortcut: T">
              Today
            </button>
            <button type="button" className="icon-only" aria-label="Previous" title="Previous (K)" onClick={() => navigate(view, shiftAnchor(view, anchor, -1))}>
              <ChevronLeft />
            </button>
            <button type="button" className="icon-only" aria-label="Next" title="Next (J)" onClick={() => navigate(view, shiftAnchor(view, anchor, 1))}>
              <ChevronRight />
            </button>
            <h2 aria-live="polite">{rangeTitle(view, anchor, weekStartsOn)}</h2>
          </div>
          <Tabs label="Calendar view" items={VIEW_ITEMS} value={view} onChange={(next) => navigate(next, anchor)} />
        </div>

        <div className="planner-filters" role="group" aria-label="Filters">
          <div className="kind-filters">
            {KINDS.map((kind) => (
              <button
                key={kind}
                type="button"
                className={cx('kind-toggle', `kind-${kind}`, prefs.kinds.includes(kind) && 'active')}
                aria-pressed={prefs.kinds.includes(kind)}
                onClick={() => toggleKind(kind)}
              >
                <KindDot kind={kind} />
                {KIND_LABELS[kind]}
              </button>
            ))}
          </div>
          <select className="input" aria-label="Course" value={courseId ?? ''} onChange={(e) => setCourseId(e.target.value ? Number(e.target.value) : null)}>
            <option value="">All courses</option>
            {courses.map((course) => (
              <option key={course.id} value={course.id}>
                {course.title}
              </option>
            ))}
          </select>
          <Tabs label="Whose events" items={SCOPES} value={prefs.scope} onChange={(scope) => updatePrefs({ scope })} />
          {filtered && (
            <button
              type="button"
              className="ghost small"
              onClick={() => {
                setCourseId(null);
                updatePrefs({ kinds: [], scope: 'all' });
              }}
            >
              Clear filters
            </button>
          )}
          <span className="planner-count muted" aria-live="polite">
            {loading ? 'Loading…' : data ? plural(data.total, 'item') : ''}
          </span>
        </div>

        {error && <ErrorBanner message={error} onRetry={reload} />}
        {!data && loading ? (
          <Loading label="Loading your calendar…" />
        ) : (
          <div className={cx('planner-body', loading && 'is-refreshing')}>
            {view === 'month' && (
              <MonthView
                key={dayKey(anchor).slice(0, 7)}
                matrix={matrix}
                anchor={anchor}
                now={now}
                weekStartsOn={weekStartsOn}
                byDay={byDay}
                onSelect={setSelected}
                onCreate={(day) => openCreate(day)}
              />
            )}
            {view === 'week' && <WeekView days={days} now={now} byDay={byDay} onSelect={setSelected} onCreate={openCreate} />}
            {view === 'agenda' && <AgendaView days={days} now={now} byDay={byDay} onSelect={setSelected} onCreate={(day) => openCreate(day)} />}
          </div>
        )}
        <p className="planner-shortcuts muted">
          Shortcuts: <kbd>T</kbd> today · <kbd>J</kbd>/<kbd>K</kbd> next/previous · <kbd>M</kbd> <kbd>W</kbd> <kbd>A</kbd> views · <kbd>N</kbd> new event. Times are in UTC.
        </p>
      </section>

      {open && (
        <EventDrawer
          item={open}
          onClose={closeDrawer}
          onEdit={(event) => {
            closeDrawer();
            setModal({ mode: 'edit', event });
          }}
          onDeleted={() => {
            closeDrawer();
            reload();
          }}
        />
      )}
      {modal && (
        <EventModal
          workspaceId={workspace.id}
          target={modal}
          courses={courses}
          canAnnounce={workspace.can('instructor')}
          onClose={() => setModal(null)}
          onSaved={(saved) => {
            toast.success(modal.mode === 'edit' ? `Saved “${saved.event.title}”` : `Added “${saved.event.title}” to your planner`);
            reload();
          }}
        />
      )}
    </div>
  );
}
