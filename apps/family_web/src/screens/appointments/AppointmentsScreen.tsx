import { CarFront, CalendarRange, Ban, Plus, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { AppointmentStatusPill } from '../../components/status';
import { AppCard, Button, EmptyState, Page } from '../../components/ui';
import {
  formatAppointmentWhen,
  formatDuration,
  formatRelativeDay,
  formatTime,
} from '../../core/formatting';
import { appointmentTypeLabel, type Appointment } from '../../domain/models';
import {
  appointmentIsUpcoming,
  appointmentStatusLabel,
  rideStatusLabel,
} from '../../domain/statuses';
import {
  can,
  clinicById,
  pastFor,
  rideIsActive,
  ridesForAppointment,
  selectedPatient,
  upcomingFor,
  type CareState,
} from '../../state/careState';
import { useCare, useNow } from '../../state/context';

export function AppointmentsScreen() {
  const state = useCare();
  const now = useNow();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState<'upcoming' | 'past'>(
    params.get('tab') === 'past' ? 'past' : 'upcoming',
  );
  const patient = selectedPatient(state);

  if (!patient) {
    return (
      <Page title="Appointments">
        <EmptyState
          fill
          icon={UserPlus}
          title="Add someone first"
          message="Appointments belong to a person. Add a profile to begin."
          action={
            <Button onClick={() => navigate('/patients/new')}>Add a profile</Button>
          }
        />
      </Page>
    );
  }

  const upcoming = upcomingFor(state, patient.id, now);
  const past = pastFor(state, patient.id, now);
  const canSchedule = can(state, patient.id, 'scheduleAppointments');

  const choose = (next: 'upcoming' | 'past') => {
    setTab(next);
    setParams(next === 'past' ? { tab: 'past' } : {}, { replace: true });
  };

  return (
    <Page
      title={`${patient.preferredName}’s appointments`}
      below={
        <div className="tabs" role="tablist">
          <button
            role="tab"
            aria-selected={tab === 'upcoming'}
            onClick={() => choose('upcoming')}
          >
            Upcoming ({upcoming.length})
          </button>
          <button
            role="tab"
            aria-selected={tab === 'past'}
            onClick={() => choose('past')}
          >
            Past ({past.length})
          </button>
        </div>
      }
    >
      <div role="tabpanel">
        {tab === 'upcoming' ? (
          <AppointmentList
            appointments={upcoming}
            state={state}
            now={now}
            emptyTitle="Nothing scheduled"
            emptyMessage="Add an appointment and CareBridge will handle reminders and the ride there."
            canSchedule={canSchedule}
          />
        ) : (
          <AppointmentList
            appointments={past}
            state={state}
            now={now}
            emptyTitle="No history yet"
            emptyMessage="Completed and cancelled appointments appear here."
            canSchedule={false}
          />
        )}
      </div>
      {canSchedule && (
        <button
          type="button"
          className="fab"
          onClick={() => navigate('/appointments/new')}
        >
          <Plus aria-hidden /> Add
        </button>
      )}
    </Page>
  );
}

function AppointmentList(props: {
  appointments: Appointment[];
  state: CareState;
  now: Date;
  emptyTitle: string;
  emptyMessage: string;
  canSchedule: boolean;
}) {
  const navigate = useNavigate();
  if (props.appointments.length === 0) {
    return (
      <EmptyState
        icon={CalendarRange}
        title={props.emptyTitle}
        message={props.emptyMessage}
        action={
          props.canSchedule ? (
            <Button icon={Plus} onClick={() => navigate('/appointments/new')}>
              Add an appointment
            </Button>
          ) : undefined
        }
      />
    );
  }
  return (
    <div className="stack gap-sm mt-md">
      {props.appointments.map((a) => (
        <AppointmentTile
          key={a.id}
          appointment={a}
          state={props.state}
          now={props.now}
        />
      ))}
    </div>
  );
}

function AppointmentTile({
  appointment,
  state,
  now,
}: {
  appointment: Appointment;
  state: CareState;
  now: Date;
}) {
  const navigate = useNavigate();
  const clinic = clinicById(state, appointment.clinicId);
  const activeRide = ridesForAppointment(state, appointment.id).find(rideIsActive);

  return (
    <AppCard
      onClick={() => navigate(`/appointments/${appointment.id}`)}
      ariaLabel={`${formatAppointmentWhen(appointment.startsAt, appointment.timeZoneLabel)} at ${clinic?.name ?? 'a clinic'}. Status ${appointmentStatusLabel[appointment.status]}.`}
    >
      <div className="row start">
        <div className="grow">
          <p className="t-title">{formatRelativeDay(appointment.startsAt, now)}</p>
          <p className="t-body muted">
            {formatTime(appointment.startsAt)} ·{' '}
            {formatDuration(appointment.expectedDurationMinutes)}
          </p>
        </div>
        <AppointmentStatusPill status={appointment.status} />
      </div>
      <p className="t-body-lg mt-sm">{clinic?.name ?? 'Clinic'}</p>
      <p className="t-body muted">{appointmentTypeLabel[appointment.type]}</p>
      {activeRide ? (
        <div className="row tight mt-sm">
          <CarFront size={20} className="muted" aria-hidden />
          <p className="t-body grow">Transport: {rideStatusLabel[activeRide.status]}</p>
        </div>
      ) : (
        appointmentIsUpcoming(appointment.status) && (
          <div className="row tight mt-sm">
            <Ban size={20} className="muted" aria-hidden />
            <p className="t-body muted grow">No transport booked</p>
          </div>
        )
      )}
    </AppCard>
  );
}
