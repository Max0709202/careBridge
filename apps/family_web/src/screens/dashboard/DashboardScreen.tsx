import {
  CalendarDays,
  Car,
  Clock,
  Contact,
  LocateFixed,
  Plus,
  ReceiptText,
  RefreshCw,
  Settings,
  Timer,
  User,
  UserPlus,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { rideStatusVisual, AppointmentStatusPill, RideStatusPill } from '../../components/status';
import { useRun } from '../../components/useRun';
import {
  AppCard,
  Button,
  EmptyState,
  IconButton,
  InfoRow,
  Page,
  SectionHeader,
} from '../../components/ui';
import { VerificationBanner } from '../../components/VerificationBanner';
import {
  formatAppointmentWhen,
  formatCountdown,
  formatFreshness,
  formatRelativeDay,
  formatTime,
} from '../../core/formatting';
import { formatMoney } from '../../core/money';
import {
  appointmentTypeLabel,
  rideDirectionLabel,
  TrackingFreshness,
  type Appointment,
  type Patient,
  type Ride,
} from '../../domain/models';
import { ridePassengerIsOnboard, rideIsTerminal } from '../../domain/statuses';
import {
  activeRidesFor,
  can,
  clinicById,
  nextAppointmentFor,
  rideIsTrackable,
  ridesFor,
  selectedPatient,
  type CareState,
} from '../../state/careState';
import { useCare, useNow, useStore } from '../../state/context';
import { PatientSwitcher } from '../patients/PatientSwitcher';
import { DelayBanner, DriverRow } from '../rides/rideParts';

/**
 * The home screen. It answers three questions without the reader doing
 * anything: what is next, is it on track, and what do I do if it is not.
 */
export function DashboardScreen() {
  const state = useCare();
  const store = useStore();
  const navigate = useNavigate();
  const now = useNow();
  const { run, busy } = useRun();
  const patient = selectedPatient(state);

  if (!patient) {
    return (
      <Page title="CareBridge">
        <EmptyState
          fill
          icon={UserPlus}
          title="Add the person you care for"
          message="Create a profile with their address, how they get about, and who to call in an emergency. Everything else builds on it."
          action={
            <Button icon={Plus} onClick={() => navigate('/patients/new')}>
              Add a profile
            </Button>
          }
        />
      </Page>
    );
  }

  const activeRides = activeRidesFor(state, patient.id);
  const nextAppointment = nextAppointmentFor(state, patient.id, now);

  return (
    <Page
      title="CareBridge"
      actions={
        <>
          <IconButton icon={RefreshCw} label="Refresh" disabled={busy} onClick={() => run(() => store.refresh())} />
          <IconButton icon={Settings} label="Settings" onClick={() => navigate('/settings')} />
        </>
      }
    >
      <div className="stack">
        <VerificationBanner />
        <PatientSwitcher />
        {activeRides.map((ride) => (
          <div className="mt-lg" key={ride.id}>
            <ActiveRideCard ride={ride} patient={patient} />
          </div>
        ))}
        <div className="mt-lg">
          <NextAppointmentSection appointment={nextAppointment} state={state} now={now} />
        </div>
        <div className="mt-lg">
          <SectionHeader title="Quick actions" subtitle={`For ${patient.preferredName}`} />
          <QuickActions patient={patient} state={state} />
        </div>
        <EmergencyContactCard patient={patient} />
        <div className="mt-lg">
          <SectionHeader
            title="Recent activity"
            action={
              <Button variant="text" onClick={() => navigate('/appointments')}>
                See all
              </Button>
            }
          />
          <RecentActivity state={state} patient={patient} now={now} />
        </div>
        <p className="t-small muted center mt-xl">
          CareBridge coordinates appointments and transport. It is not for emergencies — in an
          emergency, call 911.
        </p>
      </div>
    </Page>
  );
}

/** The card that replaces a phone call to dispatch. */
function ActiveRideCard({ ride, patient }: { ride: Ride; patient: Patient }) {
  const navigate = useNavigate();
  const now = useNow();
  const trackable = rideIsTrackable(ride);
  const visual = rideStatusVisual[ride.status];

  return (
    <AppCard
      border={ride.isDelayed ? 'caution' : visual.ink}
      // Names the driver, so two cards for one person can be told apart by ear.
      // No closing full stop: a driver's name already ends in one ("Marcus T.").
      ariaLabel={`Current ride for ${patient.preferredName}${ride.driver ? ` with ${ride.driver.displayName}` : ''}`}
    >
      <div className="row">
        <h2 className="t-title grow">{rideDirectionLabel[ride.direction]}</h2>
        <RideStatusPill status={ride.status} />
      </div>
      {ride.isDelayed && (
        <div className="mt-sm">
          <DelayBanner reason={ride.delayReason} />
        </div>
      )}
      <div className="mt-md">
        {ride.driver ? (
          <DriverRow driver={ride.driver} />
        ) : (
          <p className="t-body muted">
            {ride.status === 'awaitingAssignment'
              ? 'We are finding a driver. You will be notified as soon as one is assigned.'
              : 'No driver assigned yet.'}
          </p>
        )}
      </div>
      <div className="mt-md">
        {trackable && ride.etaMinutes !== null ? (
          <EtaLine ride={ride} />
        ) : (
          <InfoRow
            icon={Clock}
            label="Pickup"
            value={
              ride.flexibleReturn
                ? 'When the visit ends'
                : `${formatRelativeDay(ride.scheduledPickupAt, now)}, ${formatTime(ride.scheduledPickupAt)}`
            }
          />
        )}
      </div>
      <Button
        block
        className="mt-md"
        icon={trackable ? LocateFixed : ReceiptText}
        onClick={() => navigate(trackable ? `/rides/${ride.id}/track` : `/rides/${ride.id}`)}
      >
        {trackable ? 'Follow the trip' : 'Ride details'}
      </Button>
    </AppCard>
  );
}

/** Re-renders once a second, so the freshness age stays truthful. */
function EtaLine({ ride }: { ride: Ride }) {
  const now = useNow(true);
  const position = ride.lastKnownPosition;
  const age = position === null ? null : now.getTime() - position.capturedAt.getTime();
  const stale = age !== null && age > TrackingFreshness.staleMs;

  return (
    <div>
      <div className="row tight">
        <Timer size={22} className="ink-info" aria-hidden />
        <p className="t-title">
          {ridePassengerIsOnboard(ride.status)
            ? `Arriving in about ${ride.etaMinutes} min`
            : `Driver is about ${ride.etaMinutes} min away`}
        </p>
      </div>
      {age !== null && (
        <p className={`t-small mt-xs ${stale ? 'ink-caution bold' : 'muted'}`}>
          {stale
            ? `Location last updated ${formatFreshness(age)} — this may be out of date.`
            : `Location updated ${formatFreshness(age)}.`}
        </p>
      )}
    </div>
  );
}

function NextAppointmentSection({
  appointment,
  state,
  now,
}: {
  appointment: Appointment | null;
  state: CareState;
  now: Date;
}) {
  const navigate = useNavigate();

  if (!appointment) {
    return (
      <AppCard>
        <h2 className="t-title">No appointments coming up</h2>
        <p className="t-body muted mt-xs">
          When you add one, it will show here with its transport status.
        </p>
        <Button icon={Plus} className="mt-md" onClick={() => navigate('/appointments/new')}>
          Add an appointment
        </Button>
      </AppCard>
    );
  }

  const clinic = clinicById(state, appointment.clinicId);
  return (
    <>
      <SectionHeader title="Next appointment" />
      <AppCard
        onClick={() => navigate(`/appointments/${appointment.id}`)}
        ariaLabel={`Next appointment, ${formatAppointmentWhen(appointment.startsAt, appointment.timeZoneLabel)}, at ${clinic?.name ?? 'a clinic'}.`}
      >
        <div className="row">
          <p className="t-title grow">{formatRelativeDay(appointment.startsAt, now)}</p>
          <AppointmentStatusPill status={appointment.status} />
        </div>
        <p className="t-headline mt-xs">
          {formatTime(appointment.startsAt)} · {appointment.timeZoneLabel}
        </p>
        <p className="t-body-lg mt-sm">{clinic?.name ?? 'Clinic'}</p>
        <p className="t-body muted">{appointmentTypeLabel[appointment.type]}</p>
        <p className="t-body muted mt-sm">
          {formatCountdown(appointment.startsAt.getTime() - now.getTime())}
        </p>
      </AppCard>
    </>
  );
}

function QuickActions({ patient, state }: { patient: Patient; state: CareState }) {
  const navigate = useNavigate();
  return (
    <div className="wrap">
      {can(state, patient.id, 'scheduleAppointments') && (
        <Button variant="tonal" icon={CalendarDays} onClick={() => navigate('/appointments/new')}>
          Add appointment
        </Button>
      )}
      {can(state, patient.id, 'requestTransport') && (
        <Button variant="tonal" icon={Car} onClick={() => navigate('/appointments')}>
          Request transport
        </Button>
      )}
      <Button variant="outlined" icon={User} onClick={() => navigate(`/patients/${patient.id}`)}>
        Profile
      </Button>
    </div>
  );
}

function EmergencyContactCard({ patient }: { patient: Patient }) {
  const primary =
    patient.emergencyContacts.find((c) => c.isPrimary) ?? patient.emergencyContacts[0];
  if (!primary) return null;

  return (
    <AppCard className="mt-lg">
      <div className="row">
        <Contact className="ink-primary" aria-hidden />
        <div className="grow">
          <p className="t-small muted">Emergency contact</p>
          <p className="t-body-lg" style={{ marginTop: 2 }}>
            {primary.name} · {primary.relationship}
          </p>
        </div>
      </div>
    </AppCard>
  );
}

function RecentActivity({ state, patient, now }: { state: CareState; patient: Patient; now: Date }) {
  const navigate = useNavigate();
  const rides = ridesFor(state, patient.id)
    .filter((r) => rideIsTerminal(r.status))
    .sort((a, b) => b.scheduledPickupAt.getTime() - a.scheduledPickupAt.getTime())
    .slice(0, 3);

  if (rides.length === 0) {
    return <p className="t-body muted">Completed rides will appear here.</p>;
  }

  return (
    <div className="stack gap-sm">
      {rides.map((ride) => (
        <AppCard key={ride.id} onClick={() => navigate(`/rides/${ride.id}`)}>
          <div className="row">
            <div className="grow">
              <p className="t-body-lg">{formatRelativeDay(ride.scheduledPickupAt, now)}</p>
              <p className="t-body muted" style={{ marginTop: 2 }}>
                {rideDirectionLabel[ride.direction]} · {formatMoney(ride.estimate.totalCents)}
              </p>
            </div>
            <RideStatusPill status={ride.status} outlined />
          </div>
        </AppCard>
      ))}
    </div>
  );
}
