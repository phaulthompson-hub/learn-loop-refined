import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  ArchiveRestore,
  ArrowLeft,
  Check,
  Copy,
  Files,
  Eye,
  FileQuestion,
  Loader2,
  MoreHorizontal,
  Edit3,
  Pin,
  PinOff,
  Share2,
  Columns,
  Trash2,
} from 'lucide-react';
import { useNow } from '../../app/clock';
import { useToast } from '../../app/toast';
import { Avatar } from '../../components/Avatar';
import { Menu, type MenuItem } from '../../components/Menu';
import { ConfirmDialog } from '../../components/Modal';
import { Tabs } from '../../components/Tabs';
import { EmptyState, ErrorBanner, Loading } from '../../components/ui';
import { useLoader } from '../../hooks/useLoader';
import { ApiError } from '../../lib/http';
import { cx } from '../../lib/cx';
import { formatDateTime, formatNumber, relativeTime } from '../../lib/format';
import { readStorage, writeStorage } from '../../lib/storage';
import { conceptOptions, notesApi } from './api';
import { countWords, readingMinutes } from './editor';
import { buildTitleIndex, normaliseTitle } from './links';
import { MarkdownEditor, type EditorMode } from './MarkdownEditor';
import { MarkdownView, noteHref } from './MarkdownView';
import { BODY_MAX, diffDraft, draftFromNote, emptyDraft, hasErrors, isDirty, TITLE_MAX, validateDraft } from './noteForm';
import { NoteSidebar } from './NoteSidebar';
import { TagInput } from './TagInput';
import type { CourseOption, Note, NoteDraft, NoteTitle } from './types';

const AUTOSAVE_MS = 900;
const MODE_KEY = 'learnloop.notes.mode';
const MODES: EditorMode[] = ['write', 'split', 'preview'];

/** Lets the page ask the open editor to save before it navigates away. */
export type EditorGuard = { isDirty: () => boolean; flush: () => Promise<boolean> };

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export type NoteEditorProps = {
  noteId: number | 'new';
  workspaceId: number;
  titles: NoteTitle[];
  courses: CourseOption[];
  tagSuggestions: string[];
  initialTitle: string;
  initialCourseId: number | null;
  /** Receives the save-before-leaving hooks while this editor is open (null when it closes). */
  onGuard: (guard: EditorGuard | null) => void;
  onCreated: (note: Note) => void;
  onChanged: (note: Note) => void;
  onRemoved: (id: number) => void;
  onOpen: (to: string) => void;
  onBack: () => void;
};

/** Right pane: loads the note (unless it is new) and hands it to the form. */
export function NoteEditor(props: NoteEditorProps) {
  // The id the pane was opened with. A new note keeps this editor after its first save.
  const [sessionId] = useState(props.noteId);
  if (sessionId === 'new') return <NoteForm {...props} initial={null} />;
  return <LoadedNote {...props} id={sessionId} />;
}

function LoadedNote({ id, ...props }: NoteEditorProps & { id: number }) {
  const { data, error, loading, reload } = useLoader(() => notesApi.get(id), `note:${id}`);
  if (loading && !data) return <Loading label="Opening note…" />;
  if (!data) {
    return (
      <div className="note-pane">
        <div className="note-head">
          <button type="button" className="ghost small notes-back" onClick={props.onBack}>
            <ArrowLeft /> Notes
          </button>
        </div>
        {error?.includes('not found') ? (
          <EmptyState icon={<FileQuestion />} title="This note is not available">
            <p>It may have been deleted, archived by its author, or never shared with you.</p>
          </EmptyState>
        ) : (
          <ErrorBanner message={error ?? 'Could not open this note'} onRetry={reload} />
        )}
      </div>
    );
  }
  return <NoteForm {...props} initial={data} />;
}

function SaveStatus({ state, dirty, invalid, error, savedAt, onRetry }: { state: SaveState; dirty: boolean; invalid: string | null; error: string | null; savedAt: string | null; onRetry: () => void }) {
  const now = useNow();
  let content;
  if (state === 'saving') content = <><Loader2 className="spin" /> Saving…</>;
  else if (dirty && invalid) content = <><AlertTriangle /> {invalid}</>;
  else if (state === 'error')
    content = (
      <>
        <AlertTriangle /> Not saved: {error}
        <button type="button" className="ghost small" onClick={onRetry}>
          Retry
        </button>
      </>
    );
  else if (dirty) content = <>Unsaved changes</>;
  else if (state === 'saved' || state === 'idle') content = <><Check /> {savedAt ? `Saved ${relativeTime(savedAt, now)}` : 'Saved'}</>;
  return (
    <span className={cx('save-status', state === 'error' && 'is-error', dirty && invalid && 'is-warn')} role="status" aria-live="polite">
      {content}
    </span>
  );
}

