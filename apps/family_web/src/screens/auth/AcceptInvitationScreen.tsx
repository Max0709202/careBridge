import { CircleAlert, UserCheck } from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { failureMessage } from '../../api/failures';
import { AppCard, Button, EmptyState, InfoRow, Page } from '../../components/ui';
import { userIsEmailVerified } from '../../domain/models';
import { useCare, useStore } from '../../state/context';

/**
 * The landing screen for an invitation link. A screen rather than a silent
 * redirect, because acceptance can fail for a reason the person can act on:
 * the link is bound to one address, and works only once it is confirmed.
 */
export function AcceptInvitationScreen() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const store = useStore();
  const { user } = useCare();
  const navigate = useNavigate();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [accepted, setAccepted] = useState(false);

  async function accept() {
    setBusy(true);
    setError(null);
    try {
      await store.acceptInvitation(token);
      setAccepted(true);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page title="Invitation" back>
      <div className="stack">
        {accepted ? (
          <AppCard>
            <EmptyState
              icon={UserCheck}
              title="You are in"
              message="You can now see this person’s appointments and follow their rides."
              action={
                <Button onClick={() => navigate('/')}>Go to the dashboard</Button>
              }
            />
          </AppCard>
        ) : (
          <>
            <AppCard>
              <h2 className="t-title">Join a care circle</h2>
              <p className="t-body mt-sm">
                Accepting gives you access to someone’s appointments, their home
                address, and where they are during a ride. Only accept an invitation you
                were expecting.
              </p>
              {user && (
                <div className="mt-md">
                  <InfoRow label="Signed in as" value={user.email} />
                  {!userIsEmailVerified(user) && (
                    <p className="t-body error-text mt-sm">
                      Confirm this address first — an invitation only works for an
                      address its owner has proved they hold.
                    </p>
                  )}
                </div>
              )}
            </AppCard>
            {error !== null && (
              <AppCard className="mt-md">
                <div className="row">
                  <CircleAlert className="error-text" aria-hidden />
                  <p className="grow" role="alert">
                    {failureMessage(error)}
                  </p>
                </div>
              </AppCard>
            )}
            <Button block className="mt-lg" disabled={busy} onClick={accept}>
              {busy ? 'Joining…' : 'Accept the invitation'}
            </Button>
            <Button variant="text" block onClick={() => navigate('/')}>
              Not now
            </Button>
          </>
        )}
      </div>
    </Page>
  );
}
