import { CloudOff, Copy, Shield, ShieldCheck } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';

import type { MfaEnrolment, MfaStatus } from '../../api/careApi';
import { useConfirm, useFeedback } from '../../components/feedback';
import { AppCard, Button, EmptyState, Page, SectionHeader, Spinner, TextField } from '../../components/ui';
import { groupInFours } from '../../core/formatting';
import { useApi } from '../../state/context';

/**
 * Two-factor enrolment: enrol → confirm, never collapsed. Marking it active the
 * moment the secret is shown would lock out anyone whose authenticator did not
 * take the key — with no second factor left to recover with.
 */
export function TwoFactorScreen() {
  const api = useApi();
  const confirm = useConfirm();
  const { showFailure, showConfirmation } = useFeedback();

  const [status, setStatus] = useState<MfaStatus | null>(null);
  const [enrolment, setEnrolment] = useState<MfaEnrolment | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setStatus(await api.mfaStatus());
    } catch (e) {
      setError(e);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  async function guarded(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
    } catch (e) {
      showFailure(e);
    } finally {
      setBusy(false);
    }
  }

  const begin = () => guarded(async () => setEnrolment(await api.beginMfaEnrolment()));

  const confirmCode = (e?: FormEvent) => {
    e?.preventDefault();
    return guarded(async () => {
      await api.confirmMfa(code.trim());
      setCode('');
      setEnrolment(null);
      await load();
      showConfirmation('Two-factor authentication is on.');
    });
  };

  async function disable() {
    const confirmed = await confirm({
      title: 'Turn off two-factor authentication?',
      message:
        'Signing in will only need your password again. Anyone who learns it can see this patient’s address and where they are during a ride.',
      confirmLabel: 'Turn it off',
      cancelLabel: 'Keep it on',
    });
    if (!confirmed) return;
    await guarded(async () => {
      await api.disableMfa();
      await load();
    });
  }

  async function copyKey(secret: string) {
    try {
      await navigator.clipboard.writeText(secret);
      showConfirmation('Key copied.');
    } catch (e) {
      showFailure(e);
    }
  }

  let body;
  if (error !== null) {
    body = (
      <AppCard>
        <EmptyState
          icon={CloudOff}
          title="Could not load your settings"
          message="Check your connection and try again."
          action={<Button variant="outlined" onClick={load}>Retry</Button>}
        />
      </AppCard>
    );
  } else if (enrolment) {
    body = (
      <div className="stack">
        <SectionHeader title="1 · Add it to your authenticator app" />
        <AppCard>
          <p className="t-body">
            Type this key into an authenticator app — Google Authenticator, 1Password, or whatever you
            already use.
          </p>
          <p className="t-title mono mt-md" style={{ letterSpacing: '0.1em', userSelect: 'all' }}>
            {groupInFours(enrolment.secretBase32)}
          </p>
          <Button variant="text" icon={Copy} className="align-start mt-sm" onClick={() => copyKey(enrolment.secretBase32)}>
            Copy the key
          </Button>
          <p className="t-small muted mt-sm">
            On this device you can also{' '}
            <a href={enrolment.otpauthUri}>open it in your authenticator app</a>.
          </p>
        </AppCard>

        <div className="mt-lg">
          <SectionHeader title="2 · Save your recovery codes" />
          <AppCard>
            <p className="t-body">
              Shown once, and never again — not even to support. Put them somewhere that is not your
              phone.
            </p>
            <pre className="t-body-lg mono mt-md" style={{ margin: 'var(--space-md) 0 0', userSelect: 'all' }}>
              {enrolment.recoveryCodes.join('\n')}
            </pre>
          </AppCard>
        </div>

        <div className="mt-lg">
          <SectionHeader title="3 · Confirm it works" />
          <AppCard>
            <p className="t-body muted">
              Nothing changes until a code from your app is accepted. That is deliberate — turning it
              on before checking would lock you out if the app did not take the key.
            </p>
            <form className="stack gap-md mt-md" onSubmit={confirmCode} noValidate>
              <TextField
                label="Six-digit code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
              <Button type="submit" block disabled={busy}>
                {busy ? 'Checking…' : 'Turn on two-factor'}
              </Button>
              <Button variant="text" block disabled={busy} onClick={() => setEnrolment(null)}>
                Cancel
              </Button>
            </form>
          </AppCard>
        </div>
      </div>
    );
  } else if (status === null) {
    body = <Spinner />;
  } else if (status.enrolled) {
    body = (
      <AppCard>
        <div className="row tight">
          <ShieldCheck className="ink-primary" aria-hidden />
          <p className="t-title">On</p>
        </div>
        <p className="t-body muted mt-sm">
          {status.recoveryCodesRemaining} recovery codes left. Each one works once, and they are the
          only way in if you lose your phone.
        </p>
        <Button variant="outlined" icon={Shield} className="mt-md" disabled={busy} onClick={disable}>
          Turn off
        </Button>
      </AppCard>
    );
  } else {
    body = (
      <AppCard>
        <p className="t-title">Off</p>
        <p className="t-body mt-sm">
          With two-factor authentication on, signing in needs your password and a six-digit code from
          an app on your phone. Someone who learns your password still cannot get in.
        </p>
        <Button icon={Shield} className="mt-md" disabled={busy} onClick={begin}>
          Set it up
        </Button>
      </AppCard>
    );
  }

  return (
    <Page title="Two-factor authentication" back>
      {body}
    </Page>
  );
}
