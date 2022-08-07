import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { FilePlus2, FileEdit } from 'lucide-react';
import { useWorkspace } from '../../app/auth';
import { ConfirmDialog } from '../../components/Modal';
import { EmptyState } from '../../components/ui';
import { useLoader } from '../../hooks/useLoader';
import { cx } from '../../lib/cx';
import { plural } from '../../lib/format';
import { readJson, writeJson } from '../../lib/storage';
import { useDebouncedValue } from '../search/useDebouncedValue';
import { courseOptions, notesApi } from './api';
import { NoteEditor, type EditorGuard } from './NoteEditor';
import { NoteList } from './NoteList';
import type { Note, NoteFilters, NoteSort, NoteTab, NoteTitle, TagCount } from './types';
import { useNoteList } from './useNoteList';
import './notes.css';

const DEFAULT_FILTERS: NoteFilters = { tab: 'mine', q: '', tag: null, courseId: null, sort: 'updated_at' };
const viewKey = (workspaceId: number) => `learnloop.notes.view.${workspaceId}`;

/** The tab and sort order are remembered per workspace; searches and tag filters are not. */
function loadFilters(workspaceId: number): NoteFilters {
  const stored = readJson<{ tab?: NoteTab; sort?: NoteSort }>(viewKey(workspaceId), {});
  return {
    ...DEFAULT_FILTERS,
    tab: stored.tab && ['mine', 'shared', 'archived'].includes(stored.tab) ? stored.tab : 'mine',
    sort: stored.sort && ['updated_at', 'created_at', 'title'].includes(stored.sort) ? stored.sort : 'updated_at',
  };
}

function parseNoteId(param: string | undefined): number | 'new' | 'invalid' | null {
  if (param === undefined) return null;
  if (param === 'new') return 'new';
  return /^\d+$/.test(param) ? Number(param) : 'invalid';
}

/** Tags and titles for the whole workspace, refreshed quietly (old values stay while reloading). */
function useWorkspaceNoteMeta(workspaceId: number, version: number) {
  const [meta, setMeta] = useState<{ tags: TagCount[]; titles: NoteTitle[] }>({ tags: [], titles: [] });
  useEffect(() => {
    let cancelled = false;
    Promise.all([notesApi.tags(workspaceId), notesApi.titles(workspaceId)])
      .then(([tags, titles]) => !cancelled && setMeta({ tags, titles }))
      .catch(() => undefined); // The list shows its own error; tags and titles are an enhancement.
    return () => {
      cancelled = true;
    };
  }, [workspaceId, version]);
  return meta;
}

