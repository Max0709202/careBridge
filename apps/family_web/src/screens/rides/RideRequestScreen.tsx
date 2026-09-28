import { ArrowRight, ArrowRightLeft, Accessibility, Check, Clock, Hospital, House, Info } from 'lucide-react';
import { useState } from 'react';
import { useParams } from 'react-router-dom';

import { validationFailure } from '../../api/failures';
import { useFeedback } from '../../components/feedback';
import { useGoBack } from '../../components/navigation';
import { AppCard, Button, Divider, NotAvailable, Page, SectionHeader, TextField } from '../../components/ui';
import { formatMiles, formatTime, toTimeInput } from '../../core/formatting';
import { distanceMiles, estimateDriveMinutes } from '../../core/geo';
import { formatMoney, multiplyCents } from '../../core/money';
import {
  addressShortLine,
  mobilityNeedLabel,
  patientRequiresAssistance,
  patientRequiresWheelchair,
  type Clinic,
  type Patient,
} from '../../domain/models';
import { estimateFare, standardPricingRule, type PriceEstimate } from '../../domain/pricing';
import { appointmentById, canView, clinicById, patientById } from '../../state/careState';
import { useCare, useStore } from '../../state/context';
import { PriceLine } from './rideParts';

/**
 * Default lead time before the appointment. Deliberately generous: an older
 * adult with a walker does not leave the house in five minutes.
 */
const DEFAULT_LEAD_MINUTES = 40;

