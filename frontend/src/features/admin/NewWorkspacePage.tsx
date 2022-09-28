import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, Cpu, Building2 } from 'lucide-react';
import { useAuth } from '../../app/auth';
import { useToast } from '../../app/toast';
import { Field } from '../../components/Field';
import { ErrorBanner, Loading } from '../../components/ui';
import { workspaceApi } from './api';
import { ColorSwatches } from './components/bits';
import type { WorkspaceInput } from './types';
import { AVATAR_COLORS, hasErrors, validateWorkspace, WORKSPACE_DESCRIPTION_MAX } from './validation';
import './admin.css';

/**
 * Create a workspace. Rendered outside the app shell with its own sign-in guard, so it also
 * works for someone who is signed in but no longer belongs to any workspace.
 */
export function NewWorkspacePage() {
  const { status, me, refresh } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const toast = useToast();
  const [form, setForm] = useState<WorkspaceInput>({ name: '', description: '', color: AVATAR_COLORS[0] });
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errors = validateWorkspace(form);
  const visible = touched ? errors : {};

  if (status === 'loading') return <Loading label="Opening LearnLoop…" />;
  if (status === 'signed-out' || !me) return <Navigate to="/login" replace state={{ from: location.pathname }} />;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (hasErrors(errors)) return;
    setBusy(true);
    setError(null);
    try {
      const created = await workspaceApi.create({ name: form.name.trim(), description: form.description.trim(), color: form.color });
      // The API already made it the current workspace; refreshing /auth/me picks that up for the shell.
      await refresh();
      toast.success(`${created.name} is ready. Invite people from the Members page.`);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the workspace');
      setBusy(false);
    }
  };

  const hasWorkspaces = me.workspaces.length > 0;
  return (
    <div className="invite-page">
      <Link to="/" className="brand invite-brand">
        <Cpu />
        <span>
          Learn<b>Loop</b>
        </span>
      </Link>
      <main className="invite-card new-workspace">
        <div className="new-workspace-head">
          <span className="workspace-mark big" style={{ background: form.color }} aria-hidden="true">
            {form.name.trim() ? form.name.trim()[0].toUpperCase() : <Building2 />}
          </span>
          <div>
            <p className="eyebrow">New workspace</p>
            <h1>{form.name.trim() || 'Name your workspace'}</h1>
            <p className="muted">A shared space for courses, flashcards, a calendar and a study board. You will be its owner.</p>
          </div>
        </div>
        <form className="stack" onSubmit={submit} noValidate>
          {error && <ErrorBanner message={error} />}
          <Field label="Workspace name" error={visible.name}>
            <input value={form.name} placeholder="e.g. Physics 101 study group" autoFocus onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Description" error={visible.description} hint="Optional. Shown to people you invite." aside={`${form.description.trim().length}/${WORKSPACE_DESCRIPTION_MAX}`}>
            <textarea rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </Field>
          <div className="field">
            <span className="field-label">Colour</span>
            <ColorSwatches label="Workspace colour" colors={AVATAR_COLORS} value={form.color} onChange={(color) => setForm({ ...form, color })} />
          </div>
          <div className="actions">
            {hasWorkspaces && (
              <Link className="ghost" to="/">
                <ArrowLeft /> Back
              </Link>
            )}
            <span className="spacer" />
            <button type="submit" className="primary" disabled={busy || (touched && hasErrors(errors))}>
              <Building2 /> {busy ? 'Creating…' : 'Create workspace'}
            </button>
          </div>
        </form>
      </main>
    </div>
  );
}
