import {
  CalendarClock,
  CalendarX2,
  Car,
  DoorOpen,
  History,
  Hospital,
  MapPin,
  StickyNote,
  Tag,
  User,
} from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { Modal, useConfirm, useFeedback } from '../../components/feedback';
import { useGoBack } from '../../components/navigation';
import { AppointmentStatusPill, RideStatusPill } from '../../components/status';
import {
  AppCard,
  Button,
  Divider,
  InfoRow,
  NotAvailable,
  Page,
  SectionHeader,
  TextField,
} from '../../components/ui';
import {
  combineLocal,
  formatDuration,
  formatRelativeDay,
  formatShortDay,
  formatTime,
  toDateInput,
  toTimeInput,
} from '../../core/formatting';
import {
  addressSingleLine,
  appointmentTypeLabel,
  rideDirectionLabel,
  vehicleDescription,
  type Appointment,
  type Ride,
} from '../../domain/models';
import { appointmentIsUpcoming } from '../../domain/statuses';
import {
  appointmentById,
  can,
  canView,
  clinicById,
  patientById,
  rideIsActive,
  rideIsTrackable,
  ridesForAppointment,
} from '../../state/careState';
import { useCare, useNow, useStore } from '../../state/context';
import { validationFailure } from '../../api/failures';

export function AppointmentDetailScreen() {
  const { id = '' } = useParams();
  const state = useCare();
  const store = useStore();
  const now = useNow();
  const navigate = useNavigate();
  const goBack = useGoBack('/appointments');
  const confirm = useConfirm();
  const { showFailure, showConfirmation } = useFeedback();
  const [rescheduling, setRescheduling] = useState(false);

  const appointment = appointmentById(state, id);
  if (!appointment || !canView(state, appointment.patientId)) return <NotAvailable />;

  const clinic = clinicById(state, appointment.clinicId);
  const patient = patientById(state, appointment.patientId);
  const rides = ridesForAppointment(state, id);
  const canSchedule = can(state, appointment.patientId, 'scheduleAppointments');
  const canTransport = can(state, appointment.patientId, 'requestTransport');
  const hasActiveRide = rides.some(rideIsActive);
  const upcoming = appointmentIsUpcoming(appointment.status);

  async function cancel(a: Appointment) {
    const confirmed = await confirm({
      title: 'Cancel this appointment?',
      message: hasActiveRide
        ? 'The booked transportation will be cancelled too, so no car is sent for an appointment that is not happening.'
        : 'This cannot be undone. Everyone with access will be notified.',
      confirmLabel: 'Cancel appointment',
      cancelLabel: 'Keep it',
    });
    if (!confirmed) return;
    try {
      await store.cancelAppointment(a.id);
      showConfirmation('Appointment cancelled.');
      goBack();
    } catch (error) {
      showFailure(error);
    }
  }

  return (
    <Page title="Appointment" back>
      <div className="stack">
        <AppCard>
          <div className="row">
            <p className="t-title grow">{formatRelativeDay(appointment.startsAt, now)}</p>
            <AppointmentStatusPill status={appointment.status} />
          </div>
          <p className="t-display mt-xs">{formatTime(appointment.startsAt)}</p>
          <p className="t-body muted">
            {appointment.timeZoneLabel} · {formatDuration(appointment.expectedDurationMinutes)}
          </p>
          <Divider />
          <InfoRow icon={User} label="For" value={patient?.preferredName ?? 'Unknown'} />
          <InfoRow icon={Hospital} label="Clinic" value={clinic?.name ?? 'Unknown clinic'} />
          {clinic && <InfoRow icon={MapPin} label="Address" value={addressSingleLine(clinic.address)} />}
          {clinic?.entranceNotes && (
            <InfoRow icon={DoorOpen} label="Where the car should stop" value={clinic.entranceNotes} />
          )}
          <InfoRow icon={Tag} label="Visit type" value={appointmentTypeLabel[appointment.type]} />
          {appointment.coordinationNotes && (
            <InfoRow icon={StickyNote} label="Notes" value={appointment.coordinationNotes} />
          )}
        </AppCard>

        <div className="mt-lg">
          <SectionHeader title="Transportation" />
          {rides.length === 0 ? (
            <AppCard>
              <p className="t-title">No ride booked yet</p>
              <p className="t-body muted mt-xs">
                {appointment.transportRequired
                  ? 'This appointment is marked as needing a ride.'
                  : 'Book one if they need a lift there and back.'}
              </p>
              {canTransport && upcoming && (
                <Button icon={Car} className="mt-md" onClick={() => navigate(`/appointments/${id}/transport`)}>
                  Arrange transportation
                </Button>
              )}
            </AppCard>
          ) : (
            <div className="stack gap-sm">
              {rides.map((ride) => (
                <RideSummaryCard key={ride.id} ride={ride} now={now} />
              ))}
            </div>
          )}
        </div>

        <div className="mt-lg">
          <SectionHeader title="History" subtitle="Every change is recorded, with who made it." />
          <AppCard>
            {appointment.history.length === 0 ? (
              <p className="t-body muted">No changes recorded yet.</p>
            ) : (
              [...appointment.history].reverse().map((change, i) => (
                <div key={i} className="row start" style={{ padding: '6px 0', gap: 12 }}>
                  <History size={18} className="muted" aria-hidden style={{ marginTop: 3 }} />
                  <div className="grow">
                    <p className="t-body">{change.reason ?? `Status changed to ${change.to}`}</p>
                    <p className="t-small muted">
                      {formatShortDay(change.at)}, {formatTime(change.at)} · {change.actor}
                    </p>
                  </div>
                </div>
              ))
            )}
          </AppCard>
        </div>

        {canSchedule && upcoming && (
          <div className="stack gap-sm mt-lg">
            <Button variant="outlined" icon={CalendarClock} block onClick={() => setRescheduling(true)}>
              Reschedule
            </Button>
            <Button variant="outlined-danger" icon={CalendarX2} block onClick={() => cancel(appointment)}>
              Cancel appointment
            </Button>
          </div>
        )}
      </div>

      {rescheduling && (
        <RescheduleDialog
          appointment={appointment}
          now={now}
          onClose={() => setRescheduling(false)}
          onSave={async (startsAt) => {
            try {
              await store.rescheduleAppointment(appointment.id, startsAt);
              setRescheduling(false);
              showConfirmation('Appointment rescheduled.');
            } catch (error) {
              showFailure(error);
            }
          }}
        />
      )}
    </Page>
  );
}

