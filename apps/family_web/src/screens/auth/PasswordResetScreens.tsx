/**
 * The two ends of a password reset. The API sends the email with a link to
 * `/reset-password?token=…` on this origin (see mail-templates.ts); these are
 * the screens that link lands on.
 */
import { KeyRound, MailCheck } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { useFeedback } from '../../components/feedback';
import { AppCard, Button, EmptyState, Page, TextField } from '../../components/ui';
import { useApi, useCare, useStore } from '../../state/context';
import { isSignedIn } from '../../state/careState';

export function ForgotPasswordScreen() {
  const api = useApi();
  const navigate = useNavigate();
  const { showFailure } = useFeedback();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!email.includes('@')) {
      setError('That does not look like an email address.');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await api.requestPasswordReset(email);
      setSent(true);
    } catch (err) {
      showFailure(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page title="Reset your password" back narrow>
      {sent ? (
        <AppCard>
          {/* Always the same answer, whether or not the address has an account:
              anything else would enumerate the customer list. */}
          <EmptyState
            icon={MailCheck}
            title="Check your inbox"
            message={`If ${email.trim()} has a CareBridge account, a link to choose a new password is on its way. It works once.`}
            action={<Button onClick={() => navigate('/sign-in')}>Back to sign in</Button>}
          />
        </AppCard>
      ) : (
        <form className="stack gap-md" onSubmit={submit} noValidate>
          <p className="t-body-lg muted">
            Enter the address you signed up with and we will email you a link to choose a new
            password.
          </p>
          <TextField
            label="Email address"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            error={error}
          />
          <Button type="submit" block disabled={busy}>
            {busy ? 'Sending…' : 'Send the link'}
          </Button>
        </form>
      )}
    </Page>
  );
}

export function ResetPasswordScreen() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const api = useApi();
  const store = useStore();
  const state = useCare();
  const navigate = useNavigate();
  const { showFailure } = useFeedback();

  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password.length < 10) {
      setError('Use at least 10 characters.');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await api.confirmPasswordReset(token, password);
      // The server revoked every session, this one included.
      if (isSignedIn(state)) store.forgetSession();
      setDone(true);
    } catch (err) {
      showFailure(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page title="Choose a new password" narrow>
      {done ? (
        <AppCard>
          <EmptyState
            icon={KeyRound}
            title="Your password is changed"
            message="Every device has been signed out. Sign in with your new password."
            action={<Button onClick={() => navigate('/sign-in', { replace: true })}>Sign in</Button>}
          />
        </AppCard>
      ) : token === '' ? (
        <EmptyState
          icon={KeyRound}
          title="This link is incomplete"
          message="Open the link from the email again, or ask for a new one."
          action={<Button onClick={() => navigate('/forgot-password')}>Ask for a new link</Button>}
        />
      ) : (
        <form className="stack gap-md" onSubmit={submit} noValidate>
          <p className="t-body-lg muted">
            Changing your password signs out every device and emails you to say it happened.
          </p>
          <TextField
            label="New password"
            type="password"
            autoComplete="new-password"
            helper="At least 10 characters. A phrase works well."
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={error}
          />
          <Button type="submit" block disabled={busy}>
            {busy ? 'Changing…' : 'Change password'}
          </Button>
        </form>
      )}
    </Page>
  );
}
