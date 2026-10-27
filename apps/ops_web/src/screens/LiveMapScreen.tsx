import { CircleDashed, MapPin, Navigation, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { useConfirm } from '../components/feedback';
import { LiveMap } from '../components/LiveMap';
import {
  Button,
  Card,
  EmptyState,
  LoadFailure,
  LoadingBlock,
  Note,
  RefreshButton,
  Screen,
  StaleBanner,
  TextField,
} from '../components/ui';
import { useRun } from '../components/useRun';
import { formatClock, plural } from '../core/format';
import {
  freshnessOf,
  rideStatusLabel,
  type Coordinates,
  type LiveBoard,
  type LiveRide,
  type ServiceArea,
} from '../domain/liveMap';
import { canAdminister } from '../domain/models';
import {
  useOperatorId,
  useResource,
  useSelectedOrganization,
  useStore,
} from '../state/context';
import { keys, LIVE_POLL_MS } from '../state/opsStore';
import { useLiveRides, useNow } from '../state/tracking';

/**
 * Where the operator works and where its cars are, on one map.
 *
 * The snapshot is polled; positions in between are pushed over the tracking
 * socket. A position too old to trust is not drawn — the list says so instead,
 * because "no marker" and "the driver is fine" must never look the same.
 */
export function LiveMapScreen() {
  const organizationId = useOperatorId();
  const board = useResource(
    keys.liveBoard(organizationId),
    (api) => api.liveBoard(organizationId),
    {
      pollMs: LIVE_POLL_MS,
    },
  );

  let body;
  if (board.value) {
    body = (
      <>
        {board.error ? (
          <StaleBanner error={board.error} onRetry={board.reload} />
        ) : null}
        <LiveMapBody board={board.value} />
      </>
    );
  } else if (board.error) {
    body = <LoadFailure title="Could not load the live map" onRetry={board.reload} />;
  } else {
    body = <LoadingBlock />;
  }

  return (
    <Screen title="Live map" wide actions={<RefreshButton onClick={board.reload} />}>
      {body}
    </Screen>
  );
}

function LiveMapBody({ board }: { board: LiveBoard }) {
  const organization = useSelectedOrganization();
  const rides = useLiveRides(board);
  const now = useNow();
  const [selectedRideId, setSelectedRideId] = useState<string | null>(null);
  const [draft, setDraft] = useState<RadiusDraft | null>(null);

  const isAdmin = organization ? canAdminister(organization) : false;
  const shownArea: ServiceArea | null =
    draft?.center && draft.radiusMiles > 0
      ? { kind: 'radius', center: draft.center, radiusMiles: draft.radiusMiles }
      : board.serviceArea;

  return (
    <div className="live-layout">
      <div className="live-map-pane">
        <LiveMap
          area={shownArea}
          rides={rides}
          now={now}
          selectedRideId={selectedRideId}
          onSelectRide={setSelectedRideId}
          onPickPoint={draft ? (center) => setDraft({ ...draft, center }) : undefined}
        />
      </div>
      <div className="stack gap-sm live-side">
        <ServiceAreaCard
          area={board.serviceArea}
          isAdmin={isAdmin}
          draft={draft}
          onDraft={setDraft}
        />
        {rides.length === 0 ? (
          <EmptyState
            icon={Navigation}
            title="No rides under way"
            message="Cars appear here once a ride is assigned."
          />
        ) : (
          <>
            <div className="t-label">{plural(rides.length, 'ride')} under way</div>
            <ul className="list">
              {rides.map((ride) => (
                <li key={ride.rideId}>
                  <RideCard
                    ride={ride}
                    now={now}
                    selected={ride.rideId === selectedRideId}
                    onSelect={() =>
                      setSelectedRideId(
                        ride.rideId === selectedRideId ? null : ride.rideId,
                      )
                    }
                  />
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}

function RideCard(props: {
  ride: LiveRide;
  now: Date;
  selected: boolean;
  onSelect: () => void;
}) {
  const { ride, now } = props;
  const freshness = freshnessOf(ride.position, now);

  let where;
  if (!ride.position) {
    where = <span className="muted">No position yet</span>;
  } else if (freshness === 'lost') {
    where = <span className="ink-overdue">Lost contact — position not shown</span>;
  } else if (freshness === 'stale') {
    where = <span className="ink-imminent">Position may be out of date</span>;
  } else {
    where = <span className="ink-positive">Live</span>;
  }

  return (
    <Card onClick={props.onSelect} className={props.selected ? 'selected' : undefined}>
      <div className="row">
        <span className="t-title grow">{ride.driverName}</span>
        {ride.etaMinutes != null && freshness !== 'lost' && (
          <span
            className="t-label"
            aria-label={`Arriving in about ${ride.etaMinutes} minutes`}
          >
            ~{ride.etaMinutes} min
          </span>
        )}
      </div>
      <div className="t-small mt-xs">
        {rideStatusLabel(ride.status)} · {ride.patientName} · pickup{' '}
        {formatClock(ride.scheduledPickupAt)}
      </div>
      <div className="t-small mt-xs">
        {where}
        {ride.isDelayed && <span className="ink-overdue"> · Delayed</span>}
      </div>
    </Card>
  );
}

// ─── the service area ───────────────────────────────────────────────────────

interface RadiusDraft {
  center: Coordinates | null;
  radiusMiles: number;
}

function describeArea(area: ServiceArea | null): string {
  if (!area) return 'Not set — nothing in the queue is flagged.';
  if (area.kind === 'radius')
    return `Within ${area.radiusMiles} miles of the point on the map.`;
  return `An outline of ${area.points.length} points.`;
}

function ServiceAreaCard(props: {
  area: ServiceArea | null;
  isAdmin: boolean;
  draft: RadiusDraft | null;
  onDraft: (draft: RadiusDraft | null) => void;
}) {
  const store = useStore();
  const organizationId = useOperatorId();
  const confirm = useConfirm();
  const { run, busy } = useRun();
  const { draft, onDraft } = props;
  const [radiusText, setRadiusText] = useState('');

  const startEditing = () => {
    const start =
      props.area?.kind === 'radius'
        ? { center: props.area.center, radiusMiles: props.area.radiusMiles }
        : { center: null, radiusMiles: 10 };
    setRadiusText(String(start.radiusMiles));
    onDraft(start);
  };

  const save = async () => {
    if (!draft?.center) return;
    const center = draft.center;
    const result = await run(() =>
      store.api.setServiceArea(organizationId, {
        kind: 'radius',
        center,
        radiusMiles: draft.radiusMiles,
      }),
    );
    if (result.ok) {
      onDraft(null);
      store.invalidate(keys.liveBoard(organizationId), keys.queue(organizationId));
    }
  };

  const remove = async () => {
    const yes = await confirm({
      title: 'Remove the service area?',
      message: 'Rides in the queue will no longer be flagged as outside your area.',
      confirmLabel: 'Remove',
      destructive: true,
    });
    if (!yes) return;
    const result = await run(() => store.api.clearServiceArea(organizationId));
    if (result.ok)
      store.invalidate(keys.liveBoard(organizationId), keys.queue(organizationId));
  };

  if (draft) {
    const radiusError =
      draft.radiusMiles > 0 && draft.radiusMiles <= 250
        ? null
        : 'Between 0 and 250 miles.';
    return (
      <Card label="Service area">
        <div className="t-title">Set the service area</div>
        <Note icon={MapPin}>
          {draft.center
            ? 'Click the map again to move the centre.'
            : 'Click the map where the area is centred.'}
        </Note>
        <TextField
          label="Radius (miles)"
          inputMode="decimal"
          value={radiusText}
          error={radiusError}
          onChange={(event) => {
            setRadiusText(event.target.value);
            onDraft({ ...draft, radiusMiles: Number(event.target.value) });
          }}
        />
        <div className="row mt-sm">
          <Button
            onClick={() => void save()}
            busy={busy}
            disabled={!draft.center || radiusError !== null}
          >
            Save area
          </Button>
          <Button variant="text" onClick={() => onDraft(null)} disabled={busy}>
            Cancel
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card label="Service area">
      <div className="row">
        <CircleDashed size={18} aria-hidden />
        <span className="t-title grow">Service area</span>
      </div>
      <div className="t-small mt-xs">{describeArea(props.area)}</div>
      {props.isAdmin ? (
        <div className="row mt-sm">
          <Button variant="tonal" onClick={startEditing}>
            {props.area ? 'Change' : 'Set area'}
          </Button>
          {props.area && (
            <Button
              variant="text"
              icon={Trash2}
              onClick={() => void remove()}
              busy={busy}
            >
              Remove
            </Button>
          )}
        </div>
      ) : (
        <div className="t-small muted mt-xs">Owners and admins can change it.</div>
      )}
    </Card>
  );
}
