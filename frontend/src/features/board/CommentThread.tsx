import { useState } from 'react';
import { MessageSquare, Pencil, Trash2 } from 'lucide-react';
import type { Person } from '../../app/types';
import { useToast } from '../../app/toast';
import { Avatar } from '../../components/Avatar';
import { ConfirmDialog } from '../../components/Modal';
import { formatDateTime, relativeTime } from '../../lib/format';
import { boardApi } from './api';
import { MentionTextarea } from './MentionTextarea';
import { MentionText } from './TaskBits';
import { COMMENT_MAX } from './validation';
import type { TaskComment } from './types';

type CommentThreadProps = {
  taskId: number;
  comments: TaskComment[];
  people: Person[];
  me: Person;
  now: Date;
  onChange: (comments: TaskComment[]) => void;
  /** The drawer stays open while a confirmation dialog is up. */
  onConfirming: (open: boolean) => void;
};

function CommentItem({
  comment,
  people,
  now,
  onSave,
  onDelete,
}: {
  comment: TaskComment;
  people: Person[];
  now: Date;
  onSave: (body: string) => Promise<boolean>;
  onDelete: () => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (draft === null || !draft.trim()) return;
    setBusy(true);
    if (await onSave(draft.trim())) setDraft(null);
    setBusy(false);
  };

  return (
    <li className="task-comment">
      {comment.author ? <Avatar name={comment.author.name} color={comment.author.avatar_color} size="sm" /> : <span className="avatar avatar-sm unassigned" />}
      <div className="task-comment-main">
        <header>
          <b>{comment.author?.name ?? 'Former member'}</b>
          <time dateTime={comment.created_at} title={formatDateTime(comment.created_at)}>
            {relativeTime(comment.created_at, now)}
          </time>
          {comment.edited_at && <span className="muted" title={`Edited ${formatDateTime(comment.edited_at)}`}>(edited)</span>}
          <span className="spacer" />
          {comment.can_edit && draft === null && (
            <button type="button" className="icon-only" aria-label="Edit comment" onClick={() => setDraft(comment.body)}>
              <Pencil />
            </button>
          )}
          {comment.can_delete && (
            <button type="button" className="icon-only" aria-label="Delete comment" onClick={onDelete}>
              <Trash2 />
            </button>
          )}
        </header>
        {draft === null ? (
          <p className="task-comment-body">
            <MentionText body={comment.body} people={people} />
          </p>
        ) : (
          <div className="task-comment-edit">
            <MentionTextarea value={draft} onChange={setDraft} people={people} onSubmit={() => void save()} label="Edit comment" autoFocus maxLength={COMMENT_MAX} disabled={busy} />
            <div className="actions">
              <button type="button" className="primary small" disabled={busy || !draft.trim()} onClick={() => void save()}>
                Save
              </button>
              <button type="button" className="ghost small" onClick={() => setDraft(null)}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </li>
  );
}

/** Discussion under a task: @mention autocomplete, edit your own comments, admins can moderate. */
export function CommentThread({ taskId, comments, people, me, now, onChange, onConfirming }: CommentThreadProps) {
  const toast = useToast();
  const [body, setBody] = useState('');
  const [posting, setPosting] = useState(false);
  const [deleting, setDeleting] = useState<TaskComment | null>(null);

  const post = async () => {
    const text = body.trim();
    if (!text || posting) return;
    setPosting(true);
    try {
      const comment = await boardApi.addComment(taskId, text);
      onChange([...comments, comment]);
      setBody('');
      if (comment.mentions.length) toast.info(`Notified ${comment.mentions.length === 1 ? 'the mentioned member' : `${comment.mentions.length} mentioned members`}.`);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setPosting(false);
    }
  };

  const save = async (comment: TaskComment, text: string) => {
    try {
      const updated = await boardApi.editComment(taskId, comment.id, text);
      onChange(comments.map((c) => (c.id === updated.id ? updated : c)));
      return true;
    } catch (err) {
      toast.error((err as Error).message);
      return false;
    }
  };

  const confirmDelete = (comment: TaskComment | null) => {
    setDeleting(comment);
    onConfirming(comment !== null);
  };

  const remove = async () => {
    if (!deleting) return;
    try {
      await boardApi.removeComment(taskId, deleting.id);
      onChange(comments.filter((c) => c.id !== deleting.id));
    } catch (err) {
      toast.error((err as Error).message);
    }
    confirmDelete(null);
  };

  return (
    <section className="drawer-section" aria-labelledby="task-comments-title">
      <h3 id="task-comments-title">
        <MessageSquare /> Comments <span className="board-count">{comments.length}</span>
      </h3>
      {comments.length ? (
        <ol className="task-comments">
          {comments.map((comment) => (
            <CommentItem
              key={comment.id}
              comment={comment}
              people={people}
              now={now}
              onSave={(text) => save(comment, text)}
              onDelete={() => confirmDelete(comment)}
            />
          ))}
        </ol>
      ) : (
        <p className="muted">No comments yet. Ask a question or share progress; type @ to mention someone.</p>
      )}
      <div className="task-composer">
        <Avatar name={me.name} color={me.avatar_color} size="sm" />
        <div className="task-composer-main">
          <MentionTextarea value={body} onChange={setBody} people={people} onSubmit={() => void post()} placeholder="Write a comment… (@ to mention)" label="New comment" disabled={posting} maxLength={COMMENT_MAX} />
          <div className="actions">
            <small className="hint">Ctrl + Enter to send</small>
            <span className="spacer" />
            <button type="button" className="primary small" disabled={posting || !body.trim()} onClick={() => void post()}>
              {posting ? 'Sending…' : 'Comment'}
            </button>
          </div>
        </div>
      </div>
      {deleting && (
        <ConfirmDialog
          title="Delete comment?"
          message={deleting.author?.id === me.id ? 'Your comment will be removed for everyone.' : `This removes ${deleting.author?.name ?? 'a former member'}'s comment for everyone.`}
          confirmLabel="Delete comment"
          onConfirm={() => void remove()}
          onCancel={() => confirmDelete(null)}
        />
      )}
    </section>
  );
}
