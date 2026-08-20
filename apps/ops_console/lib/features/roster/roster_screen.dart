import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app/theme.dart';
import '../../domain/dispatch.dart';
import '../../domain/models.dart';
import '../../state/providers.dart';
import '../../widgets/common.dart';

/// The roster: who may drive, and who is driving today.
///
/// Two controls that look similar and are not. **Shift** is a scheduling fact
/// a dispatcher owns — they are the person who knows somebody called in sick,
/// and waiting for an administrator would leave the queue offering a driver
/// who is not there. **Status** is the company's standing decision about
/// whether this person may carry a passenger at all, and crossing into or out
/// of `approved` moves a billable seat in the same transaction. So the first
/// is available to a dispatcher and the second is not.
class RosterScreen extends ConsumerWidget {
  const RosterScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final organizationId = ref.watch(selectedOrganizationIdProvider);
    if (organizationId == null) return const LoadingBlock();

    final drivers = ref.watch(driversProvider(organizationId));
    final organization = ref.watch(selectedOrganizationProvider);
    final canAdminister = organization?.canAdminister ?? false;

    return RefreshIndicator(
      onRefresh: () async => ref.invalidate(driversProvider(organizationId)),
      child: drivers.when(
        loading: () => const LoadingBlock(),
        error: (error, _) => ListView(
          children: [
            EmptyState(
              icon: Icons.cloud_off_outlined,
              title: 'Could not load the roster',
              message: 'Check your connection and try again.',
              action: OutlinedButton(
                onPressed: () =>
                    ref.invalidate(driversProvider(organizationId)),
                child: const Text('Retry'),
              ),
            ),
          ],
        ),
        data: (list) {
          if (list.isEmpty) {
            return ListView(
              children: const [
                EmptyState(
                  icon: Icons.people_outline,
                  title: 'No drivers yet',
                  message:
                      'Add a vehicle first, then the driver who will be in it.',
                ),
              ],
            );
          }

          return ListView(
            padding: const EdgeInsets.all(AppSpacing.md),
            children: [
              for (final driver in list) ...[
                _DriverRow(
                  driver: driver,
                  organizationId: organizationId,
                  canAdminister: canAdminister,
                ),
                const SizedBox(height: AppSpacing.sm),
              ],
            ],
          );
        },
      ),
    );
  }
}

class _DriverRow extends ConsumerStatefulWidget {
  const _DriverRow({
    required this.driver,
    required this.organizationId,
    required this.canAdminister,
  });

  final Driver driver;
  final String organizationId;
  final bool canAdminister;

  @override
  ConsumerState<_DriverRow> createState() => _DriverRowState();
}

class _DriverRowState extends ConsumerState<_DriverRow> {
  bool _busy = false;

  Future<void> _run(Future<void> Function() action) async {
    setState(() => _busy = true);
    try {
      await action();
      if (mounted) refreshOperationalState(ref, widget.organizationId);
    } catch (error) {
      if (mounted) showFailure(context, error);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _toggleShift(bool onShift) => _run(
    () async => ref
        .read(opsApiProvider)
        .setShift(
          organizationId: widget.organizationId,
          driverId: widget.driver.id,
          onShift: onShift,
        ),
  );

  Future<void> _changeStatus(DriverStatus to) async {
    String? reason;

    if (transitionNeedsReason(to)) {
      reason = await _askReason(to);
      // Cancelled at the prompt. Suspension and offboarding both end
      // somebody's ability to earn, and a record of one with no reason is
      // unanswerable three months later when they ask why.
      if (reason == null || reason.trim().isEmpty) return;
    }

    await _run(
      () async => ref
          .read(opsApiProvider)
          .setDriverStatus(
            organizationId: widget.organizationId,
            driverId: widget.driver.id,
            to: to,
            reason: reason,
          ),
    );
  }

  Future<String?> _askReason(DriverStatus to) {
    final controller = TextEditingController();

    return showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text('Why ${to.label.toLowerCase()}?'),
        content: TextField(
          controller: controller,
          autofocus: true,
          maxLength: 300,
          decoration: const InputDecoration(
            labelText: 'Reason',
            helperText: 'Recorded against this driver and in the audit log.',
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(controller.text),
            child: const Text('Confirm'),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final driver = widget.driver;
    final transitions = nextStatusesFor(driver.status);

    return OpsCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  driver.displayName,
                  style: theme.textTheme.titleMedium,
                ),
              ),
              DriverStatusPill(driver.status),
            ],
          ),
          const SizedBox(height: AppSpacing.xs),
          Text(
            '${driver.vehicle.label} · ${driver.vehicle.licensePlate}'
            '${driver.vehicle.isWheelchairAccessible ? ' · accessible' : ''}',
            style: theme.textTheme.bodySmall?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
            ),
          ),
          if (driver.suspensionReason != null)
            Padding(
              padding: const EdgeInsets.only(top: AppSpacing.xs),
              child: Text(
                'Suspended: ${driver.suspensionReason}',
                style: theme.textTheme.bodySmall?.copyWith(
                  color: theme.colorScheme.error,
                ),
              ),
            ),
          // Said on the row rather than only on the seats screen: an admin
          // about to approve somebody should see that it costs money before
          // they tap, not discover it on an invoice.
          if (driver.occupiesSeat)
            Padding(
              padding: const EdgeInsets.only(top: AppSpacing.xs),
              child: Text(
                'Occupies a billable seat',
                style: theme.textTheme.bodySmall,
              ),
            ),
          const SizedBox(height: AppSpacing.sm),
          Row(
            children: [
              // A dispatcher's control, not an administrator's.
              Switch(
                value: driver.onShift,
                onChanged: _busy || !driver.status.isAssignable
                    ? null
                    : _toggleShift,
              ),
              Text('On shift', style: theme.textTheme.bodyMedium),
              const Spacer(),
              if (driver.activeRideCount > 0)
                Text(
                  'On a trip',
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                ),
            ],
          ),
          if (widget.canAdminister && transitions.isNotEmpty) ...[
            const Divider(height: AppSpacing.lg),
            Wrap(
              spacing: AppSpacing.sm,
              children: [
                for (final to in transitions)
                  OutlinedButton(
                    onPressed: _busy ? null : () => _changeStatus(to),
                    child: Text(_actionLabel(to)),
                  ),
              ],
            ),
          ],
        ],
      ),
    );
  }

  /// The verb, not the destination state.
  ///
  /// "Approve" rather than "Approved": a button is named for what it does.
  String _actionLabel(DriverStatus to) => switch (to) {
    DriverStatus.pendingApproval => 'Send for approval',
    DriverStatus.approved => 'Approve',
    DriverStatus.suspended => 'Suspend',
    DriverStatus.offboarded => 'Offboard',
    DriverStatus.invited => 'Invite',
  };
}
