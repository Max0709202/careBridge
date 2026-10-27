/**
 * Where the verification email's `/verify-email?token=…` link lands.
 *
 * Confirmation happens when the person presses the button, not on page load:
 * mail scanners pre-fetch links, and a single-use token spent by a scanner is a
 * link that "does not work" for the human who clicks it a minute later.
 */
import { MailCheck, MailWarning } from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { failureMessage } from '../../api/failures';
import { AppCard, Button, EmptyState, Page } from '../../components/ui';
import { isSignedIn } from '../../state/careState';
import { useApi, useCare, useStore } from '../../state/context';

export function VerifyEmailScreen() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const api = useApi();
  const store = useStore();
  const state = useCare();
  const navigate = useNavigate();

  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await api.verifyEmail(token);
      // Re-read, so the banner asking for confirmation goes away at once.
      if (isSignedIn(state)) await store.refresh().catch(() => undefined);
      setDone(true);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const home = isSignedIn(state) ? '/' : '/sign-in';

  return (
    <Page title="Confirm your email" narrow>
      <AppCard>
        {done ? (
          <EmptyState
            icon={MailCheck}
            title="Your address is confirmed"
            message="You can now invite relatives and accept invitations."
            action={
              <Button onClick={() => navigate(home, { replace: true })}>
                Continue
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={error ? MailWarning : MailCheck}
            title="Confirm your email address"
            message={
              error
                ? failureMessage(error)
                : 'This proves the address is yours, which is what lets you invite a relative or accept an invitation.'
            }
            action={
              <Button disabled={busy || token === ''} onClick={confirm}>
                {busy ? 'Confirming…' : 'Confirm my address'}
              </Button>
            }
          />
        )}
      </AppCard>
    </Page>
  );
}
