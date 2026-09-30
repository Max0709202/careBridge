import {
  Accessibility,
  CircleOff,
  Clock,
  CircleDot,
  HandHeart,
  Info,
  LocateFixed,
  MapPin,
  StickyNote,
  User,
} from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';

import { useConfirm, useFeedback } from '../../components/feedback';
import { RideStatusPill } from '../../components/status';
import {
  AppCard,
  Avatar,
  Button,
  Divider,
  InfoRow,
  NotAvailable,
  Page,
  SectionHeader,
  StatusPill,
} from '../../components/ui';
import { formatMiles, formatRelativeDay, formatTime } from '../../core/formatting';
import { formatMoney } from '../../core/money';
import {
  addressSingleLine,
  initialsOf,
  rideDirectionLabel,
  vehicleDescription,
} from '../../domain/models';
import { rideIsTerminal } from '../../domain/statuses';
import { canView, patientById, rideById, rideIsActive, rideIsTrackable } from '../../state/careState';
import { useCare, useNow, useStore } from '../../state/context';
import { DemoControls } from './DemoControls';
import { PriceLine } from './rideParts';
import { RideTimeline } from './RideTimeline';

export function RideDetailScreen() {
  const { id = '' } = useParams();
  const state = useCare();
  const store = useStore();
  const now = useNow();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const { showFailure, showConfirmation } = useFeedback();

  // A ride id is not a capability: access resolves ride → patient → grant, and
  // "no such ride" and "not yours" are deliberately the same screen.
  const ride = rideById(state, id);
  if (!ride || !canView(state, ride.patientId)) return <NotAvailable />;

  const patient = patientById(state, ride.patientId);
  const estimate = ride.estimate;

  async function cancel() {
    const confirmed = await confirm({
      title: 'Cancel this ride?',
      message: 'The driver will be told not to come. You can book another ride afterwards.',
      confirmLabel: 'Cancel the ride',
    });
    if (!confirmed) return;
    try {
      await store.cancelRide(id, 'Cancelled by family');
      showConfirmation('Ride cancelled.');
    } catch (error) {
      showFailure(error);
    }
  }

  return (
    <Page title="Ride" back>
      <div className="stack">
        <AppCard>
          <div className="row">
            <h2 className="t-title-lg grow">{rideDirectionLabel[ride.direction]}</h2>
            <RideStatusPill status={ride.status} />
          </div>
          <div className="mt-sm">
            {patient && <InfoRow icon={User} label="Passenger" value={patient.preferredName} />}
            <InfoRow
              icon={Clock}
              label="Pickup"
              value={
                ride.flexibleReturn
                  ? 'Flexible — sent when the visit ends'
                  : `${formatRelativeDay(ride.scheduledPickupAt, now)}, ${formatTime(ride.scheduledPickupAt)}`
              }
            />
            <InfoRow icon={CircleDot} label="From" value={addressSingleLine(ride.pickup)} />
            <InfoRow icon={MapPin} label="To" value={addressSingleLine(ride.destination)} />
            {ride.notesForDriver && <InfoRow icon={StickyNote} label="Notes for the driver" value={ride.notesForDriver} />}
            {ride.cancellationReason && (
              <InfoRow icon={Info} label="Reason for cancellation" value={ride.cancellationReason} />
            )}
          </div>
        </AppCard>

        {(ride.wheelchairRequired || ride.assistanceRequired) && (
          <AppCard className="mt-md">
            <p className="t-title">Requirements for this trip</p>
            <div className="wrap mt-sm">
              {ride.wheelchairRequired && (
                <StatusPill label="Wheelchair-accessible vehicle" icon={Accessibility} ink="info" />
              )}
              {ride.assistanceRequired && (
                <StatusPill label="Door-through-door assistance" icon={HandHeart} ink="info" />
              )}
            </div>
          </AppCard>
        )}

        {ride.driver && (
          <AppCard className="mt-md">
            <div className="row">
              <Avatar text={initialsOf(ride.driver.displayName)} size="md" />
              <div className="grow">
                <p className="t-title">{ride.driver.displayName}</p>
                <p className="t-body muted">
                  {vehicleDescription(ride.driver.vehicle)} · {ride.driver.vehicle.licensePlate}
                </p>
              </div>
            </div>
          </AppCard>
        )}

        <div className="mt-lg">
          <SectionHeader
            title={rideIsTerminal(ride.status) ? 'What you paid' : 'Estimated cost'}
            subtitle={`Priced under rule ${estimate.ruleVersion}.`}
          />
          <AppCard>
            <PriceLine label="Base fare" value={formatMoney(estimate.baseCents)} />
            {estimate.distanceMiles > 0 && (
              <>
                <PriceLine
                  label={`Distance (${formatMiles(estimate.distanceMiles)} mi)`}
                  value={formatMoney(estimate.distanceChargeCents)}
                />
                <PriceLine
                  label={`Time (about ${estimate.durationMinutes} min)`}
                  value={formatMoney(estimate.timeChargeCents)}
                />
              </>
            )}
            {estimate.surcharges.map((s) => (
              <PriceLine key={s.label} label={s.label} value={formatMoney(s.amountCents)} />
            ))}
            <Divider />
            <div className="row">
              <p className="t-title grow">Total</p>
              <p className="t-title-lg">{formatMoney(estimate.totalCents)}</p>
            </div>
          </AppCard>
        </div>

        <div className="mt-lg">
          <SectionHeader title="Timeline" />
          <RideTimeline events={ride.events} />
        </div>

        {rideIsTrackable(ride) && (
          <Button icon={LocateFixed} block className="mt-lg" onClick={() => navigate(`/rides/${id}/track`)}>
            Follow the trip
          </Button>
        )}

        {rideIsActive(ride) && (
          <>
            <div className="mt-lg">
              {import.meta.env.DEV && <DemoControls rideId={id} />}
            </div>
            <Button variant="outlined-danger" icon={CircleOff} block className="mt-md" onClick={cancel}>
              Cancel this ride
            </Button>
          </>
        )}
      </div>
    </Page>
  );
}
