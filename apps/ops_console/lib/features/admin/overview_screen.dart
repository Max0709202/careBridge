import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app/theme.dart';
import '../../core/money.dart';
import '../../domain/admin.dart';
import '../../state/providers.dart';
import '../../widgets/common.dart';

/// The operational dashboard.
///
/// Every number here implies an action rather than being interesting, and the
/// screen is arranged around that rather than around the shape of the DTO.
/// Four of the fields are work queues — a stale trip is a telephone call, a
/// document awaiting review is a driver who cannot be assigned, an expiring
/// licence is a driver who comes off the road on a date somebody can still
/// move, an invoice past due is money — and they are lifted above the counts.
///
/// The counts are below them, because a dashboard that leads with "rides last
/// week" trains the reader to skim, and the four things that need a person
/// today are the ones that get skimmed.
class AdminOverviewScreen extends ConsumerWidget {
  const AdminOverviewScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final stats = ref.watch(platformStatsProvider);

    return RefreshIndicator(
      onRefresh: () async => ref.invalidate(platformStatsProvider),
      child: stats.when(
        loading: () => const LoadingBlock(),
        error: (error, _) => ListView(
          children: [
            EmptyState(
              icon: Icons.cloud_off_outlined,
              title: 'Could not load the dashboard',
              message: 'Check your connection and try again.',
              action: OutlinedButton(
                onPressed: () => ref.invalidate(platformStatsProvider),
                child: const Text('Retry'),
              ),
            ),
          ],
        ),
        data: (data) => _body(context, data),
      ),
    );
  }

  Widget _body(BuildContext context, PlatformStats stats) {
    final theme = Theme.of(context);

    return ListView(
      padding: const EdgeInsets.all(AppSpacing.md),
      children: [
        if (stats.needsAttention)
          _attention(theme, stats)
        else
          OpsCard(
            child: Row(
              children: [
                const Icon(
                  Icons.check_circle_outline,
                  color: OpsColors.positive,
                ),
                const SizedBox(width: AppSpacing.sm),
                Expanded(
                  child: Text(
                    'Nothing is waiting on a person right now.',
                    style: theme.textTheme.bodyMedium,
                  ),
                ),
              ],
            ),
          ),

        const SectionHeader('Right now'),
        _Tiles(
          children: [
            _StatTile(
              icon: Icons.local_taxi_outlined,
              label: 'Trips in flight',
              value: '${stats.activeRidesNow}',
            ),
            _StatTile(
              icon: Icons.people_outline,
              label: 'Drivers approved',
              value: '${stats.driversApproved}',
            ),
          ],
        ),

        const SectionHeader('The last seven days'),
        _Tiles(
          children: [
            _StatTile(
              icon: Icons.route_outlined,
              label: 'Trips booked',
              value: '${stats.ridesLast7Days}',
            ),
            _StatTile(
              icon: Icons.check_circle_outline,
              label: 'Completed',
              value: '${stats.ridesCompletedLast7Days}',
            ),
            // Beside completions rather than buried. It is the number that
            // says whether the product worked for the people it is for — a
            // no-show is somebody who waited and was not collected.
            _StatTile(
              icon: Icons.person_off_outlined,
              label: 'Nobody travelled',
              value: '${stats.ridesNoShowLast7Days}',
              emphasis: stats.ridesNoShowLast7Days > 0,
            ),
            _StatTile(
              icon: Icons.cancel_outlined,
              label: 'Cancelled',
              value: '${stats.ridesCancelledLast7Days}',
            ),
          ],
        ),
        Padding(
          padding: const EdgeInsets.only(top: AppSpacing.sm),
          child: Text(
            // Null when nothing finished in the window. "0%" and "no trips
            // yet" are different facts, and printing the first for the second
            // is how a quiet week reads as a broken product.
            stats.completionRate == null
                ? 'No trips have reached an end state in the last seven days.'
                : '${(stats.completionRate! * 100).round()}% of the trips that '
                      'ended were completed.',
            style: theme.textTheme.bodySmall?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
            ),
          ),
        ),

        const SectionHeader('Who is paying'),
        _Tiles(
          children: [
            _StatTile(
              icon: Icons.family_restroom_outlined,
              label: 'Households',
              value: '${stats.familiesSubscribed}',
            ),
            _StatTile(
              icon: Icons.business_outlined,
              label: 'Operators',
              value: '${stats.operatorsSubscribed}',
            ),
          ],
        ),

        const SectionHeader('Money, last thirty days'),
        _Tiles(
          children: [
            _StatTile(
              icon: Icons.payments_outlined,
              label: 'Collected',
              value: formatCents(stats.revenueCentsLast30Days),
            ),
            _StatTile(
              icon: Icons.undo_outlined,
              label: 'Refunded',
              value: formatCents(stats.refundedCentsLast30Days),
            ),
            _StatTile(
              icon: Icons.account_balance_outlined,
              label: 'Kept',
              value: formatCents(stats.netRevenueCentsLast30Days),
            ),
          ],
        ),
        Padding(
          padding: const EdgeInsets.only(top: AppSpacing.sm),
          child: Text(
            'Collected is money that settled; refunded is money sent back over '
            'the same window, which may credit an invoice from before it.',
            style: theme.textTheme.bodySmall?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
            ),
          ),
        ),
      ],
    );
  }

  /// The four queues, each with the action it implies said out loud.
  Widget _attention(ThemeData theme, PlatformStats stats) => OpsCard(
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            const Icon(Icons.error_outline, color: OpsColors.overdue),
            const SizedBox(width: AppSpacing.sm),
            Text('Waiting on a person', style: theme.textTheme.titleMedium),
          ],
        ),
        const SizedBox(height: AppSpacing.sm),
        if (stats.staleTrackingNow > 0)
          _ActionRow(
            count: stats.staleTrackingNow,
            what: 'trip(s) in flight have not reported a position recently',
            todo:
                'Telephone the driver — the family is watching a map that '
                'has stopped moving.',
          ),
        if (stats.documentsAwaitingReview > 0)
          _ActionRow(
            count: stats.documentsAwaitingReview,
            what: 'driver document(s) are waiting to be reviewed',
            todo:
                'Each one is a driver who cannot be assigned until somebody '
                'looks.',
          ),
        if (stats.driversWithExpiringDocuments > 0)
          _ActionRow(
            count: stats.driversWithExpiringDocuments,
            what:
                'approved driver(s) have paperwork lapsing within thirty days',
            todo: 'Chase them now; after the date they come off the road.',
          ),
        if (stats.invoicesPastDue > 0)
          _ActionRow(
            count: stats.invoicesPastDue,
            what: 'invoice(s) have failed at least once and are unpaid',
            todo:
                'Dunning is retrying. A card that will never work needs a '
                'conversation rather than another attempt.',
          ),
      ],
    ),
  );
}

