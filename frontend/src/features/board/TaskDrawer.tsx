import { useState } from 'react';
import { Link2, Pencil, Search, Trash2 } from 'lucide-react';
import type { Person } from '../../app/types';
import { useNow } from '../../app/clock';
import { useToast } from '../../app/toast';
import { ConfirmDialog, Modal } from '../../components/Modal';
import { Tabs } from '../../components/Tabs';
import { EmptyState, Loading } from '../../components/ui';
import { useLoader } from '../../hooks/useLoader';
import { formatDateTime, relativeTime } from '../../lib/format';
import { boardApi } from './api';
import { applyPatch, PRIORITIES, PRIORITY_LABELS, STATUS_LABELS, STATUSES, summarize, type PatchLookups } from './board';
import { ChecklistPanel } from './ChecklistPanel';
import { CommentThread } from './CommentThread';
import { LabelPicker } from './LabelPicker';
import { DueBadge, Markup } from './TaskBits';
import { DESCRIPTION_MAX, ESTIMATE_MAX, TITLE_MAX, validateEstimate, validateTitle } from './validation';
import type { BoardMember, CourseBrief, Label, Task, TaskDetail, TaskPatch, TaskPriority, TaskStatus } from './types';

type TaskDrawerProps = {
  workspaceId: number;
  number: number;
  members: BoardMember[];
  labels: Label[];
  courses: CourseBrief[];
  canManageLabels: boolean;
  me: Person;
  onClose: () => void;
  onChanged: (task: Task) => void;
  onDeleted: (taskId: number) => void;
  onLabelCreated: (label: Label) => void;
};

function InlineTitle({ value, onSave }: { value: string; onSave: (title: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const error = draft === null ? undefined : validateTitle(draft);

  const commit = () => {
    if (draft === null) return;
    if (!error && draft.trim() !== value) onSave(draft.trim());
    setDraft(null);
  };

  if (draft === null) {
    return (
      <button type="button" className="drawer-title" title="Click to edit the title" onClick={() => setDraft(value)}>
        {value}
        <Pencil aria-hidden />
      </button>
    );
  }
  return (
    <div className="field drawer-title-edit">
      <input
        className="input"
        autoFocus
        value={draft}
        maxLength={TITLE_MAX}
        aria-label="Task title"
        aria-invalid={error ? true : undefined}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit();
          if (event.key === 'Escape') {
            event.stopPropagation();
            setDraft(null);
          }
        }}
      />
      {error && <small className="field-error">{error} Press Esc to cancel.</small>}
    </div>
  );
}

function DescriptionEditor({ value, onSave }: { value: string; onSave: (description: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const [tab, setTab] = useState<'write' | 'preview'>('write');

  if (draft === null) {
    return value ? (
      <div className="description-view">
        <Markup source={value} />
        <button type="button" className="ghost small" onClick={() => setDraft(value)}>
          <Pencil /> Edit description
        </button>
      </div>
    ) : (
      <button type="button" className="description-empty" onClick={() => setDraft('')}>
        Add a description: goals, resources, what “done” means…
      </button>
    );
  }
  const tooLong = draft.length > DESCRIPTION_MAX;
  return (
    <div className="description-edit">
      <div className="row">
        <Tabs
          label="Description editor"
          value={tab}
          onChange={setTab}
          items={[
            { key: 'write', label: 'Write' },
            { key: 'preview', label: 'Preview' },
          ]}
        />
        <span className="spacer" />
        <small className={tooLong ? 'field-error' : 'muted'}>
          {draft.length}/{DESCRIPTION_MAX}
        </small>
      </div>
      {tab === 'write' ? (
        <textarea
          className="input"
          rows={7}
          autoFocus
          value={draft}
          aria-label="Description"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return;
            event.stopPropagation();
            setDraft(null);
          }}
        />
      ) : (
        <div className="description-preview">{draft.trim() ? <Markup source={draft} /> : <p className="muted">Nothing to preview.</p>}</div>
      )}
      <small className="hint">{'**bold**, *italic*, `code`, # heading, - bullet and 1. numbered lists.'}</small>
      <div className="actions">
        <button
          type="button"
          className="primary small"
          disabled={tooLong}
          onClick={() => {
            onSave(draft.trim());
            setDraft(null);
          }}
        >
          Save
        </button>
        <button type="button" className="ghost small" onClick={() => setDraft(null)}>
          Cancel
        </button>
      </div>
    </div>
  );
}