function NoteForm({ initial, ...props }: NoteEditorProps & { initial: Note | null }) {
  const toast = useToast();
  const now = useNow();
  const titleId = useId();
  const bodyHintId = useId();
  const [note, setNote] = useState<Note | null>(initial);
  const [startDraft] = useState<NoteDraft>(() => (initial ? draftFromNote(initial) : emptyDraft(props.initialTitle, props.initialCourseId)));
  const [draft, setDraft] = useState(startDraft);
  const [saved, setSaved] = useState(startDraft);
  const [saveState, setSaveState] = useState<SaveState>(initial ? 'saved' : 'idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [titleTouched, setTitleTouched] = useState(false);
  const [mode, setModeState] = useState<EditorMode>(() => {
    const stored = readStorage(MODE_KEY) as EditorMode | null;
    return stored && MODES.includes(stored) ? stored : 'write';
  });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  // Refs hold the latest values for the autosave timer and the navigation guard.
  const noteRef = useRef(note);
  const savedRef = useRef(saved);
  const draftRef = useRef(draft);
  const handlers = useRef(props);
  const inFlight = useRef<Promise<boolean> | null>(null);
  useEffect(() => {
    draftRef.current = draft;
    handlers.current = props;
  });

  const readOnly = note !== null && !note.can_edit;
  const errors = validateDraft(draft);
  const dirty = !readOnly && isDirty(saved, draft);
  const invalidMessage = errors.title ? (draft.title.trim() ? errors.title : 'Add a title to save') : (errors.body ?? errors.tags ?? null);

  const save = useCallback(async (): Promise<boolean> => {
    if (inFlight.current) await inFlight.current;
    const snapshot = draftRef.current;
    const current = noteRef.current;
    const patch = diffDraft(savedRef.current, snapshot);
    if (current && !Object.keys(patch).length) return true;
    if (hasErrors(validateDraft(snapshot))) return false;
    setSaveState('saving');
    const request = (async () => {
      try {
        const result = current
          ? await notesApi.update(current.id, patch)
          : await notesApi.create(handlers.current.workspaceId, { ...snapshot, title: snapshot.title.trim() });
        savedRef.current = snapshot;
        noteRef.current = result;
        setSaved(snapshot);
        setNote(result);
        setSaveError(null);
        setSaveState('saved');
        if (current) handlers.current.onChanged(result);
        else handlers.current.onCreated(result);
        return true;
      } catch (err) {
        setSaveState('error');
        setSaveError(err instanceof ApiError && err.status === 0 ? 'you appear to be offline' : (err as Error).message);
        return false;
      }
    })();
    inFlight.current = request;
    const ok = await request;
    inFlight.current = null;
    return ok;
  }, []);

  // Debounced autosave after every change.
  useEffect(() => {
    if (readOnly || !isDirty(savedRef.current, draft) || hasErrors(validateDraft(draft))) return;
    const timer = window.setTimeout(() => void save(), AUTOSAVE_MS);
    return () => window.clearTimeout(timer);
  }, [draft, readOnly, save]);

  useEffect(() => {
    const { onGuard } = handlers.current;
    onGuard({ isDirty: () => !readOnly && isDirty(savedRef.current, draftRef.current), flush: save });
    return () => onGuard(null);
  }, [readOnly, save]);

  // Warn before closing the tab with unsaved work, and save what we can when the editor goes away.
  useEffect(() => {
    if (!dirty) return;
    const onUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [dirty]);
  useEffect(
    () => () => {
      if (isDirty(savedRef.current, draftRef.current)) void save();
    },
    [save],
  );

  const titleIndex = useMemo(() => buildTitleIndex(props.titles), [props.titles]);
  const concepts = useLoader(
    () => (draft.course_id ? conceptOptions(draft.course_id) : Promise.resolve([])),
    `concepts:${draft.course_id ?? 'none'}`,
  );

  const update = (patch: Partial<NoteDraft>) => setDraft((current) => ({ ...current, ...patch }));
  const setMode = (next: EditorMode) => {
    setModeState(next);
    writeStorage(MODE_KEY, next);
  };

  const resolveLink = (target: string, heading: string | null) => {
    const entry = titleIndex.get(normaliseTitle(target));
    return { href: entry ? noteHref(entry.id, heading) : null };
  };

  const createLinked = (title: string) => {
    const course = draft.course_id ? `&course=${draft.course_id}` : '';
    props.onOpen(`/notes/new?title=${encodeURIComponent(title)}${course}`);
  };

  const act = async (label: string, run: () => Promise<Note>) => {
    setBusy(true);
    try {
      const result = await run();
      noteRef.current = result;
      setNote(result);
      props.onChanged(result);
      toast.success(label);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const duplicate = async () => {
    if (!note) return;
    if (dirty && !(await save())) return;
    try {
      const copy = await notesApi.duplicate(note.id);
      toast.success(`Copied to “${copy.title}”`);
      props.onChanged(copy);
      props.onOpen(`/notes/${copy.id}`);
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const remove = async () => {
    if (!note) return;
    setBusy(true);
    try {
      await notesApi.remove(note.id);
      savedRef.current = draftRef.current; // nothing left to save
      toast.success(`Deleted “${note.title}”`);
      props.onRemoved(note.id);
    } catch (err) {
      toast.error((err as Error).message);
      setBusy(false);
      setConfirmDelete(false);
    }
  };

  const copyLink = () => {
    const title = (note?.title ?? draft.title).trim();
    void navigator.clipboard?.writeText(`[[${title}]]`).then(
      () => toast.info(`Copied [[${title}]]; paste it into another note to link here.`),
      () => toast.error('Could not copy to the clipboard'),
    );
  };

  const words = countWords(draft.body);
  const minutes = readingMinutes(words);
  const modeTabs = [
    { key: 'write' as EditorMode, label: 'Write', icon: <Edit3 /> },
    { key: 'split' as EditorMode, label: 'Split', icon: <Columns /> },
    { key: 'preview' as EditorMode, label: 'Preview', icon: <Eye /> },
  ];

  const menuItems: MenuItem[] = note
    ? [
        { label: 'Copy [[link]]', icon: <Copy />, onSelect: copyLink },
        { label: note.can_edit ? 'Duplicate' : 'Make a copy', icon: <Files />, onSelect: () => void duplicate() },
        ...(note.can_edit
          ? ([
              {
                label: note.archived ? 'Restore' : 'Archive',
                icon: note.archived ? <ArchiveRestore /> : <Archive />,
                onSelect: () => void act(note.archived ? 'Note restored' : 'Note archived', () => notesApi.archive(note.id, !note.archived)),
              },
              'separator',
              { label: 'Delete…', icon: <Trash2 />, danger: true, onSelect: () => setConfirmDelete(true) },
            ] as MenuItem[])
          : []),
      ]
    : [];

  const head = (
    <header className="note-head">
      <button type="button" className="ghost small notes-back" onClick={props.onBack}>
        <ArrowLeft /> Notes
      </button>
      {readOnly ? (
        <span className="badge info">
          <Share2 /> Shared by {note!.author.name}
        </span>
      ) : (
        <SaveStatus state={saveState} dirty={dirty} invalid={invalidMessage} error={saveError} savedAt={note?.updated_at ?? null} onRetry={() => void save()} />
      )}
      <span className="spacer" />
      {!readOnly && <Tabs label="Editor mode" items={modeTabs} value={mode} onChange={setMode} />}
      {note?.can_edit && (
        <>
          <button
            type="button"
            className={cx('icon-only note-flag', note.pinned && 'on')}
            aria-pressed={note.pinned}
            aria-label={note.pinned ? 'Unpin note' : 'Pin note'}
            title={note.archived ? 'Restore the note to pin it' : note.pinned ? 'Unpin' : 'Pin to the top of your list'}
            disabled={busy || note.archived}
            onClick={() => void act(note.pinned ? 'Unpinned' : 'Pinned to the top', () => notesApi.pin(note.id, !note.pinned))}
          >
            {note.pinned ? <PinOff /> : <Pin />}
          </button>
          <button
            type="button"
            className={cx('secondary small note-share', note.shared && 'on')}
            aria-pressed={note.shared}
            disabled={busy}
            title={note.shared ? 'Everyone in the workspace can read this note' : 'Only you can see this note'}
            onClick={() => void act(note.shared ? 'Note is private again' : 'Shared with the workspace', () => notesApi.update(note.id, { shared: !note.shared }))}
          >
            <Share2 /> {note.shared ? 'Shared' : 'Share'}
          </button>
        </>
      )}
      {note && (
        <Menu
          items={menuItems}
          trigger={({ toggle, ref, open }) => (
            <button type="button" ref={ref} className="icon-only" aria-label="More note actions" aria-haspopup="menu" aria-expanded={open} onClick={toggle}>
              <MoreHorizontal />
            </button>
          )}
        />
      )}
    </header>
  );

  const sidebar = (
    <NoteSidebar
      note={note}
      body={draft.body}
      showOutline={readOnly || mode !== 'write'}
      onOpen={props.onOpen}
      onCreateLinked={readOnly ? null : createLinked}
    />
  );

  if (readOnly && note) {
    return (
      <div className="note-pane">
        {head}
        <div className="note-grid">
          <article className="note-main note-reader">
            <h1 className="note-reader-title">{note.title}</h1>
            <p className="note-byline">
              <Avatar name={note.author.name} color={note.author.avatar_color} size="xs" />
              {note.author.name} · updated {relativeTime(note.updated_at, now)}
              {note.course && ` · ${note.course.title}`}
              {note.concept && ` › ${note.concept.name}`}
            </p>
            {note.tags.length > 0 && (
              <p className="note-reader-tags">
                {note.tags.map((tag) => (
                  <span key={tag} className="tag">
                    #{tag}
                  </span>
                ))}
              </p>
            )}
            <MarkdownView source={note.body} resolveLink={resolveLink} />
            <div className="note-reader-foot">
              <span className="muted">
                {formatNumber(words)} words · {minutes} min read
              </span>
              <button type="button" className="secondary small" onClick={() => void duplicate()}>
                <Files /> Make a copy to edit
              </button>
            </div>
          </article>
          {sidebar}
        </div>
      </div>
    );
  }

  return (
    <div className="note-pane">
      {head}
      {note?.archived && (
        <div className="note-banner">
          <Archive /> This note is archived. It is hidden from teammates and your main list.
          <button type="button" className="ghost small" disabled={busy} onClick={() => void act('Note restored', () => notesApi.archive(note.id, false))}>
            Restore
          </button>
        </div>
      )}
      <div className="note-grid">
        <div className="note-main">
          <label htmlFor={titleId} className="sr-only">
            Title
          </label>
          <input
            id={titleId}
            className={cx('note-title-input', titleTouched && errors.title && 'invalid')}
            value={draft.title}
            maxLength={TITLE_MAX + 20}
            placeholder="Untitled note"
            autoFocus={!initial && !draft.title}
            aria-invalid={titleTouched && errors.title ? true : undefined}
            onChange={(event) => update({ title: event.target.value })}
            onBlur={() => setTitleTouched(true)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                event.currentTarget.closest('.note-main')?.querySelector('textarea')?.focus();
              }
            }}
          />
          {titleTouched && errors.title && <small className="field-error">{errors.title}</small>}
          <div className="note-meta">
            <select
              className="input"
              aria-label="Course"
              value={draft.course_id ?? ''}
              onChange={(event) => update({ course_id: event.target.value ? Number(event.target.value) : null, concept_id: null })}
            >
              <option value="">No course</option>
              {props.courses.map((course) => (
                <option key={course.id} value={course.id}>
                  {course.title}
                  {course.status === 'draft' ? ' (draft)' : ''}
                </option>
              ))}
            </select>
            <select
              className="input"
              aria-label="Concept"
              value={draft.concept_id ?? ''}
              disabled={!draft.course_id || concepts.loading}
              onChange={(event) => update({ concept_id: event.target.value ? Number(event.target.value) : null })}
            >
              <option value="">{draft.course_id ? (concepts.loading ? 'Loading concepts…' : 'Any concept') : 'Pick a course first'}</option>
              {(concepts.data ?? []).map((concept) => (
                <option key={concept.id} value={concept.id}>
                  {concept.name}
                </option>
              ))}
            </select>
            <TagInput tags={draft.tags} suggestions={props.tagSuggestions} onChange={(tags) => update({ tags })} />
          </div>
          <MarkdownEditor
            value={draft.body}
            onChange={(body) => update({ body })}
            mode={mode}
            titles={props.titles}
            noteId={note?.id ?? null}
            resolveLink={resolveLink}
            onMissingLink={createLinked}
            onSaveNow={() => void save()}
            invalid={!!errors.body}
            describedBy={bodyHintId}
          />
          <footer className="note-foot" id={bodyHintId}>
            <span>
              {formatNumber(words)} words · {minutes ? `${minutes} min read` : 'empty'}
            </span>
            <span className={cx(draft.body.length > BODY_MAX && 'bad')}>
              {formatNumber(draft.body.length)} / {formatNumber(BODY_MAX)} characters
            </span>
            {note && <span className="muted">Created {formatDateTime(note.created_at)}</span>}
            <span className="note-foot-keys">
              <kbd>Ctrl B</kbd> <kbd>Ctrl I</kbd> <kbd>Ctrl S</kbd> <kbd>[[</kbd> link
            </span>
          </footer>
        </div>
        {sidebar}
      </div>
      {confirmDelete && note && (
        <ConfirmDialog
          title="Delete this note?"
          message={
            <>
              “{note.title}” will be deleted for good.{note.backlinks > 0 && ` ${note.backlinks} other note(s) link here; those links will show as missing.`}
            </>
          }
          confirmLabel="Delete note"
          busy={busy}
          onConfirm={() => void remove()}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </div>
  );
}
