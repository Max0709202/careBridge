import {
  CircleCheck,
  CirclePause,
  Clock,
  CloudOff,
  Copy,
  Download,
  LogOut,
  Trash2,
  UserX,
  type LucideIcon,
} from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';

import type { DeletionStatus } from '../../api/careApi';
import { useConfirm, useFeedback } from '../../components/feedback';
import { AppCard, Button, EmptyState, Page, SectionHeader, Spinner } from '../../components/ui';
import { formatLongDate } from '../../core/formatting';
import { useApi, useStore } from '../../state/context';

/**
 * The way out. The most common reason somebody deletes an account in this
 * product is that the person they coordinated care for has died, so this
 * explains rather than warns, says plainly what is and is not destroyed, and
 * makes the undo obvious before asking. Three states: the explanation, a
 * refusal with its remedy, and — once scheduled — the export.
 */
export function DeleteAccountScreen() {
  const api = useApi();
  const store = useStore();
  const confirm = useConfirm();
  const { showFailure, showConfirmation } = useFeedback();

  const [status, setStatus] = useState<DeletionStatus | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  /** Set once scheduled. This session is then already signed out server-side. */
  const [exported, setExported] = useState<Record<string, unknown> | null>(null);
  const [scheduledFor, setScheduledFor] = useState<Date | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setStatus(await api.deletionStatus());
    } catch (e) {
      setError(e);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  async function remove() {
    if (!status) return;
    const confirmed = await confirm({
      title: 'Delete your account?',
      message:
        `Every device is signed out now. The account itself is deleted in ${status.graceDays} days — and signing in again before then cancels it.\n\n` +
        'Invoices and payment records are kept for as long as the law requires, with nothing left on them that identifies you.',
      confirmLabel: 'Delete my account',
      cancelLabel: 'Keep my account',
      destructive: true,
    });
    if (!confirmed) return;

    setBusy(true);
    try {
      const receipt = await api.deleteAccount();
      setExported(receipt.data);
      setScheduledFor(new Date(receipt.scheduledFor));
    } catch (e) {
      showFailure(e);
      // A refusal is a state, not a transient error: reload so the blockers
      // are on screen with their remedies.
      await load();
    } finally {
      setBusy(false);
    }
  }

  const json = exported ? JSON.stringify(exported, null, 2) : '';

  async function copyExport() {
    try {
      await navigator.clipboard.writeText(json);
      showConfirmation('Your data was copied to the clipboard.');
    } catch (e) {
      showFailure(e);
    }
  }

  function downloadExport() {
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'carebridge-account-export.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }

  if (exported) {
    return (
      // Once scheduled, going back lands on a screen whose session is dead.
      // The only way on is forwards.
      <Page title="Delete account">
        <div className="stack">
          <AppCard>
            <div className="stack gap-sm center" style={{ alignItems: 'center' }}>
              <CircleCheck size={40} className="ink-primary" aria-hidden />
              <h2 className="t-title-lg">Your account is scheduled for deletion</h2>
              <p className="t-body muted">
                {scheduledFor
                  ? `It will be deleted on ${formatLongDate(scheduledFor)}. Every device has been signed out. If you change your mind, sign in again before then — that cancels it.`
                  : 'Every device has been signed out.'}
              </p>
            </div>
          </AppCard>

          <div className="mt-lg">
            <SectionHeader title="Your data" />
            <AppCard>
              <p className="t-body muted">
                This is everything we hold about the account, as it was when you asked. Take it now if
                you want it — signing back in to fetch it would cancel the deletion.
              </p>
              <div className="wrap mt-md">
                <Button variant="tonal" icon={Copy} onClick={copyExport}>
                  Copy my data
                </Button>
                <Button variant="tonal" icon={Download} onClick={downloadExport}>
                  Download it as a file
                </Button>
              </div>
              <pre className="code-box mono mt-md" style={{ userSelect: 'all' }}>
                {json}
              </pre>
            </AppCard>
          </div>

          {/* The tokens are already gone and the server has raised the token
              version; there is no session left to end, only local state. */}
          <Button block className="mt-lg" onClick={() => store.forgetSession()}>
            Done
          </Button>
        </div>
      </Page>
    );
  }

  let body;
  if (error !== null) {
    body = (
      <AppCard>
        <EmptyState
          icon={CloudOff}
          title="Could not load your account"
          message="Check your connection and try again."
          action={<Button variant="outlined" onClick={load}>Retry</Button>}
        />
      </AppCard>
    );
  } else if (status === null) {
    body = (
      <AppCard>
        <Spinner />
      </AppCard>
    );
  } else {
    const blocked = status.blockerMessages.length > 0;
    body = (
      <div className="stack">
        <SectionHeader title="What happens" />
        <AppCard>
          <Bullet icon={LogOut}>Every device is signed out straight away.</Bullet>
          <Bullet icon={Clock}>
            The account is deleted {status.graceDays} days from now. Signing in again before then
            cancels it — that is all it takes.
          </Bullet>
          <Bullet icon={UserX}>
            Your name, address, phone number, sign-in details and notification history are removed.
          </Bullet>
          <Bullet icon={Download}>
            You get a copy of everything we hold, on this screen, before you go.
          </Bullet>
        </AppCard>

        <div className="mt-lg">
          <SectionHeader title="What is kept" />
          <AppCard>
            <p className="t-body muted pre">
              {'Invoices, payments and the log of actions taken on the account are kept for as long as financial and audit rules require — with nothing left on them that identifies you.\n\nWe would rather tell you that now than have you find an invoice with your name on it later.'}
            </p>
          </AppCard>
        </div>

        {blocked && (
          <div className="mt-lg">
            <SectionHeader title="Not just yet" />
            <div className="stack gap-sm">
              {status.blockerMessages.map((message) => (
                <AppCard key={message}>
                  <div className="row start tight">
                    <CirclePause className="error-text" aria-hidden style={{ flex: '0 0 auto' }} />
                    <p className="t-body grow">{message}</p>
                  </div>
                </AppCard>
              ))}
            </div>
          </div>
        )}

        {/* Refusals are decided on the server; disabling here only keeps the
            person from tapping into an error they can already read above. */}
        <Button variant="danger" icon={Trash2} block className="mt-lg" disabled={busy || blocked} onClick={remove}>
          {busy ? 'Deleting…' : 'Delete my account'}
        </Button>
        <p className="t-small muted center mt-sm">
          You can also do this from <a href="/delete-account">our website</a> without signing in.
        </p>
      </div>
    );
  }

  return (
    <Page title="Delete account" back>
      {body}
    </Page>
  );
}

function Bullet({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <div className="row start tight" style={{ paddingBottom: 'var(--space-sm)' }}>
      <Icon size={20} className="muted" aria-hidden style={{ flex: '0 0 auto', marginTop: 2 }} />
      <p className="t-body grow">{children}</p>
    </div>
  );
}

