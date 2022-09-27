import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { LogOut, Trash2 } from 'lucide-react';
import { useAuth, useWorkspace } from '../../../app/auth';
import { ROLE_LABELS, ROLES } from '../../../app/roles';
import { useToast } from '../../../app/toast';
import { Field } from '../../../components/Field';
import { ConfirmDialog, Modal } from '../../../components/Modal';
import { ErrorBanner, Loading, StatCard } from '../../../components/ui';
import { useLoader } from '../../../hooks/useLoader';
import { formatDate, formatNumber, plural } from '../../../lib/format';
import { workspaceApi } from '../api';
import { ColorSwatches, RoleBadge, SaveBar, SettingsSection } from '../components/bits';
import type { WorkspaceDetail, WorkspaceInput } from '../types';
import { AVATAR_COLORS, changedFields, confirmationMatches, hasErrors, leaveProblem, validateWorkspace, WORKSPACE_DESCRIPTION_MAX } from '../validation';
import { useUnsavedChangesWarning } from './SettingsLayout';

const formOf = (detail: WorkspaceDetail): WorkspaceInput => ({ name: detail.name, description: detail.description, color: detail.color });

function Stats({ detail }: { detail: WorkspaceDetail }) {
  const { stats } = detail;
  return (
    <>
      <div className="stats">
        <StatCard label="Members" value={formatNumber(stats.members)} hint={<Link to="/members">Manage members</Link>} />
        <StatCard label="Active learners" value={formatNumber(stats.active_learners_7d)} hint="answered or reviewed in the last 7 days" />
        <StatCard label="Courses" value={formatNumber(stats.active_courses)} hint={`active of ${plural(stats.courses, 'course')}`} />
        <StatCard label="Answers this week" value={formatNumber(stats.answers_7d)} hint={`${plural(stats.reviews_7d, 'flashcard review')}`} />
        <StatCard label="Pending invitations" value={formatNumber(stats.pending_invitations)} />
      </div>
      <div className="role-bar" role="img" aria-label={ROLES.map((r) => `${stats.members_by_role[r]} ${ROLE_LABELS[r].toLowerCase()}`).join(', ')}>
        {[...ROLES].reverse().map((role) =>
          stats.members_by_role[role] ? <span key={role} className={`role-${role}`} style={{ flexGrow: stats.members_by_role[role] }} title={`${ROLE_LABELS[role]}: ${stats.members_by_role[role]}`} /> : null,
        )}
      </div>
      <ul className="role-legend">
        {[...ROLES].reverse().map((role) => (
          <li key={role} className={`role-${role}`}>
            <i aria-hidden="true" />
            {ROLE_LABELS[role]} <b>{stats.members_by_role[role]}</b>
          </li>
        ))}
      </ul>
    </>
  );
}

function DetailsForm({ detail, onSaved }: { detail: WorkspaceDetail; onSaved: (detail: WorkspaceDetail) => void }) {
  const toast = useToast();
  // The last saved version, updated from the save response so the form is clean before the page reloads.
  const [base, setBase] = useState(detail);
  const saved = formOf(base);
  const [draft, setDraft] = useState<WorkspaceInput>(saved);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changes = changedFields(saved, draft);
  const dirty = Object.keys(changes).length > 0;
  const errors = validateWorkspace(draft);
  useUnsavedChangesWarning(dirty);
  const colors = AVATAR_COLORS.includes(detail.color) ? AVATAR_COLORS : [...AVATAR_COLORS, detail.color];

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!dirty || hasErrors(errors)) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await workspaceApi.update(detail.id, changes);
      setBase(updated);
      setDraft(formOf(updated));
      onSaved(updated);
      toast.success('Workspace settings saved');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the workspace settings');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="stack" onSubmit={submit} noValidate>
      {error && <ErrorBanner message={error} />}
      <div className="workspace-identity">
        <span className="workspace-mark big" style={{ background: draft.color }} aria-hidden="true">
          {(draft.name.trim() || '?')[0].toUpperCase()}
        </span>
        <Field label="Workspace name" error={errors.name} className="grow">
          <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        </Field>
      </div>
      <Field label="Description" error={errors.description} aside={`${draft.description.trim().length}/${WORKSPACE_DESCRIPTION_MAX}`} hint="Shown to people you invite.">
        <textarea rows={3} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
      </Field>
      <div className="field">
        <span className="field-label">Colour</span>
        <ColorSwatches label="Workspace colour" colors={colors} value={draft.color} onChange={(color) => setDraft({ ...draft, color })} />
      </div>
      <SaveBar dirty={dirty} valid={!hasErrors(errors)} busy={busy} onDiscard={() => setDraft(saved)} />
    </form>
  );
}

