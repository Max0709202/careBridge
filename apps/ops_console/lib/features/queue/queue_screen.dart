import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../app/theme.dart';
import '../../domain/dispatch.dart';
import '../../domain/models.dart';
import '../../state/providers.dart';
import '../../widgets/common.dart';
import 'assign_sheet.dart';

/// The queue a dispatcher works.
///
/// Two decisions carry this screen.
///
/// **It is ordered by when the car is needed, not by when the request
/// arrived.** That ordering is the server's — `dispatchQueue` in
/// domain/dispatch.ts — and the console renders it rather than re-sorting. A
/// ride booked this morning for 4pm is not more urgent than one booked five
/// minutes ago for 2pm, and first-in-first-out quietly optimises for the
/// dispatcher's sense of fairness rather than for the person waiting.
///
/// **A ride nobody can take is called out before a ride that merely has not
/// been assigned yet.** Those are different problems: one needs a tap, the
/// other needs a phone call, and a queue that presents them identically buries
/// the second behind the first.
class QueueScreen extends ConsumerStatefulWidget {
  const QueueScreen({super.key});

  @override
  ConsumerState<QueueScreen> createState() => _QueueScreenState();
}

class _QueueScreenState extends ConsumerState<QueueScreen> {
  Timer? _poll;

  @override
  void initState() {
    super.initState();
    // A dispatcher leaves this open all day, and a ride a family booked two
    // minutes ago has to appear without anyone pressing anything.
    _poll = Timer.periodic(queuePollInterval, (_) {
      final id = ref.read(selectedOrganizationIdProvider);
      if (id != null && mounted) ref.invalidate(queueProvider(id));
    });
  }

  @override
  void dispose() {
    _poll?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final organizationId = ref.watch(selectedOrganizationIdProvider);
    if (organizationId == null) return const LoadingBlock();

    final queue = ref.watch(queueProvider(organizationId));

    return RefreshIndicator(
      onRefresh: () async => ref.invalidate(queueProvider(organizationId)),
      child: queue.when(
        loading: () => const LoadingBlock(),
        error: (error, _) => ListView(
          children: [
            EmptyState(
              icon: Icons.cloud_off_outlined,
              title: 'Could not load the queue',
              message: 'Check your connection and try again.',
              action: OutlinedButton(
                onPressed: () => ref.invalidate(queueProvider(organizationId)),
                child: const Text('Retry'),
              ),
            ),
          ],
        ),
        data: (data) => _body(context, organizationId, data),
      ),
    );
  }

  Widget _body(
    BuildContext context,
    String organizationId,
    DispatchQueue queue,
  ) {
    if (queue.isEmpty) {
      return ListView(
        children: [
          EmptyState(
            icon: Icons.check_circle_outline,
            title: 'Nothing waiting',
            message:
                'Every requested ride has a driver. '
                '${queue.availableDrivers} driver(s) free right now.',
          ),
        ],
      );
    }

    return ListView(
      padding: const EdgeInsets.all(AppSpacing.md),
      children: [
        _summary(context, queue),
        const SizedBox(height: AppSpacing.md),
        for (final item in queue.items) ...[
          _QueueRow(
            item: item,
            onAssign: () => _assign(context, organizationId, item),
          ),
          const SizedBox(height: AppSpacing.sm),
        ],
      ],
    );
  }

  Widget _summary(BuildContext context, DispatchQueue queue) {
    final theme = Theme.of(context);
    final stranded = queue.strandedCount;

    return OpsCard(
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '${queue.items.length} waiting · ${queue.availableDrivers} free',
                  style: theme.textTheme.titleMedium,
                ),
                if (queue.overdueCount > 0)
                  Text(
                    '${queue.overdueCount} past their pickup time',
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: OpsColors.overdue,
                    ),
                  ),
                // The number to act on first: these will not happen unless
                // somebody makes a phone call, and no amount of tapping in
                // this screen will fix them.
                if (stranded > 0)
                  Text(
                    '$stranded with nobody available — needs a call, not a tap',
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: OpsColors.overdue,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Future<void> _assign(
    BuildContext context,
    String organizationId,
    QueueItem item,
  ) async {
    final assigned = await showAssignSheet(
      context: context,
      ref: ref,
      organizationId: organizationId,
      item: item,
    );
    if (assigned == true && mounted) {
      refreshOperationalState(ref, organizationId);
    }
  }
}

class _QueueRow extends StatelessWidget {
  const _QueueRow({required this.item, required this.onAssign});

