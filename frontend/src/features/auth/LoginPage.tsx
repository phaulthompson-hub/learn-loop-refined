import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, LogIn } from 'lucide-react';
import { useAuth } from '../../app/auth';
import { Field } from '../../components/Field';
import { ErrorBanner } from '../../components/ui';
import { AuthLayout } from './AuthLayout';
import { validateEmail } from './validation';

const DEMO_ACCOUNTS = [
  { email: 'demo@learnloop.dev', who: 'Alex · admin' },
  { email: 'maya@learnloop.dev', who: 'Maya · owner' },
  { email: 'sam@learnloop.dev', who: 'Sam · learner' },
];
export const DEMO_PASSWORD = 'learnloop123';

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const next = { email: validateEmail(email), password: password ? undefined : 'Enter your password.' };
    setErrors(next);
    if (next.email || next.password) return;
    setBusy(true);
    setError(null);
    try {
      await login(email.trim(), password);
      navigate(from, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not sign in');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout title="Welcome back" subtitle="Sign in to continue your learning loop.">
      {error && <ErrorBanner message={error} />}
      <form className="stack" onSubmit={submit} noValidate>
        <Field label="Email" error={errors.email}>
          <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <div className="input-with-button">
          <Field label="Password" error={errors.password}>
            <input type={show ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <button type="button" className="icon-only reveal" aria-label={show ? 'Hide password' : 'Show password'} onClick={() => setShow(!show)}>
            {show ? <EyeOff /> : <Eye />}
          </button>
        </div>
        <button type="submit" className="primary wide" disabled={busy}>
          <LogIn /> {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      <div className="demo-accounts">
        <p className="eyebrow">DEMO ACCOUNTS · PASSWORD {DEMO_PASSWORD}</p>
        <div>
          {DEMO_ACCOUNTS.map((account) => (
            <button
              key={account.email}
              type="button"
              className="chip-button"
              onClick={() => {
                setEmail(account.email);
                setPassword(DEMO_PASSWORD);
                setErrors({});
              }}
            >
              <b>{account.email}</b>
              <small>{account.who}</small>
            </button>
          ))}
        </div>
      </div>
      <p className="auth-switch">
        New to LearnLoop? <Link to="/register">Create an account</Link>
      </p>
    </AuthLayout>
  );
}
