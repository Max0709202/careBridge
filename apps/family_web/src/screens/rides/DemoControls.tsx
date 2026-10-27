import { CircleCheck, FlaskConical, Pause, Play, Clock } from 'lucide-react';

import { useRun } from '../../components/useRun';
import { AppCard, Button } from '../../components/ui';
import { rideIsTerminal } from '../../domain/statuses';
import { rideById } from '../../state/careState';
import { useCare, useStore } from '../../state/context';

/**
 * Stand-in controls for the driver app and dispatch. "Run the trip" asks the
 * **server** to drive the ride through the same transition endpoint a real
 * driver's app calls; "Report a delay" sets the same flag a dispatcher would.
 * Neither has a privileged path. Marked as a preview tool so it can never be
 * mistaken for a family-facing feature. Port of demo_controls.dart.
 */
export function DemoControls({ rideId }: { rideId: string }) {
  const state = useCare();
  const store = useStore();
  const { run, busy } = useRun();
  const ride = rideById(state, rideId);
  if (!ride || rideIsTerminal(ride.status)) return null;

  // From the server's snapshot rather than a local flag, so it is right after
  // a reload or on a second device.
  const running = store.isPreviewRunning(rideId);

  return (
    <AppCard border="outline">
      <div className="row tight">
        <FlaskConical className="muted" aria-hidden />
        <p className="t-title muted grow">Preview controls</p>
      </div>
      <p className="t-small muted mt-xs">
        The driver app and dispatch service do not exist yet. These stand in for them,
        and drive the same state machine on the same server a real driver would.
      </p>
      <div className="wrap mt-md">
        {!running ? (
          <Button
            variant="tonal"
            icon={Play}
            disabled={busy}
            onClick={() => run(() => store.startPreviewTrip(rideId))}
          >
            {ride.status === 'awaitingAssignment' || ride.status === 'requested'
              ? 'Assign a driver and run the trip'
              : 'Continue the trip'}
          </Button>
        ) : (
          <Button
            variant="outlined"
            icon={Pause}
            disabled={busy}
            onClick={() => run(() => store.stopPreviewTrip(rideId))}
          >
            Pause
          </Button>
        )}
        <Button
          variant="outlined"
          icon={ride.isDelayed ? CircleCheck : Clock}
          disabled={busy}
          onClick={() =>
            run(() =>
              store.setDelay(
                rideId,
                !ride.isDelayed,
                ride.isDelayed ? undefined : 'Heavy traffic on Route 315',
              ),
            )
          }
        >
          {ride.isDelayed ? 'Clear the delay' : 'Report a delay'}
        </Button>
      </div>
    </AppCard>
  );
}