export function NotesPage() {
  const workspace = useWorkspace();
  const navigate = useNavigate();
  const { noteId: param } = useParams();
  const [searchParams] = useSearchParams();
  const noteId = parseNoteId(param);

  const [filters, setFilters] = useState<NoteFilters>(() => loadFilters(workspace.id));
  const [searchText, setSearchText] = useState('');
  const debouncedSearch = useDebouncedValue(searchText, 250);
  const effectiveFilters = { ...filters, q: debouncedSearch };
  const list = useNoteList(workspace.id, effectiveFilters);
  const [version, setVersion] = useState(0);
  const meta = useWorkspaceNoteMeta(workspace.id, version);
  const courses = useLoader(() => courseOptions(workspace.id), `note-courses:${workspace.id}`);
  const guard = useRef<EditorGuard | null>(null);
  const registerGuard = useCallback((next: EditorGuard | null) => {
    guard.current = next;
  }, []);
  const [pendingNavigation, setPendingNavigation] = useState<string | null>(null);

  // Editor identity: a brand-new note keeps its editor (and caret) after the first save moves the
  // URL from /notes/new to /notes/{id}; every other change of note gets a fresh editor.
  const [route, setRoute] = useState(param);
  const [draftCount, setDraftCount] = useState(0);
  const [adopted, setAdopted] = useState<{ id: number; key: string } | null>(null);
  if (route !== param) {
    setRoute(param);
    if (param === 'new') setDraftCount((count) => count + 1);
  }
  const editorKey = noteId === 'new' ? `new-${draftCount}` : adopted && adopted.id === noteId ? adopted.key : `note-${noteId}`;

  const { refresh } = list;
  const refreshAll = useCallback(() => {
    refresh();
    setVersion((v) => v + 1);
  }, [refresh]);

  const updateFilters = (patch: Partial<NoteFilters>) => {
    setFilters((current) => {
      const next = { ...current, ...patch };
      writeJson(viewKey(workspace.id), { tab: next.tab, sort: next.sort });
      return next;
    });
  };

  /** Navigate after the open editor has saved; if saving fails, ask before throwing changes away. */
  const open = async (to: string) => {
    const current = guard.current;
    if (current?.isDirty() && !(await current.flush())) {
      setPendingNavigation(to);
      return;
    }
    navigate(to);
  };

  const onCreated = (note: Note) => {
    setAdopted({ id: note.id, key: editorKey });
    navigate(`/notes/${note.id}`, { replace: true });
    refreshAll();
  };

  const onRemoved = () => {
    navigate('/notes');
    refreshAll();
  };

  const counts = list.counts;
  const initialCourse = Number(searchParams.get('course')) || null;

  return (
    <div className={cx('notes-layout', noteId === null ? 'show-list' : 'show-editor')}>
      <div className="notes-list-pane">
        <NoteList
          filters={effectiveFilters}
          searchText={searchText}
          onSearchText={setSearchText}
          onFilters={updateFilters}
          items={list.items}
          total={list.total}
          counts={counts}
          loading={list.loading}
          loadingMore={list.loadingMore}
          error={list.error}
          tags={meta.tags}
          courses={courses.data ?? []}
          activeId={typeof noteId === 'number' ? noteId : null}
          onOpen={(id) => void open(`/notes/${id}`)}
          onNew={() => void open('/notes/new')}
          onRetry={list.refresh}
          onLoadMore={list.loadMore}
        />
      </div>
      <section className="notes-editor-pane" aria-label="Note">
        {noteId === null ? (
          <EmptyState icon={<FileEdit />} title="Pick a note, or start a new one">
            <p>
              {counts ? `${plural(counts.mine, 'note')} of yours and ${plural(counts.shared, 'shared note')} from teammates. ` : ''}
              Link ideas with <code>[[Note title]]</code>, tick off <code>- [ ] tasks</code>, and share what helps the group.
            </p>
            <button type="button" className="primary" onClick={() => void open('/notes/new')}>
              <FilePlus2 /> New note
            </button>
          </EmptyState>
        ) : noteId === 'invalid' ? (
          <EmptyState icon={<FileEdit />} title="That is not a note address">
            <p>Choose a note from the list instead.</p>
          </EmptyState>
        ) : (
          <NoteEditor
            key={editorKey}
            noteId={noteId}
            workspaceId={workspace.id}
            titles={meta.titles}
            courses={courses.data ?? []}
            tagSuggestions={meta.tags.map((t) => t.tag)}
            initialTitle={searchParams.get('title')?.slice(0, 160) ?? ''}
            initialCourseId={initialCourse}
            onGuard={registerGuard}
            onCreated={onCreated}
            onChanged={refreshAll}
            onRemoved={onRemoved}
            onOpen={(to) => void open(to)}
            onBack={() => void open('/notes')}
          />
        )}
      </section>
      {pendingNavigation && (
        <ConfirmDialog
          title="Leave without saving?"
          message="Your latest changes to this note could not be saved. Leave anyway and lose them, or stay to fix the problem."
          confirmLabel="Discard changes"
          onConfirm={() => {
            const to = pendingNavigation;
            guard.current = null;
            setPendingNavigation(null);
            navigate(to);
          }}
          onCancel={() => setPendingNavigation(null)}
        />
      )}
    </div>
  );
}
