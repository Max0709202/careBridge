import {
  ArrowLeftRight,
  Accessibility,
  CircleCheck,
  HandHelping,
  MessageSquare,
  PhoneCall,
} from 'lucide-react';
import { useState } from 'react';

import { OutsideAreaPill, UrgencyPill } from '../components/pills';
import {
  Button,
  Card,
  EmptyState,
  LoadFailure,
  LoadingBlock,
  RefreshButton,
  Screen,
  StaleBanner,
} from '../components/ui';
import { formatClock, plural } from '../core/format';
import {
  reasonLabel,
  reasonRemedy,
  type IneligibilityReason,
} from '../domain/dispatch';
import {
  eligibleCandidates,
  hasAnyoneAvailable,
  isReassignment,
  overdueCount,
  strandedCount,
  type DispatchQueue,
  type QueueItem,
} from '../domain/models';
import { useOperatorId, useResource, useStore } from '../state/context';
import { keys, QUEUE_POLL_MS } from '../state/opsStore';
import { AssignSheet } from './AssignSheet';
import { useOpenThread } from './messages/useOpenThread';

/**
 * The queue a dispatcher works. A port of
 * apps/ops_console/lib/features/queue/queue_screen.dart.
 *
 * **Ordered by when the car is needed, not by when the request arrived** —
 * the server's order, rendered rather than re-sorted.
 *
 * **A ride nobody can take is called out before a ride that merely has not
 * been assigned yet.** One needs a click, the other needs a phone call.
 */
export function QueueScreen() {
  const store = useStore();
  const organizationId = useOperatorId();
  const queue = useResource(
    keys.queue(organizationId),
    (api) => api.queue(organizationId),
    {
      pollMs: QUEUE_POLL_MS,
    },
  );
  const [assigning, setAssigning] = useState<QueueItem | null>(null);

  let body;
  if (queue.value) {
    body = (
      <>
        {queue.error ? (
          <StaleBanner error={queue.error} onRetry={queue.reload} />
        ) : null}
        <QueueBody queue={queue.value} onAssign={setAssigning} />
      </>
    );
  } else if (queue.error) {
    body = <LoadFailure title="Could not load the queue" onRetry={queue.reload} />;
  } else {
    body = <LoadingBlock />;
  }

  return (
    <Screen title="Queue" actions={<RefreshButton onClick={queue.reload} />}>
      {body}
      {assigning && (
        <AssignSheet
          organizationId={organizationId}
          item={assigning}
          onClose={(assigned) => {
            setAssigning(null);
            if (assigned) store.invalidateOperational(organizationId);
          }}
        />
      )}
    </Screen>
  );
}

function QueueBody({
  queue,
  onAssign,
}: {
  queue: DispatchQueue;
  onAssign: (item: QueueItem) => void;
}) {
  if (queue.items.length === 0) {
    return (
      <EmptyState
        icon={CircleCheck}
        title="Nothing waiting"
        message={`Every requested ride has a driver. ${plural(queue.availableDrivers, 'driver')} free right now.`}
      />
    );
  }

  const stranded = strandedCount(queue);
  const overdue = overdueCount(queue);

  return (
    <div className="stack gap-sm">
      <Card label="Queue summary">
        <div className="t-title">
          {queue.items.length} waiting · {queue.availableDrivers} free
        </div>
        {overdue > 0 && (
          <div className="t-small ink-overdue">{overdue} past their pickup time</div>
        )}
        {/* The number to act on first: no amount of clicking here will fix these. */}
        {stranded > 0 && (
          <div className="t-small ink-overdue bold">
            {stranded} with nobody available — needs a call, not a tap
          </div>
        )}
      </Card>
      <ul className="list">
        {queue.items.map((item) => (
          <li key={item.rideId}>
            <QueueRow item={item} onAssign={() => onAssign(item)} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function QueueRow({ item, onAssign }: { item: QueueItem; onAssign: () => void }) {
  const organizationId = useOperatorId();
  const { openThread, busy } = useOpenThread();
  const stranded = !hasAnyoneAvailable(item);
  const available = eligibleCandidates(item).length;
  const reassignment = isReassignment(item);

  return (
    <Card>
      <div className="row">
        <UrgencyPill urgency={item.urgency} />
        <span className="t-title">{formatClock(item.scheduledPickupAt)}</span>
        {/* Only a definite "outside": unknown (no area, or an unlocated address) is not flagged. */}
        {item.pickupInServiceArea === false && <OutsideAreaPill />}
        <span className="grow" />
        {reassignment && (
          <span className="muted" title="The previous driver dropped this trip">
            <ArrowLeftRight
              size={18}
              aria-label="The previous driver dropped this trip"
            />
          </span>
        )}
        {/*
          Accessibility requirements are a hard constraint on assignment, never
          a preference — so they are on the row itself, not behind a click.
        */}
        {item.wheelchairRequired && (
          <span title="Needs a wheelchair-accessible vehicle">
            <Accessibility
              size={18}
              aria-label="Needs a wheelchair-accessible vehicle"
            />
          </span>
        )}
        {item.assistanceRequired && (
          <span title="Door-through-door assistance">
            <HandHelping size={18} aria-label="Door-through-door assistance" />
          </span>
        )}
      </div>
      <div className="t-body-lg mt-sm">{item.patientName}</div>
      <div className="t-small muted mt-xs">
        {item.pickupLine} → {item.destinationLine}
      </div>
      <div className="mt-sm">
        {stranded ? (
          <NobodyAvailable item={item} />
        ) : (
          <Button variant="tonal" onClick={onAssign}>
            {reassignment ? 'Reassign' : 'Assign'} ({available} available)
          </Button>
        )}
      </div>
      {/*
        The family thread about this trip, with the patient and the family
        callable from it — the "needs a call, not a tap" case above included.
      */}
      <div className="mt-sm">
        <Button
          variant="text"
          icon={MessageSquare}
          busy={busy}
          aria-label={`Message ${item.patientName}'s family about this trip`}
          onClick={() =>
            void openThread({
              kind: 'dispatchFamily',
              organizationId,
              rideId: item.rideId,
            })
          }
        >
          Message family
        </Button>
      </div>
    </Card>
  );
}

/**
 * Why nobody can take this trip, and what would change that. Counted across
 * candidates so the dispatcher sees the shape of the problem — "four off
 * shift" is a different call from "one off shift".
 */
function NobodyAvailable({ item }: { item: QueueItem }) {
  const counts = new Map<IneligibilityReason, number>();
  for (const candidate of item.candidates) {
    for (const reason of candidate.reasons)
      counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  const ordered = [...counts.entries()].sort((a, b) => b[1] - a[1]);

  return (
    <div className="stranded" role="note">
      <div className="row gap-xs bold">
        <PhoneCall size={16} aria-hidden />
        {item.candidates.length === 0
          ? 'No drivers on this roster'
          : 'Nobody available for this trip'}
      </div>
      {ordered.map(([reason, count]) => (
        <div key={reason} className="mt-xs">
          {count} × {reasonLabel[reason]}
          {reasonRemedy[reason] ? ` — ${reasonRemedy[reason]}` : ''}
        </div>
      ))}
    </div>
  );
}