/// One queue, its size, and what to do about it.
class _ActionRow extends StatelessWidget {
  const _ActionRow({
    required this.count,
    required this.what,
    required this.todo,
  });

  final int count;
  final String what;
  final String todo;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.sm),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('$count $what', style: theme.textTheme.bodyLarge),
          Text(
            todo,
            style: theme.textTheme.bodySmall?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
            ),
          ),
        ],
      ),
    );
  }
}

/// A wrapping row of tiles, so a narrow window stacks rather than clipping.
class _Tiles extends StatelessWidget {
  const _Tiles({required this.children});

  final List<Widget> children;

  @override
  Widget build(BuildContext context) => Wrap(
    spacing: AppSpacing.sm,
    runSpacing: AppSpacing.sm,
    children: [
      for (final child in children)
        ConstrainedBox(
          constraints: const BoxConstraints(minWidth: 160),
          child: child,
        ),
    ],
  );
}

class _StatTile extends StatelessWidget {
  const _StatTile({
    required this.icon,
    required this.label,
    required this.value,
    this.emphasis = false,
  });

  final IconData icon;
  final String label;
  final String value;

  /// Draws attention with an icon colour **and** the figure's weight, never
  /// with colour alone — the same WCAG 1.4.1 rule the urgency pills follow.
  final bool emphasis;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Semantics(
      label: '$label: $value',
      child: OpsCard(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(
                  icon,
                  size: 16,
                  color: emphasis
                      ? OpsColors.overdue
                      : theme.colorScheme.onSurfaceVariant,
                ),
                const SizedBox(width: AppSpacing.xs),
                Text(
                  label,
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                ),
              ],
            ),
            const SizedBox(height: AppSpacing.xs),
            Text(
              value,
              style: theme.textTheme.titleLarge?.copyWith(
                fontWeight: emphasis ? FontWeight.w700 : FontWeight.w500,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