function RescheduleDialog(props: {
  appointment: Appointment;
  now: Date;
  onClose: () => void;
  onSave: (startsAt: Date) => Promise<void>;
}) {
  const { showFailure } = useFeedback();
  const initial = props.appointment.startsAt > props.now ? props.appointment.startsAt : props.now;
  const [date, setDate] = useState(toDateInput(initial));
  const [time, setTime] = useState(toTimeInput(props.appointment.startsAt));
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const startsAt = combineLocal(date, time);
    if (!startsAt) {
      showFailure(validationFailure('Choose a date and a time.'));
      return;
    }
    setBusy(true);
    await props.onSave(startsAt);
    setBusy(false);
  }

  return (
    <Modal title="Reschedule" onClose={props.onClose}>
      <form className="stack gap-md" onSubmit={submit} noValidate>
        <TextField
          label="New date"
          type="date"
          min={toDateInput(props.now)}
          max={toDateInput(new Date(props.now.getTime() + 365 * 86_400_000))}
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
        <TextField label="New time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        <div className="dialog-actions">
          <Button variant="text" onClick={props.onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Reschedule'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function RideSummaryCard({ ride, now }: { ride: Ride; now: Date }) {
  const navigate = useNavigate();
  return (
    <AppCard onClick={() => navigate(rideIsTrackable(ride) ? `/rides/${ride.id}/track` : `/rides/${ride.id}`)}>
      <div className="row">
        <p className="t-title grow">{rideDirectionLabel[ride.direction]}</p>
        <RideStatusPill status={ride.status} />
      </div>
      <p className="t-body mt-sm">
        {ride.flexibleReturn
          ? 'Pickup when the visit ends'
          : `Pickup ${formatRelativeDay(ride.scheduledPickupAt, now)} at ${formatTime(ride.scheduledPickupAt)}`}
      </p>
      {ride.driver && (
        <p className="t-body muted mt-xs">
          {ride.driver.displayName} · {vehicleDescription(ride.driver.vehicle)}
        </p>
      )}
    </AppCard>
  );
}
