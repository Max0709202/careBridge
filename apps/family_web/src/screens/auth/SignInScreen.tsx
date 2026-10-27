import { Eye, EyeOff, ShieldPlus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

import { Failure } from '../../api/failures';
import { safeNext } from '../../App';
import { useFeedback } from '../../components/feedback';
import { Button, IconButton, Page, TextField } from '../../components/ui';
import { useStore } from '../../state/context';

export function SignInScreen() {
  const store = useStore();
  const navigate = useNavigate();
  const location = useLocation();
  const { showFailure } = useFeedback();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [needsCode, setNeedsCode] = useState(false);
  const [obscure, setObscure] = useState(true);
  const [errors, setErrors] = useState<{
    email?: string;
    password?: string;
    mfaCode?: string;
  }>({});
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const next: typeof errors = {};
    if (email.trim() === '') next.email = 'Enter your email address.';
    else if (!email.includes('@'))
      next.email = 'That does not look like an email address.';
    if (password === '') next.password = 'Enter your password.';
    if (needsCode && mfaCode.trim() === '')
      next.mfaCode = 'Enter the code from your authenticator app.';
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setBusy(true);
    try {
      await store.signIn(email, password, needsCode ? mfaCode : undefined);
      navigate(safeNext(location.search), { replace: true });
    } catch (error) {
      // An account with two-factor on answers a correct password with a
      // request for the code — checked only after the password, so this is
      // never a hint about an account whose password was wrong.
      if (error instanceof Failure && error.field === 'mfaCode') {
        setNeedsCode(true);
        if (needsCode) setErrors({ mfaCode: error.message });
      } else {
        showFailure(error);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page title="" bare narrow>
      <div className="stack gap-md" style={{ paddingTop: 'var(--space-xl)' }}>
        <div className="row tight" style={{ gap: 12 }}>
          <ShieldPlus size={36} className="ink-primary" aria-hidden />
          <h1 className="t-headline-md">CareBridge</h1>
        </div>
        <p className="t-body-lg muted">
          Appointments, transportation, and the reassurance that someone you love
          arrived safely.
        </p>

        <h2 className="t-headline mt-lg">Sign in</h2>
        <form className="stack gap-md" onSubmit={submit} noValidate>
          <TextField
            label="Email address"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            error={errors.email}
          />
          <TextField
            label="Password"
            type={obscure ? 'password' : 'text'}
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={errors.password}
            trailing={
              <IconButton
                icon={obscure ? Eye : EyeOff}
                label={obscure ? 'Show password' : 'Hide password'}
                onClick={() => setObscure(!obscure)}
              />
            }
          />
          {needsCode && (
            <TextField
              label="Authentication code"
              helper="The six-digit code from your authenticator app, or one of your recovery codes."
              inputMode="text"
              autoComplete="one-time-code"
              maxLength={16}
              autoFocus
              value={mfaCode}
              onChange={(e) => setMfaCode(e.target.value)}
              error={errors.mfaCode}
            />
          )}
          <Button type="submit" block disabled={busy} className="mt-sm">
            {busy ? 'Signing in…' : 'Sign in'}
          </Button>
          <Button
            variant="outlined"
            block
            onClick={() => navigate(`/register${location.search}`)}
          >
            Create an account
          </Button>
          <Link to="/forgot-password" className="btn btn-text">
            Forgot your password?
          </Link>
        </form>
      </div>
    </Page>
  );
}
