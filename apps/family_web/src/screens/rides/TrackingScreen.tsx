import {
  Accessibility,
  CarFront,
  CircleCheck,
  CircleCheckBig,
  CircleOff,
  Clock,
  Hash,
  LocateOff,
  MapPinOff,
  ReceiptText,
  Star,
  TriangleAlert,
  WifiOff,
} from 'lucide-react';
import { lazy, Suspense, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { useConfirm, useFeedback } from '../../components/feedback';
import { useGoBack } from '../../components/navigation';
import { RideStatusPill } from '../../components/status';
import {
  AppCard,
  Avatar,
  Banner,
  Button,
  Divider,
  EmptyState,
  IconButton,
  InfoRow,
  NotAvailable,
  Page,
  SectionHeader,
  StatusPill,
  type Ink,
} from '../../components/ui';
import { formatFreshness } from '../../core/formatting';
import {
  initialsOf,
  newerPoint,
  TrackingFreshness,
  vehicleDescription,
  type Driver,
  type Ride,
} from '../../domain/models';
import {
  rideAllowsLocationSharing,
  ridePassengerIsOnboard,
  rideStatusLabel,
} from '../../domain/statuses';
import { canView, patientById, rideById } from '../../state/careState';
import { useCare, useLiveTracking, useNow, useStore } from '../../state/context';
import { DemoControls } from './DemoControls';
import { RideTimeline } from './RideTimeline';
import { CallBar } from '../messages/ChatThread';

// Loaded with this screen only: the map library is most of its weight.
const StreetMap = lazy(() => import('./StreetMap'));

/**
 * Live tracking. The screen answers one question — *is the person I love all
 * right right now* — and its hardest requirement is honesty:
 *
 *  - position is aged against when the device took the reading, never against
 *    when it arrived;
 *  - past the stale threshold the screen says so, in words, at the top; past
 *    the lost threshold it stops presenting a position at all;
 *  - ETA is "about N minutes", never a clock time.
 */
export function TrackingScreen() {
  const { id = '' } = useParams();
  // Re-renders every second so the freshness age cannot silently go out of date.
  const now = useNow(true);
  const state = useCare();
  const store = useStore();
  const navigate = useNavigate();
  const goBack = useGoBack(`/rides/${id}`);
  const confirm = useConfirm();
  const { showFailure, showConfirmation } = useFeedback();

  // Live position is the most sensitive thing this app renders — where a
  // vulnerable person physically is, right now. The grant is checked before a
  // subscription is even asked for, and the server re-checks it regardless.
  const ride = rideById(state, id);
  const allowed = ride !== null && canView(state, ride.patientId);
  const tracking = ride !== null && allowed && rideAllowsLocationSharing(ride.status);
  const live = useLiveTracking(tracking ? id : null);
  // The socket pushes positions; this re-reads the snapshot as a backup, so a
  // dropped connection costs fifteen seconds rather than the rest of the trip.
  useEffect(() => (tracking ? store.watchLiveTrip() : undefined), [store, tracking]);

  if (!ride || !allowed) return <NotAvailable />;

  const patient = patientById(state, ride.patientId);

  // The snapshot is the floor; the pushed position wins only when it is the
  // more recent *reading*.
  const livePoint = live?.type === 'position' ? live.point : null;
  const position = newerPoint(ride.lastKnownPosition, livePoint);
  const etaMinutes =
    (live?.type === 'position' ? live.etaMinutes : null) ?? ride.etaMinutes;
  const age = position === null ? null : now.getTime() - position.capturedAt.getTime();
  const stale = age !== null && age > TrackingFreshness.staleMs;
  const lost = age !== null && age > TrackingFreshness.lostMs;

  // Once a ride ends, this screen must not keep presenting a position.
  if (!rideAllowsLocationSharing(ride.status)) return <FinishedRideView ride={ride} />;

  async function cancel(r: Ride) {
    const onboard = ridePassengerIsOnboard(r.status);
    const confirmed = await confirm({
      title: 'Cancel this ride?',
      message: onboard
        ? 'The passenger is already in the vehicle. Only cancel if you have spoken to them — the driver will be told to stop.'
        : 'The driver will be told not to come. You can book another ride afterwards.',
      confirmLabel: 'Cancel the ride',
      cancelLabel: 'Keep it',
    });
    if (!confirmed) return;
    try {
      await store.cancelRide(r.id, 'Cancelled by family');
      showConfirmation('Ride cancelled.');
      goBack();
    } catch (error) {
      showFailure(error);
    }
  }

  return (
    <Page
      title={patient ? `${patient.preferredName}’s trip` : 'Live trip'}
      back
      actions={
        <IconButton
          icon={ReceiptText}
          label="Ride details"
          onClick={() => navigate(`/rides/${id}`)}
        />
      }
    >
      <div className="stack">
        {ride.pickup.coordinates && ride.destination.coordinates ? (
          <Suspense fallback={<div className="street-map" aria-hidden />}>
            <StreetMap
              pickup={ride.pickup.coordinates}
              destination={ride.destination.coordinates}
              driver={lost ? null : (position?.coordinates ?? null)}
              isStale={stale}
              passengerOnboard={ridePassengerIsOnboard(ride.status)}
              route={lost ? null : ride.route}
            />
          </Suspense>
        ) : (
          <AppCard>
            <p className="t-body muted">
              This address has not been verified yet, so the route cannot be drawn.
              Status updates below are unaffected.
            </p>
          </AppCard>
        )}

        <div className="mt-md" aria-live="polite">
          <FreshnessBanner age={age} stale={stale} lost={lost} />
        </div>

        <div className="mt-md">
          <StatusHeadline ride={ride} lost={lost} etaMinutes={etaMinutes} />
        </div>

        {ride.isDelayed && (
          <AppCard border="caution" className="mt-md">
            <div className="row start" style={{ gap: 12 }}>
              <Clock className="ink-caution" aria-hidden style={{ flex: '0 0 auto' }} />
              <div className="grow">
                <p className="t-title ink-caution">Running late</p>
                {ride.delayReason && <p className="t-body">{ride.delayReason}</p>}
              </div>
            </div>
          </AppCard>
        )}

        {ride.driver && (
          <div className="mt-lg">
            <DriverCard driver={ride.driver} rideId={ride.id} />
          </div>
        )}

        <div className="mt-lg">
          <SectionHeader title="What has happened so far" />
          <RideTimeline events={ride.events} />
        </div>

        <div className="mt-lg">
          {import.meta.env.DEV && <DemoControls rideId={id} />}
        </div>

        <Button
          variant="outlined-danger"
          icon={CircleOff}
          block
          className="mt-lg"
          onClick={() => cancel(ride)}
        >
          Cancel this ride
        </Button>
      </div>
    </Page>
  );
}

function FreshnessBanner({
  age,
  stale,
  lost,
}: {
  age: number | null;
  stale: boolean;
  lost: boolean;
}) {
  let ink: Ink;
  let icon;
  let message: string;
  if (age === null) {
    ink = 'neutral';
    icon = LocateOff;
    message = 'Waiting for the first position report from the driver.';
  } else if (lost) {
    ink = 'critical';
    icon = WifiOff;
    message = `We have lost contact with the driver’s device. The last position was ${formatFreshness(age)} and is no longer shown.`;
  } else if (stale) {
    ink = 'caution';
    icon = TriangleAlert;
    message = `Position last updated ${formatFreshness(age)}. It may be out of date.`;
  } else {
    ink = 'positive';
    icon = CircleCheck;
    message = `Position updated ${formatFreshness(age)}.`;
  }

  return (
    <Banner ink={ink} icon={icon}>
      <p className="t-body" style={{ fontWeight: stale || lost ? 700 : 500 }}>
        {message}
      </p>
    </Banner>
  );
}

function StatusHeadline({
  ride,
  lost,
  etaMinutes,
}: {
  ride: Ride;
  lost: boolean;
  etaMinutes: number | null;
}) {
  const eta = etaMinutes;
  const unit = eta === 1 ? 'minute' : 'minutes';

  let headline: string;
  switch (ride.status) {
    case 'driverEnRoute':
      headline =
        lost || eta === null
          ? 'The driver is on the way'
          : `Driver is about ${eta} ${unit} away`;
      break;
    case 'driverArrived':
      headline = 'The driver is outside';
      break;
    case 'passengerOnboard':
      headline = 'Picked up safely';
      break;
    case 'inProgress':
      headline =
        lost || eta === null
          ? 'On the way to the clinic'
          : `Arriving in about ${eta} ${unit}`;
      break;
    case 'arrivedAtDestination':
      headline = 'Arrived at the clinic';
      break;
    default:
      headline = rideStatusLabel[ride.status];
  }

  const support =
    ride.status === 'driverArrived'
      ? 'They are waiting at the pickup address. There is no rush — the driver has been asked to allow time.'
      : ride.status === 'passengerOnboard'
        ? 'They are in the vehicle and the trip has started.'
        : ride.status === 'arrivedAtDestination'
          ? 'The vehicle has reached the destination.'
          : null;

  return (
    <AppCard>
      <RideStatusPill status={ride.status} />
      <p className="t-headline mt-sm" style={{ marginTop: 12 }}>
        {headline}
      </p>
      {support && <p className="t-body muted mt-xs">{support}</p>}
    </AppCard>
  );
}

function DriverCard({ driver, rideId }: { driver: Driver; rideId: string }) {
  return (
    <AppCard>
      <div className="row">
        <Avatar text={initialsOf(driver.displayName)} size="xl" />
        <div className="grow">
          <p className="t-title">{driver.displayName}</p>
          <div className="row tight" style={{ gap: 4, marginTop: 2 }}>
            <Star size={16} className="ink-caution" aria-hidden />
            <p className="t-small muted">
              {driver.rating} · {driver.yearsDriving} years driving
            </p>
          </div>
        </div>
      </div>
      <Divider />
      <InfoRow
        icon={CarFront}
        label="Look for"
        value={vehicleDescription(driver.vehicle)}
      />
      <InfoRow icon={Hash} label="Licence plate" value={driver.vehicle.licensePlate} />
      {driver.vehicle.isWheelchairAccessible && (
        <div className="mt-sm">
          <StatusPill
            label="Wheelchair accessible"
            icon={Accessibility}
            ink="positive"
          />
        </div>
      )}
      {/* Through the relay: your phone rings first, and neither side sees the other's number. */}
      <div className="mt-md">
        <CallBar context={{ rideId }} compact />
      </div>
    </AppCard>
  );
}

/**
 * Shown when a ride is no longer trackable — deliberately a different screen,
 * so nothing implies there is still a position to show.
 */
function FinishedRideView({ ride }: { ride: Ride }) {
  const navigate = useNavigate();
  const completed = ride.status === 'completed';
  return (
    <Page title="Trip" back>
      <EmptyState
        fill
        icon={completed ? CircleCheckBig : MapPinOff}
        title={completed ? 'This trip is complete' : 'Tracking has stopped'}
        message={
          completed
            ? 'Location sharing ended when the trip finished. The full timeline is on the ride details.'
            : `This ride is ${rideStatusLabel[ride.status].toLowerCase()}, so the driver is no longer sharing location.`
        }
        action={
          <Button onClick={() => navigate(`/rides/${ride.id}`, { replace: true })}>
            See ride details
          </Button>
        }
      />
    </Page>
  );
}
