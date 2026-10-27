import { Accessibility, Car, Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';

import { Modal } from '../components/feedback';
import {
  Button,
  Card,
  EmptyState,
  LoadFailure,
  LoadingBlock,
  RefreshButton,
  Screen,
  StaleBanner,
  Switch,
  TextField,
} from '../components/ui';
import { useRun } from '../components/useRun';
import { plural } from '../core/format';
import { canAdminister, vehicleLabel } from '../domain/models';
import {
  useOperatorId,
  useResource,
  useSelectedOrganization,
  useStore,
} from '../state/context';
import { keys } from '../state/opsStore';

/**
 * The vehicles a driver can be put in. A port of
 * apps/ops_console/lib/features/fleet/fleet_screen.dart.
 *
 * `isWheelchairAccessible` is the field that matters. It is a **hard
 * constraint on assignment**: a fleet recorded wrongly here does not produce a
 * slightly worse match, it produces a trip that cannot be assigned at all.
 */
export function FleetScreen() {
  const organizationId = useOperatorId();
  const organization = useSelectedOrganization();
  const vehicles = useResource(keys.vehicles(organizationId), (api) =>
    api.vehicles(organizationId),
  );
  const [adding, setAdding] = useState(false);

  let body;
  if (vehicles.value) {
    const list = vehicles.value;
    const accessible = list.filter((v) => v.isWheelchairAccessible).length;
    body =
      list.length === 0 ? (
        <EmptyState
          icon={Car}
          title="No vehicles yet"
          message="A driver is added to a vehicle, so the fleet comes first."
        />
      ) : (
        <div className="stack gap-sm">
          {vehicles.error ? (
            <StaleBanner error={vehicles.error} onRetry={vehicles.reload} />
          ) : null}
          <Card>
            <span className="t-title">
              {plural(list.length, 'vehicle')} · {accessible} wheelchair-accessible
            </span>
          </Card>
          <ul className="list">
            {list.map((vehicle) => (
              <li key={vehicle.id}>
                <Card>
                  <div className="row">
                    <div className="grow">
                      <div className="t-body-lg">{vehicleLabel(vehicle)}</div>
                      <div className="t-small">{vehicle.licensePlate}</div>
                    </div>
                    {vehicle.isWheelchairAccessible && (
                      <span title="Wheelchair-accessible">
                        <Accessibility size={22} aria-label="Wheelchair-accessible" />
                      </span>
                    )}
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        </div>
      );
  } else if (vehicles.error) {
    body = <LoadFailure title="Could not load the fleet" onRetry={vehicles.reload} />;
  } else {
    body = <LoadingBlock />;
  }

  return (
    <Screen
      title="Fleet"
      actions={
        <>
          <RefreshButton onClick={vehicles.reload} />
          {organization && canAdminister(organization) && (
            <Button icon={Plus} onClick={() => setAdding(true)}>
              Add vehicle
            </Button>
          )}
        </>
      }
    >
      {body}
      {adding && (
        <AddVehicleDialog
          organizationId={organizationId}
          onClose={() => setAdding(false)}
        />
      )}
    </Screen>
  );
}

function AddVehicleDialog(props: { organizationId: string; onClose: () => void }) {
  const store = useStore();
  const { run, busy } = useRun();
  const [form, setForm] = useState({
    make: '',
    model: '',
    color: '',
    licensePlate: '',
  });
  const [accessible, setAccessible] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<keyof typeof form, string>>>({});

  const field = (name: keyof typeof form, label: string) => (
    <TextField
      label={label}
      value={form[name]}
      error={errors[name]}
      onChange={(e) => setForm({ ...form, [name]: e.target.value })}
    />
  );

  async function submit(e: FormEvent) {
    e.preventDefault();
    const next: typeof errors = {};
    for (const name of Object.keys(form) as (keyof typeof form)[]) {
      if (form[name].trim() === '') next[name] = 'Required';
    }
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    const result = await run(() =>
      store.guard(() =>
        store.api.addVehicle({
          organizationId: props.organizationId,
          ...form,
          isWheelchairAccessible: accessible,
        }),
      ),
    );
    if (result.ok) {
      store.invalidate(keys.vehicles(props.organizationId));
      props.onClose();
    }
  }

  return (
    <Modal title="Add a vehicle" onClose={props.onClose}>
      <form className="stack gap-sm" onSubmit={(e) => void submit(e)} noValidate>
        {field('make', 'Make')}
        {field('model', 'Model')}
        {field('color', 'Colour')}
        {field('licensePlate', 'Licence plate')}
        <Switch
          label="Wheelchair-accessible"
          // Spelled out because getting it wrong is not cosmetic: the refusal lands on the dispatcher.
          description="Assignment refuses wheelchair trips to vehicles without this."
          checked={accessible}
          onChange={setAccessible}
        />
        <div className="dialog-actions">
          <Button variant="text" disabled={busy} onClick={props.onClose}>
            Cancel
          </Button>
          <Button type="submit" busy={busy}>
            {busy ? 'Adding…' : 'Add'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
