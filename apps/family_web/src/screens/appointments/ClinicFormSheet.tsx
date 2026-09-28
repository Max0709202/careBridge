import { useState, type FormEvent } from 'react';

import { Modal, useFeedback } from '../../components/feedback';
import { Button, TextField } from '../../components/ui';
import type { Clinic } from '../../domain/models';
import { useStore } from '../../state/context';

/**
 * Adds a clinic without leaving the appointment being created. Clinics are
 * entered by hand in the MVP. Port of clinic_form_sheet.dart.
 */
export function ClinicFormSheet({ onClose }: { onClose: (clinic: Clinic | null) => void }) {
  const store = useStore();
  const { showFailure } = useFeedback();
  const [values, setValues] = useState({
    name: '',
    phone: '',
    line1: '',
    city: '',
    state: '',
    postalCode: '',
    entrance: '',
  });
  const [errors, setErrors] = useState<Partial<Record<keyof typeof values, string>>>({});
  const [busy, setBusy] = useState(false);

  const set = (key: keyof typeof values) => (e: { target: { value: string } }) =>
    setValues((v) => ({ ...v, [key]: e.target.value }));

  async function save(e: FormEvent) {
    e.preventDefault();
    const required: (keyof typeof values)[] = ['name', 'phone', 'line1', 'city', 'state', 'postalCode'];
    const next: typeof errors = {};
    for (const key of required) if (values[key].trim() === '') next[key] = 'Required';
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setBusy(true);
    try {
      // The server assigns the id; `addClinic` hands back the stored record,
      // which is what the appointment form then selects.
      const saved = await store.addClinic({
        name: values.name.trim(),
        phone: values.phone.trim(),
        line1: values.line1.trim(),
        city: values.city.trim(),
        state: values.state.trim(),
        postalCode: values.postalCode.trim(),
        entranceNotes: values.entrance.trim() === '' ? null : values.entrance.trim(),
      });
      onClose(saved);
    } catch (error) {
      showFailure(error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal sheet title="Add a clinic" onClose={() => onClose(null)}>
      <form className="stack gap-md" onSubmit={save} noValidate>
        <TextField label="Clinic name" autoCapitalize="words" value={values.name} onChange={set('name')} error={errors.name} />
        <TextField label="Phone number" type="tel" autoComplete="off" value={values.phone} onChange={set('phone')} error={errors.phone} />
        <TextField label="Street address" value={values.line1} onChange={set('line1')} error={errors.line1} />
        <div className="city-state">
          <TextField label="City" value={values.city} onChange={set('city')} error={errors.city} />
          <TextField label="State" autoCapitalize="characters" value={values.state} onChange={set('state')} error={errors.state} />
        </div>
        <TextField label="ZIP code" inputMode="numeric" value={values.postalCode} onChange={set('postalCode')} error={errors.postalCode} />
        <TextField
          label="Where should the car stop? (optional)"
          helper="Large campuses are the most common reason a driver cannot find someone."
          multiline
          rows={2}
          value={values.entrance}
          onChange={set('entrance')}
        />
        <Button type="submit" block disabled={busy} className="mt-sm">
          {busy ? 'Adding…' : 'Add clinic'}
        </Button>
      </form>
    </Modal>
  );
}
