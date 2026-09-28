import { useEffect, useState, type FormEvent } from 'react';

import { Failure, failureMessage } from '../api/failures';
import { Button, TextField } from '../components/ui';
import { useStore } from '../state/context';

/**
 * Sign-in for the console. A port of
 * apps/ops_console/lib/features/auth/sign_in_screen.dart.
 *
 * The same accounts as the family app: a person is a `User`, and what they may
 * do here comes from an `OrganizationMembership`. Two account systems would
 * mean two password resets and two places for an offboarded dispatcher to
 * still have access.
 */
export function SignInScreen() {
  const store = useStore();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [needsCode, setNeedsCode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string; mfaCode?: string }>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    document.title = 'Sign in · CareBridge ops';
  }, []);

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
      // The router moves on by itself once the session exists.
      await store.signIn(email, password, needsCode ? mfaCode : undefined);
    } catch (failure) {
      if (failure instanceof Failure && failure.field === 'mfaCode') {
        // Asked for only after a correct password, so never a hint about one.
        setNeedsCode(true);
        if (needsCode) setFieldErrors({ mfaCode: failure.message });
      } else {
        // The server's message, unchanged: it says "email or password is
        // incorrect" without saying which.
        setError(failureMessage(failure));
      }
      setBusy(false);
    }
  }

  return (
    <main className="sign-in">
      <form className="stack gap-md" onSubmit={submit} noValidate>
        <div>
          <h1 className="t-title-lg">CareBridge ops</h1>
          <p className="muted">Dispatch console for transport operators.</p>
        </div>
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
