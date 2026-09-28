import {
  Building2,
  CarTaxiFront,
  CircleAlert,
  CircleCheck,
  CircleX,
  HandCoins,
  Home,
  Landmark,
  Route,
  Undo2,
  UserX,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';

import {
  Card,
  LoadFailure,
  LoadingBlock,
  RefreshButton,
  Screen,
  SectionHeader,
  StaleBanner,
} from '../../components/ui';
import { formatCents } from '../../core/money';
import { completionRate, needsAttention, netRevenueCentsLast30Days, type PlatformStats } from '../../domain/admin';
import { useResource } from '../../state/context';
import { keys } from '../../state/opsStore';

/**
 * The operational dashboard. A port of
 * apps/ops_console/lib/features/admin/overview_screen.dart.
 *
 * Every number implies an action. Four of them are work queues — a stale trip
 * is a telephone call, a document awaiting review is a driver who cannot be
 * assigned — and they are lifted above the counts, because a dashboard that
 * leads with "rides last week" trains the reader to skim.
 */
export function OverviewScreen() {
  const stats = useResource(keys.platformStats, (api) => api.stats());

  let body;
  if (stats.value) {
    body = (
      <>
        {stats.error ? <StaleBanner error={stats.error} onRetry={stats.reload} /> : null}
        <OverviewBody stats={stats.value} />
      </>
    );
  } else if (stats.error) {
    body = <LoadFailure title="Could not load the dashboard" onRetry={stats.reload} />;
  } else {
    body = <LoadingBlock />;
  }

  return (
    <Screen title="Overview" actions={<RefreshButton onClick={stats.reload} />}>
      {body}
    </Screen>
  );
}

function OverviewBody({ stats }: { stats: PlatformStats }) {
  const rate = completionRate(stats);

  return (
    <>
      {needsAttention(stats) ? (
        <Attention stats={stats} />
      ) : (
        <Card>
          <p className="row gap-xs">
            <CircleCheck size={20} className="ink-positive" aria-hidden />
            Nothing is waiting on a person right now.
          </p>
        </Card>
      )}

      <SectionHeader title="Right now" />
      <Tiles>
        <StatTile icon={CarTaxiFront} label="Trips in flight" value={stats.activeRidesNow} />
        <StatTile icon={Users} label="Drivers approved" value={stats.driversApproved} />
      </Tiles>

      <SectionHeader title="The last seven days" />
      <Tiles>
        <StatTile icon={Route} label="Trips booked" value={stats.ridesLast7Days} />
        <StatTile icon={CircleCheck} label="Completed" value={stats.ridesCompletedLast7Days} />
        {/* Beside completions rather than buried: a no-show is somebody who waited and was not collected. */}
        <StatTile
          icon={UserX}
          label="Nobody travelled"
          value={stats.ridesNoShowLast7Days}
          emphasis={stats.ridesNoShowLast7Days > 0}
        />
        <StatTile icon={CircleX} label="Cancelled" value={stats.ridesCancelledLast7Days} />
      </Tiles>
      {/* "0%" and "no trips yet" are different facts. */}
      <p className="t-small muted mt-sm">
        {rate === null
          ? 'No trips have reached an end state in the last seven days.'
          : `${Math.round(rate * 100)}% of the trips that ended were completed.`}
      </p>

      <SectionHeader title="Who is paying" />
      <Tiles>
        <StatTile icon={Home} label="Households" value={stats.familiesSubscribed} />
        <StatTile icon={Building2} label="Operators" value={stats.operatorsSubscribed} />
      </Tiles>

      <SectionHeader title="Money, last thirty days" />
      <Tiles>
        <StatTile icon={HandCoins} label="Collected" value={formatCents(stats.revenueCentsLast30Days)} />
        <StatTile icon={Undo2} label="Refunded" value={formatCents(stats.refundedCentsLast30Days)} />
        <StatTile icon={Landmark} label="Kept" value={formatCents(netRevenueCentsLast30Days(stats))} />
      </Tiles>
      <p className="t-small muted mt-sm">
        Collected is money that settled; refunded is money sent back over the same window, which may credit an invoice
        from before it.
      </p>
    </>
  );
}

/** The four queues, each with the action it implies said out loud. */
function Attention({ stats }: { stats: PlatformStats }) {
  return (
    <Card label="Waiting on a person">
      <h2 className="row gap-xs t-title">
        <CircleAlert size={20} className="ink-overdue" aria-hidden />
        Waiting on a person
      </h2>
      <div className="stack gap-sm mt-sm">
        {stats.staleTrackingNow > 0 && (
          <ActionRow
            count={stats.staleTrackingNow}
            what="trip(s) in flight have not reported a position recently"
            todo="Telephone the driver — the family is watching a map that has stopped moving."
          />
        )}
        {stats.documentsAwaitingReview > 0 && (
          <ActionRow
            count={stats.documentsAwaitingReview}
            what="driver document(s) are waiting to be reviewed"
            todo="Each one is a driver who cannot be assigned until somebody looks."
          />
        )}
        {stats.driversWithExpiringDocuments > 0 && (
          <ActionRow
            count={stats.driversWithExpiringDocuments}
            what="approved driver(s) have paperwork lapsing within thirty days"
            todo="Chase them now; after the date they come off the road."
          />
        )}
        {stats.invoicesPastDue > 0 && (
          <ActionRow
            count={stats.invoicesPastDue}
            what="invoice(s) have failed at least once and are unpaid"
            todo="Dunning is retrying. A card that will never work needs a conversation rather than another attempt."
          />
        )}
      </div>
    </Card>
  );
}

function ActionRow(props: { count: number; what: string; todo: string }) {
  return (
    <div>
      <div className="t-body-lg">
        {props.count} {props.what}
      </div>
      <div className="t-small muted">{props.todo}</div>
    </div>
  );
}

function Tiles({ children }: { children: ReactNode }) {
  return <div className="tiles">{children}</div>;
}

/** Attention is drawn with the icon colour **and** the figure's weight, never colour alone. */
function StatTile(props: { icon: LucideIcon; label: string; value: number | string; emphasis?: boolean }) {
  const Icon = props.icon;
  return (
    <Card className="tile" label={`${props.label}: ${props.value}`}>
      <div className="row gap-xs t-small muted">
        <Icon size={16} className={props.emphasis ? 'ink-overdue' : undefined} aria-hidden />
        {props.label}
      </div>
      <div className={`tile-value${props.emphasis ? ' bold' : ''}`}>{props.value}</div>
    </Card>
  );
}
