import {
  CloudOff,
  Link2Off,
  Mail,
  MailWarning,
  RefreshCw,
  Send,
  TimerOff,
  UserCheck,
  UserPlus,
  type LucideIcon,
} from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';

import type { Invitation } from '../../api/careApi';
import { Modal, useConfirm, useFeedback } from '../../components/feedback';
import { useRun } from '../../components/useRun';
import {
  AppCard,
  Button,
  CheckboxRow,
  EmptyState,
  IconButton,
  Page,
  SectionHeader,
  SelectField,
  Spinner,
  TextField,
} from '../../components/ui';
import { formatMediumDate } from '../../core/formatting';
import { userIsEmailVerified } from '../../domain/models';
import {
  FAMILY_PERMISSIONS,
  permissionLabel,
  RELATIONSHIP_TYPES,
  relationshipLabel,
  type FamilyPermission,
  type RelationshipType,
} from '../../domain/permissions';
import { useApi, useCare } from '../../state/context';

/**
 * Who can see this patient, and who has been asked to. An invitation grants
 * standing access to a vulnerable person's address, schedule and live
 * position; the copy says so plainly. Port of care_circle_screen.dart.
 */
export function CareCircleScreen() {
  const { id = '' } = useParams();
  const api = useApi();
  const { user } = useCare();
  const confirm = useConfirm();
  const { run, busy } = useRun();
  const verified = user ? userIsEmailVerified(user) : false;

  const [invitations, setInvitations] = useState<Invitation[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [inviting, setInviting] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setInvitations(await api.invitations(id));
    } catch (e) {
      setError(e);
    }
  }, [api, id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function revoke(invitation: Invitation) {
    const confirmed = await confirm({
      title: 'Revoke this invitation?',
      message: 'The link stops working immediately. You can send a new one at any time.',
      confirmLabel: 'Revoke it',
      cancelLabel: 'Keep it',
    });
    if (!confirmed) return;
    await run(async () => {
      await api.revokeInvitation(id, invitation.id);
      await load();
    });
  }

  let list;
  if (error !== null) {
    list = (
      <AppCard>
        <EmptyState
          icon={CloudOff}
          title="Could not load invitations"
          message="Check your connection and try again."
          action={<Button variant="outlined" onClick={load}>Retry</Button>}
        />
      </AppCard>
    );
  } else if (invitations === null) {
    list = (
      <AppCard>
        <Spinner />
      </AppCard>
    );
  } else if (invitations.length === 0) {
    list = (
      <AppCard>
        <EmptyState
          icon={Mail}
          title="No invitations yet"
          message="Invite a relative so they can see appointments and follow a ride without having to call you."
        />
      </AppCard>
    );
  } else {
    list = (
      <AppCard flush>
        {invitations.map((invitation) => {
          const Icon = statusIcon[invitation.status];
          return (
            <div key={invitation.id} className="tile">
              <Icon className={statusInk[invitation.status]} aria-hidden style={{ flex: '0 0 auto' }} />
              <div className="grow">
                {/* Masked by the server: enough for the invitee to recognise
                    their address, not enough for the circle to harvest one. */}
                <p className="tile-title">{invitation.emailHint}</p>
                <p className="tile-sub">{subtitle(invitation)}</p>
              </div>
              {invitation.status === 'pending' && (
                <IconButton icon={Link2Off} label="Revoke" disabled={busy} onClick={() => revoke(invitation)} />
              )}
            </div>
          );
        })}
      </AppCard>
    );
  }

  return (
    <Page title="Care circle" back actions={<IconButton icon={RefreshCw} label="Refresh" onClick={load} />}>
      <div className="stack">
        {!verified && (
          <AppCard className="mb-md">
            <div className="row">
              <MailWarning className="error-text" aria-hidden style={{ flex: '0 0 auto' }} />
              <p className="t-body grow">
                Confirm your own email address before inviting anyone. An unconfirmed address is one
                nobody has proved they own.
              </p>
            </div>
          </AppCard>
        )}
        <AppCard>
          <p className="t-body muted">
            Anyone you invite can see this person’s home address, their appointments, and where they
            are during a ride. The link works once, expires in a week, and only works for the address
            you send it to.
          </p>
        </AppCard>
        <div className="mt-lg">
          <SectionHeader title="Invitations" />
          {list}
        </div>
        <div style={{ height: 'calc(var(--space-xl) * 2)' }} />
      </div>

      <button type="button" className="fab no-nav" disabled={!verified} onClick={() => setInviting(true)}>
        <UserPlus aria-hidden /> Invite someone
      </button>

      {inviting && (
        <InviteSheet
          patientId={id}
          onClose={(sent) => {
            setInviting(false);
            if (sent) void load();
          }}
        />
      )}
    </Page>
  );
}

const statusIcon: Record<Invitation['status'], LucideIcon> = {
  pending: Send,
  accepted: UserCheck,
  revoked: Link2Off,
  expired: TimerOff,
};

const statusInk: Record<Invitation['status'], string> = {
  pending: 'muted',
  accepted: 'ink-primary',
  revoked: 'muted',
  expired: 'muted',
};

function subtitle(invitation: Invitation): string {
  switch (invitation.status) {
    case 'pending':
      return `Invited as ${relationshipLabel[invitation.relationship].toLowerCase()} · expires ${formatMediumDate(new Date(invitation.expiresAt))}`;
    case 'accepted':
      return 'Accepted — they have access';
    case 'revoked':
      return 'Revoked';
    case 'expired':
      return 'Expired without being used';
  }
}

function InviteSheet({ patientId, onClose }: { patientId: string; onClose: (sent: boolean) => void }) {
  const api = useApi();
  const { showFailure } = useFeedback();
  const [email, setEmail] = useState('');
  const [relationship, setRelationship] = useState<RelationshipType>('son');
  // `viewProfile` is preselected and cannot be removed: every other
  // permission stands on it.
  const [permissions, setPermissions] = useState<FamilyPermission[]>(['viewProfile']);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const value = email.trim();
    if (value === '') return setEmailError('Enter an email address.');
    if (!value.includes('@') || !value.includes('.')) {
      return setEmailError('That does not look like an email address.');
    }
    setEmailError(null);

    setBusy(true);
    try {
      await api.invite({ patientId, email: value, relationship, permissions });
      onClose(true);
    } catch (error) {
      showFailure(error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal sheet title="Invite someone" onClose={() => onClose(false)}>
      <form className="stack gap-md" onSubmit={submit} noValidate>
        <TextField
          label="Their email address"
          type="email"
          autoComplete="email"
          helper="The invitation only works for this address, and only once they have confirmed it."
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={emailError}
        />
        <SelectField
          label="Relationship"
          value={relationship}
          onChange={(e) => setRelationship(e.target.value as RelationshipType)}
        >
          {RELATIONSHIP_TYPES.map((r) => (
            <option key={r} value={r}>
              {relationshipLabel[r]}
            </option>
          ))}
        </SelectField>
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="t-title-sm">What they can do</legend>
          {FAMILY_PERMISSIONS.map((permission) => (
            <CheckboxRow
              key={permission}
              checked={permissions.includes(permission)}
              disabled={permission === 'viewProfile'}
              onChange={(checked) =>
                setPermissions((current) =>
                  checked ? [...current, permission] : current.filter((p) => p !== permission),
                )
              }
              title={permissionLabel[permission]}
            />
          ))}
        </fieldset>
        <Button type="submit" block disabled={busy}>
          {busy ? 'Sending…' : 'Send the invitation'}
        </Button>
      </form>
    </Modal>
  );
}
