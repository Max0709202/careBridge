import { ReceiptText, UserMinus, UserPlus } from 'lucide-react';

import {
  Card,
  EmptyState,
  KeyValue,
  LoadFailure,
  LoadingBlock,
  RefreshButton,
  Screen,
  SectionHeader,
  StaleBanner,
} from '../components/ui';
import { formatDay } from '../core/format';
import { formatCents } from '../core/money';
import { isGrant, pendingAtRenewal, type SeatSummary } from '../domain/models';
import { useOperatorId, useResource } from '../state/context';
import { keys } from '../state/opsStore';

/**
 * What this operator is billed, and the ledger behind it. A port of
 * apps/ops_console/lib/features/seats/seats_screen.dart.
 *
 * It exists for one question — "why were we billed for eleven drivers?" — and
 * the append-only seat ledger is the only thing that can answer it once the
 * roster has moved on. A bill nobody can check is a bill somebody disputes.
 */
export function SeatsScreen() {
  const organizationId = useOperatorId();
  const seats = useResource(keys.seats(organizationId), (api) =>
    api.seats(organizationId),
  );

  let body;
  if (seats.value) {
    body = (
      <>
        {seats.error ? (
          <StaleBanner error={seats.error} onRetry={seats.reload} />
        ) : null}
        <SeatsBody summary={seats.value} />
      </>
    );
  } else if (seats.error) {
    body = <LoadFailure title="Could not load seats" onRetry={seats.reload} />;
  } else {
    body = <LoadingBlock />;
  }

  return (
    <Screen title="Seats" actions={<RefreshButton onClick={seats.reload} />}>
      {body}
    </Screen>
  );
}

function SeatsBody({ summary }: { summary: SeatSummary }) {
  const pending = pendingAtRenewal(summary);

  return (
    <>
      <Card>
        <h2 className="t-title">Seats</h2>
        <div className="mt-sm">
          <KeyValue label="Drivers on the road" value={summary.activeDrivers} />
          <KeyValue label="Billed at last renewal" value={summary.billedSeats} />
          {summary.renewalTotalCents !== null && (
            <KeyValue
              label="Next renewal"
              value={formatCents(summary.renewalTotalCents)}
            />
          )}
        </div>
        {/*
          The two numbers differ whenever a driver was approved mid-period, and
          that is not a discrepancy — explained here, on the screen that shows
          both, rather than queried later.
        */}
        {pending !== 0 && (
          <p className="t-small muted mt-sm">
            {pending > 0
              ? `${pending} seat(s) added since the last renewal — charged pro rata now, and folded into the recurring amount at renewal.`
              : `${-pending} seat(s) released — they stay usable until the period that paid for them ends, and are not refunded.`}
          </p>
        )}
      </Card>
      <SectionHeader title="Seat ledger" />
      {summary.ledger.length === 0 ? (
        <EmptyState
          icon={ReceiptText}
          title="No seat changes yet"
          message="Approving or offboarding a driver records an entry here."
        />
      ) : (
        <ul className="list">
          {summary.ledger.map((entry) => (
            <li key={entry.id}>
              <Card>
                <div className="row">
                  {isGrant(entry) ? (
                    <UserPlus
                      size={18}
                      className="ink-positive"
                      aria-label="Seat granted"
                    />
                  ) : (
                    <UserMinus size={18} className="muted" aria-label="Seat released" />
                  )}
                  <div className="grow">
                    <div>{entry.driverDisplayName}</div>
                    <div className="t-small muted">
                      {formatDay(entry.at)} · {entry.seatsAfter} seat(s) after
                    </div>
                  </div>
                  {/* Zero on a release is the rule, not a gap: a released seat is not refunded. */}
                  <span>
                    {entry.prorationCents > 0 ? formatCents(entry.prorationCents) : '—'}
                  </span>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
