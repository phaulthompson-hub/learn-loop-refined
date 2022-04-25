import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { UserPlus } from 'lucide-react';
import { useAuth } from '../../app/auth';
import { Field } from '../../components/Field';
import { ErrorBanner } from '../../components/ui';
import { AuthLayout } from './AuthLayout';
import { passwordStrength, STRENGTH_LABELS, validateEmail, validateName, validateNewPassword } from './validation';

type Errors = Partial<Record<'name' | 'email' | 'password' | 'workspace', string>>;

export function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const invitation = params.get('invite') ?? undefined;
  const [form, setForm] = useState({ name: '', email: params.get('email') ?? '', password: '', workspace: '' });
  const [errors, setErrors] = useState<Errors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const strength = passwordStrength(form.password);

  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: event.target.value });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const next: Errors = {
      name: validateName(form.name),
      email: validateEmail(form.email),
      password: validateNewPassword(form.password),
      workspace: !invitation && form.workspace && form.workspace.trim().length < 2 ? 'Workspace name must be at least 2 characters.' : undefined,
    };
    setErrors(next);
    if (Object.values(next).some(Boolean)) return;
    setBusy(true);
    setError(null);
    try {
      await register({
        name: form.name.trim(),
        email: form.email.trim(),
        password: form.password,
        workspace_name: invitation ? undefined : form.workspace.trim() || undefined,
        invitation_token: invitation,
      });
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the account');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout
      title={invitation ? 'Join your team' : 'Create your account'}
      subtitle={invitation ? 'Finish signing up to accept the invitation.' : 'Start a workspace for yourself or your study group.'}
    >
      {error && <ErrorBanner message={error} />}
      <form className="stack" onSubmit={submit} noValidate>
        <Field label="Full name" error={errors.name}>
          <input autoComplete="name" value={form.name} onChange={set('name')} />
        </Field>
        <Field label="Email" error={errors.email}>
          <input type="email" autoComplete="email" value={form.email} onChange={set('email')} />
        </Field>
        <Field label="Password" error={errors.password} hint="At least 8 characters, mixing letters with numbers or symbols.">
          <input type="password" autoComplete="new-password" value={form.password} onChange={set('password')} />
        </Field>
        {form.password && (
          <div className={`strength strength-${strength}`} aria-live="polite">
            <span>
              {[0, 1, 2, 3].map((i) => (
                <i key={i} className={i < strength ? 'on' : ''} />
              ))}
            </span>
            <small>{STRENGTH_LABELS[strength]}</small>
          </div>
        )}
        {!invitation && (
          <Field label="Workspace name" error={errors.workspace} hint="Optional. You can rename it or invite people later.">
            <input value={form.workspace} placeholder="e.g. Biology study group" onChange={set('workspace')} />
          </Field>
        )}
        <button type="submit" className="primary wide" disabled={busy}>
          <UserPlus /> {busy ? 'Creating account…' : 'Create account'}
        </button>
      </form>
      <p className="auth-switch">
        Already have an account? <Link to="/login">Sign in</Link>
      </p>
    </AuthLayout>
  );
}
