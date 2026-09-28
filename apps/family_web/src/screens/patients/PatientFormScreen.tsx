import { Accessibility } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';

import type { PatientInput } from '../../api/careApi';
import { useFeedback } from '../../components/feedback';
import { useGoBack } from '../../components/navigation';
import { AppCard, Button, Page, SectionHeader, SelectField, TextField } from '../../components/ui';
import {
  AGE_BANDS,
  ageBandLabel,
  MOBILITY_NEEDS,
  mobilityNeedLabel,
  type AgeBand,
  type MobilityNeed,
} from '../../domain/models';
import { patientById } from '../../state/careState';
import { useCare, useStore } from '../../state/context';

type Fields =
  | 'preferredName'
  | 'legalName'
  | 'phone'
  | 'line1'
  | 'line2'
  | 'city'
  | 'state'
  | 'postalCode'
  | 'accessNotes'
  | 'mobilityNotes'
  | 'contactName'
  | 'contactRelationship'
  | 'contactPhone';

/**
 * Create or edit the person being cared for. Every field has to earn its
 * place; date of birth is absent by design. The fields that look like
 * afterthoughts — access notes, mobility notes — are the ones drivers rely on.
 */
export function PatientFormScreen() {
  const { id } = useParams();
  const state = useCare();
  const store = useStore();
  const goBack = useGoBack(id ? `/patients/${id}` : '/');
  const { showFailure, showConfirmation } = useFeedback();

  const isEditing = id !== undefined;
  const [existing] = useState(() => (id ? patientById(state, id) : null));
  const contact = existing?.emergencyContacts[0] ?? null;

  const [values, setValues] = useState<Record<Fields, string>>(() => ({
    preferredName: existing?.preferredName ?? '',
    legalName: existing?.legalName ?? '',
    phone: existing?.phone ?? '',
    line1: existing?.homeAddress.line1 ?? '',
    line2: existing?.homeAddress.line2 ?? '',
    city: existing?.homeAddress.city ?? '',
    state: existing?.homeAddress.state ?? '',
    postalCode: existing?.homeAddress.postalCode ?? '',
    accessNotes: existing?.homeAddress.accessNotes ?? '',
    mobilityNotes: existing?.mobilityNotes ?? '',
    contactName: contact?.name ?? '',
    contactRelationship: contact?.relationship ?? '',
    contactPhone: contact?.phone ?? '',
  }));
  const [needs, setNeeds] = useState<MobilityNeed[]>(() => [...(existing?.mobilityNeeds ?? [])]);
  const [ageBand, setAgeBand] = useState<AgeBand | ''>(existing?.ageBand ?? '');
  const [errors, setErrors] = useState<Partial<Record<Fields, string>>>({});
  const [busy, setBusy] = useState(false);

  const set = (key: Fields) => (e: { target: { value: string } }) =>
    setValues((v) => ({ ...v, [key]: e.target.value }));
  const text = (key: Fields) => values[key].trim();
  const optional = (key: Fields) => (text(key) === '' ? null : text(key));

  function toggleNeed(need: MobilityNeed) {
    setNeeds((current) =>
      current.includes(need) ? current.filter((n) => n !== need) : [...current, need],
    );
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    const next: typeof errors = {};
    if (text('preferredName') === '') next.preferredName = 'Enter the name they like to be called.';
    if (text('phone') === '') next.phone = 'A phone number is needed so a driver can make contact.';
    if (text('line1') === '') next.line1 = 'Enter the pickup address.';
    if (text('city') === '') next.city = 'Required';
    if (text('state') === '') next.state = 'Required';
    if (text('postalCode') === '') next.postalCode = 'Required';
    setErrors(next);
    if (Object.keys(next).length > 0) {
      document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
      return;
    }

    const coordinates = existing?.homeAddress.coordinates;
    const patient: PatientInput = {
      preferredName: text('preferredName'),
      legalName: optional('legalName'),
      phone: text('phone'),
      homeAddress: {
        line1: text('line1'),
        line2: optional('line2'),
        city: text('city'),
        state: text('state'),
        postalCode: text('postalCode'),
        accessNotes: optional('accessNotes'),
        // Coordinates come from server-side geocoding; carried over, never invented.
        ...(coordinates ? { latitude: coordinates.latitude, longitude: coordinates.longitude } : {}),
      },
      ageBand: ageBand === '' ? null : ageBand,
      preferredLanguage: existing?.preferredLanguage ?? 'English',
      mobilityNeeds: needs,
      mobilityNotes: optional('mobilityNotes'),
      emergencyContacts: [
        ...(text('contactName') !== ''
          ? [
              {
                name: text('contactName'),
                relationship: text('contactRelationship') === '' ? 'Family' : text('contactRelationship'),
                phone: text('contactPhone'),
                isPrimary: true,
              },
            ]
          : []),
        ...(existing?.emergencyContacts.slice(1) ?? []).map((c) => ({
          name: c.name,
          relationship: c.relationship,
          phone: c.phone,
          isPrimary: c.isPrimary,
        })),
      ],
      preferredClinicId: existing?.preferredClinicId ?? null,
    };

    setBusy(true);
    try {
      await store.savePatient(existing?.id ?? null, patient);
      showConfirmation(isEditing ? 'Profile updated.' : `${patient.preferredName} added.`);
      goBack();
    } catch (error) {
      showFailure(error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page title={isEditing ? 'Edit profile' : 'Add a profile'} back>
      <form className="stack gap-md" onSubmit={save} noValidate>
        <SectionHeader title="Who they are" subtitle="Only what is needed to arrange a trip safely." />
        <TextField
          label="Preferred name"
          helper="What they like to be called."
          autoCapitalize="words"
          value={values.preferredName}
          onChange={set('preferredName')}
          error={errors.preferredName}
        />
        <TextField
          label="Legal name (optional)"
          helper="Only needed if a clinic or transport provider has to match their records."
          autoCapitalize="words"
          value={values.legalName}
          onChange={set('legalName')}
        />
        <TextField label="Their phone number" type="tel" value={values.phone} onChange={set('phone')} error={errors.phone} />
        <SelectField
          label="Age range (optional)"
          helper="A range, not a date of birth — enough to plan mobility support, and not enough to identify anyone."
          value={ageBand}
          onChange={(e) => setAgeBand(e.target.value as AgeBand | '')}
        >
          <option value="">Not given</option>
          {AGE_BANDS.map((band) => (
            <option key={band} value={band}>
              {ageBandLabel[band]}
            </option>
          ))}
        </SelectField>

        <div className="mt-sm">
          <SectionHeader title="Where they are collected" subtitle="The details a driver needs to find the right door." />
        </div>
        <TextField label="Street address" autoComplete="address-line1" value={values.line1} onChange={set('line1')} error={errors.line1} />
        <TextField label="Flat, unit or floor (optional)" autoComplete="address-line2" value={values.line2} onChange={set('line2')} />
        <div className="city-state">
          <TextField label="City" autoComplete="address-level2" value={values.city} onChange={set('city')} error={errors.city} />
          <TextField label="State" autoComplete="address-level1" autoCapitalize="characters" value={values.state} onChange={set('state')} error={errors.state} />
        </div>
        <TextField label="ZIP code" inputMode="numeric" autoComplete="postal-code" value={values.postalCode} onChange={set('postalCode')} error={errors.postalCode} />
        <TextField
          label="How to find them"
          helper="Gate codes, which door, how long to wait. This is what stops a driver waiting at the wrong entrance."
          multiline
          rows={3}
          value={values.accessNotes}
          onChange={set('accessNotes')}
        />

        <div className="mt-sm">
          <SectionHeader
            title="Getting about"
            subtitle="Determines which vehicle is sent and what help is offered on the day."
          />
        </div>
        <div className="wrap" role="group" aria-label="Mobility needs">
          {MOBILITY_NEEDS.map((need) => (
            <button
              key={need}
              type="button"
              className="chip"
              aria-pressed={needs.includes(need)}
              onClick={() => toggleNeed(need)}
            >
              {mobilityNeedLabel[need]}
            </button>
          ))}
        </div>
        {needs.includes('wheelchair') && (
          <AppCard>
            <div className="row start" style={{ gap: 12 }}>
              <Accessibility className="ink-primary" aria-hidden style={{ flex: '0 0 auto' }} />
              <p className="t-body grow">
                Every trip will require a wheelchair-accessible vehicle. This is treated as a hard
                requirement, never a preference.
              </p>
            </div>
          </AppCard>
        )}
        <TextField
          label="Anything a driver should know"
          helper="How to help, not why help is needed. No medical details."
          multiline
          rows={3}
          value={values.mobilityNotes}
          onChange={set('mobilityNotes')}
        />

        <div className="mt-sm">
          <SectionHeader title="Emergency contact" subtitle="Who should be called if something goes wrong." />
        </div>
        <TextField label="Name" autoCapitalize="words" value={values.contactName} onChange={set('contactName')} />
        <TextField
          label="Relationship"
          placeholder="Daughter, neighbour, …"
          autoCapitalize="words"
          value={values.contactRelationship}
          onChange={set('contactRelationship')}
        />
        <TextField label="Phone number" type="tel" value={values.contactPhone} onChange={set('contactPhone')} />

        <Button type="submit" block className="mt-lg" disabled={busy}>
          {busy ? 'Saving…' : isEditing ? 'Save changes' : 'Add profile'}
        </Button>
      </form>
    </Page>
  );
}