export function RideRequestScreen() {
  const { id = '' } = useParams();
  const state = useCare();
  const store = useStore();
  const goBack = useGoBack(`/appointments/${id}`);
  const { showFailure, showConfirmation } = useFeedback();
  const appointment = appointmentById(state, id);

  const [pickupTime, setPickupTime] = useState(() =>
    appointment
      ? toTimeInput(new Date(appointment.startsAt.getTime() - DEFAULT_LEAD_MINUTES * 60_000))
      : '',
  );
  const [roundTrip, setRoundTrip] = useState(true);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  if (!appointment || !canView(state, appointment.patientId)) return <NotAvailable />;
  const patient = patientById(state, appointment.patientId);
  const clinic = clinicById(state, appointment.clinicId);
  if (!patient || !clinic) return <Page title="" back>{null}</Page>;

  const estimate = estimateFor(patient, clinic);
  const hasCoordinates = patient.homeAddress.coordinates !== null && clinic.address.coordinates !== null;

  async function submit() {
    const match = /^(\d{2}):(\d{2})$/.exec(pickupTime);
    if (!match || !appointment) {
      showFailure(validationFailure('Choose a pickup time.'));
      return;
    }
    // On the appointment's own day, at the chosen time.
    const s = appointment.startsAt;
    const pickupAt = new Date(s.getFullYear(), s.getMonth(), s.getDate(), +match[1]!, +match[2]!);

    setBusy(true);
    try {
      await store.requestTransport({
        appointmentId: appointment.id,
        pickupAt,
        roundTrip,
        notesForDriver: notes.trim() === '' ? null : notes.trim(),
      });
      showConfirmation('Requested. We are finding a driver.');
      goBack();
    } catch (error) {
      showFailure(error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page title="Arrange transportation" back>
      <div className="stack">
        <SectionHeader title="The journey" />
        <AppCard>
          <RoutePoint icon={House} label="Pickup" title={addressShortLine(patient.homeAddress)} detail={patient.homeAddress.accessNotes} />
          <div style={{ marginLeft: 11, height: 24, width: 2, background: 'var(--outline-variant)' }} aria-hidden />
          <RoutePoint icon={Hospital} label="Destination" title={clinic.name} detail={clinic.entranceNotes} />
        </AppCard>

        <div className="mt-lg">
          <SectionHeader title="When to collect them" />
          <AppCard>
            <div className="row start">
              <Clock className="ink-primary" aria-hidden style={{ flex: '0 0 auto', marginTop: 4 }} />
              <div className="grow stack gap-sm">
                <TextField
                  label="Pickup time"
                  type="time"
                  value={pickupTime}
                  onChange={(e) => setPickupTime(e.target.value)}
                  helper={`Appointment starts at ${formatTime(appointment.startsAt)}`}
                />
              </div>
            </div>
          </AppCard>
        </div>

        <div className="mt-lg">
          <SectionHeader title="Getting home" />
          <AppCard>
            <div className="segmented" role="group" aria-label="Getting home">
              <button type="button" aria-pressed={roundTrip} onClick={() => setRoundTrip(true)}>
                <ArrowRightLeft size={18} aria-hidden /> Round trip
              </button>
              <button type="button" aria-pressed={!roundTrip} onClick={() => setRoundTrip(false)}>
                <ArrowRight size={18} aria-hidden /> One way
              </button>
            </div>
            <p className="t-body muted mt-md">
              {roundTrip
                ? 'A car home as well. The return pickup is flexible — we send one when the visit actually ends, not at a time guessed days earlier.'
                : 'Someone else is bringing them home.'}
            </p>
          </AppCard>
        </div>

        <div className="mt-lg">
          <SectionHeader title="What the driver will be told" subtitle="Taken from the profile — no medical details are shared." />
          <AppCard>
            {patient.mobilityNeeds.length === 0 ? (
              <p className="t-body muted">No mobility needs recorded.</p>
            ) : (
              <div className="wrap">
                {patient.mobilityNeeds.map((need) => (
                  <span key={need} className="chip">
                    {mobilityNeedLabel[need]}
                  </span>
                ))}
              </div>
            )}
            {patientRequiresWheelchair(patient) && (
              <div className="row tight mt-sm">
                <Accessibility className="ink-positive" aria-hidden />
                <p className="t-body grow">Only wheelchair-accessible vehicles will be offered this trip.</p>
              </div>
            )}
          </AppCard>
          <div className="mt-md">
            <TextField
              label="Anything else for the driver? (optional)"
              placeholder="Ring the bell twice, allow a few minutes …"
              multiline
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>

        <div className="mt-lg">
          <SectionHeader title="Estimated cost" />
          <EstimateCard estimate={estimate} roundTrip={roundTrip} hasCoordinates={hasCoordinates} />
        </div>

        <Button icon={Check} block className="mt-xl" disabled={busy} onClick={submit}>
          {busy ? 'Requesting…' : roundTrip ? 'Request round trip' : 'Request ride'}
        </Button>
        <p className="t-small muted center mt-sm">You will not be charged until the trip is complete.</p>
      </div>
    </Page>
  );
}

function estimateFor(patient: Patient, clinic: Clinic): PriceEstimate {
  const from = patient.homeAddress.coordinates;
  const to = clinic.address.coordinates;
  const common = {
    rule: standardPricingRule,
    wheelchairAccessRequired: patientRequiresWheelchair(patient),
    assistanceRequired: patientRequiresAssistance(patient),
  };
  if (!from || !to) return estimateFare({ ...common, distanceMiles: 0, durationMinutes: 0 });

  const miles = distanceMiles(from, to);
  return estimateFare({
    ...common,
    distanceMiles: Number(miles.toFixed(1)),
    durationMinutes: estimateDriveMinutes(miles),
  });
}

function RoutePoint(props: { icon: typeof House; label: string; title: string; detail: string | null }) {
  const Icon = props.icon;
  return (
    <div className="row start">
      <Icon className="ink-primary" aria-hidden style={{ flex: '0 0 auto' }} />
      <div className="grow">
        <p className="t-small muted">{props.label}</p>
        <p className="t-body-lg">{props.title}</p>
        {props.detail && <p className="t-small muted" style={{ marginTop: 2 }}>{props.detail}</p>}
      </div>
    </div>
  );
}

/**
 * Itemised: an unexplained total on a care bill generates a support call, and
 * a surcharge for an accessible vehicle should be visible rather than buried.
 */
function EstimateCard({ estimate, roundTrip, hasCoordinates }: { estimate: PriceEstimate; roundTrip: boolean; hasCoordinates: boolean }) {
  const legs = roundTrip ? 2 : 1;
  return (
    <AppCard>
      {!hasCoordinates && (
        <div className="row start tight ink-caution" style={{ marginBottom: 'var(--space-sm)' }}>
          <Info size={20} aria-hidden style={{ flex: '0 0 auto' }} />
          <p className="t-small">
            This address has not been verified yet, so only the minimum fare can be shown. The final
            price is confirmed before the trip.
          </p>
        </div>
      )}
      <PriceLine label="Base fare" value={formatMoney(estimate.baseCents)} />
      {hasCoordinates && (
        <>
          <PriceLine label={`Distance (${formatMiles(estimate.distanceMiles)} mi)`} value={formatMoney(estimate.distanceChargeCents)} />
          <PriceLine label={`Time (about ${estimate.durationMinutes} min)`} value={formatMoney(estimate.timeChargeCents)} />
        </>
      )}
      {estimate.surcharges.map((s) => (
        <PriceLine key={s.label} label={s.label} value={formatMoney(s.amountCents)} />
      ))}
      {estimate.minimumApplied && <PriceLine label="Minimum fare applied" value="" muted />}
      <Divider />
      <div className="row">
        <p className="t-title grow">{roundTrip ? 'Estimated total (2 legs)' : 'Estimated total'}</p>
        <p className="t-title-lg">{formatMoney(multiplyCents(estimate.totalCents, legs))}</p>
      </div>
      <p className="t-small muted mt-xs">An estimate, not a quote. Traffic and waiting time can change it.</p>
    </AppCard>
  );
}
