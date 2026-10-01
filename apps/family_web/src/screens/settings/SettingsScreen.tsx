import { Bell, ChevronRight, Clock, CreditCard, LogOut, Phone, ShieldCheck, UserPlus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { useConfirm, useFeedback } from '../../components/feedback';
import { AppCard, Avatar, Button, Page, SectionHeader, SwitchRow } from '../../components/ui';
import { VerificationBanner } from '../../components/VerificationBanner';
import { addressShortLine, initialsOf, patientFirstInitial } from '../../domain/models';
import { activePatients } from '../../state/careState';
import { useCare, useStore } from '../../state/context';

export function SettingsScreen() {
  const state = useCare();
  const store = useStore();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const { showFailure } = useFeedback();
  const user = state.user;

  return (
    <Page title="Settings">
      <div className="stack">
        <VerificationBanner />
        {user && (
          <AppCard>
            <div className="row">
              <Avatar text={initialsOf(user.fullName)} size="lg" />
              <div className="grow">
                <p className="t-title">{user.fullName}</p>
                <p className="t-body muted">{user.email}</p>
              </div>
            </div>
          </AppCard>
        )}

        <div className="mt-lg">
          <SectionHeader title="Reading and accessibility" />
          <AppCard>
            <SwitchRow
              title="Simplified mode"
              subtitle="Larger text throughout. Intended for the person being cared for when they hold the phone themselves — or for anyone who prefers it."
              checked={state.simplifiedMode}
              onChange={async (value) => {
                try {
                  await store.setSimplifiedMode(value);
                } catch (error) {
                  showFailure(error);
                }
              }}
            />
          </AppCard>
          <p className="t-small muted mt-sm">
            CareBridge also follows your browser’s text size and contrast settings.
          </p>
        </div>

        <div className="mt-lg">
          <SectionHeader title="People you care for" />
          <div className="stack gap-sm">
            {activePatients(state).map((patient) => (
              <AppCard key={patient.id} onClick={() => navigate(`/patients/${patient.id}`)}>
                <div className="row">
                  <Avatar text={patientFirstInitial(patient)} />
                  <div className="grow">
                    <p className="t-body-lg">{patient.preferredName}</p>
                    <p className="t-body muted">{addressShortLine(patient.homeAddress)}</p>
                  </div>
                  <ChevronRight aria-hidden />
                </div>
              </AppCard>
            ))}
            <Button variant="outlined" icon={UserPlus} block onClick={() => navigate('/patients/new')}>
              Add someone
            </Button>
          </div>
        </div>

        <div className="mt-lg">
          <SectionHeader title="Your account" />
          <AppCard flush>
            <NavTile
              icon={ShieldCheck}
              title="Account security"
              subtitle="Where you are signed in, and your password"
              onClick={() => navigate('/settings/security')}
            />
            <NavTile
              icon={CreditCard}
              title="Your plan"
              subtitle="What you pay, what it covers, and when it renews"
              onClick={() => navigate('/settings/plan')}
            />
            <NavTile
              icon={Bell}
              title="Notifications"
              subtitle="Which events reach you by email and push"
              onClick={() => navigate('/settings/notifications')}
            />
            <NavTile
              icon={Phone}
              title="Calls and messages"
              subtitle="Your number for relay calls, and alerts in this browser"
              onClick={() => navigate('/settings/calls')}
            />
          </AppCard>
        </div>

        <div className="mt-lg">
          <SectionHeader title="Not built yet" />
          <AppCard>
            <p className="t-body muted">
              These need more of the platform, and are listed here rather than shown as controls that
              do nothing.
            </p>
            <div className="mt-sm">
              {['Push notifications in the browser', 'Downloading your data at any time'].map((item) => (
                <div key={item} className="row tight" style={{ padding: '4px 0' }}>
                  <Clock size={18} className="muted" aria-hidden />
                  <p className="t-body grow">{item}</p>
                </div>
              ))}
            </div>
          </AppCard>
        </div>

        <AppCard className="mt-lg">
          <p className="t-title">Safety</p>
          <p className="t-body mt-xs">
            CareBridge coordinates appointments and transport. It is not a medical service and not an
            emergency service. In an emergency, call 911.
          </p>
        </AppCard>

        <Button
          variant="outlined"
          icon={LogOut}
          block
          className="mt-lg"
          onClick={async () => {
            const confirmed = await confirm({
              title: 'Sign out?',
              message: 'You will need to sign in again to see appointments and trips.',
              confirmLabel: 'Sign out',
              cancelLabel: 'Stay signed in',
              destructive: false,
            });
            if (!confirmed) return;
            // `signOut` swallows a server failure and clears the local session
            // regardless, so this can never leave someone stuck signed in.
            await store.signOut();
            navigate('/sign-in', { replace: true });
          }}
        >
          Sign out
        </Button>
      </div>
    </Page>
  );
}

export function NavTile(props: {
  icon: typeof Bell;
  title: string;
  subtitle: string;
  onClick: () => void;
  danger?: boolean;
}) {
  const Icon = props.icon;
  return (
    <button type="button" className="tile" onClick={props.onClick}>
      <Icon aria-hidden className={props.danger ? 'error-text' : 'muted'} style={{ flex: '0 0 auto' }} />
      <span className="grow">
        <span className="tile-title" style={{ display: 'block' }}>
          {props.title}
        </span>
        <span className="tile-sub">{props.subtitle}</span>
      </span>
      <ChevronRight aria-hidden />
    </button>
  );
}
