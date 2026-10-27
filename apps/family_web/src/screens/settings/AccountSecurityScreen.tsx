import {
  CloudOff,
  KeyRound,
  Laptop,
  LogOut,
  MonitorSmartphone,
  RefreshCw,
  Shield,
  Smartphone,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';

import type { SessionSummary } from '../../api/careApi';
import { Modal, useConfirm, useFeedback } from '../../components/feedback';
import { useRun } from '../../components/useRun';
import {
  AppCard,
  Button,
  EmptyState,
  IconButton,
  Page,
  SectionHeader,
  Spinner,
  TextField,
} from '../../components/ui';
import { formatSessionAge } from '../../core/formatting';
import { useApi, useStore } from '../../state/context';
import { NavTile } from './SettingsScreen';

/**
 * Sessions, password, and the way out of a device you no longer hold. The
 * session list answers "is anyone else signed in as me?" — a question worth
 * asking of an account that can see a vulnerable person's movements.
 */
export function AccountSecurityScreen() {
  const api = useApi();
  const store = useStore();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const { showConfirmation, showFailure } = useFeedback();
  const { run, busy } = useRun();

  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [changingPassword, setChangingPassword] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setSessions(await api.sessions());
    } catch (e) {
      setError(e);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  async function revoke(session: SessionSummary) {
    const confirmed = await confirm({
      title: `Sign out ${session.deviceLabel}?`,
      message:
        'That device will have to sign in again. Anything it is doing right now stops.',
      confirmLabel: 'Sign it out',
      cancelLabel: 'Cancel',
    });
    if (!confirmed) return;
    const result = await run(async () => {
      await api.revokeSession(session.id);
      await load();
    });
    if (result.ok) showConfirmation('That device was signed out.');
  }

  async function signOutEverywhere() {
    const confirmed = await confirm({
      title: 'Sign out everywhere?',
      message:
        'Every device, including this one, is signed out immediately — not when its session happens to expire.',
      confirmLabel: 'Sign out everywhere',
      cancelLabel: 'Cancel',
      destructive: true,
    });
    if (!confirmed) return;
    try {
      await api.signOutEverywhere();
      store.forgetSession();
    } catch (e) {
      showFailure(e);
    }
  }

  let sessionList;
  if (error !== null) {
    sessionList = (
      <AppCard>
        <EmptyState
          icon={CloudOff}
          title="Could not load your sessions"
          message="Check your connection and try again."
          action={
            <Button variant="outlined" onClick={load}>
              Retry
            </Button>
          }
        />
      </AppCard>
    );
  } else if (sessions === null) {
    sessionList = (
      <AppCard>
        <Spinner />
      </AppCard>
    );
  } else {
    sessionList = (
      <AppCard flush>
        {sessions.map((session) => {
          const Icon = iconFor(session.deviceLabel);
          return (
            <div key={session.id} className="tile">
              <Icon
                className={session.isCurrent ? 'ink-primary' : 'muted'}
                aria-hidden
                style={{ flex: '0 0 auto' }}
              />
              <div className="grow">
                <p className="tile-title">{session.deviceLabel}</p>
                <p className="tile-sub">
                  {session.isCurrent
                    ? 'This device'
                    : `Last used ${formatSessionAge(new Date(session.lastUsedAt))}`}
                </p>
              </div>
              {session.isCurrent ? (
                <span
                  className="chip"
                  style={{
                    background: 'var(--primary-container)',
                    color: 'var(--on-primary-container)',
                    borderColor: 'transparent',
                  }}
                >
                  Current
                </span>
              ) : (
                <IconButton
                  icon={LogOut}
                  label={`Sign out ${session.deviceLabel}`}
                  disabled={busy}
                  onClick={() => revoke(session)}
                />
              )}
            </div>
          );
        })}
      </AppCard>
    );
  }

  return (
    <Page
      title="Account security"
      back
      actions={<IconButton icon={RefreshCw} label="Refresh" onClick={load} />}
    >
      <div className="stack">
        <SectionHeader title="Where you are signed in" />
        {sessionList}

        <div className="mt-lg">
          <SectionHeader title="Password" />
          <AppCard>
            <p className="t-body muted">
              Changing your password signs out every device, including this one, and
              emails you to say it happened.
            </p>
            <Button
              variant="outlined"
              icon={KeyRound}
              block
              className="mt-md"
              onClick={() => setChangingPassword(true)}
            >
              Change password
            </Button>
          </AppCard>
        </div>

        <div className="mt-lg">
          <SectionHeader title="Two-factor authentication" />
          <AppCard flush>
            <NavTile
              icon={Shield}
              title="Two-factor authentication"
              subtitle="A code from your phone, as well as your password"
              onClick={() => navigate('/settings/security/two-factor')}
            />
          </AppCard>
        </div>

        <div className="mt-lg">
          <SectionHeader title="Everywhere" />
          <AppCard>
            <p className="t-body muted">
              If you have lost a phone, this is the fastest thing to do. It takes effect
              on the next request each device makes, not at the end of its session.
            </p>
            <Button
              variant="tonal"
              icon={LogOut}
              block
              className="mt-md"
              disabled={busy}
              onClick={signOutEverywhere}
            >
              Sign out everywhere
            </Button>
          </AppCard>
        </div>

        {/* Last, and deliberately not dressed up as a warning: the most common
            reason somebody reaches it is that the person they cared for has died. */}
        <div className="mt-lg">
          <SectionHeader title="Leaving" />
          <AppCard flush>
            <NavTile
              icon={Trash2}
              danger
              title="Delete account"
              subtitle="What is removed, what is kept, and how to undo it"
              onClick={() => navigate('/settings/security/delete')}
            />
          </AppCard>
        </div>
      </div>

      {changingPassword && (
        <ChangePasswordSheet
          onClose={(changed) => {
            setChangingPassword(false);
            // The server revoked every session, this one included.
            if (changed) store.forgetSession();
          }}
        />
      )}
    </Page>
  );
}

function iconFor(label: string): LucideIcon {
  if (label.includes('iPhone') || label.includes('Android')) return Smartphone;
  if (label.includes('Mac') || label.includes('Windows')) return Laptop;
  return MonitorSmartphone;
}

function ChangePasswordSheet({ onClose }: { onClose: (changed: boolean) => void }) {
  const api = useApi();
  const { showFailure } = useFeedback();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [errors, setErrors] = useState<{ current?: string; next?: string }>({});
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const found: typeof errors = {};
    if (current === '') found.current = 'Enter your current password.';
    if (next.length < 10) found.next = 'Use at least 10 characters.';
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setBusy(true);
    try {
      await api.changePassword(current, next);
      onClose(true);
    } catch (error) {
      showFailure(error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal sheet title="Change your password" onClose={() => onClose(false)}>
      <form className="stack gap-md" onSubmit={submit} noValidate>
        <TextField
          label="Current password"
          type="password"
          autoComplete="current-password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          error={errors.current}
        />
        <TextField
          label="New password"
          type="password"
          autoComplete="new-password"
          // Matches the server's rule exactly, so the form never accepts
          // something the server then rejects.
          helper="At least 10 characters. A phrase works well."
          value={next}
          onChange={(e) => setNext(e.target.value)}
          error={errors.next}
        />
        <Button type="submit" block disabled={busy}>
          {busy ? 'Changing…' : 'Change password'}
        </Button>
      </form>
    </Modal>
  );
}
