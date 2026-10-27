import {
  Accessibility,
  CircleCheck,
  Crosshair,
  HandHeart,
  MapPin,
  MapPinOff,
  Phone,
  SunMedium,
  UserX,
  CircleDot,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { useConfirm } from '../components/feedback';
import { useRun } from '../components/useRun';
import {
  Button,
  Centered,
  EmptyState,
  FailureBlock,
  InfoCard,
  Page,
  RequirementChip,
  Spinner,
} from '../components/ui';
import {
  offersNoShow,
  placeOneLine,
  primaryMove,
  type Job,
  type Place,
} from '../domain/models';
import { actionLabel, driverLabel } from '../domain/rideStatus';
import type { LocationAccess } from '../services/positionSource';
import type { SharingState } from '../services/locationService';
import { useDriver, usePageVisible, useSharing, useStore } from '../state/context';
import { formatCountdown, formatTime } from './format';
import { JobContact } from './messages/JobContact';

/**
 * One ride, from the driver's seat — arranged around a single enormous button,
 * with everything above it answering the question that button asks.
 */
export function JobScreen() {
  const { rideId } = useParams();
  const store = useStore();
  const navigate = useNavigate();
  const { jobs } = useDriver();

  let body;
  if (jobs.value === null) {
    body = jobs.error ? (
      <FailureBlock error={jobs.error} onRetry={() => void store.refreshJobs()} />
    ) : (
      <Centered>
        <Spinner />
      </Centered>
    );
  } else {
    const job = jobs.value.find((j) => j.id === rideId);
    if (!job) {
      // Finished, or handed to somebody else. Both ordinary; neither an error.
      body = (
        <EmptyState
          icon={CircleCheck}
          title="This ride is done"
          message="It is no longer on your list. Go back to see what is next."
          action={
            <Button variant="outlined" onClick={() => navigate('/today')}>
              Back to today
            </Button>
          }
        />
      );
    } else {
      return (
        <Page title="Ride" back="/today" footer={<Actions job={job} />}>
          <JobBody job={job} />
        </Page>
      );
    }
  }

  return (
    <Page title="Ride" back="/today">
      {body}
    </Page>
  );
}

function JobBody({ job }: { job: Job }) {
  return (
    <div className="stack gap-md">
      <Passenger job={job} />
      <div className="stack gap-sm">
        <Stop
          icon={CircleDot}
          title="Pick up"
          place={job.pickup}
          at={job.scheduledPickupAt}
        />
        <Stop icon={MapPin} title="Drop off" place={job.destination} />
      </div>
      {job.notesForDriver && (
        <InfoCard label="Notes">
          <p className="t-label">Notes</p>
          <p className="mt-xs">{job.notesForDriver}</p>
        </InfoCard>
      )}
      <JobContact rideId={job.id} />
      <SharingCard />
    </div>
  );
}

function Passenger({ job }: { job: Job }) {
  return (
    <InfoCard label="Passenger">
      <h2 className="t-headline">{job.passengerName}</h2>
      <p className="muted">{driverLabel(job.status)}</p>
      {(job.wheelchairRequired || job.assistanceRequired) && (
        <div className="chips mt-md">
          {job.wheelchairRequired && (
            <RequirementChip icon={Accessibility} label="Wheelchair" />
          )}
          {job.assistanceRequired && (
            <RequirementChip icon={HandHeart} label="Needs help to the door" />
          )}
        </div>
      )}
      {job.passengerPhone && (
        // A call from the kerb is what stops a five-minute wait becoming a
        // no-show, so it is a button rather than a number to copy out.
        <a
          className="btn btn-outlined mt-md"
          href={`tel:${job.passengerPhone.replace(/\s/g, '')}`}
        >
          <Phone size={22} aria-hidden />
          Call {job.passengerName}
        </a>
      )}
    </InfoCard>
  );
}

function Stop(props: { icon: LucideIcon; title: string; place: Place; at?: Date }) {
  const Icon = props.icon;
  return (
    <InfoCard label={props.title}>
      <div className="row start">
        <Icon className="ink-primary" aria-hidden style={{ flex: '0 0 auto' }} />
        <div className="grow">
          <div className="row">
            <span className="t-label grow">{props.title}</span>
            {props.at && <span className="t-label">{formatTime(props.at)}</span>}
          </div>
          <p className="t-body-lg mt-xs">{placeOneLine(props.place)}</p>
          {props.place.accessNotes && (
            <p className="muted mt-xs">{props.place.accessNotes}</p>
          )}
        </div>
      </div>
    </InfoCard>
  );
}

/**
 * What the app is doing with the driver's location, said plainly: that it is
 * happening, how recently anything was sent, and — when a dead zone has
 * stopped it — that a backlog is waiting rather than that all is well.
 *
 * The web adds one thing the app never had to say: a browser stops sharing
 * when the page is hidden or the phone locks.
 */
function SharingCard() {
  const state = useSharing();
  const visible = usePageVisible();

  if (state.access !== 'granted' && state.access !== 'prompt') {
    return (
      <InfoCard className="warn" label="Location">
        <div className="row start">
          <MapPinOff className="error-text" aria-hidden style={{ flex: '0 0 auto' }} />
          <p className="grow">{accessMessage(state.access)}</p>
        </div>
      </InfoCard>
    );
  }

  if (state.rideId === null) return null;

  return (
    <InfoCard label="Location sharing">
      <div className="row start">
        <Crosshair className="ink-primary" aria-hidden style={{ flex: '0 0 auto' }} />
        <div className="grow">
          <p className="t-label">
            {state.access === 'prompt'
              ? 'Allow location when your browser asks'
              : 'Sharing your location with the family'}
          </p>
          <p className="muted">{detail(state)}</p>
        </div>
      </div>
      <div className="row start mt-md keep-open">
        <SunMedium aria-hidden style={{ flex: '0 0 auto' }} />
        <p className="grow t-body">
          {!visible
            ? 'Paused — come back to this page to keep sharing.'
            : state.keptAwake
              ? 'Keep this page open. The screen will stay on while you drive.'
              : 'Keep this page open and the screen on. Your browser stops sharing when the phone locks or you switch apps.'}
        </p>
      </div>
    </InfoCard>
  );
}

function detail(state: SharingState): string {
  if (state.queued > 0) {
    // The only visible sign of a dead zone; a driver who can see it can mention it.
    return `${state.queued} ${state.queued === 1 ? 'update' : 'updates'} waiting for signal.`;
  }
  if (state.cadenceMs === null) return 'Up to date.';
  return `Updating every ${Math.round(state.cadenceMs / 1000)} seconds.`;
}

function accessMessage(access: LocationAccess): string {
  switch (access) {
    case 'unavailable':
      return 'Your phone cannot find its location. Check that location is switched on. The family cannot see where you are.';
    case 'unsupported':
      return 'This browser cannot share location here. Open CareBridge over a secure (https) connection in Chrome or Safari.';
    case 'blocked':
    default:
      // Asking again does nothing once refused, so say where to go instead.
      return 'Location is blocked for this site. Allow it in your browser’s site settings, then come back to this page.';
  }
}

function Actions({ job }: { job: Job }) {
  const store = useStore();
  const { run, busy } = useRun();
  const next = primaryMove(job);

  return (
    <div className="stack gap-sm">
      {next && (
        <Button busy={busy} onClick={() => void run(() => store.advance(job.id, next))}>
          {actionLabel(next)}
        </Button>
      )}
      {/* Deliberately not a second big button beside the first: this one ends
          the ride and tells a family their relative did not come out. */}
      {offersNoShow(job) && <NoShowButton job={job} />}
    </div>
  );
}

/** "Nobody came out", behind a wait and a confirmation. */
function NoShowButton({ job }: { job: Job }) {
  const store = useStore();
  const confirm = useConfirm();
  const { run, busy } = useRun();
  const [remaining, setRemaining] = useState(job.noShowAvailableInSeconds ?? 0);

  // A fresh figure from the server replaces the local count.
  useEffect(() => {
    if (job.noShowAvailableInSeconds !== null)
      setRemaining(job.noShowAvailableInSeconds);
  }, [job.noShowAvailableInSeconds]);

  // Counted down locally between polls: a button that refuses without
  // explaining itself is tapped four times and then telephoned about.
  useEffect(() => {
    const tick = setInterval(() => setRemaining((r) => (r > 0 ? r - 1 : 0)), 1_000);
    return () => clearInterval(tick);
  }, []);

  const ready = remaining <= 0;

  async function record() {
    const confirmed = await confirm({
      title: 'Record a no-show?',
      message: `This ends the ride and tells ${job.passengerName}’s family that nobody came out. Try calling them first if you have not.`,
      confirmLabel: 'Record no-show',
      cancelLabel: 'Keep waiting',
    });
    if (confirmed) await run(() => store.advance(job.id, 'noShow'));
  }

  return (
    <Button
      variant="danger-outlined"
      icon={UserX}
      disabled={!ready}
      busy={busy}
      onClick={() => void record()}
    >
      {ready
        ? 'Nobody came out'
        : `Nobody came out — wait ${formatCountdown(remaining)}`}
    </Button>
  );
}
