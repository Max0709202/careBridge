import {
  Copy,
  FolderOpen,
  KeyRound,
  MessageSquare,
  RotateCw,
  Search,
  UserPlus,
  Users,
} from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';

import type { DriverAccountMatch } from '../api/codec';
import { Failure } from '../api/failures';
import { Modal, useConfirm, useFeedback } from '../components/feedback';
import { DriverStatusPill } from '../components/pills';
import {
  Button,
  Card,
  EmptyState,
  LoadFailure,
  LoadingBlock,
  RefreshButton,
  Screen,
  SectionHeader,
  SelectField,
  StaleBanner,
  Switch,
  TextArea,
  TextField,
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
import {
  canAdminister,
  isOpenApplication,
  vehicleLabel,
  type Driver,
} from '../domain/models';
import {
  useOperatorId,
  useResource,
  useSelectedOrganization,
  useStore,
} from '../state/context';
import { keys } from '../state/opsStore';
import { DocumentReviewSheet } from './DocumentReviewSheet';
import { useOpenThread } from './messages/useOpenThread';

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
  const drivers = useResource(keys.drivers(organizationId), (api) =>
    api.drivers(organizationId),
  );
  const [paperworkFor, setPaperworkFor] = useState<Driver | null>(null);
  const [adding, setAdding] = useState(false);

  const row = (driver: Driver) => (
    <li key={driver.id}>
      <DriverRow
        driver={driver}
        organizationId={organizationId}
        canAdminister={administer}
        onPaperwork={() => setPaperworkFor(driver)}
      />
    </li>
  );

  let body;
  if (drivers.value) {
    // Applications first: they are the part of the roster waiting on somebody
    // here, and a driver who applied on Monday should not find out on Friday
    // that nobody scrolled down.
    const applications = drivers.value.filter(isOpenApplication);
    const roster = drivers.value.filter((driver) => !isOpenApplication(driver));
    body =
      drivers.value.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No drivers yet"
          message={
            administer
              ? 'Give drivers your company code above so they can apply from the driver app, or add one yourself.'
              : 'Drivers appear here once an admin adds them or approves their application.'
          }
        />
      ) : (
        <>
          {drivers.error ? (
            <StaleBanner error={drivers.error} onRetry={drivers.reload} />
          ) : null}
          {applications.length > 0 && (
            <>
              <SectionHeader title={`Applications (${applications.length})`} />
              <ul className="list">{applications.map(row)}</ul>
              <SectionHeader title="Roster" />
            </>
          )}
          <ul className="list">{roster.map(row)}</ul>
        </>
      );
  } else if (drivers.error) {
    body = <LoadFailure title="Could not load the roster" onRetry={drivers.reload} />;
  } else {
    body = <LoadingBlock />;
  }

  return (
    <Screen
      title="Roster"
      actions={
        <>
          <RefreshButton onClick={drivers.reload} />
          {administer && (
            <Button icon={UserPlus} onClick={() => setAdding(true)}>
              Add driver
            </Button>
          )}
        </>
      }
    >
      {administer && <JoinCodeCard organizationId={organizationId} />}
      {body}
      {adding && (
        <AddDriverDialog
          organizationId={organizationId}
          onClose={() => setAdding(false)}
        />
      )}
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
    act(() =>
      store.api.setDriverStatus({ organizationId, driverId: driver.id, to, reason }),
    );

  const thread = useOpenThread();

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
      {driver.appliedAt && driver.status === 'pendingApproval' && (
        <div className="t-small mt-xs">
          Applied {driver.appliedAt.toLocaleDateString()}
          {driver.applicantName ? ` · ${driver.applicantName}` : ''}
          {driver.email ? ` · ${driver.email}` : ''}
          {driver.phone ? ` · ${driver.phone}` : ''} · {driver.yearsDriving} years
          driving
        </div>
      )}
      {driver.rejectionReason && driver.status === 'offboarded' && (
        <div className="t-small error-text mt-xs">
          Not accepted: {driver.rejectionReason}
        </div>
      )}
      {driver.suspensionReason && (
        <div className="t-small error-text mt-xs">
          Suspended: {driver.suspensionReason}
        </div>
      )}
      {/* On the row, so an admin about to approve somebody sees it costs money before they click. */}
      {driver.occupiesSeat && (
        <div className="t-small mt-xs">Occupies a billable seat</div>
      )}
      <div className="row mt-sm">
        <Switch
          label="On shift"
          checked={driver.onShift}
          disabled={busy || !isAssignable(driver.status)}
          onChange={(next) => void toggleShift(next)}
        />
        <span className="grow" />
        {driver.activeRideCount > 0 && <span className="t-small muted">On a trip</span>}
        {driver.status !== 'offboarded' && driver.status !== 'invited' && (
          <Button
            variant="text"
            icon={MessageSquare}
            busy={thread.busy}
            aria-label={`Message ${driver.displayName}`}
            onClick={() =>
              void thread.openThread({
                kind: 'dispatchDriver',
                organizationId,
                driverId: driver.id,
              })
            }
          >
            Message
          </Button>
        )}
      </div>
      {props.canAdminister && (
        <div className="actions-row divided">
          {/* Paperwork first: approval is refused without it. */}
          <Button
            variant="outlined"
            icon={FolderOpen}
            disabled={busy}
            onClick={props.onPaperwork}
          >
            Paperwork
          </Button>
          {nextStatusesFor(driver.status).map((to) => (
            <Button
              key={to}
              variant="outlined"
              disabled={busy}
              onClick={() =>
                transitionNeedsReason(to)
                  ? setAskingReasonFor(to)
                  : void changeStatus(to)
              }
            >
              {actionLabel(driver, to)}
            </Button>
          ))}
        </div>
      )}
      {askingReasonFor && (
        <ReasonDialog
          to={askingReasonFor}
          title={
            isRejection(driver, askingReasonFor)
              ? 'Why is the application not accepted?'
              : undefined
          }
          helper={
            isRejection(driver, askingReasonFor)
              ? 'Shown to the applicant in the driver app, so they can put it right and apply again.'
              : undefined
          }
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
 * Offboarding somebody who was never approved is turning their application
 * down; the button says so, and the reason reaches them.
 */
const isRejection = (driver: Driver, to: DriverStatus) =>
  to === 'offboarded' && driver.approvedAt === null && driver.status !== 'invited';

const actionLabel = (driver: Driver, to: DriverStatus) =>
  isRejection(driver, to) ? 'Reject' : transitionActionLabel[to];

/**
 * The code drivers type into the driver app to apply. On the roster because
 * that is where their applications then arrive.
 */
function JoinCodeCard({ organizationId }: { organizationId: string }) {
  const store = useStore();
  const confirm = useConfirm();
  const { showConfirmation } = useFeedback();
  const { run, busy } = useRun();
  const code = useResource(keys.joinCode(organizationId), (api) =>
    api.driverJoinCode(organizationId),
  );

  async function copy() {
    if (!code.value) return;
    try {
      await navigator.clipboard.writeText(code.value);
      showConfirmation('Company code copied');
    } catch {
      // No clipboard (an insecure context, or permission refused): the code is
      // on screen to read out instead.
    }
  }

  async function rotate() {
    const ok = await confirm({
      title: 'Make a new company code?',
      message:
        'The current code stops working straight away. Drivers who already applied are not affected.',
      confirmLabel: 'Make a new code',
    });
    if (!ok) return;
    const result = await run(() =>
      store.guard(() => store.api.rotateDriverJoinCode(organizationId)),
    );
    if (result.ok) store.invalidate(keys.joinCode(organizationId));
  }

  return (
    <Card className="mb-md">
      <div className="row">
        <KeyRound aria-hidden />
        <div className="grow">
          <div className="t-small muted">Company code for new drivers</div>
          <div className="t-title mono">
            {code.value ?? (code.error ? 'Could not load' : '…')}
          </div>
        </div>
        <Button
          variant="text"
          icon={Copy}
          disabled={!code.value}
          onClick={() => void copy()}
        >
          Copy
        </Button>
        <Button
          variant="text"
          icon={RotateCw}
          busy={busy}
          disabled={!code.value}
          onClick={() => void rotate()}
        >
          New code
        </Button>
      </div>
      <div className="t-small muted mt-xs">
        Drivers create an account in the driver app and apply with this code. Their
        application appears here; approve them once their paperwork is checked.
      </div>
    </Card>
  );
}

/**
 * Puts somebody who already has a CareBridge account on the roster.
 *
 * Two steps, and the first is an exact address rather than a search: every
 * account — families included — is in one table, and an operator scrolling
 * through it would be scrolling through them. The server answers one way for
 * everybody it will not add, so neither can this dialog say why.
 *
 * The driver arrives as pending approval with their account already linked.
 * Approval still waits for their paperwork, which they upload in the driver app.
 */
function AddDriverDialog(props: { organizationId: string; onClose: () => void }) {
  const store = useStore();
  const { showFailure } = useFeedback();
  const { run, busy } = useRun();
  const vehicles = useResource(keys.vehicles(props.organizationId), (api) =>
    api.vehicles(props.organizationId),
  );

  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [looking, setLooking] = useState(false);
  const [match, setMatch] = useState<DriverAccountMatch | null>(null);

  const [displayName, setDisplayName] = useState('');
  const [vehicleId, setVehicleId] = useState('');
  const [yearsDriving, setYearsDriving] = useState('');
  const [errors, setErrors] = useState<{
    displayName?: string;
    vehicleId?: string;
    yearsDriving?: string;
  }>({});

  async function lookUp(e: FormEvent) {
    e.preventDefault();
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      setEmailError('Enter the full email address they signed up with.');
      return;
    }
    setEmailError(null);
    setLooking(true);
    try {
      const found = await store.guard(() =>
        store.api.lookupDriverAccount({ organizationId: props.organizationId, email }),
      );
      setMatch(found);
      setDisplayName(found.suggestedDisplayName);
    } catch (error) {
      // "Nobody we can add" belongs under the field, not in a toast that
      // disappears before it is read. Everything else is a real failure.
      if (error instanceof Failure && error.kind === 'validation')
        setEmailError(error.message);
      else showFailure(error);
    } finally {
      setLooking(false);
    }
  }

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!match) return;
    const years = yearsDriving.trim() === '' ? undefined : Number(yearsDriving);
    const next: typeof errors = {};
    if (displayName.trim() === '') next.displayName = 'Required';
    if (vehicleId === '') next.vehicleId = 'Choose the vehicle they will drive';
    if (
      years !== undefined &&
      !(Number.isInteger(years) && years >= 0 && years <= 60)
    ) {
      next.yearsDriving = 'A whole number from 0 to 60';
    }
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    const result = await run(() =>
      store.guard(() =>
        store.api.addDriver({
          organizationId: props.organizationId,
          displayName,
          vehicleId,
          yearsDriving: years,
          userId: match.userId,
        }),
      ),
    );
    if (result.ok) {
      store.invalidateOperational(props.organizationId);
      props.onClose();
    }
  }

  if (!match) {
    return (
      <Modal title="Add a driver" onClose={props.onClose}>
        <form className="stack gap-sm" onSubmit={(e) => void lookUp(e)} noValidate>
          <TextField
            label="Email address"
            type="email"
            autoComplete="off"
            value={email}
            error={emailError}
            helper="The address they signed up to CareBridge with, and have verified."
            onChange={(e) => {
              setEmail(e.target.value);
              setEmailError(null);
            }}
          />
          <div className="dialog-actions">
            <Button variant="text" disabled={looking} onClick={props.onClose}>
              Cancel
            </Button>
            <Button type="submit" icon={Search} busy={looking}>
              {looking ? 'Looking…' : 'Find account'}
            </Button>
          </div>
        </form>
      </Modal>
    );
  }

  const fleet = vehicles.value ?? [];
  return (
    <Modal title="Add a driver" onClose={props.onClose}>
      <form className="stack gap-sm" onSubmit={(e) => void add(e)} noValidate>
        <Card>
          <div className="row">
            <div className="grow">
              <div className="t-body-lg">{match.fullName}</div>
              <div className="t-small muted">{match.email}</div>
            </div>
            <Button variant="text" disabled={busy} onClick={() => setMatch(null)}>
              Change
            </Button>
          </div>
        </Card>
        <TextField
          label="Name on the roster"
          helper="First name and last initial. Families see this at pickup."
          counter={60}
          value={displayName}
          error={errors.displayName}
          onChange={(e) => setDisplayName(e.target.value)}
        />
        {vehicles.value && fleet.length === 0 ? (
          <div className="t-small error-text">
            There are no vehicles yet.{' '}
            <Link to="/fleet">Add one on the Fleet screen</Link> first.
          </div>
        ) : (
          <SelectField
            label="Vehicle"
            value={vehicleId}
            error={errors.vehicleId}
            disabled={!vehicles.value}
            onChange={(e) => setVehicleId(e.target.value)}
          >
            <option value="">{vehicles.value ? 'Choose a vehicle' : 'Loading…'}</option>
            {fleet.map((vehicle) => (
              <option key={vehicle.id} value={vehicle.id}>
                {vehicleLabel(vehicle)} · {vehicle.licensePlate}
                {vehicle.isWheelchairAccessible ? ' · accessible' : ''}
              </option>
            ))}
          </SelectField>
        )}
        <TextField
          label="Years driving (optional)"
          type="number"
          inputMode="numeric"
          min={0}
          max={60}
          value={yearsDriving}
          error={errors.yearsDriving}
          onChange={(e) => setYearsDriving(e.target.value)}
        />
        <div className="t-small muted">
          They join as pending approval. Once they have uploaded their paperwork in the
          driver app, approve them here.
        </div>
        <div className="dialog-actions">
          <Button variant="text" disabled={busy} onClick={props.onClose}>
            Cancel
          </Button>
          <Button type="submit" busy={busy} disabled={fleet.length === 0}>
            {busy ? 'Adding…' : 'Add driver'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * Suspension and offboarding end somebody's ability to earn, and a record of
 * one with no reason is unanswerable three months later. Confirm stays grey
 * until one is typed.
 */
function ReasonDialog(props: {
  to: DriverStatus;
  title?: string;
  helper?: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  return (
    <Modal
      title={props.title ?? `Why ${driverStatusLabel[props.to].toLowerCase()}?`}
      onClose={props.onCancel}
    >
      <TextArea
        label="Reason"
        helper={props.helper ?? 'Recorded against this driver and in the audit log.'}
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
