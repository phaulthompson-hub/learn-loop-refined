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

