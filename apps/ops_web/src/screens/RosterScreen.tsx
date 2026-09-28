import { FolderOpen, Users } from 'lucide-react';
import { useState } from 'react';

import { Modal } from '../components/feedback';
import { DriverStatusPill } from '../components/pills';
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
  TextArea,
} from '../components/ui';
import { useRun } from '../components/useRun';
import {
  driverStatusLabel,
  isAssignable,
  nextStatusesFor,
  transitionActionLabel,
  transitionNeedsReason,
  type DriverStatus,
} from '../domain/dispatch';
import { canAdminister, vehicleLabel, type Driver } from '../domain/models';
import { useOperatorId, useResource, useSelectedOrganization, useStore } from '../state/context';
import { keys } from '../state/opsStore';
import { DocumentReviewSheet } from './DocumentReviewSheet';

/**
 * The roster: who may drive, and who is driving today. A port of
 * apps/ops_console/lib/features/roster/roster_screen.dart.
 *
 * Two controls that look similar and are not. **Shift** is a scheduling fact a
 * dispatcher owns — they know who called in sick. **Status** is the company's
 * standing decision about whether this person may carry a passenger, and
 * crossing into or out of `approved` moves a billable seat. So the first is a
 * dispatcher's and the second is not.
 */
export function RosterScreen() {
  const organizationId = useOperatorId();
  const organization = useSelectedOrganization();
  const administer = organization ? canAdminister(organization) : false;
  const drivers = useResource(keys.drivers(organizationId), (api) => api.drivers(organizationId));
  const [paperworkFor, setPaperworkFor] = useState<Driver | null>(null);

  let body;
  if (drivers.value) {
    body =
      drivers.value.length === 0 ? (
        <EmptyState icon={Users} title="No drivers yet" message="Add a vehicle first, then the driver who will be in it." />
      ) : (
        <>
          {drivers.error ? <StaleBanner error={drivers.error} onRetry={drivers.reload} /> : null}
          <ul className="list">
            {drivers.value.map((driver) => (
              <li key={driver.id}>
                <DriverRow
                  driver={driver}
                  organizationId={organizationId}
                  canAdminister={administer}
                  onPaperwork={() => setPaperworkFor(driver)}
                />
              </li>
            ))}
          </ul>
        </>
      );
  } else if (drivers.error) {
    body = <LoadFailure title="Could not load the roster" onRetry={drivers.reload} />;
  } else {
    body = <LoadingBlock />;
  }

  return (
    <Screen title="Roster" actions={<RefreshButton onClick={drivers.reload} />}>
      {body}
      {/*
        A sheet rather than a page: paperwork is reviewed *while* looking at
        the roster, and losing one's place in a list of forty drivers is how
        the list gets abandoned halfway.
      */}
      {paperworkFor && (
        <DocumentReviewSheet
          organizationId={organizationId}
          driverId={paperworkFor.id}
          driverName={paperworkFor.displayName}
          onClose={() => setPaperworkFor(null)}
        />
      )}
    </Screen>
  );
}

function DriverRow(props: {
  driver: Driver;
  organizationId: string;
  canAdminister: boolean;
  onPaperwork: () => void;
}) {
  const { driver, organizationId } = props;
  const store = useStore();
  const { run, busy } = useRun();
  const [askingReasonFor, setAskingReasonFor] = useState<DriverStatus | null>(null);

  async function act(action: () => Promise<unknown>) {
    const result = await run(() => store.guard(action));
    if (result.ok) store.invalidateOperational(organizationId);
    return result.ok;
  }

  const toggleShift = (onShift: boolean) =>
    act(() => store.api.setShift({ organizationId, driverId: driver.id, onShift }));

  const changeStatus = (to: DriverStatus, reason?: string) =>
    act(() => store.api.setDriverStatus({ organizationId, driverId: driver.id, to, reason }));

  return (
    <Card>
      <div className="row">
        <span className="t-title grow">{driver.displayName}</span>
        <DriverStatusPill status={driver.status} />
      </div>
      <div className="t-small muted mt-xs">
        {vehicleLabel(driver.vehicle)} · {driver.vehicle.licensePlate}
        {driver.vehicle.isWheelchairAccessible ? ' · accessible' : ''}
      </div>
      {driver.suspensionReason && <div className="t-small error-text mt-xs">Suspended: {driver.suspensionReason}</div>}
      {/* On the row, so an admin about to approve somebody sees it costs money before they click. */}
      {driver.occupiesSeat && <div className="t-small mt-xs">Occupies a billable seat</div>}
      <div className="row mt-sm">
        <Switch
          label="On shift"
          checked={driver.onShift}
          disabled={busy || !isAssignable(driver.status)}
          onChange={(next) => void toggleShift(next)}
        />
        <span className="grow" />
        {driver.activeRideCount > 0 && <span className="t-small muted">On a trip</span>}
      </div>
      {props.canAdminister && (
        <div className="actions-row divided">
          {/* Paperwork first: approval is refused without it. */}
          <Button variant="outlined" icon={FolderOpen} disabled={busy} onClick={props.onPaperwork}>
            Paperwork
          </Button>
          {nextStatusesFor(driver.status).map((to) => (
            <Button
              key={to}
              variant="outlined"
              disabled={busy}
              onClick={() => (transitionNeedsReason(to) ? setAskingReasonFor(to) : void changeStatus(to))}
            >
              {transitionActionLabel[to]}
            </Button>
          ))}
        </div>
      )}
      {askingReasonFor && (
        <ReasonDialog
          to={askingReasonFor}
          onCancel={() => setAskingReasonFor(null)}
          onConfirm={async (reason) => {
            if (await changeStatus(askingReasonFor, reason)) setAskingReasonFor(null);
          }}
          busy={busy}
        />
      )}
    </Card>
  );
}

/**
 * Suspension and offboarding end somebody's ability to earn, and a record of
 * one with no reason is unanswerable three months later. Confirm stays grey
 * until one is typed.
 */
function ReasonDialog(props: {
  to: DriverStatus;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  return (
    <Modal title={`Why ${driverStatusLabel[props.to].toLowerCase()}?`} onClose={props.onCancel}>
      <TextArea
        label="Reason"
        helper="Recorded against this driver and in the audit log."
        counter={300}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      <div className="dialog-actions">
        <Button variant="text" onClick={props.onCancel}>
          Cancel
        </Button>
        <Button
          disabled={reason.trim() === ''}
          busy={props.busy}
          onClick={() => props.onConfirm(reason.trim())}
        >
          Confirm
        </Button>
      </div>
    </Modal>
  );
}
