import { useMemo, useState, type ClipboardEvent, type FormEvent, type KeyboardEvent } from 'react';
import { AlertCircle, CheckCircle2, MailPlus, MinusCircle, Send, X } from 'lucide-react';
import { ROLE_DESCRIPTIONS, ROLE_LABELS } from '../../../app/roles';
import type { Role } from '../../../app/types';
import { Field } from '../../../components/Field';
import { Modal } from '../../../components/Modal';
import { ErrorBanner } from '../../../components/ui';
import { cx } from '../../../lib/cx';
import { plural } from '../../../lib/format';
import { invitationApi } from '../api';
import { ROLE_ICONS } from '../components/bits';
import type { InviteSummary } from '../types';
import { INVITE_MESSAGE_MAX, inviteListProblem, invitableRoles, MAX_INVITES, parseEmailList, splitAddresses, uniqueValidEmails } from '../validation';

type Props = { workspaceId: number; workspaceName: string; actorRole: Role; onClose: () => void; onInvited: () => void };

const SEPARATOR = /[,;\r\n]/;

/** Two-step invite flow: collect addresses as chips and pick a role, then show what happened to each address. */
export function InviteModal({ workspaceId, workspaceName, actorRole, onClose, onInvited }: Props) {
  const roles = invitableRoles(actorRole);
  const [entries, setEntries] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const [role, setRole] = useState<Role>('learner');
  const [message, setMessage] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<InviteSummary | null>(null);

  // Chips include the text still being typed, so the count and validation are always current.
  const chips = useMemo(() => parseEmailList([...entries, draft].join('\n')), [entries, draft]);
  const committed = chips.slice(0, parseEmailList(entries.join('\n')).length);
  const listProblem = inviteListProblem(chips);
  const valid = uniqueValidEmails(chips);
  const messageTooLong = message.trim().length > INVITE_MESSAGE_MAX;

  const commit = (text: string) => {
    const tokens = splitAddresses(text);
    if (tokens.length) setEntries((current) => [...current, ...tokens]);
  };

  const onDraftChange = (value: string) => {
    // Typing a separator turns everything before it into chips; the rest stays in the box.
    if (!SEPARATOR.test(value)) return setDraft(value);
    const lastBreak = Math.max(value.lastIndexOf(','), value.lastIndexOf(';'), value.lastIndexOf('\n'));
    commit(value.slice(0, lastBreak));
    setDraft(value.slice(lastBreak + 1).trimStart());
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && draft.trim()) {
      event.preventDefault();
      commit(draft);
      setDraft('');
    } else if (event.key === 'Backspace' && !draft && entries.length) {
      setEntries((current) => current.slice(0, -1));
    }
  };

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const text = event.clipboardData.getData('text');
    if (!SEPARATOR.test(text) && !/\s/.test(text.trim())) return;
    event.preventDefault();
    commit(draft + text);
    setDraft('');
  };

  const removeChip = (index: number) => setEntries((current) => current.filter((_, i) => i !== index));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (listProblem || messageTooLong) return;
    setBusy(true);
    setError(null);
    try {
      const result = await invitationApi.create(workspaceId, { emails: valid, role, message: message.trim() });
      setSummary(result);
      if (result.invited) onInvited();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the invitations');
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setEntries([]);
    setDraft('');
    setMessage('');
    setTouched(false);
    setSummary(null);
  };

  if (summary) {
    return (
      <Modal
        title={summary.invited ? `${plural(summary.invited, 'invitation')} sent` : 'No invitations sent'}
        description={summary.skipped ? `${plural(summary.skipped, 'address', 'addresses')} skipped. Details below.` : `Everyone will get a link to join ${workspaceName}.`}
        onClose={onClose}
        footer={
          <>
            <button type="button" className="secondary" onClick={reset}>
              <MailPlus /> Invite more people
            </button>
            <button type="button" className="primary" onClick={onClose} data-autofocus>
              Done
            </button>
          </>
        }
      >
        <ul className="invite-results">
          {summary.results.map((result, index) => {
            const Icon = result.outcome === 'invited' ? CheckCircle2 : result.outcome === 'invalid' ? AlertCircle : MinusCircle;
            return (
              <li key={`${result.email}-${index}`} className={`outcome-${result.outcome}`}>
                <Icon aria-hidden="true" />
                <span className="invite-result-email">{result.email}</span>
                <small>{result.outcome === 'invited' ? `Invited as ${ROLE_LABELS[result.invitation?.role ?? role].toLowerCase()}` : result.reason}</small>
              </li>
            );
          })}
        </ul>
      </Modal>
    );
  }

  return (
    <Modal
      title="Invite people"
      description={`They will get a link to join ${workspaceName}. Invitations expire after 14 days.`}
      onClose={onClose}
      size="lg"
      footer={
        <>
          <span className="muted invite-count">{valid.length ? `${plural(valid.length, 'person', 'people')} to invite` : ''}</span>
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="invite-form" className="primary" disabled={busy || (touched && (!!listProblem || messageTooLong))}>
            <Send /> {busy ? 'Sending…' : valid.length > 1 ? `Send ${valid.length} invitations` : 'Send invitation'}
          </button>
        </>
      }
    >
      <form id="invite-form" className="stack" onSubmit={submit} noValidate>
        {error && <ErrorBanner message={error} />}
        <Field
          label="Email addresses"
          error={touched && listProblem ? listProblem : undefined}
          hint={`Paste a list or press Enter after each address. Up to ${MAX_INVITES} at a time.`}
          aside={chips.length ? `${valid.length} valid` : undefined}
        >
          <div className="chip-input">
            {committed.map((chip, index) => (
              <span key={`${chip.raw}-${index}`} className={cx('email-chip', chip.error && 'invalid', chip.duplicate && 'duplicate')} title={chip.error ?? (chip.duplicate ? 'Already in the list' : undefined)}>
                {chip.email || chip.raw}
                {chip.duplicate && <small>duplicate</small>}
                {chip.error && <small>invalid</small>}
                <button type="button" className="icon-only" aria-label={`Remove ${chip.raw}`} onClick={() => removeChip(index)}>
                  <X />
                </button>
              </span>
            ))}
            <textarea
              data-autofocus
              rows={2}
              value={draft}
              aria-label="Email addresses"
              placeholder={entries.length ? 'Add more…' : 'ada@example.com, grace@example.org'}
              onChange={(e) => onDraftChange(e.target.value)}
              onKeyDown={onKeyDown}
              onPaste={onPaste}
              onBlur={() => {
                commit(draft);
                setDraft('');
              }}
            />
          </div>
        </Field>

        <fieldset className="role-picker">
          <legend>Role</legend>
          {roles.map((option) => {
            const Icon = ROLE_ICONS[option];
            return (
              <label key={option} className={cx('role-option', option === role && 'selected')}>
                <input type="radio" name="invite-role" value={option} checked={option === role} onChange={() => setRole(option)} />
                <Icon aria-hidden="true" />
                <span>
                  <b>{ROLE_LABELS[option]}</b>
                  <small>{ROLE_DESCRIPTIONS[option]}</small>
                </span>
              </label>
            );
          })}
        </fieldset>

        <Field
          label="Personal message"
          hint="Optional. Shown on the invitation page."
          error={messageTooLong ? `Keep the message under ${INVITE_MESSAGE_MAX} characters.` : undefined}
          aside={`${message.trim().length}/${INVITE_MESSAGE_MAX}`}
        >
          <textarea rows={3} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Welcome aboard! Start with the intro course." />
        </Field>
      </form>
    </Modal>
  );
}
