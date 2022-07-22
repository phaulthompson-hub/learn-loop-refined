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

function EstimateInput({ value, onSave }: { value: number | null; onSave: (estimate: number | null) => void }) {
  const [draft, setDraft] = useState(value === null ? '' : String(value));
  const error = validateEstimate(draft);
  const commit = () => {
    const next = draft.trim() ? Number(draft) : null;
    if (!error && next !== value) onSave(next);
  };
  return (
    <>
      <input
        className="input"
        type="number"
        inputMode="numeric"
        min={0}
        max={ESTIMATE_MAX}
        value={draft}
        aria-label="Estimate in points"
        aria-invalid={error ? true : undefined}
        placeholder="—"
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => event.key === 'Enter' && commit()}
      />
      {error && <small className="field-error">{error}</small>}
    </>
  );
}

/** Everything about one task in a side drawer; addressable as /board?task=<number>. */
export function TaskDrawer({ workspaceId, number, members, labels, courses, canManageLabels, me, onClose, onChanged, onDeleted, onLabelCreated }: TaskDrawerProps) {
  const now = useNow();
  const toast = useToast();
  const loader = useLoader(() => boardApi.byNumber(workspaceId, number), `task:${workspaceId}:${number}`);
  const [local, setLocal] = useState<{ source: TaskDetail | null; detail: TaskDetail | null }>({ source: null, detail: null });
  if (loader.data && loader.data !== local.source) setLocal({ source: loader.data, detail: loader.data });
  const detail = local.detail;
  const [confirming, setConfirming] = useState(false);
  // A nested confirmation (task or comment delete) owns Escape; the drawer must not close underneath it.
  const [commentDialog, setCommentDialog] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const lookups: PatchLookups = { members, courses, labels };

  const commit = (next: TaskDetail) => {
    setLocal((l) => ({ ...l, detail: next }));
    onChanged(summarize(next));
  };

  const save = async (patch: TaskPatch) => {
    if (!detail) return;
    const previous = detail;
    commit(applyPatch(detail, patch, lookups));
    try {
      commit(await boardApi.update(detail.id, patch));
    } catch (err) {
      commit(previous);
      toast.error((err as Error).message);
    }
  };

  const remove = async () => {
    if (!detail) return;
    setDeleting(true);
    try {
      await boardApi.remove(detail.id);
      toast.success(`Deleted ${detail.key}`);
      onDeleted(detail.id);
    } catch (err) {
      toast.error((err as Error).message);
      setDeleting(false);
      setConfirming(false);
    }
  };

  const copyLink = () => {
    const url = `${window.location.origin}/board?task=${number}`;
    navigator.clipboard?.writeText(url).then(
      () => toast.success('Link copied'),
      () => toast.error('Could not copy the link'),
    );
  };

  const title = detail ? (
    <span className="drawer-heading">
      <span className="task-key">{detail.key}</span>
      <span className={`task-status-pill task-status-${detail.status}`}>{STATUS_LABELS[detail.status]}</span>
    </span>
  ) : (
    'Task'
  );

  return (
    <Modal
      variant="drawer"
      title={title}
      onClose={confirming || commentDialog ? () => undefined : onClose}
      footer={
        detail && (
          <>
            <button type="button" className="ghost small" onClick={copyLink}>
              <Link2 /> Copy link
            </button>
            <span className="spacer" />
            {detail.can_delete && (
              <button type="button" className="danger small" onClick={() => setConfirming(true)}>
                <Trash2 /> Delete task
              </button>
            )}
          </>
        )
      }
    >
      {!detail && loader.loading && <Loading label="Loading task…" />}
      {!detail && loader.error && (
        <EmptyState icon={<Search />} title={`Task #${number} is not available`}>
          <p>{loader.error}. It may have been deleted, or it belongs to another workspace.</p>
          <button type="button" className="secondary" onClick={loader.reload}>
            Try again
          </button>
        </EmptyState>
      )}
      {detail && (
        <div className="task-drawer">
          <InlineTitle key={detail.title} value={detail.title} onSave={(value) => void save({ title: value })} />

          <dl className="task-fields">
            <div>
              <dt>Status</dt>
              <dd>
                <select className="input" aria-label="Status" value={detail.status} onChange={(event) => void save({ status: event.target.value as TaskStatus })}>
                  {STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {STATUS_LABELS[status]}
                    </option>
                  ))}
                </select>
              </dd>
            </div>
            <div>
              <dt>Priority</dt>
              <dd>
                <select className="input" aria-label="Priority" value={detail.priority} onChange={(event) => void save({ priority: event.target.value as TaskPriority })}>
                  {PRIORITIES.map((priority) => (
                    <option key={priority} value={priority}>
                      {PRIORITY_LABELS[priority]}
                    </option>
                  ))}
                </select>
              </dd>
            </div>
            <div>
              <dt>Assignee</dt>
              <dd>
                <select
                  className="input"
                  aria-label="Assignee"
                  value={detail.assignee?.id ?? ''}
                  onChange={(event) => void save({ assignee_id: event.target.value ? Number(event.target.value) : null })}
                >
                  <option value="">Unassigned</option>
                  {members.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.id === me.id ? `${member.name} (me)` : member.name}
                    </option>
                  ))}
                </select>
              </dd>
            </div>
            <div>
              <dt>Course</dt>
              <dd>
                <select
                  className="input"
                  aria-label="Course"
                  value={detail.course?.id ?? ''}
                  onChange={(event) => void save({ course_id: event.target.value ? Number(event.target.value) : null })}
                >
                  <option value="">No course</option>
                  {detail.course && !courses.some((c) => c.id === detail.course!.id) && <option value={detail.course.id}>{detail.course.title}</option>}
                  {courses.map((course) => (
                    <option key={course.id} value={course.id}>
                      {course.title}
                    </option>
                  ))}
                </select>
              </dd>
            </div>
            <div>
              <dt>Due date</dt>
              <dd className="due-field">
                <input className="input" type="date" aria-label="Due date" value={detail.due_date ?? ''} onChange={(event) => void save({ due_date: event.target.value || null })} />
                <DueBadge due={detail.due_date} status={detail.status} now={now} />
              </dd>
            </div>
            <div>
              <dt>Estimate</dt>
              <dd>
                <EstimateInput key={detail.estimate ?? 'none'} value={detail.estimate} onSave={(estimate) => void save({ estimate })} />
              </dd>
            </div>
            <div className="wide-field">
              <dt>Labels</dt>
              <dd>
                <LabelPicker
                  workspaceId={workspaceId}
                  labels={labels}
                  selected={detail.labels}
                  canCreate={canManageLabels}
                  onChange={(label_ids) => void save({ label_ids })}
                  onCreated={onLabelCreated}
                />
              </dd>
            </div>
          </dl>

          <section className="drawer-section" aria-label="Description">
            <h3>Description</h3>
            <DescriptionEditor value={detail.description} onSave={(description) => void save({ description })} />
          </section>

          <ChecklistPanel taskId={detail.id} items={detail.checklist} onChange={(checklist) => commit({ ...detail, checklist })} />

          <CommentThread
            taskId={detail.id}
            comments={detail.comments}
            people={members}
            me={me}
            now={now}
            onChange={(comments) => commit({ ...detail, comments })}
            onConfirming={setCommentDialog}
          />

          <footer className="task-meta-footer">
            <span>
              Created by {detail.reporter?.name ?? 'a former member'} <time title={formatDateTime(detail.created_at)}>{relativeTime(detail.created_at, now)}</time>
            </span>
            <span>
              Updated <time title={formatDateTime(detail.updated_at)}>{relativeTime(detail.updated_at, now)}</time>
            </span>
            {detail.completed_at && (
              <span>
                Completed <time title={formatDateTime(detail.completed_at)}>{relativeTime(detail.completed_at, now)}</time>
              </span>
            )}
          </footer>
        </div>
      )}
      {confirming && detail && (
        <ConfirmDialog
          title={`Delete ${detail.key}?`}
          message={
            <>
              <b>{detail.title}</b> and its checklist and {detail.comments.length} comment{detail.comments.length === 1 ? '' : 's'} will be removed for everyone. This cannot be undone.
            </>
          }
          confirmLabel="Delete task"
          busy={deleting}
          onConfirm={() => void remove()}
          onCancel={() => setConfirming(false)}
        />
      )}
    </Modal>
  );
}
