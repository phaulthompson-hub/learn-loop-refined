import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff, Key, LogOut, Monitor, Smartphone, UserX } from 'lucide-react';
import { useAuth } from '../../../app/auth';
import { useNow } from '../../../app/clock';
import { useToast } from '../../../app/toast';
import { Field } from '../../../components/Field';
import { ConfirmDialog, Modal } from '../../../components/Modal';
import { ErrorBanner, Loading } from '../../../components/ui';
import { useLoader } from '../../../hooks/useLoader';
import { formatDate, plural, relativeTime } from '../../../lib/format';
import { accountApi } from '../api';
import { PasswordMeter, SettingsSection } from '../components/bits';
import type { SessionInfo } from '../types';
import { hasErrors, validatePasswordChange, type PasswordForm } from '../validation';

const EMPTY: PasswordForm = { current: '', next: '', confirm: '' };

function ChangePassword({ onChanged }: { onChanged: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState<PasswordForm>(EMPTY);
  const [show, setShow] = useState(false);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errors = validatePasswordChange(form);
  const visible = touched ? errors : {};

  const set = (key: keyof PasswordForm) => (event: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: event.target.value });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (hasErrors(errors)) return;
    setBusy(true);
    setError(null);
    try {
      const { signed_out_sessions: count } = await accountApi.changePassword(form.current, form.next);
      toast.success(count ? `Password changed. Signed out ${plural(count, 'other session')}.` : 'Password changed.');
      setForm(EMPTY);
      setTouched(false);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change the password');
    } finally {
      setBusy(false);
    }
  };

  const type = show ? 'text' : 'password';
  return (
    <form className="stack password-form" onSubmit={submit} noValidate>
      {error && <ErrorBanner message={error} />}
      <Field label="Current password" error={visible.current}>
        <span className="input-with-button">
          <input type={type} autoComplete="current-password" value={form.current} onChange={set('current')} />
          <button type="button" className="icon-only" aria-label={show ? 'Hide passwords' : 'Show passwords'} onClick={() => setShow(!show)}>
            {show ? <EyeOff /> : <Eye />}
          </button>
        </span>
      </Field>
      <Field label="New password" error={visible.next} hint="At least 8 characters, mixing letters with numbers or symbols.">
        <input type={type} autoComplete="new-password" value={form.next} onChange={set('next')} />
      </Field>
      <PasswordMeter password={form.next} />
      <Field label="Confirm new password" error={visible.confirm}>
        <input type={type} autoComplete="new-password" value={form.confirm} onChange={set('confirm')} />
      </Field>
      <div className="actions">
        <button type="submit" className="primary" disabled={busy || !form.current || !form.next}>
          <Key /> {busy ? 'Changing…' : 'Change password'}
        </button>
        <small className="muted">Other devices will be signed out.</small>
      </div>
    </form>
  );
}

const isPhone = (session: SessionInfo) => /iPhone|Android|iPad/.test(session.device);

function Sessions({ version }: { version: number }) {
  const now = useNow();
  const toast = useToast();
  const { data, error, loading, reload } = useLoader(accountApi.sessions, `sessions:${version}`);
  const [confirmAll, setConfirmAll] = useState(false);
  const [busy, setBusy] = useState<number | 'all' | null>(null);
  const others = (data ?? []).filter((s) => !s.current);

  const revoke = async (session: SessionInfo) => {
    setBusy(session.id);
    try {
      await accountApi.revokeSession(session.id);
      toast.success(`Signed out ${session.device}`);
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not sign out that session');
    } finally {
      setBusy(null);
    }
  };

  const revokeAll = async () => {
    setBusy('all');
    try {
      const { revoked } = await accountApi.revokeOtherSessions();
      toast.success(`Signed out ${plural(revoked, 'other session')}`);
      setConfirmAll(false);
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not sign out other sessions');
    } finally {
      setBusy(null);
    }
  };

  if (loading && !data) return <Loading label="Loading sessions…" />;
  return (
    <>
      {error && <ErrorBanner message={error} onRetry={reload} />}
      <ul className="session-list">
        {(data ?? []).map((session) => {
          const Icon = isPhone(session) ? Smartphone : Monitor;
          return (
            <li key={session.id} className={session.current ? 'current' : undefined}>
              <span className="session-icon">
                <Icon aria-hidden="true" />
              </span>
              <span className="session-main">
                <b>
                  {session.device} {session.current && <span className="badge ok">This device</span>}
                </b>
                <small className="muted" title={session.user_agent}>
                  Signed in {formatDate(session.created_at)} · active {relativeTime(session.last_seen_at, now)}
                </small>
              </span>
              {!session.current && (
                <button type="button" className="ghost small" disabled={busy !== null} onClick={() => void revoke(session)} aria-label={`Sign out ${session.device}`}>
                  <LogOut /> <span>Sign out</span>
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <div className="actions">
        <button type="button" className="secondary" disabled={!others.length || busy !== null} onClick={() => setConfirmAll(true)}>
          <LogOut /> Sign out other sessions
        </button>
        {!others.length && data && <small className="muted">You are only signed in here.</small>}
      </div>
      {confirmAll && (
        <ConfirmDialog
          title="Sign out everywhere else?"
          message={`${plural(others.length, 'other session')} will be signed out. This device stays signed in.`}
          confirmLabel="Sign out others"
          busy={busy === 'all'}
          onCancel={() => setConfirmAll(false)}
          onConfirm={() => void revokeAll()}
        />
      )}
    </>
  );
}

