import { CarFront } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';

import { Failure, failureMessage } from '../api/failures';
import { Button, TextField } from '../components/ui';
import { useStore } from '../state/context';

/**
 * Signing in — the same account as the family app, deliberately: a driver is a
 * CareBridge user who happens to be on an operator's roster.
 */
export function SignInScreen() {
  const store = useStore();
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [needsCode, setNeedsCode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string; mfaCode?: string }>({});
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const next: typeof fieldErrors = {};
    if (email.trim() === '') next.email = 'Enter your email address';
    if (password === '') next.password = 'Enter your password';
    if (needsCode && mfaCode.trim() === '') next.mfaCode = 'Enter the code from your authenticator app';
    setFieldErrors(next);
    setError(null);
    if (Object.keys(next).length > 0) return;

    setBusy(true);
    try {
      await store.signIn(email, password, needsCode ? mfaCode : undefined);
      navigate('/today', { replace: true });
    } catch (failure) {
      if (failure instanceof Failure && failure.field === 'mfaCode') {
        // Asked for only after a correct password, so never a hint about one.
        setNeedsCode(true);
        if (needsCode) setFieldErrors({ mfaCode: failure.message });
      } else {
        // The server's message, unchanged: it says "email or password is
        // incorrect" without saying which, and rewording it undoes that care.
        setError(failureMessage(failure));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="sign-in">
      <form className="stack gap-md" onSubmit={submit} noValidate>
        <CarFront className="brand-icon" size={56} aria-hidden />
        <h1 className="t-headline center">CareBridge for drivers</h1>
        <div className="gap-lg" />
        <TextField
          label="Email"
          type="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={fieldErrors.email}
        />
        <TextField
          label="Password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={fieldErrors.password}
        />
        {needsCode && (
          <TextField
            label="Authentication code"
            helper="The six-digit code from your authenticator app, or a recovery code."
            autoComplete="one-time-code"
            maxLength={16}
            autoFocus
            value={mfaCode}
            onChange={(e) => setMfaCode(e.target.value)}
            error={fieldErrors.mfaCode}
          />
        )}
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        <Button type="submit" busy={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </main>
  );
}