function DeleteDialog({ detail, onClose }: { detail: WorkspaceDetail; onClose: () => void }) {
  const { refresh } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const matches = confirmationMatches(typed, detail.name);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!matches) return;
    setBusy(true);
    try {
      await workspaceApi.remove(detail.id, typed);
      await refresh();
      toast.success(`${detail.name} was deleted`);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete the workspace');
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`Delete ${detail.name}?`}
      description="This permanently deletes every course, deck, note, board and calendar event in the workspace for everyone. It cannot be undone."
      onClose={onClose}
      size="sm"
      footer={
        <>
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="delete-workspace" className="danger solid" disabled={!matches || busy}>
            <Trash2 /> {busy ? 'Deleting…' : 'Delete workspace'}
          </button>
        </>
      }
    >
      <form id="delete-workspace" className="stack" onSubmit={submit} noValidate>
        {error && <ErrorBanner message={error} />}
        <p className="confirm-message">
          {plural(detail.stats.members, 'member')} will lose access, including {plural(detail.stats.courses, 'course')}.
        </p>
        <Field label={<>Type <b className="confirm-name">{detail.name}</b> to confirm</>}>
          <input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} data-autofocus />
        </Field>
      </form>
    </Modal>
  );
}

export function WorkspaceSettings() {
  const workspace = useWorkspace();
  const { refresh } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [leaving, setLeaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  const { data, error, loading, reload } = useLoader(() => workspaceApi.get(workspace.id), `workspace:${workspace.id}`);

  if (loading && !data) return <Loading label="Loading workspace…" />;
  if (!data) return <ErrorBanner message={error ?? 'Workspace not found'} onRetry={reload} />;

  const isAdmin = workspace.can('admin');
  const isOwner = workspace.role === 'owner';
  const leaveBlock = leaveProblem(workspace.role, data.stats.members_by_role.owner);

  const leave = async () => {
    setBusy(true);
    try {
      await workspaceApi.leave(workspace.id);
      await refresh();
      toast.success(`You left ${data.name}`);
      navigate('/', { replace: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not leave the workspace');
      setBusy(false);
      setLeaving(false);
    }
  };

  return (
    <div className="stack">
      <SettingsSection
        title={data.name}
        description={
          <>
            Created {formatDate(data.created_at)}
            {data.owner && <> by {data.owner.name}</>} · you are <RoleBadge role={data.your_role} />
          </>
        }
      >
        <Stats detail={data} />
      </SettingsSection>

      {isAdmin ? (
        <SettingsSection title="Details" description="Name, description and colour appear in the workspace switcher and on invitations.">
          <DetailsForm
            key={data.id}
            detail={data}
            onSaved={() => {
              reload();
              void refresh();
            }}
          />
        </SettingsSection>
      ) : (
        <SettingsSection title="About this workspace">
          <p className="workspace-about">{data.description || <span className="muted">No description yet.</span>}</p>
          <p className="muted">Only admins and owners can change these details.</p>
        </SettingsSection>
      )}

      <SettingsSection title="Danger zone" tone="danger">
        <div className="danger-row">
          <div>
            <b>Leave workspace</b>
            <p className="muted">{leaveBlock ?? 'You will lose access until someone invites you again.'}</p>
          </div>
          <button type="button" className="danger" disabled={!!leaveBlock} onClick={() => setLeaving(true)}>
            <LogOut /> Leave
          </button>
        </div>
        {isOwner && (
          <div className="danger-row">
            <div>
              <b>Delete workspace</b>
              <p className="muted">Permanently removes the workspace and everything in it for all members.</p>
            </div>
            <button type="button" className="danger solid" onClick={() => setDeleting(true)}>
              <Trash2 /> Delete…
            </button>
          </div>
        )}
      </SettingsSection>

      {leaving && (
        <ConfirmDialog
          title={`Leave ${data.name}?`}
          message="You will lose access to its courses, notes and boards. Your history stays with the workspace."
          confirmLabel="Leave workspace"
          busy={busy}
          onCancel={() => setLeaving(false)}
          onConfirm={() => void leave()}
        />
      )}
      {deleting && <DeleteDialog detail={data} onClose={() => setDeleting(false)} />}
    </div>
  );
}