  final QueueItem item;
  final VoidCallback onAssign;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final time = DateFormat('HH:mm').format(item.scheduledPickupAt.toLocal());
    final stranded = !item.hasAnyoneAvailable;

    return OpsCard(
      onTap: stranded ? null : onAssign,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              UrgencyPill(item.urgency),
              const SizedBox(width: AppSpacing.sm),
              Text(time, style: theme.textTheme.titleMedium),
              const Spacer(),
              if (item.isReassignment)
                Padding(
                  padding: const EdgeInsets.only(right: AppSpacing.sm),
                  child: Tooltip(
                    message: 'The previous driver dropped this trip',
                    child: Icon(
                      Icons.swap_horiz,
                      size: 18,
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                  ),
                ),
              // Accessibility requirements are a hard constraint on assignment,
              // never a preference — so they are on the row itself rather than
              // hidden behind a tap.
              if (item.wheelchairRequired)
                const Tooltip(
                  message: 'Needs a wheelchair-accessible vehicle',
                  child: Icon(Icons.accessible, size: 18),
                ),
              if (item.assistanceRequired)
                const Padding(
                  padding: EdgeInsets.only(left: AppSpacing.xs),
                  child: Tooltip(
                    message: 'Door-through-door assistance',
                    child: Icon(Icons.support_outlined, size: 18),
                  ),
                ),
            ],
          ),
          const SizedBox(height: AppSpacing.sm),
          Text(item.patientName, style: theme.textTheme.bodyLarge),
          const SizedBox(height: AppSpacing.xs),
          Text(
            '${item.pickupLine}  →  ${item.destinationLine}',
            style: theme.textTheme.bodySmall?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
            ),
          ),
          const SizedBox(height: AppSpacing.sm),
          if (stranded)
            _NobodyAvailable(item: item)
          else
            Align(
              alignment: Alignment.centerLeft,
              child: FilledButton.tonal(
                onPressed: onAssign,
                child: Text(
                  item.isReassignment
                      ? 'Reassign (${item.eligibleCandidates.length} available)'
                      : 'Assign (${item.eligibleCandidates.length} available)',
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/// Why nobody can take this trip, and what would change that.
///
/// The whole reason the API returns *every* reason rather than the first:
/// "nobody is on shift" and "nobody has an accessible vehicle" need different
/// phone calls, and collapsing them into "no drivers available" turns a
/// two-minute fix into a cancelled appointment.
class _NobodyAvailable extends StatelessWidget {
  const _NobodyAvailable({required this.item});

  final QueueItem item;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    // Counted across candidates so the dispatcher sees the shape of the
    // problem — "four off shift" is a different call from "one off shift".
    final counts = <IneligibilityReason, int>{};
    for (final candidate in item.candidates) {
      for (final reason in candidate.reasons) {
        counts[reason] = (counts[reason] ?? 0) + 1;
      }
    }

    final ordered = counts.entries.toList()
      ..sort((a, b) => b.value.compareTo(a.value));

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(AppSpacing.sm),
      decoration: BoxDecoration(
        color: OpsColors.overdueContainer,
        borderRadius: AppRadius.controlAll,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(
                Icons.phone_in_talk_outlined,
                size: 16,
                color: OpsColors.overdue,
              ),
              const SizedBox(width: AppSpacing.xs),
              Text(
                item.candidates.isEmpty
                    ? 'No drivers on this roster'
                    : 'Nobody available for this trip',
                style: theme.textTheme.bodySmall?.copyWith(
                  color: OpsColors.overdue,
                  fontWeight: FontWeight.w500,
                ),
              ),
            ],
          ),
          for (final entry in ordered)
            Padding(
              padding: const EdgeInsets.only(top: AppSpacing.xs),
              child: Text(
                '${entry.value} × ${entry.key.label}'
                '${entry.key.remedy == null ? '' : ' — ${entry.key.remedy}'}',
                style: theme.textTheme.bodySmall?.copyWith(
                  color: OpsColors.overdue,
                ),
              ),
            ),
        ],
      ),
    );
  }
}
