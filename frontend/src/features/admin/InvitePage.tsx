import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Cpu, CheckCircle2, Clock, LogIn, MailX, UserPlus, Users } from 'lucide-react';
import { useAuth } from '../../app/auth';
import { useNow } from '../../app/clock';
import { ROLE_DESCRIPTIONS, ROLE_LABELS } from '../../app/roles';
import { Avatar } from '../../components/Avatar';
import { ErrorBanner, Loading } from '../../components/ui';
import { useLoader } from '../../hooks/useLoader';
import { formatDate, plural } from '../../lib/format';
import { invitationApi } from './api';
import { RoleBadge } from './components/bits';
import type { InvitationPreview } from './types';
import { expiryCountdown, inviteAuthSearch } from './validation';
import './admin.css';

const CLOSED_COPY: Record<'accepted' | 'revoked' | 'expired', { title: string; text: string }> = {
  accepted: { title: 'This invitation was already used', text: 'Sign in with the invited email to open the workspace.' },
  revoked: { title: 'This invitation was withdrawn', text: 'Ask the person who invited you to send a new one.' },
  expired: { title: 'This invitation has expired', text: 'Invitations last 14 days. Ask the person who invited you to resend it.' },
};

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="invite-page">
      <Link to="/" className="brand invite-brand">
        <Cpu />
        <span>
          Learn<b>Loop</b>
        </span>
      </Link>
      <main className="invite-card">{children}</main>
    </div>
  );
}

/** What a signed-in or signed-out visitor can do with a pending invitation. */
function PendingActions({ token, preview }: { token: string; preview: InvitationPreview }) {
  const { status, me, logout, refresh, switchWorkspace } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const search = inviteAuthSearch(token, preview.email);
  const back = { from: `/invite/${token}` };

  if (status !== 'signed-in' || !me) {
    const signIn = (
      <Link className={preview.has_account ? 'primary wide' : 'secondary wide'} to={`/login${search}`} state={back}>
        <LogIn /> Sign in to accept
      </Link>
    );
    const signUp = (
      <Link className={preview.has_account ? 'secondary wide' : 'primary wide'} to={`/register${search}`}>
        <UserPlus /> Create an account
      </Link>
    );
    return (
      <div className="invite-actions">
        {preview.has_account ? signIn : signUp}
        {preview.has_account ? signUp : signIn}
        <small className="muted">
          Use <b>{preview.email}</b>, the address this invitation was sent to.
        </small>
      </div>
    );
  }

  if (preview.viewer_is_member) {
    return (
      <div className="invite-actions">
        <p className="invite-note ok">
          <CheckCircle2 aria-hidden="true" /> You are already a member of {preview.workspace.name}.
        </p>
        <Link className="primary wide" to="/">
          Go to LearnLoop
        </Link>
      </div>
    );
  }

  if (preview.viewer_email_matches === false) {
    return (
      <div className="invite-actions">
        <p className="invite-note warn">
          This invitation was sent to <b>{preview.email}</b>, but you are signed in as <b>{me.user.email}</b>.
        </p>
        <button type="button" className="primary wide" onClick={() => void logout()}>
          <LogIn /> Sign out and switch account
        </button>
      </div>
    );
  }

  const accept = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await invitationApi.accept(token);
      await refresh();
      await switchWorkspace(result.workspace_id);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not accept the invitation');
      setBusy(false);
    }
  };

  return (
    <div className="invite-actions">
      {error && <ErrorBanner message={error} />}
      <button type="button" className="primary wide" disabled={busy} onClick={() => void accept()}>
        <CheckCircle2 /> {busy ? 'Joining…' : `Join ${preview.workspace.name}`}
      </button>
      <small className="muted">Signed in as {me.user.email}</small>
    </div>
  );
}

export function InvitePage() {
  const token = useParams().token ?? '';
  const { status, me } = useAuth();
  const now = useNow();
  // Reload when the viewer signs in or out: the preview then says whether the invitation is theirs.
  const { data, error, loading } = useLoader(() => invitationApi.preview(token), `invite:${token}:${me?.user.id ?? status}`);

  if (status === 'loading' || (loading && !data)) {
    return (
      <Frame>
        <Loading label="Opening invitation…" />
      </Frame>
    );
  }
  if (!data) {
    return (
      <Frame>
        <div className="invite-closed">
          <MailX aria-hidden="true" />
          <h1>Invitation not found</h1>
          <p className="muted">{error ?? 'Check that you copied the whole link.'}</p>
          <Link className="secondary" to="/">
            Go to LearnLoop
          </Link>
        </div>
      </Frame>
    );
  }

  const { workspace, inviter } = data;
  const closed = data.status === 'pending' ? null : CLOSED_COPY[data.status];
  const countdown = expiryCountdown(data.expires_at, now);
  return (
    <Frame>
      <div className="invite-hero" style={{ ['--ws-color' as string]: workspace.color }}>
        <span className="workspace-mark big" aria-hidden="true" style={{ background: workspace.color }}>
          {workspace.name[0]}
        </span>
        <p className="eyebrow">You are invited to</p>
        <h1>{workspace.name}</h1>
        {workspace.description && <p className="muted">{workspace.description}</p>}
        <p className="invite-facts">
          <span>
            <Users aria-hidden="true" /> {plural(workspace.members, 'member')}
          </span>
          {!closed && (
            <span className={`countdown ${countdown.tone}`} title={formatDate(data.expires_at)}>
              <Clock aria-hidden="true" /> {countdown.label}
            </span>
          )}
        </p>
      </div>

      {inviter && (
        <div className="invite-from">
          <Avatar name={inviter.name} color={inviter.avatar_color} size="md" />
          <p>
            <b>{inviter.name}</b> invited you to join as <RoleBadge role={data.role} />
          </p>
        </div>
      )}
      {data.message && <blockquote className="invite-message">{data.message}</blockquote>}
      <p className="invite-role muted">
        <b>{ROLE_LABELS[data.role]}s:</b> {ROLE_DESCRIPTIONS[data.role]}
      </p>

      {closed ? (
        <div className="invite-closed compact">
          <h2>{closed.title}</h2>
          <p className="muted">{closed.text}</p>
          <Link className="secondary" to="/">
            Go to LearnLoop
          </Link>
        </div>
      ) : (
        <PendingActions token={token} preview={data} />
      )}
    </Frame>
  );
}
