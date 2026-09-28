import {
  Accessibility,
  BadgeInfo,
  CalendarCheck,
  ChevronRight,
  FolderOpen,
  LogOut,
  Play,
  RefreshCw,
  CircleStop,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { Failure } from '../api/failures';
import { useRun } from '../components/useRun';
import { Button, Centered, EmptyState, FailureBlock, IconButton, InfoCard, Page, Spinner } from '../components/ui';
import { placeOneLine, vehicleDescription, type DriverProfile, type Job } from '../domain/models';
import { driverLabel } from '../domain/rideStatus';
import { useDriver, useStore } from '../state/context';
import { formatTime } from './format';

/**
 * The shift, and what is on it: are you working, and what is next. Read in a
 * car park before setting off, and not again until something changes.
 */
export function TodayScreen() {
  const store = useStore();
  const { profile } = useDriver();
  const navigate = useNavigate();
  const { run, busy } = useRun();

  return (
    <Page
      title="Today"
      actions={
        <>
          <IconButton
            icon={RefreshCw}
            label="Refresh"
            onClick={() => void store.refreshAll()}
          />
          <IconButton icon={FolderOpen} label="Your paperwork" onClick={() => navigate('/documents')} />
          <IconButton
            icon={LogOut}
            label="Sign out"
            disabled={busy}
            onClick={() => void run(() => store.signOut())}
          />
        </>
      }
    >
      {profile.value ? (
        <div className="stack gap-md">
          <ShiftCard profile={profile.value} />
          <JobList />
        </div>
      ) : profile.error ? (
        <ProfileError error={profile.error} />
      ) : (
        <Centered>
          <Spinner />
        </Centered>
      )}
    </Page>
  );
}

/**
 * A 404 means this account is not on anybody's roster — what a family member
 * who opened the wrong app would see, and what a new driver sees before their
 * operator has added them. Both deserve a sentence, not a red error.
 */
function ProfileError({ error }: { error: unknown }) {
  const store = useStore();
  if (error instanceof Failure && error.kind === 'notFound') {
    return (
      <EmptyState
        icon={BadgeInfo}
        title="No driver profile yet"
        message="This account is not on an operator’s roster. Ask your dispatcher to add you with this email address, and make sure you have confirmed it — we only join the two once the address is verified."
        action={
          <Button variant="outlined" icon={RefreshCw} onClick={() => void store.refreshProfile()}>
            Check again
          </Button>
        }
      />
    );
  }
  return <FailureBlock error={error} onRetry={() => void store.refreshProfile()} />;
}

function ShiftCard({ profile }: { profile: DriverProfile }) {
  const store = useStore();
  const navigate = useNavigate();
  const { run, busy } = useRun();

  return (
    <InfoCard label="Your shift">
      <h2 className="t-title-lg">{profile.displayName}</h2>
      <p className="muted">{profile.organizationName}</p>
      <p className="mt-sm">
        {vehicleDescription(profile.vehicle)} · {profile.vehicle.licensePlate}
      </p>
      {profile.suspensionReason && (
        // Said out loud: being locked out of your own job with no reason given
        // is how a support queue fills up.
        <p className="error-text bold mt-md">Suspended: {profile.suspensionReason}</p>
      )}
      <div className="mt-md">
        {profile.canWork ? (
          <Button
            variant={profile.onShift ? 'quiet' : 'primary'}
            icon={profile.onShift ? CircleStop : Play}
            busy={busy}
            onClick={() => void run(() => store.setShift(!profile.onShift))}
          >
            {profile.onShift ? 'End shift' : 'Start shift'}
          </Button>
        ) : (
          <>
            <p>Your operator has not approved you to drive yet.</p>
            {/* The next thing to do rather than a dead end: approval waits on paperwork. */}
            <Button variant="outlined" icon={FolderOpen} className="mt-sm" onClick={() => navigate('/documents')}>
              Check your paperwork
            </Button>
          </>
        )}
      </div>
    </InfoCard>
  );
}

function JobList() {
  const store = useStore();
  const { jobs } = useDriver();

  if (jobs.value === null) {
    return jobs.error ? (
      <FailureBlock error={jobs.error} onRetry={() => void store.refreshJobs()} />
    ) : (
      <Centered>
        <Spinner />
      </Centered>
    );
  }

  if (jobs.value.length === 0) {
    return (
      <EmptyState
        icon={CalendarCheck}
        title="Nothing assigned"
        message="Your dispatcher will send work here. The screen refreshes on its own — there is no need to keep checking."
      />
    );
  }

  return (
    <ul className="job-list" aria-label="Your rides">
      {jobs.value.map((job) => (
        <li key={job.id}>
          <JobRow job={job} />
        </li>
      ))}
    </ul>
  );
}

function JobRow({ job }: { job: Job }) {
  const navigate = useNavigate();
  return (
    <button type="button" className="card job-row" onClick={() => navigate(`/job/${job.id}`)}>
      <span className="grow">
        <span className="t-title block">{formatTime(job.scheduledPickupAt)}</span>
        <span className="t-title-lg block">{job.passengerName}</span>
        <span className="muted block mt-xs">{placeOneLine(job.pickup)}</span>
        <span className="t-label block mt-sm">{driverLabel(job.status)}</span>
      </span>
      {job.wheelchairRequired && <Accessibility size={28} aria-label="Wheelchair" />}
      <ChevronRight aria-hidden />
    </button>
  );
}
