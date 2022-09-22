import { useState } from 'react';
import { Slash, Clock, Copy, MailOpen, RotateCw, UserCheck } from 'lucide-react';
import { useNow } from '../../../app/clock';
import { useToast } from '../../../app/toast';
import { Avatar } from '../../../components/Avatar';
import { ConfirmDialog } from '../../../components/Modal';
import { Tabs } from '../../../components/Tabs';
import { ErrorBanner, Loading } from '../../../components/ui';
import { useLoader } from '../../../hooks/useLoader';
import { formatDate, relativeTime } from '../../../lib/format';
import { invitationApi } from '../api';
import { RoleBadge } from '../components/bits';
import type { Invitation, InvitationFilter, InvitationStatus } from '../types';
import { expiryCountdown, inviteLink } from '../validation';

const STATUS_TONES: Record<InvitationStatus, string> = { pending: 'info', expired: 'warn', accepted: 'ok', revoked: 'bad' };
const FILTERS: { key: InvitationFilter; label: string }[] = [
  { key: 'pending', label: 'Pending' },
  { key: 'expired', label: 'Expired' },
  { key: 'accepted', label: 'Accepted' },
  { key: 'revoked', label: 'Revoked' },
  { key: 'all', label: 'All' },
];

/** Copy text with the async Clipboard API, falling back to a hidden textarea for older or insecure contexts. */
async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.className = 'sr-only';
  document.body.appendChild(area);
  area.select();
  const ok = document.execCommand('copy');
  area.remove();
  if (!ok) throw new Error('Copy is not available in this browser');
}

/** Admin view of invitations: status filter, expiry countdowns and copy / resend / revoke actions.
 *  `version` changes when invitations are created elsewhere on the page, which reloads the list. */
export function InvitationsPanel({ workspaceId, version }: { workspaceId: number; version: number }) {
  const now = useNow();
  const toast = useToast();
  const [filter, setFilter] = useState<InvitationFilter>('pending');
  const [revoking, setRevoking] = useState<Invitation | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const { data, error, loading, reload } = useLoader(() => invitationApi.list(workspaceId), `invitations:${workspaceId}:${version}`);

  const rows = (data?.items ?? []).filter((i) => filter === 'all' || i.status === filter);

  const run = async (invitation: Invitation, action: () => Promise<unknown>, success: string) => {
    setBusyId(invitation.id);
    try {
      await action();
      toast.success(success);
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusyId(null);
    }
  };

  const copy = (invitation: Invitation) =>
    copyText(inviteLink(invitation.token, window.location.origin)).then(
      () => toast.success(`Invite link for ${invitation.email} copied`),
      (err: Error) => toast.error(err.message),
    );

  return (
    <section className="panel invitations-panel" aria-labelledby="invitations-title">
      <div className="panel-head">
        <h2 id="invitations-title">
          <MailOpen /> Invitations
        </h2>
        <Tabs label="Invitation status" items={FILTERS.map((f) => ({ ...f, count: data?.counts[f.key] }))} value={filter} onChange={setFilter} />
      </div>
      {error && <ErrorBanner message={error} onRetry={reload} />}
      {loading && !data ? (
        <Loading label="Loading invitations…" />
      ) : rows.length === 0 ? (
        <p className="muted invitations-empty">{filter === 'pending' ? 'No pending invitations. Invite people to see them here.' : `No ${filter === 'all' ? '' : `${filter} `}invitations.`}</p>
      ) : (
        <ul className="invitation-list">
          {rows.map((invitation) => {
            const open = invitation.status === 'pending' || invitation.status === 'expired';
            const countdown = expiryCountdown(invitation.expires_at, now);
            return (
              <li key={invitation.id} className={`invitation invitation-${invitation.status}`}>
                <div className="invitation-main">
                  <b className="invitation-email">{invitation.email}</b>
                  <div className="invitation-meta">
                    <RoleBadge role={invitation.role} />
                    <span className={`badge ${STATUS_TONES[invitation.status]}`}>{invitation.status}</span>
                    {invitation.has_account && (
                      <span className="badge" title="This person already has a LearnLoop account and was notified in the app">
                        <UserCheck /> Has account
                      </span>
                    )}
                    {open && (
                      <span className={`countdown ${countdown.tone}`} title={`Expires ${formatDate(invitation.expires_at)}`}>
                        <Clock /> {countdown.label}
                      </span>
                    )}
                  </div>
                  <small className="muted">
                    {invitation.invited_by && (
                      <>
                        <Avatar name={invitation.invited_by.name} color={invitation.invited_by.avatar_color} size="xs" /> {invitation.invited_by.name} ·{' '}
                      </>
                    )}
                    sent {relativeTime(invitation.created_at, now)}
                  </small>
                  {invitation.message && <q className="invitation-message">{invitation.message}</q>}
                </div>
                {open && (
                  <div className="invitation-actions">
                    <button type="button" className="ghost small" onClick={() => void copy(invitation)} aria-label={`Copy invite link for ${invitation.email}`}>
                      <Copy /> <span>Copy link</span>
                    </button>
                    <button
                      type="button"
                      className="ghost small"
                      disabled={busyId === invitation.id}
                      onClick={() => void run(invitation, () => invitationApi.resend(workspaceId, invitation.id), `Invitation to ${invitation.email} renewed for 14 days`)}
                      aria-label={`Resend invitation to ${invitation.email}`}
                    >
                      <RotateCw /> <span>Resend</span>
                    </button>
                    <button type="button" className="danger small" disabled={busyId === invitation.id} onClick={() => setRevoking(invitation)} aria-label={`Revoke invitation to ${invitation.email}`}>
                      <Slash /> <span>Revoke</span>
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {revoking && (
        <ConfirmDialog
          title="Revoke invitation?"
          message={
            <>
              The link sent to <b>{revoking.email}</b> will stop working. You can invite them again later.
            </>
          }
          confirmLabel="Revoke"
          busy={busyId === revoking.id}
          onCancel={() => setRevoking(null)}
          onConfirm={() => {
            const target = revoking;
            setRevoking(null);
            void run(target, () => invitationApi.revoke(workspaceId, target.id), `Invitation to ${target.email} revoked`);
          }}
        />
      )}
    </section>
  );
}
