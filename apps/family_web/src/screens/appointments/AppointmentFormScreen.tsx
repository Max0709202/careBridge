import { MapPinPlus } from 'lucide-react';
import { useState, type FormEvent } from 'react';

import { validationFailure } from '../../api/failures';
import { useFeedback } from '../../components/feedback';
import { useGoBack } from '../../components/navigation';
import {
  AppCard,
  Avatar,
  Button,
  Page,
  SectionHeader,
  SelectField,
  SwitchRow,
  TextField,
} from '../../components/ui';
import { combineLocal, toDateInput } from '../../core/formatting';
import {
  APPOINTMENT_TYPES,
  appointmentTypeLabel,
  patientFirstInitial,
  type AppointmentType,
} from '../../domain/models';
import { selectedPatient } from '../../state/careState';
import { useCare, useStore } from '../../state/context';
import { ClinicFormSheet } from './ClinicFormSheet';

const DURATIONS: [number, string][] = [
  [20, '20 minutes'],
  [30, '30 minutes'],
  [45, '45 minutes'],
  [60, '1 hour'],
  [90, '1 hour 30 minutes'],
  [120, '2 hours'],
];

export function AppointmentFormScreen() {
  const state = useCare();
  const store = useStore();
  const goBack = useGoBack('/appointments');
  const { showFailure, showConfirmation } = useFeedback();
  const patient = selectedPatient(state);

  const [clinicId, setClinicId] = useState<string>(
    () => patient?.preferredClinicId ?? state.clinics[0]?.id ?? '',
  );
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [duration, setDuration] = useState(45);
  const [type, setType] = useState<AppointmentType>('followUp');
  const [notes, setNotes] = useState('');
  const [transportRequired, setTransportRequired] = useState(true);
  const [clinicError, setClinicError] = useState<string | null>(null);
  const [addingClinic, setAddingClinic] = useState(false);
  const [busy, setBusy] = useState(false);

  const today = new Date();
  const inAYear = new Date(today.getTime() + 365 * 86_400_000);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (clinicId === '') {
      setClinicError('Choose a clinic.');
      return;
    }
    setClinicError(null);

    const startsAt = combineLocal(date, time);
    if (!patient || startsAt === null) {
      showFailure(validationFailure('Choose a clinic, a date and a time.'));
      return;
    }

    setBusy(true);
    try {
      await store.createAppointment({
        patientId: patient.id,
        clinicId,
        startsAt,
        expectedDurationMinutes: duration,
        type,
        coordinationNotes: notes.trim() === '' ? null : notes.trim(),
        transportRequired,
      });
      showConfirmation('Appointment added.');
      goBack();
    } catch (error) {
      showFailure(error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page title="Add an appointment" back>
      <form className="stack" onSubmit={save} noValidate>
        {patient && (
          <AppCard>
            <div className="row">
              <Avatar text={patientFirstInitial(patient)} />
              <p className="t-body-lg grow">For {patient.preferredName}</p>
            </div>
          </AppCard>
        )}

        <div className="mt-lg">
          <SectionHeader title="Where" />
          <SelectField
            label="Clinic"
            value={clinicId}
            onChange={(e) => setClinicId(e.target.value)}
            error={clinicError}
          >
            {clinicId === '' && <option value="">Choose a clinic</option>}
            {state.clinics.map((clinic) => (
              <option key={clinic.id} value={clinic.id}>
                {clinic.name}
              </option>
            ))}
          </SelectField>
          <Button
            variant="text"
            icon={MapPinPlus}
            className="align-start mt-sm"
            onClick={() => setAddingClinic(true)}
          >
            Add a clinic
          </Button>
        </div>

        <div className="mt-lg">
          <SectionHeader
            title="When"
            subtitle="Times are shown in the clinic’s local time."
          />
          <div className="two-col">
            <TextField
              label="Date"
              type="date"
              min={toDateInput(today)}
              max={toDateInput(inAYear)}
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
            <TextField
              label="Time"
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
            />
          </div>
          <div className="mt-md">
            <SelectField
              label="How long will it take?"
              helper="Used to plan the ride home."
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
            >
              {DURATIONS.map(([minutes, label]) => (
                <option key={minutes} value={minutes}>
                  {label}
                </option>
              ))}
            </SelectField>
          </div>
        </div>

        <div className="mt-lg">
          <SectionHeader
            title="What kind of visit"
            subtitle="Kept deliberately broad — CareBridge does not hold medical details."
          />
          <SelectField
            label="Visit type"
            value={type}
            onChange={(e) => setType(e.target.value as AppointmentType)}
          >
            {APPOINTMENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {appointmentTypeLabel[t]}
              </option>
            ))}
          </SelectField>
          <div className="mt-md">
            <TextField
              label="Notes for coordination (optional)"
              helper="Practical reminders only — what to bring, which floor. No symptoms or medication."
              multiline
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>

        <div className="mt-md">
          <SwitchRow
            title="They will need a ride"
            subtitle="You can arrange the ride once the appointment is saved."
            checked={transportRequired}
            onChange={setTransportRequired}
          />
        </div>

        <Button type="submit" block className="mt-xl" disabled={busy}>
          {busy ? 'Saving…' : 'Save appointment'}
        </Button>
      </form>

      {addingClinic && (
        <ClinicFormSheet
          onClose={(clinic) => {
            setAddingClinic(false);
            if (clinic) {
              setClinicId(clinic.id);
              setClinicError(null);
            }
          }}
        />
      )}
    </Page>
  );
}
